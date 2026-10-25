# Scalability audit follow-up (#175, #176, #177, #181)

## Leaderboard (#177)

Leaderboard reads now use the materialized `LeaderboardSnapshot` rows and return only the requested page. The hourly scheduled recalculation computes points and ranks, stores points/current rank/previous rank, and invalidates the Redis leaderboard namespace. This removes the per-read fan-out across users, enrollments, lesson progress, assignments, and exam attempts. The first snapshot is populated by the scheduled recalculation; trigger `recalculateRankings()` operationally after deployment if a leaderboard must be available before the first hourly run.

## Fraud rolling windows (#181)

The Enrollment model uses `studentId` and `enrolledAt` (not `userId` and `createdAt`). The schema now declares a composite index on `(studentId, enrolledAt)` to support both rolling-window count queries. The schema already has a unique `(studentId, courseId)` index for duplicate-course checks. `EXPLAIN ANALYZE` must be run against a representative deployed PostgreSQL database; this repository change does not claim a live query plan was verified.

## Audit and cron history (#175)

Audit-log and cron-run query DTOs validate ISO date strings, require positive integer page/limit values, and cap limits at 200. Both query services apply a default 90-day lower bound when `from` is omitted, while respecting explicit `from` and `to` filters. The schema already indexed audit-log `createdAt` and cron-run `startedAt`; an additional `(actorId, createdAt)` index helps the common actor-filtered audit query.

## Video transcodes (#176)

The upload service calls `VideoTranscodeService.addTranscodeJob()`, which adds a BullMQ job to `video-transcode`. `VideoTranscodeProcessor` is a BullMQ `WorkerHost` and executes ffmpeg in the worker's `process()` method. Transcoding is therefore queued instead of running inside the upload request; the upload response includes the job ID for status polling via `getJobStatus()`. Thumbnail extraction remains part of the request path.

## Verification

- Static source inspection confirms queue dispatch and worker processing for video transcodes.
- No production database was available to run `EXPLAIN ANALYZE`.
- Build, lint, and automated tests were not run in this environment.
