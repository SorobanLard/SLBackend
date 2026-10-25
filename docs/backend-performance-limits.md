# Database limits and cache/analytics safeguards (#178, #179, #182)

## Connection pool (#178)
Set connection pool parameters in the Prisma PostgreSQL connection URL, for example:
`postgresql://user:pass@db:5432/app?connection_limit=10&pool_timeout=10`.
The **pool is per running PrismaClient process**; size it against database max_connections,
all replicas, and separate worker processes. A production database role should enforce
`statement_timeout` (for example `ALTER ROLE app_user SET statement_timeout = '15s';`)
via DBA-managed migration or role configuration. Do not run ALTER ROLE on every app boot.
Statement timeout must be tuned with migrations/large reports and deployment needs.

## Analytics (#179)
All event-reading endpoints now require both ISO timestamps `from` and `to`,
in chronological order, spanning no more than 90 days. Raw event pages are capped at 200
and CSV exports at 50,000 rows. Prisma already declares the
`@@index([eventType, occurredAt])` index; no redundant migration is needed.

## Read caching (#182)
`GET /courses` was already cached at 60 seconds; course details now use 120 seconds;
leaderboard uses 60 seconds. Mutations invalidate the course list/categories/detail
namespaces and leaderboard recalculations invalidate leaderboard entries.
Cache keys incorporate query arguments and route parameters.

## Certificate PDF generation (#180)
Certificate issuance now enqueues a BullMQ `certificate-pdf` job. A worker renders the
PDF and atomically saves the file under `CERTIFICATE_PDF_DIR` (default
`./uploads/certificates`), then updates the certificate's `pdfUrl` only after the
file has been persisted. Authenticated callers can poll `GET /certificates/:id/status`.
This change depends on Redis and the certificate worker being available. For multiple
replicas, mount a shared persistent volume or replace local storage with object storage.
An issued certificate may exist before its PDF is ready; consumers should poll status.
The existing download endpoint returns a PDF reference and does not itself stream the file.

Run `npm test -- --runInBand` and `npm run build` from the repository root before merge;
these checks were not executed by the GitHub connector.
