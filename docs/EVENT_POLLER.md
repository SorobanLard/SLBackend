# Stellar Event Poller Architecture

This document describes how SorobanLard watches the Stellar contract for on-chain
events, how progress is checkpointed, what happens when the RPC or database is
unavailable, and how to replay or backfill events.

Related code:

- `src/modules/events/events.service.ts` — poll loop, checkpoint handling, event handlers
- `src/common/stellar/stellar.service.ts` — Soroban RPC access (`getEvents`, `getLatestLedger`)
- `src/modules/health/health.controller.ts` — checkpoint health endpoints
- `prisma/migrations/20260827000000_add_event_poller_checkpoint/migration.sql` — checkpoint table

---

## 1. Overview

The backend does not subscribe to Stellar events over a websocket. It uses a
cron-style **pull** model:

```
NestJS @Cron(EVERY_5_SECONDS)
        │
        ▼
EventsService.pollEvents()
        │
        ├── StellarService.fetchContractEvents(lastProcessedLedger)
        │       └── Soroban RPC getEvents({ startLedger, contractIds, limit: 100 })
        │
        ├── EventsService.processEvent(event) for each returned event
        │       ├── persist raw event in chain_events
        │       └── run the matching DB/notification handler
        │
        └── persist lastProcessedLedger in event_poller_checkpoints
```

The poller is a singleton within one NestJS process. If you run multiple API
replicas, **only one replica should own the poller**, otherwise every replica
will process the same events. Currently the service has no distributed lock; run
the poller as a single instance (or add a leader-election lock) in production.

---

## 2. Polling frequency

| Setting | Value | Notes |
|---|---|---|
| Poll interval | **5 seconds** | Hard-coded via `@Cron(CronExpression.EVERY_5_SECONDS)` |
| Schedule timezone | Process default | Interval-based, not wall-clock based |
| Events per RPC call | **100** | `limit: 100` in `StellarService.fetchContractEvents` |
| Contract filter | `SOROBANLARD_CONTRACT_ID` | Only events emitted by the configured contract |
| Start ledger | `lastProcessedLedger` | Checkpoint value, or a cold-start lookback |

`EVENT_POLLING_INTERVAL_MS` exists in `.env.example` but is **not currently
read** by the implementation. Changing it has no effect; the interval is fixed
at five seconds in code.

---

## 3. Checkpoint persistence

### Table

`event_poller_checkpoints` has one logical row:

| Column | Meaning |
|---|---|
| `key` | Fixed value `stellar-event-poller` (`EVENT_POLLER_CHECKPOINT_KEY`) |
| `lastProcessedLedger` | Next ledger the poller will request from RPC |
| `lastPolledAt` | When the last poll finished |
| `lastWriteError` | Most recent checkpoint write error (truncated to 500 chars) |
| `consecutiveWriteFailures` | Number of consecutive checkpoint write failures |
| `createdAt` / `updatedAt` | Row timestamps |

The row is upserted after **every** poll, including polls that return no events.

### Startup / resume

On `onModuleInit()`:

1. Read the checkpoint row. Database errors are logged and treated as “no checkpoint”.
2. Fetch the current chain tip (`getLatestLedger()`). If this fails, the poller
   still starts and will discover the tip on subsequent polls.
3. If a checkpoint exists with `lastProcessedLedger > 0`:
   - If it is **ahead of the chain tip + 1** (corrupt row, restored database from
     another network, or a reset testnet), it is ignored.
   - Otherwise the poller resumes from exactly that ledger. Existing events
     between the checkpoint and the checkpoint are not replayed.
4. If there is no usable checkpoint, the poller **cold-starts 10 ledgers behind
   the chain tip** (`COLD_START_LOOKBACK`) and writes that value immediately.
   The lookback covers a small amount of recent history without replaying the
   whole chain.

### Advancement

After each event is handled successfully:

```
lastProcessedLedger = max(lastProcessedLedger, event.ledger + 1)
```

If an event handler throws, the outer `pollEvents` catch logs the error and the
checkpoint is **not advanced past the failed event**. The same range is retried
on the next poll. Raw events are inserted before the handler runs, so a retry
can produce a duplicate `chain_events` row for that event.

Most handlers are idempotent (`updateMany`, status writes, notifications may
repeat). `handleStudentEnrolled` increments `Course.totalEnrollments`, so a
replay of that event can double-count. Plan replays accordingly.

---

## 4. Supported events

| Event | Handler behavior |
|---|---|
| `course_registered` | Log only; the course was already created by `POST /courses` |
| `course_approved` | Set course `ACTIVE` and `approvedAt` |
| `course_paused` | Set course `PAUSED` |
| `course_archived` | Set course `ARCHIVED` |
| `student_enrolled` | Increment `Course.totalEnrollments` (backend enrollment record is created by `POST /enrollments`) |
| `course_completed` | Mark enrollment `COMPLETED`, progress 100%, notify student |
| `certificate_issued` | Notify the student; certificate row is created by the admin API |
| `certificate_revoked` | Set `Certificate.isRevoked = true` |
| unknown | Logged as a warning; raw event is still stored |

Raw events are always written to `chain_events` with `eventName`, `ledger`,
`txHash`, `payload`, and an optional `courseId`.

---

## 5. Failure behavior

### Stellar RPC is down or returns an error

`StellarService.fetchContractEvents` catches the RPC error, logs it, and returns
an **empty array**. This means:

- The poll loop stays alive.
- The checkpoint is still written with the same `lastProcessedLedger`.
- The same ledger range is requested again on the next tick, so normal
  transient outages recover automatically.

There is no exponential backoff because the poller is already on a fixed 5s
cadence. Sustained RPC outages do not lose progress, but they do delay it.

> **Retention warning:** Soroban RPC only retains events for a limited ledger
> window. If the service is offline longer than that window, the missed events
> cannot be recovered with `getEvents`; restore from an archive or reconcile the
> affected records manually.

### Database is down

- Reading the checkpoint fails: the poller cold-starts near the chain tip.
- Writing the checkpoint fails: the in-memory ledger still advances, the failure
  counter increments, and the error is recorded. Polling is **not** blocked.
- If the process crashes before a later successful write, the next boot resumes
  from the last successfully persisted ledger, replaying events handled since
  then.

### Handler failure

The failed event is retried on the next poll because the checkpoint is not
advanced past it. If one handler permanently fails (for example, malformed
payload), polling stalls at that ledger. Check logs for `Event polling failed`
and inspect `chain_events` for the offending payload.

### More than 100 events in a range

`getEvents` returns at most 100 events per call. The poller advances to the
ledger of the last returned event + 1 and continues on the next tick. If a
single ledger contains more than 100 matching events, events after the 100th may
not be observed. For very high-volume backfills, use a narrower resume ledger or
replay in small windows.

---

## 6. Monitoring

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health/checkpoint` | Authoritative checkpoint state (in-memory + persisted) |
| `GET /api/v1/health` | Aggregate health; includes an informational `event_poller_checkpoint` indicator |

`GET /health/checkpoint` returns fields such as:

```json
{
  "key": "stellar-event-poller",
  "lastProcessedLedger": 123456,
  "persistedLedger": 123454,
  "lastPolledAt": "2026-10-21T12:00:05.000Z",
  "resumedFromCheckpoint": true,
  "consecutiveWriteFailures": 0,
  "lastWriteError": null,
  "healthy": true
}
```

Alert on:

- `healthy: false` / `consecutiveWriteFailures > 0` — checkpoint cannot be persisted.
- `lastPolledAt` older than a few minutes — the process or scheduler is stalled.
- `lastProcessedLedger` stuck while the chain tip advances — RPC or handler failure.

The aggregate `/health` check intentionally reports the checkpoint indicator as
`up` even when checkpoint writes are failing, so a transient database issue does
not remove the API from a load balancer. Use `/health/checkpoint` for alerting.

---

## 7. Manual backfill / replay

There is currently **no HTTP endpoint** for replay; replay is controlled by the
checkpoint row. Use this procedure:

1. **Stop the poller** (scale the poller replica to zero or stop the app) so two
   processes do not race on the same checkpoint.
2. Choose the first ledger to replay, `START_LEDGER`.
3. Update the checkpoint:

   ```sql
   UPDATE event_poller_checkpoints
   SET "lastProcessedLedger" = :start_ledger,
       "lastPolledAt" = NULL,
       "lastWriteError" = NULL,
       "consecutiveWriteFailures" = 0,
       "updatedAt" = NOW()
   WHERE "key" = 'stellar-event-poller';
   ```

   If no row exists:

   ```sql
   INSERT INTO event_poller_checkpoints
     ("id", "key", "lastProcessedLedger", "createdAt", "updatedAt")
   VALUES
     (gen_random_uuid(), 'stellar-event-poller', :start_ledger, NOW(), NOW());
   ```

4. Restart the poller. Startup logs should show
   `Resumed event poller from persisted ledger <START_LEDGER>`.
5. Watch `GET /api/v1/health/checkpoint`, `chain_events`, and application logs
   until the ledger catches up.

### Replay warnings

- Events are stored in `chain_events` **before** handlers run, so replayed events
  create duplicate rows. There is no unique constraint on `(txHash, eventName)`.
- `student_enrolled` increments a counter; replaying it can inflate
  `totalEnrollments`. Reconcile counts after a replay if needed.
- Notifications may be sent again.
- Rewinding a long way can make the poller page through events for a long time
  and may hit RPC retention limits. Prefer replaying the smallest range that
  fixes the incident.
- Do not replay on multiple replicas simultaneously.

---

## 8. Operational checklist

- [ ] Run exactly one poller instance (or add a distributed lock before scaling).
- [ ] Keep `SOROBANLARD_CONTRACT_ID` and `STELLAR_RPC_URL` stable; a checkpoint
      from another network is rejected only when it is ahead of the local tip.
- [ ] Monitor `GET /health/checkpoint` for stale `lastPolledAt` and write failures.
- [ ] Monitor `chain_events` growth and alert on unknown event names.
- [ ] Document the chosen RPC retention window and ensure the service never sits
      offline longer than it during an incident.
