# Queue Metrics API

Structured BullMQ queue health metrics for the queues registered in
`src/common/queue/queue.service.ts` (e.g. the email queue). This gives
operators a dashboard signal when a queue is backing up or failing.

## Endpoint

```
GET /admin/queues/metrics
```

Protected by the same admin guards/roles as the other `/admin/queues/*`
endpoints. Do not expose it publicly.

### Response

```json
{
  "timestamp": "2026-07-29T12:00:00.000Z",
  "queues": [
    {
      "name": "email",
      "counts": {
        "active": 3,
        "waiting": 12,
        "delayed": 0,
        "completed": 1042,
        "failed": 5,
        "paused": 0
      },
      "failureRate": 0.0048
    }
  ]
}
```

- `counts` mirrors BullMQ's `Queue#getJobCounts()` per queue.
- `failureRate` is `failed / (completed + failed)` for the queue, or `0`
  when no jobs have finished yet.

## Wiring into external monitoring

### Prometheus + Grafana

1. Add a scrape job that hits the endpoint through an authenticated proxy
   (the endpoint is admin-guarded, so scrape via a sidecar/proxy that
   injects the admin credentials, or export the same counts from a
   Prometheus exporter process that calls `QueueService` directly).
2. Map each queue to a metric label, e.g.
   `bullmq_jobs{queue="email",state="waiting"}` and
   `bullmq_failure_rate{queue="email"}`.
3. In Grafana, graph `bullmq_jobs{state="waiting"}` for queue depth and
   alert when it grows monotonically, and alert on
   `bullmq_failure_rate > 0.05`.

### Datadog

1. Use an HTTP check / custom check that polls
   `/admin/queues/metrics` with admin credentials.
2. Submit gauges: `bullmq.jobs` tagged with `queue:<name>` and
   `state:<state>`, plus `bullmq.failure_rate` tagged with `queue:<name>`.
3. Create monitors on `avg:bullmq.jobs{state:waiting} by {queue}` for
   backlog growth and on `avg:bullmq.failure_rate by {queue}` for failure
   spikes.

## Notes

- Counts are read live from Redis on each request; keep the scrape
  interval modest (e.g. 30–60s) to avoid load on Redis.
- New queues added to `QueueService` are reported automatically once they
  are registered there.
