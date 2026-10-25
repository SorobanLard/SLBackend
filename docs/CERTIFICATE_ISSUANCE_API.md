# Certificate Issuance and On-Chain Verification

This document explains the certificate lifecycle: how a certificate is issued,
how the backend interacts with `StellarService`, what happens when the PDF or
on-chain step fails, and the contract for the public verification/share
endpoints.

Related code:

- `src/modules/certificates/certificates.service.ts` — issuance, verification, revocation
- `src/modules/certificates/certificates.controller.ts` — protected and public certificate routes
- `src/modules/certificates/certificate-share.controller.ts` — public share routes
- `src/modules/certificates/certificate-share.service.ts` — share metadata and HTML
- `src/modules/certificates/certificate-pdf.processor.ts` — BullMQ PDF worker
- `src/common/stellar/stellar.service.ts` — `verifyCertificateOnChain()`, RPC simulation
- `src/modules/events/events.service.ts` — `course_completed`, `certificate_issued`, `certificate_revoked` handlers

---

## 1. Lifecycle at a glance

```
Student reaches 100% progress
        │
        ▼
Enrollment.status = COMPLETED        (lesson progress / course_completed event)
        │
        ▼
Admin POST /api/v1/certificates       (requires ADMIN JWT)
        │  ├── enrollment COMPLETED?
        │  ├── certification exam passed? (if the course has one)
        │  └── no existing certificate?
        ▼
Certificate row created (id = CERT-XXXXXXXXXXXX)
PDF job queued in BullMQ (5 attempts, exponential backoff)
Notification sent to student
        │
        ▼
Admin/frontend wallet calls issue_certificate() on the Soroban contract
        │  (the backend does NOT sign or submit this transaction)
        ▼
Admin PATCH /api/v1/certificates/:id/tx-hash
        │
        ▼
Anyone GET /api/v1/certificates/verify/:id
        ├── DB says revoked?            → invalid
        └── simulate verify_certificate → valid / invalid
```

> **Important:** the backend does not automatically submit an on-chain
> transaction when progress reaches 100%. It creates and validates the
> certificate record; the on-chain `issue_certificate()` call is signed by the
> admin wallet (Freighter/secure signing service). The events poller only reacts
> to the resulting chain events.

---

## 2. Trigger conditions

`CertificatesService.issue(adminId, studentId, courseId)` enforces all of the
following before writing anything:

| Condition | Failure response |
|---|---|
| An enrollment exists for `(studentId, courseId)` | `404 Not Found` — `Enrollment not found` |
| `enrollment.status === COMPLETED` | `403 Forbidden` — `Student has not completed this course yet` |
| The certification exam is passed, if the course has one | `403 Forbidden` — exam requirement message |
| No certificate already exists for `(studentId, courseId)` | `403 Forbidden` — `Certificate already issued for this enrollment` |

`ExamsService.hasPassedExam(studentId, courseId)` returns `true` when no
certification exam is configured for the course.

The course does **not** need to be `ACTIVE` at issuance time; the enrollment and
exam checks are the source of truth.

---

## 3. Endpoints

All paths are prefixed with `/api/v1`.

### 3.1 Issue a certificate — `POST /certificates` (ADMIN)

Request:

```json
{
  "studentId": "b3b7c1e2-1f3a-4f0e-9a1e-2d6a5c8f9e10",
  "courseId": "0f6a9d4c-7e21-4a4b-8c3d-5e6f7a8b9c0d"
}
```

Successful response (`201 Created`):

```json
{
  "id": "CERT-1A2B3C4D5E6F",
  "studentId": "b3b7c1e2-1f3a-4f0e-9a1e-2d6a5c8f9e10",
  "courseId": "0f6a9d4c-7e21-4a4b-8c3d-5e6f7a8b9c0d",
  "courseTitle": "Professional Tailoring",
  "instructorAddress": "G...",
  "txHash": null,
  "pdfUrl": null,
  "isRevoked": false,
  "issuedAt": "2026-10-21T12:00:00.000Z",
  "student": { "...": "..." },
  "course": { "...": "..." },
  "pdfStatus": "queued"
}
```

The certificate ID is generated as
`CERT-<12 uppercase hex characters>` from a UUID. It is the value used both in
the database and as the on-chain `certificate_id`.

The response is returned as soon as the DB row and PDF job exist. PDF rendering
is asynchronous.

### 3.2 Record the on-chain transaction — `PATCH /certificates/:id/tx-hash` (ADMIN)

Call this after the admin wallet successfully submits `issue_certificate()`.

Request:

```json
{
  "txHash": "64-character-hex-string"
}
```

Response (`200 OK`): the updated certificate row.

The DTO requires exactly 64 hexadecimal characters. The endpoint records the
hash; it does **not** verify the transaction status. If the transaction later
fails, update the record manually or revoke the certificate.

### 3.3 Revoke — `POST /certificates/:id/revoke` (ADMIN)

Request body is optional:

```json
{
  "reason": "Issued in error"
}
```

The backend:

1. Loads the certificate (404 if missing).
2. Rejects if already revoked (`403 Forbidden`).
3. Sets `isRevoked`, `revokedById`, `revokedAt`, and `revokeReason`.
4. Notifies the student.

Response (`200 OK`): the updated certificate.

The backend does **not** submit an on-chain revoke transaction. If the contract
supports revocation, the admin wallet must do that separately; the
`certificate_revoked` event is consumed by the poller to mirror the DB flag.

### 3.4 Verify — `GET /certificates/verify/:id` (PUBLIC)

This is the authoritative public verification endpoint. No authentication is
required.

Success:

```json
{
  "valid": true,
  "certificate": {
    "id": "CERT-1A2B3C4D5E6F",
    "studentId": "...",
    "courseId": "...",
    "courseTitle": "Professional Tailoring",
    "instructorAddress": "G...",
    "txHash": "…",
    "pdfUrl": "certificates/CERT-1A2B3C4D5E6F.pdf",
    "isRevoked": false,
    "issuedAt": "2026-10-21T12:00:00.000Z",
    "student": { "id": "...", "name": "Jane Doe", "stellarAddress": "G..." },
    "course": { "...": "..." },
    "revokedBy": null
  }
}
```

Revoked in the database:

```json
{
  "valid": false,
  "reason": "Certificate has been revoked",
  "certificate": null
}
```

Not found / revoked on-chain:

```json
{
  "valid": false,
  "reason": "Certificate not found or revoked on-chain",
  "certificate": null
}
```

Behavior:

- A missing DB row throws `404 Not Found` (`Certificate not found`).
- A revoked DB row short-circuits without an RPC call.
- Otherwise the backend calls `StellarService.verifyCertificateOnChain(id)`,
  which simulates the contract method `verify_certificate(certificate_id)` via
  `SorobanRpc.simulateTransaction`.
- Verification **fails closed**: RPC errors, simulation errors, or an empty
  result return `false`, so a transient RPC outage yields “not found or revoked
  on-chain” rather than a false positive.
- A DB record with `txHash = null` can still verify if the contract already has
  the certificate; the tx hash is not part of the check.

### 3.5 Certificate details — `GET /certificates/:id` (PUBLIC)

Returns the full certificate row with student, course/instructor, and revoker
details. This endpoint does **not** perform the on-chain check and returns
revoked certificates too. Use `/verify/:id` for a validity decision.

### 3.6 Student's certificates — `GET /certificates/my/all` (JWT)

Returns all certificates for the authenticated user, newest first, including
course instructor name.

### 3.7 PDF job status — `GET /certificates/:id/status` (JWT)

Returns the BullMQ job state for the certificate PDF:

```json
{
  "certificateId": "CERT-1A2B3C4D5E6F",
  "status": "completed",
  "pdfUrl": "certificates/CERT-1A2B3C4D5E6F.pdf"
}
```

Possible `status` values include `not_queued`, `waiting`, `active`, `completed`,
`failed`, and other BullMQ states. `pdfUrl` is only returned when completed.

### 3.8 PDF download — `GET /certificates/:id/download` (JWT)

Returns `{ "pdfUrl": "...", "message": "PDF certificate ready for download" }`,
or `404 Not Found` if the PDF has not been generated yet.

---

## 4. PDF generation and retry behavior

Issuance queues a BullMQ job on the `CERTIFICATE_PDF_QUEUE`:

```ts
await this.pdfQueue.add(
  CERTIFICATE_PDF_JOB,
  { certificateId },
  {
    jobId: certificateId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  },
);
```

- The **job id is the certificate id**, so repeated issuance calls cannot enqueue
  duplicate PDF jobs for the same certificate.
- The worker retries up to 5 times with exponential backoff starting at 5 seconds.
- The worker writes to `CERTIFICATE_PDF_DIR` (default `./uploads/certificates`),
  first to a temporary file and then atomically renames it to `<certificateId>.pdf`.
- On success it sets `Certificate.pdfUrl = certificates/<certificateId>.pdf`.
- If rendering fails permanently, the certificate row remains valid; the PDF can
  be retried by re-queuing the job. `GET /:id/status` shows the job state.
- Worker instances must share the certificate directory (persistent volume) in
  production.

The issue endpoint itself does not wait for the PDF. A successful `201` means
“certificate recorded and PDF queued”, not “PDF ready”.

---

## 5. On-chain interaction details

`StellarService` is read-only for certificates:

| Method | Purpose |
|---|---|
| `verifyCertificateOnChain(certificateId)` | Simulates `verify_certificate` and returns a boolean |
| `simulateCall(method, args)` | Builds a transaction with a random dummy source and simulates it |

The backend never signs or submits `issue_certificate`, `revoke_certificate`, or
any other write transaction. This is deliberate: write authority stays with the
admin wallet / secure signing service.

Because verification uses simulation, it does not require gas or a funded
account. Any failure (network, contract error, missing contract config) is
treated as “not valid” by the public verifier.

---

## 6. Events and reconciliation

The Stellar event poller (`EventsService`) correlates chain activity with the DB:

| Event | Backend effect |
|---|---|
| `course_completed` | Marks the enrollment `COMPLETED`, progress 100%, notifies the student |
| `certificate_issued` | Notifies the student that the certificate is on-chain; does not create the DB row |
| `certificate_revoked` | Sets `Certificate.isRevoked = true` |

If an on-chain certificate exists but the DB row is missing, `verify` returns
invalid because `findById` throws 404. Create the row through the admin endpoint
and record the tx hash to reconcile.

---

## 7. Sharing endpoints

### `POST /certificates/:id/share` (JWT, owner only)

Creates (or reuses) a share token for the student's own certificate.

```json
{
  "certificateId": "CERT-1A2B3C4D5E6F",
  "shareUrl": "https://api.example.com/api/v1/certificates/share/<token>",
  "verificationUrl": "https://app.example.com/certificates/verify/CERT-1A2B3C4D5E6F",
  "linkedinUrl": "https://www.linkedin.com/profile/add?...",
  "linkedinMetadata": { "...": "..." },
  "viewCount": 0,
  "openGraph": {
    "title": "Jane Doe earned a certificate in Professional Tailoring",
    "description": "Verify Jane Doe's SorobanLard certificate for Professional Tailoring.",
    "type": "website",
    "url": "https://api.example.com/api/v1/certificates/share/<token>"
  }
}
```

Errors:

- `404` — certificate or share link not found.
- `403` — the authenticated user does not own the certificate.
- `410 Gone` — the certificate is revoked.

Share links are idempotent: the same certificate reuses its token.

### `GET /certificates/share/:token/metadata` (PUBLIC)

Returns the same metadata shape without incrementing `viewCount`. Returns
`404` for an unknown token and `410` for a revoked certificate.

### `GET /certificates/share/:token` (PUBLIC, HTML)

Returns a small HTML page with Open Graph/Twitter metadata and a link to the
frontend verification page. Each successful render increments `viewCount` and
sets `lastViewedAt`. `Cache-Control: no-store` is set so share pages are not
cached. Unknown tokens return `404`; revoked certificates return `410`.

---

## 8. Failure and recovery matrix

| Failure | State after failure | Recovery |
|---|---|---|
| Enrollment not completed / exam not passed | No row created | Complete the requirements, retry `POST /certificates` |
| Certificate already exists | Existing row unchanged | Use the existing certificate or revoke it first |
| PDF queue unavailable | Certificate row exists, no PDF | Re-queue/redeploy the worker; job id is deterministic |
| PDF render fails after 5 attempts | Certificate row exists, `pdfUrl = null` | Fix worker/storage, re-queue the job |
| Admin never calls `issue_certificate()` | Row exists with `txHash = null` | Verification returns invalid until the on-chain call succeeds |
| On-chain tx succeeds but `tx-hash` update is missed | Row exists with no tx hash | Call `PATCH /:id/tx-hash`; verification still works via simulation |
| On-chain call fails | Row may exist with no tx hash | Fix and resubmit; or revoke the DB record |
| Revoked on-chain but DB not updated | Verification fails closed on-chain | Poller should apply `certificate_revoked`; otherwise update/revoke in DB |
| RPC unavailable during verification | `valid: false` | Retry later; verification fails closed by design |
