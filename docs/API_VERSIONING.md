# API Versioning and Deprecation Policy

This document defines how the SorobanLard HTTP API is versioned, how breaking
changes are introduced, and how deprecations are communicated across the three
SorobanLard repositories:

- `sorobanlard-contract` — Soroban smart contract (Rust)
- `sorobanlard-backend` — this NestJS API
- `sorobanlard-frontend` — Next.js student/instructor portal

## Versioning scheme

The API uses **URL major-versioning**:

```
https://api.sorobanlard.com/api/v1/...
```

`API_PREFIX` defaults to `api/v1` (`src/main.ts`) and is the single source of
truth for the current major version. The URL only carries the major version;
there is no separate minor or patch segment in the path.

### What can change inside a major version

Within `v1`, the following **non-breaking** changes are made in place and do not
require a new version:

| Change | Allowed in place? |
| --- | --- |
| Adding a new endpoint | Yes |
| Adding an optional request field/query parameter | Yes |
| Adding a response field | Yes |
| Adding a new enum value that clients must tolerate | Yes, with notice |
| Relaxing validation | Yes |
| Changing response field order or whitespace | Yes |
| Removing/renaming an endpoint or field | No (breaking) |
| Making an optional field required | No (breaking) |
| Changing a field's type, format, or meaning | No (breaking) |
| Changing authentication/authorization requirements | No (breaking) |
| Changing pagination defaults in a way that drops data | No (breaking) |
| Changing webhook payload shape or signing scheme | No (breaking) |

Clients must ignore unknown response fields and treat enums as open sets so
additive changes remain safe.

### Introducing a new major version

A new major version (`v2`) is required for any breaking change that cannot be
made backward-compatibly. The process is:

1. Open a `v2` design issue in this repository describing the motivation, the
   affected endpoints, and the migration path from `v1`.
2. Implement `v2` alongside `v1` behind a new prefix (for example
   `API_PREFIX=api/v2` or a router-level `/v2` namespace). Do **not** mutate
   existing `v1` handlers in place.
3. Keep `v1` fully functional for the deprecation window described below.
4. Publish OpenAPI/Swagger for both versions and update `README.md`.
5. Add compatibility tests covering `v1` and `v2` for the shared critical flows
   (auth, courses, enrollment, certificates, payments).
6. Coordinate release order across repos: contract (if applicable) → backend →
   frontend. The backend must support the old contract event/ABI shape until the
   contract migration window closes.

`v1` is retired only after the final Sunset date has passed and telemetry shows
no meaningful live traffic (or all known consumers have migrated).

## Deprecation process

### 1. Announce

Every deprecation starts with a GitHub issue labelled `api-deprecation` in this
repository. The issue must include:

- The deprecated endpoint, field, parameter, or webhook contract.
- The replacement (or explicitly state that no replacement exists).
- The reason and expected impact.
- The planned Sunset date (at least the minimum notice period).
- Links to the corresponding frontend and, when relevant, contract issues.

Add the item to the API changelog (`docs/API_CHANGELOG.md` once created) and
update the affected Swagger operation with `@deprecated`.

### 2. Emit deprecation headers

While an endpoint is deprecated but still functional, include the following
response headers on every call:

```http
Deprecation: @1767225600
Sunset: Wed, 01 Apr 2026 00:00:00 GMT
Link: <https://api.sorobanlard.com/docs/changelog#deprecate-old-endpoint>; rel="deprecation"; type="text/html"
Warning: 299 - "This endpoint is deprecated and will be removed on 2026-04-01. Use /api/v1/new-endpoint instead."
```

Header semantics:

| Header | Meaning |
| --- | --- |
| `Deprecation` | RFC 9745 structured timestamp (`@<unix-seconds>`) indicating when the resource became deprecated. For older clients, `Deprecation: true` is an accepted fallback. |
| `Sunset` | RFC 8594 HTTP-date (IMF-fixdate) after which the resource may stop responding. |
| `Link` with `rel="deprecation"` | Human-readable migration documentation. |
| `Warning` (optional) | Human-readable notice; clients should not parse it. |

### 3. Minimum notice period

- **Standard deprecations:** at least **90 calendar days** between the first
  announcement (and live deprecation headers) and the Sunset date.
- **Money-moving, enrollment, certificate, auth, or contract-facing changes:**
  at least **180 calendar days**, because these require coordinated frontend
  and contract releases and may affect in-flight on-chain transactions.
- **Security exceptions:** a shorter window is allowed only for an active
  vulnerability or data-loss risk. The issue must document the risk and the
  emergency approval; 7 days is the recommended minimum even in this case.

The notice period starts when the announcement is published *and* the
deprecation headers are deployed, whichever is later.

### 4. Migrate and monitor

- Frontend should migrate before the Sunset date and remove its own usage.
- Backend should track usage of the deprecated surface (logs/metrics) and
  proactively contact known consumers if traffic remains near Sunset.
- Both sides add or update tests so the replacement contract is covered.
- The deprecation issue remains open until the endpoint is removed.

### 5. Sunset

On or after the Sunset date:

1. Return `410 Gone` with a body pointing to the replacement, or `404 Not Found`
   when the route is removed entirely.
2. Remove the handler and its DTOs from the codebase.
3. Update Swagger, `README.md`, and the changelog.
4. Close the `api-deprecation` issue and the linked frontend/contract issues.

Do not reuse a sunset URL for a different meaning; add a new endpoint instead.

## Cross-repo coordination

Because SorobanLard is split across three repositories, the deprecation issue is
the coordination point. The expected sequence is:

| Change involves | Contract repo | Backend repo | Frontend repo |
| --- | --- | --- | --- |
| Pure REST response/field change | — | Implement `v2`/deprecation | Update client + tests |
| Enrollment/payment payload change | Update contract only if args/events change | Support old + new shapes during migration | Update wallet/tx flow |
| On-chain event schema change | Publish new event version/fields | Poller accepts both old and new events | Update decoding/UI |
| Certificate metadata/ABI change | Update contract + migration plan | Support old + new certificate verification | Update certificate display/share |
| Webhook payload/signature change | — | Keep old route until Sunset; document in `docs/WEBHOOKS.md` | Update receiver if applicable |

Rules:

- The backend must never require a frontend or contract release that is not yet
  deployed. Release backend compatibility shims first.
- Contract ABI/event versions are independent of the REST major version. Record
  the mapping in the deprecation issue (for example: backend `v2` supports
  contract events `v1` and `v2` until the contract `v1` Sunset).
- When a contract change is irreversible (for example, a new required argument),
  the frontend must ship before the backend stops accepting the old shape.

## Version headers and discovery

- Swagger is served at `/docs` and the OpenAPI document at `/docs-json`.
  `DocumentBuilder.setVersion('1.0')` must be bumped for each new major version.
- Responses may include `X-API-Version: v1` in future middleware; clients should
  not depend on it until it is documented.
- Webhook receivers should treat the API version and webhook payload version as
  separate: payloads may carry an explicit `version` field, while the webhook
  URL remains stable unless a new provider route is required.

## Client responsibilities

- Pin to a major version (`/api/v1`) rather than constructing URLs from env
  values that may change per environment.
- Surface `Deprecation` and `Sunset` headers in development telemetry so
  migrations start early.
- Treat unknown fields and enum values as forward-compatible.
- Do not parse `Warning` text programmatically; use `Sunset` for dates.
