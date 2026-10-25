# Fraud Detection Scoring Model

This document describes the enrollment fraud detection scoring model used by
the SorobanLard backend, including every risk signal, its point value, the
configurable thresholds and the resulting operational behaviour.

- Implementation: `src/modules/enrollments/fraud-detection.service.ts`
- Admin API: `src/modules/enrollments/fraud.controller.ts`
- Database model: `EnrollmentFraudFlag` (`prisma/schema.prisma`)

## Overview

The backend runs a real-time risk scoring pipeline on every enrollment
attempt (`EnrollmentsService.create` → `FraudDetectionService.processFraudCheck`
→ `FraudDetectionService.scoreEnrollment`).

For each attempt the service evaluates available signals, accumulates a
risk score in the **0–100** range and maps that score to:

1. a **risk level** (`FraudRiskLevel`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), and
2. an **action** (`ALLOW`, `FLAG`, `HOLD`) that tells the caller — the
   enrollments service — what to do next.

## Risk Score & Risk Levels

| Risk level | Score range | Meaning |
| --- | --- | --- |
| `LOW` | `0 – 39` | No action required. |
| `MEDIUM` | `40 – 69` | Recorded internally; no enforcement action. |
| `HIGH` | `70 – 89` | Enrollment flagged — proceeds normally, flag persisted for review. |
| `CRITICAL` | `90 – 100` | Enrollment blocked — automatic hold. |

## Signals and Point Values

| # | Signal (rule id) | Trigger condition | Points added |
| --- | --- | --- | --- |
| 1 | `RAPID_REPEAT_PURCHASE` | Student enrolled in `FRAUD_MAX_ENROLLMENTS_PER_WINDOW` (default **3**) or more courses within the rolling `FRAUD_WINDOW_HOURS` (default **1**) window. | `+40` |
| 2 | `HIGH_DAILY_VOLUME` | Student enrolled in `FRAUD_MAX_DAILY_ENROLLMENTS` (default **10**) or more courses within the last 24 hours. | `+25` |
| 3 | `PRIOR_FRAUD_HISTORY` | Student has at least one previously **CONFIRMED** fraud flag. | `+35` |
| 4 | `HIGH_AMOUNT_ANOMALY` | Payment amount exceeds the `FRAUD_HIGH_AMOUNT_THRESHOLD_USDC` threshold (default **500** USDC). | `+15` |
| 5 | `EXCESSIVE_ACTIVE_ENROLLMENTS` | Student holds `FRAUD_MAX_ACTIVE_ENROLLMENTS` (default **20**) or more simultaneously `ACTIVE` enrollments. | `+20` |
| 6 | `DUPLICATE_COURSE_PURCHASE` | Student already has an enrollment record for the same course (refund + re-enroll pattern / account duplication). | `+30` |

The final score is clamped to the `0–100` range.

## Actions & Thresholds

| Action | Condition | Behaviour |
| --- | --- | --- |
| `ALLOW` | Score below the high-risk threshold | No flag persisted, enrollment proceeds normally. |
| `FLAG` | Score at/above the high-risk threshold, below the critical threshold | Flag persisted (status `OPEN`), enrollment proceeds and the flag is queued for admin review. |
| `HOLD` | Score at/above the critical threshold | Enrollment **not** created; flag persisted (status `HELD`) for admin review; the caller responds with HTTP `423`. |

Thresholds are configurable through environment variables (defaults shown):

| Variable | Default | Meaning |
| --- | --- | --- |
| `FRAUD_WINDOW_HOURS` | `1` | Rolling window (hours) for rapid-repeat-purchase detection. |
| `FRAUD_MAX_ENROLLMENTS_PER_WINDOW` | `3` | Max enrollments within the window before `RAPID_REPEAT_PURCHASE` fires. |
| `FRAUD_MAX_DAILY_ENROLLMENTS` | `10` | Max enrollments in 24 h before `HIGH_DAILY_VOLUME` fires. |
| `FRAUD_MAX_ACTIVE_ENROLLMENTS` | `20` | Max simultaneously `ACTIVE` enrollments before `EXCESSIVE_ACTIVE_ENROLLMENTS` fires. |
| `FRAUD_HIGH_AMOUNT_THRESHOLD_USDC` | `500` | USDC amount above which `HIGH_AMOUNT_ANOMALY` fires. |
| `FRAUD_HIGH_RISK_SCORE_THRESHOLD` | `70` | Score at/above which an enrollment is **FLAGGED** (`OPEN` flag persisted). |
| `FRAUD_CRITICAL_SCORE_THRESHOLD` | `90` | Score at/above which an enrollment is **BLOCKED** (`HELD` flag persisted). |

## Operational Behaviour

### FLAG — flagged enrollment (HTTP continues)

- Score ≥ `FRAUD_HIGH_RISK_SCORE_THRESHOLD` and < `FRAUD_CRITICAL_SCORE_THRESHOLD`.
- A fraud flag is persisted with status `OPEN` (via the post-check once the
  enrollment row exists, or pre-check when scoring happens before creation).
- The enrollment proceeds normally; the flag appears in the admin review queue.

### BLOCKED — enrollment held (HTTP 423)

- Score ≥ `FRAUD_CRITICAL_SCORE_THRESHOLD`.
- The enrollment is **not** created.
- A fraud flag is persisted with status `HELD` (enrollment id, course and paid
  amount are recorded for context).
- The API responds with `HTTP 423 Locked` and a body containing:

```json
{
  "statusCode": 423,
  "error": "Enrollment Locked",
  "message": "Your enrollment has been flagged and placed on hold pending a fraud review. Please contact support if you believe this is an error.",
  "riskScore": 95,
  "reasons": ["RAPID_REPEAT_PURCHASE", "PRIOR_FRAUD_HISTORY"],
  "flagId": "uuid-of-the-fraud-flag"
}
```

### Admin review workflow

Admin-only endpoints (JWT + admin role) under the fraud module:

| Endpoint | Purpose |
| --- | --- |
| `GET /enrollments/fraud/queue` | Paginated review queue (`status`, `riskLevel`, `page`, `limit` filters, sorted by risk score desc). |
| `GET /enrollments/fraud/student/:studentId` | Aggregate risk profile for a student (flags, confirmed fraud, held count, max score). |
| `GET /enrollments/fraud/:flagId` | Single fraud flag detail (enrollment, course, student, reviewer). |
| `POST /enrollments/fraud/:flagId/review` | Resolve a flag — `decision: CLEARED \| CONFIRMED` plus optional `reviewNotes`. |

Flag lifecycle statuses:

- `OPEN` — flagged, awaiting admin review.
- `HELD` — enrollment blocked by automatic hold.
- `CLEARED` — admin reviewed and found no fraud; flag archived.
- `CONFIRMED` — admin confirmed the fraud; downstream actions (e.g. enrollment
  voiding) are handled by a separate admin workflow.

Only `OPEN` or `HELD` flags are reviewable. After a review the flag is moved to
the resolved status (`CLEARED` or `CONFIRMED`) and stamped with the reviewer,
notes and timestamp.

## Adding a New Signal

To extend the scoring model:

1. Add the rule identifier to the `RULES` map in `fraud-detection.service.ts`.
2. Add any new threshold to the service (with `.env` default + fallback).
3. Add the point accumulation in `scoreEnrollment`.
4. Document the new signal in this file, including its point value and the
   resulting behaviour at the current thresholds.

---

See also:

- [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- [`docs/REFERRAL_PROGRAM.md`](REFERRAL_PROGRAM.md)
