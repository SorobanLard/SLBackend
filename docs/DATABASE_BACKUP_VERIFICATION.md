# Database Backup Verification (Restore Dry-Run)

A backup that has never been restored is not a tested backup. This runbook
describes the automated verification job that downloads the latest nightly
database dump, restores it into a disposable scratch database, and runs a basic
integrity check.

Related code:

- `src/modules/backups/db-backup.service.ts` — creates, validates, uploads, and rotates dumps
- `src/modules/backups/db-backup-verification.service.ts` — restore dry-run and integrity check
- `src/modules/backups/db-backup-verification.controller.ts` — admin trigger/status endpoints
- `.env.example` — `BACKUP_*` / `BACKUP_VERIFY_*` configuration

---

## 1. What the job does

```
Every day at 03:30 UTC (after the 02:00 backup)
        │
        ▼
List s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/*.dump
        │  pick the object with the newest LastModified
        ▼
Download to a temporary directory
        │  verify stored SHA256 checksum (if present)
        ▼
pg_restore --list <dump>              (archive sanity check, no DB writes)
        │
        ▼
Scratch DB: DROP SCHEMA public CASCADE; CREATE SCHEMA public;
        │
        ▼
pg_restore --exit-on-error --no-owner --no-privileges
        │
        ▼
psql integrity query
        │
        ├── tables present
        ├── applied Prisma migrations found
        ├── no incomplete/rolled-back migrations
        └── key tables present
        ▼
SUCCESS / FAILED status (logged + available via API)
```

The job never writes to the production `DATABASE_URL`. It requires a separate
`BACKUP_VERIFY_DATABASE_URL`.

---

## 2. Configuration

```bash
# Existing backup settings (used to find the latest dump)
BACKUP_ENABLED=true
BACKUP_S3_BUCKET=your-backup-bucket
BACKUP_S3_PREFIX=database-backups
AWS_REGION=us-east-1
# BACKUP_S3_ENDPOINT=https://s3.example.com

# Verification (Issue #169)
BACKUP_VERIFY_ENABLED=true
BACKUP_VERIFY_DATABASE_URL=postgresql://user:password@host:5432/sorobanlard_restore_test
```

| Variable | Required | Purpose |
|---|---|---|
| `BACKUP_VERIFY_ENABLED` | Yes | Master switch; defaults to `false` |
| `BACKUP_VERIFY_DATABASE_URL` | Yes when enabled | Disposable scratch database connection. Must differ from `DATABASE_URL` |
| `BACKUP_S3_BUCKET` | Yes when enabled | Bucket containing the nightly dumps |
| `BACKUP_S3_PREFIX` | No | Prefix to scan; defaults to `database-backups` |
| `DATABASE_URL` | Yes | Used only to compare identities and refuse a self-targeted restore |

### Scratch database requirements

- A dedicated PostgreSQL database that can be destroyed and recreated, e.g.
  `sorobanlard_restore_test` on a separate host/instance if possible.
- The configured role must be able to create/drop schemas/tables and restore
  extensions used by the dump.
- **Never reuse the production database URL, a read replica used for serving
  traffic, or a database containing anything you need.** The job drops the
  `public` schema before restoring.
- The service refuses to run when the host, port, and database name of the
  scratch URL match `DATABASE_URL`.
- `pg_dump`, `pg_restore`, and `psql` must be installed in the runtime image and
  must be compatible with the PostgreSQL server version.

The scratch database itself must already exist. The job resets its schema; it
does not create the database.

---

## 3. Integrity checks

The verification passes only when all of these are true:

| Check | Failure message |
|---|---|
| At least one table was restored | `restored database has no tables` |
| At least one finished, non-rolled-back Prisma migration exists | `no applied Prisma migrations found` |
| No unfinished or rolled-back migrations exist | `N incomplete/rolled-back migration(s) found` |
| Key domain tables exist | `only N/7 key tables are present` |

Key tables checked:

`users`, `courses`, `enrollments`, `assignments`,
`assignment_submissions`, `certificates`, `event_poller_checkpoints`.

The job also verifies that the downloaded file is non-empty, matches the
SHA256 checksum stored with the object (when present), and is a readable
PostgreSQL custom-format archive (`pg_restore --list`).

### What is not checked

This is a **smoke test**, not full data reconciliation:

- It does not compare row counts against production.
- It does not run application-level queries or background workers.
- It does not validate business invariants or foreign-key orphan counts.
- It does not prove point-in-time recovery (PITR/WAL) works.

Add deeper checks to the integrity SQL as the schema evolves if needed.

---

## 4. Triggering verification

### Scheduled

The NestJS scheduler runs `handleScheduledVerification()` every day at
**03:30 UTC**. No external cron is required as long as the API process is
running. The job is enabled only when `BACKUP_VERIFY_ENABLED=true`.

### Manual (admin API)

```http
POST /api/v1/backups/database/verify
Authorization: Bearer <ADMIN_JWT>
```

Returns the verification result:

```json
{
  "state": "SUCCESS",
  "startedAt": "2026-10-21T03:30:00.000Z",
  "completedAt": "2026-10-21T03:31:12.000Z",
  "durationMs": 72000,
  "backupKey": "database-backups/sorobanlard-2026-10-21T02-00-00-000Z.dump",
  "backupLastModified": "2026-10-21T02:00:05.000Z",
  "sizeBytes": 12345678,
  "checksumVerified": true,
  "restoreDurationMs": 51000,
  "integrity": {
    "tableCount": 34,
    "appliedMigrations": 21,
    "incompleteMigrations": 0,
    "keyTablesPresent": 7,
    "expectedKeyTables": 7
  }
}
```

Failure:

```json
{
  "state": "FAILED",
  "startedAt": "2026-10-21T03:30:00.000Z",
  "completedAt": "2026-10-21T03:30:02.000Z",
  "durationMs": 2000,
  "message": "No database backup (*.dump) found in s3://bucket/database-backups/"
}
```

If verification is already running, a second trigger returns a `SKIPPED` result
with `"A database backup verification is already in progress"`.

### Last result (admin API)

```http
GET /api/v1/backups/database/verify/status
Authorization: Bearer <ADMIN_JWT>
```

Returns the last result held in memory, or `null` after a restart before the
first run. Use application logs for historical results.

### Manual (local/CLI)

If you cannot reach the admin API, run the same steps manually:

```bash
# 1. Download the latest dump
aws s3 ls s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/ | sort | tail -n 1
aws s3 cp s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<file>.dump /tmp/latest.dump

# 2. Validate the archive
pg_restore --list /tmp/latest.dump >/dev/null

# 3. Restore into the scratch database
psql "$BACKUP_VERIFY_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
pg_restore \
  --no-owner --no-privileges --exit-on-error \
  --dbname "$BACKUP_VERIFY_DATABASE_URL" /tmp/latest.dump

# 4. Smoke-check
psql "$BACKUP_VERIFY_DATABASE_URL" -v ON_ERROR_STOP=1 -c '
  SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = ''public'' AND table_type = ''BASE TABLE'';
  SELECT COUNT(*) FROM "_prisma_migrations"
   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  SELECT COUNT(*) FROM "_prisma_migrations"
   WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
'
```

You can also wrap this in an external CI cron job (GitHub Actions, cron on an
ops host). Use a dedicated runner/secret store with access to the backup bucket
and scratch database, and never point it at production.

---

## 5. Operational runbook

### Daily

1. Confirm the 02:00 UTC backup succeeded (`DbBackupService` log/status).
2. Confirm the 03:30 UTC verification result is `SUCCESS`.
3. Alert if verification is `FAILED`, missing for > 25 hours, or returns
   `SKIPPED` while enabled.

### When verification fails

1. Read `message` and the application logs (`Database backup verification failed`).
2. Check S3: does a `*.dump` object exist under the prefix, and is it recent?
3. Check the backup job: `pg_dump`/S3 upload errors usually explain a missing or
   truncated archive.
4. Test the archive manually with `pg_restore --list`.
5. Check scratch database connectivity, credentials, disk space, and Postgres
   version compatibility.
6. If checksum validation failed, treat the object as corrupt. Do not rely on it
   for recovery; create a fresh backup and investigate storage/transfer issues.
7. If the integrity query fails, compare with the production schema/migrations.
   A restored database with missing key tables or incomplete migrations means the
   dump is not recoverable as-is.

### After a production restore

Run a manual verification against the newly created backup, then promote only
after it reports `SUCCESS`. Record the backup key and verification timestamp in
the incident notes.

### Rotating credentials

The scratch credentials are separate from production. Rotate them in the secret
manager and update `BACKUP_VERIFY_DATABASE_URL`; no code change is required.

---

## 6. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `Database backup verification is disabled` | `BACKUP_VERIFY_ENABLED` not `true` | Enable the flag and restart |
| `No database backup (*.dump) found` | Wrong bucket/prefix, backup job failed | Check `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, backup logs |
| `BACKUP_VERIFY_DATABASE_URL must not point at the production DATABASE_URL` | Same host/port/database as production | Use a separate scratch database |
| `Backup checksum mismatch` | Corrupt/partial upload | Treat as failed backup; create a new one |
| `pg_restore failed: ...` | Incompatible version, missing extension, insufficient privileges | Install matching client tools, add extensions/privileges |
| `no applied Prisma migrations found` | Dump is empty or restored into the wrong database | Verify the dump key and scratch URL |
| `only N/7 key tables are present` | Partial restore / stale dump missing migrations | Inspect restore output and migration history |
| Verification times out | Large database on slow scratch host | Use a faster/co-located scratch instance or raise infrastructure limits |
