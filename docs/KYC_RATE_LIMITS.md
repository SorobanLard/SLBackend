# KYC Rate Limits

Identity document submission and administrative review endpoints on `KycController` (`src/modules/kyc/kyc.controller.ts`) enforce both role-tiered throttling via `RoleThrottlerGuard` (`src/common/guards/role-throttler.guard.ts`) and route-specific `@Throttle(...)` limits.

## Endpoint Rate-Limit Matrix

| Endpoint | Role | Route `@Throttle` Limit | Window (`ttl`) | Guard Stack |
| --- | --- | --- | --- | --- |
| `POST /api/v1/kyc/submit` | `INSTRUCTOR` | **5 requests** | `60,000 ms` (1 minute) | `JwtAuthGuard`, `RolesGuard`, `RoleThrottlerGuard` |
| `GET /api/v1/kyc` | `ADMIN` | **30 requests** | `60,000 ms` (1 minute) | `JwtAuthGuard`, `RolesGuard`, `RoleThrottlerGuard` |
| `GET /api/v1/kyc/:id` | `ADMIN` | **30 requests** | `60,000 ms` (1 minute) | `JwtAuthGuard`, `RolesGuard`, `RoleThrottlerGuard` |
| `POST /api/v1/kyc/:id/review` | `ADMIN` | **30 requests** | `60,000 ms` (1 minute) | `JwtAuthGuard`, `RolesGuard`, `RoleThrottlerGuard` |
| `GET /api/v1/kyc/my` | `INSTRUCTOR` | Role bucket (`ROLE_THROTTLE_INSTRUCTOR_LIMIT`, default 120) | `ROLE_THROTTLE_WINDOW_MS` (default 60s) | `JwtAuthGuard`, `RolesGuard`, `RoleThrottlerGuard` |
| `GET /api/v1/kyc/my/status` | `INSTRUCTOR` | Role bucket (`ROLE_THROTTLE_INSTRUCTOR_LIMIT`, default 120) | `ROLE_THROTTLE_WINDOW_MS` (default 60s) | `JwtAuthGuard`, `RolesGuard`, `RoleThrottlerGuard` |

## Response Headers & 429 Behavior

Every request handled through `RoleThrottlerGuard` includes standard rate-limit headers:

- `X-RateLimit-Bucket`: Resolved role tier (`INSTRUCTOR`, `ADMIN`, or `anon`)
- `X-RateLimit-Limit`: Maximum requests permitted in the active window
- `X-RateLimit-Remaining`: Remaining requests in the active window
- `X-RateLimit-Reset`: Unix epoch timestamp (seconds) when the window resets

When a limit is exceeded, the server responds with `HTTP 429 Too Many Requests` and a `Retry-After` header indicating the number of seconds before retrying.
