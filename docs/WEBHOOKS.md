# Inbound Webhooks

This document describes the contract for inbound webhook integrations handled by
`WebhookSignatureMiddleware`. It lists the provider routes, the signature scheme
each provider uses, the secret that must be configured, and example payloads.

## Base path

All inbound webhooks live under the global API prefix:

```
{API_PREFIX}/webhooks/*
```

`API_PREFIX` defaults to `api/v1`, so in local development the base path is
`http://localhost:3000/api/v1/webhooks`.

The middleware is registered in `AppModule` with `.forRoutes('webhooks')`, which
means it runs for every route under the prefix. Provider-specific secrets are
selected from the first path segment after `/webhooks/`:

| Route | Provider | Secret env var | Fallback |
| --- | --- | --- | --- |
| `POST /api/v1/webhooks/stripe` | Stripe | `WEBHOOK_SECRET_STRIPE` | `WEBHOOK_SECRET` |
| `POST /api/v1/webhooks/africastalking` | Africa's Talking | `WEBHOOK_SECRET_AFRICASTALKING` | `WEBHOOK_SECRET` |
| `POST /api/v1/webhooks/github` | GitHub | `WEBHOOK_SECRET_GITHUB` | `WEBHOOK_SECRET` |
| `POST /api/v1/webhooks` | Generic / default | `WEBHOOK_SECRET` | — |

Provider-specific secrets are optional. When a provider secret is not set, the
middleware falls back to `WEBHOOK_SECRET`. If neither is configured, the request
is rejected with `403 Forbidden`.

> **Current code status:** the signature middleware is installed globally for the
> `webhooks` route prefix, while provider handlers can be added as controllers
> under `@Controller('webhooks/<provider>')`. The route and payload contracts
> below are the supported integration format for those handlers. The SMS
> delivery-report handler currently lives at `POST /api/v1/notifications/sms/callback`
> (outside the `/webhooks` prefix, therefore unsigned); move it under the prefix
> or apply equivalent verification before exposing it publicly.

## Signature verification

The middleware:

1. Reads the raw request body. This requires `NestFactory.create(..., { rawBody: true })`
   (already enabled in `src/main.ts`).
2. Computes `HMAC-SHA256(secret, rawBody)`.
3. Compares the expected and received values with a timing-safe comparison.
4. Rejects the request before it reaches the route handler if verification fails.

### Accepted signature headers

The middleware checks these headers in order and uses the first one present:

| Header | Used by | Format |
| --- | --- | --- |
| `X-Webhook-Signature` | Generic, Africa's Talking | `sha256=<hex>` (preferred) or `<hex>` |
| `X-Hub-Signature-256` | GitHub, Meta-style providers | `sha256=<hex>` |
| `Stripe-Signature` | Stripe | `t=<unix-timestamp>,v1=<hex>[,v1=<hex>...]` |

For Stripe, only the first `v1=` HMAC value is compared. The `t=` timestamp is
parsed by the middleware only as part of the header; it is **not** currently used
for replay protection. Add a timestamp tolerance check (or delegate to the
official Stripe SDK) before relying on Stripe webhooks in production.

### Responses

| Status | Meaning |
| --- | --- |
| `200` / `201` | Signature verified and handler processed the event. |
| `401 Unauthorized` | No signature header was sent. |
| `403 Forbidden` | Signature did not match, no secret is configured, or `rawBody` is unavailable. |

## Provider contracts

### Stripe

- **Route:** `POST /api/v1/webhooks/stripe`
- **Signature header:** `Stripe-Signature`
- **Secret:** `WEBHOOK_SECRET_STRIPE`, falling back to `WEBHOOK_SECRET`
- **Example signature:** `Stripe-Signature: t=1735689600,v1=5f1c...`
- **Notes:** The HMAC is computed over the exact raw body. Do not parse or
  re-serialize the body before the middleware runs.

Example payload (`checkout.session.completed`, abridged):

```json
{
  "id": "evt_1QExample",
  "object": "event",
  "type": "checkout.session.completed",
  "created": 1735689600,
  "data": {
    "object": {
      "id": "cs_test_a1Example",
      "object": "checkout.session",
      "payment_status": "paid",
      "amount_total": 10750,
      "currency": "usdc",
      "client_reference_id": "user_01HX...",
      "metadata": {
        "courseId": "course_01HX...",
        "txHash": "5c9f...stellar...tx...hash"
      }
    }
  }
}
```

Expected handling: verify the event idempotently by `id`, find the referenced
enrollment/course, and only mark payment complete when `payment_status` is
`paid`.

### Africa's Talking

- **Route:** `POST /api/v1/webhooks/africastalking`
- **Signature header:** `X-Webhook-Signature`
- **Secret:** `WEBHOOK_SECRET_AFRICASTALKING`, falling back to `WEBHOOK_SECRET`
- **Example signature:** `X-Webhook-Signature: sha256=9d2b...`
- **Notes:** Africa's Talking may also send delivery reports to a custom callback
  URL configured in their dashboard. Point that URL at this route so it receives
  the same HMAC verification.

Example delivery-report (DLR) payload:

```json
{
  "id": "ATXid_6f1a2b3c4d",
  "status": "Success",
  "phoneNumber": "+2348012345678",
  "networkCode": "62120",
  "failureReason": null,
  "retryCount": 0
}
```

`handleDeliveryCallback` treats `status` values `success` and `delivered`
(case-insensitive) as delivered; any other value marks the message failed.

### GitHub

- **Route:** `POST /api/v1/webhooks/github`
- **Signature header:** `X-Hub-Signature-256`
- **Secret:** `WEBHOOK_SECRET_GITHUB`, falling back to `WEBHOOK_SECRET`
- **Example signature:** `X-Hub-Signature-256: sha256=4a7d...`
- **Notes:** GitHub also sends `X-GitHub-Event` and `X-GitHub-Delivery` headers.
  The middleware verifies the signature only; use `X-GitHub-Delivery` in the
  handler for idempotency.

Example payload (`push` event, abridged):

```json
{
  "ref": "refs/heads/main",
  "before": "6113728f27ae82c7b1a177c8d03f9e96e0adf246",
  "after": "9f5a2c1d7e3b4a6c8d0e2f1a3b5c7d9e1f3a5c7b",
  "repository": {
    "full_name": "SorobanLard/SLBackend",
    "default_branch": "main"
  },
  "pusher": {
    "name": "octocat",
    "email": "octocat@github.com"
  },
  "head_commit": {
    "id": "9f5a2c1d7e3b4a6c8d0e2f1a3b5c7d9e1f3a5c7b",
    "message": "feat: update contract bindings"
  }
}
```

### Generic / default provider

- **Route:** `POST /api/v1/webhooks` (or any unknown provider segment)
- **Signature header:** `X-Webhook-Signature`
- **Secret:** `WEBHOOK_SECRET`
- **Example signature:** `X-Webhook-Signature: sha256=7c9e...`

Example payload — the only required convention is a stable event identity and
type so the handler can deduplicate:

```json
{
  "id": "evt_01JEXAMPLE",
  "type": "enrollment.completed",
  "createdAt": "2026-10-22T12:00:00.000Z",
  "data": {
    "enrollmentId": "enr_01HX...",
    "studentId": "user_01HX...",
    "courseId": "course_01HX...",
    "txHash": "5c9f...stellar...tx...hash"
  }
}
```

## Generating a signature locally

```bash
SECRET="change-me-webhook-signing-secret"
BODY='{"id":"evt_01JEXAMPLE","type":"enrollment.completed"}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST http://localhost:3000/api/v1/webhooks/generic \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  --data-raw "$BODY"
```

Node.js equivalent:

```ts
import { createHmac } from 'crypto';

const signature = createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(rawBody) // exact bytes sent over the wire
  .digest('hex');
```

## Exempting a route with `@SkipWebhookSignature()`

Most webhook routes must be verified. Some providers send unsigned
health-check/handshake requests (for example, a verification `GET`). Use
`@SkipWebhookSignature()` **only** for those routes.

Because Nest middleware runs before guards and interceptors, the decorator alone
is not sufficient. The reliable options are:

**Option A (recommended): keep unsigned endpoints outside the `/webhooks/*`
prefix.** The middleware only covers routes registered under that prefix, so a
separate controller path is exempt automatically.

**Option B: exclude the exact path in `AppModule`:**

```ts
consumer
  .apply(WebhookSignatureMiddleware)
  .exclude({ path: 'api/v1/webhooks/ping', method: RequestMethod.GET })
  .forRoutes('webhooks');
```

Then mark the handler for documentation/intent:

```ts
@Get('webhooks/ping')
@SkipWebhookSignature()
ping() {
  return { ok: true };
}
```

`WebhookSkipGuard` can also stamp `req._webhookSignatureSkipped = true` when it
sees the metadata, but it does not replace the path exclusion because middleware
executes first. Prefer Option A or B rather than relying on the guard alone.

## Operational checklist

- Set `WEBHOOK_SECRET` in every environment; use provider-specific secrets when
  rotating credentials independently.
- Store the exact raw body; never verify against a parsed/re-stringified object.
- Make handlers idempotent using the provider event id/delivery id.
- Return quickly (2xx) and move slow work to the queue.
- Rotate secrets during the provider's retry window; the middleware tries the
  provider-specific secret first, then the default.
- Add replay protection for providers that send timestamps (notably Stripe)
  before processing money-moving events.
