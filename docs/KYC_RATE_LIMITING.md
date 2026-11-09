# KYC Endpoint Rate Limiting

## Overview

Identity document upload (`POST /kyc/submit`) and admin review endpoints (`GET /kyc`, `GET /kyc/:id`, `POST /kyc/:id/review`) in `src/modules/kyc/kyc.controller.ts` are protected by `RoleThrottlerGuard` (`src/common/guards/role-throttler.guard.ts`) and route-specific `@Throttle(...)` limits.

## Chosen Rate Limits

| Endpoint | Role | Route `@Throttle` Limit | Window (`ttl`) | Role Bucket Guard | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST /kyc/submit` | `INSTRUCTOR` | **5 requests** | `60,000 ms` (1 min) | `RoleThrottlerGuard` (`INSTRUCTOR:<userId>`) | Prevents multipart document upload flooding and storage abuse while allowing legitimate resubmissions. |
| `GET /kyc` | `ADMIN` | **30 requests** | `60,000 ms` (1 min) | `RoleThrottlerGuard` (`ADMIN:<userId>`) | Bounds paginated KYC queue polling by reviewer sessions. |
| `GET /kyc/:id` | `ADMIN` | **30 requests** | `60,000 ms` (1 min) | `RoleThrottlerGuard` (`ADMIN:<userId>`) | Bounds individual identity document metadata/signed-URL fetches. |
| `POST /kyc/:id/review` | `ADMIN` | **30 requests** | `60,000 ms` (1 min) | `RoleThrottlerGuard` (`ADMIN:<userId>`) | Protects approval/rejection state transitions and downstream notification triggers against automated burst calls. |

## Headers & 429 Response Behavior

Every request passing through `RoleThrottlerGuard` includes standard rate-limit headers:

- `X-RateLimit-Bucket`: Resolved role tier (`INSTRUCTOR`, `ADMIN`, or `anon`)
- `X-RateLimit-Limit`: Maximum requests allowed in the active window
- `X-RateLimit-Remaining`: Remaining requests in the active window
- `X-RateLimit-Reset`: Unix epoch timestamp (seconds) when the window resets

When a client exceeds its quota, the endpoint responds with `HTTP 429 Too Many Requests` and a `Retry-After` header indicating the number of seconds until the bucket resets.
