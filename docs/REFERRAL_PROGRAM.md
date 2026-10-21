# Referral Program

This document describes the SorobanLard referral program: how referral codes
are created and validated, how discounts flow to referred users, how referrer
rewards are issued, expired, capped and redeemed.

- Implementation: `src/modules/referrals/`
- Related migration: `prisma/migrations/20260929000000_persist_quiz_referral_payout_gates/migration.sql`
- Environment variables: `REFERRAL_*` in `.env.example`

## Overview

The referral program works as a two-sided discount model:

1. **Referee discount** — the referred user receives a percentage discount on
   their first qualifying enrollment.
2. **Referrer reward** — the referrer (who shared the referral code) earns a
   percentage discount reward each time a referred user converts into an
   enrollment.

Both values are configurable and persisted, so they can be tuned per
environment without a code change.

## Concepts

| Entity | Purpose |
| --- | --- |
| `ReferralCode` | Per-user shareable code (e.g. `HAMP-XXXXXX`) and signup/conversion counters. |
| `Referral` | Links a referrer to a referred user (`SIGNED_UP` → `CONVERTED`). |
| `ReferralReward` | A single reward — either a `REFERRER` reward (earned on conversion) or a `REFERREE` welcome reward (issued on signup). |
| `ReferralRewardRule` | Singleton (`id = "default"`) holding the active reward issuance rules. Falls back to `REFERRAL_*` env defaults when unset. |

## Reward Rules

| Rule | Environment variable | Default |
| --- | --- | --- |
| Referrer discount percent | `REFERRAL_REFERRER_DISCOUNT_PERCENT` | `10` |
| Referee discount percent | `REFERRAL_REFEREE_DISCOUNT_PERCENT` | `10` |
| Reward expiry (days) | `REFERRAL_REWARD_EXPIRY_DAYS` | `90` |
| Max rewards per referrer | `REFERRAL_MAX_REWARDS_PER_REFERRER` | `50` |

Admins can inspect and override the persisted rules via the admin endpoints:

- `GET /referrals/rules` — read current reward rules.
- `PATCH /referrals/rules` — update reward rules (admin only).

When no singleton rules row exists, the service falls back to the
`REFERRAL_*` environment defaults.

## Discount & Reward Flows

### 1. Referral code generation

`POST /referrals/code` (authenticated) → `GET /referrals/code` returns the
user's personal referral code, creating one if missing (`HAMP-XXXXXX`).

### 2. Code validation

`POST /referrals/validate` with `{ "code": "HAMP-XXXXXX" }` validates the code
at registration/share time and returns:

```json
{
  "valid": true,
  "code": "HAMP-XXXXXX",
  "referrer": { "id": "…", "name": "…" },
  "refereeDiscountPercent": 10,
  "referrerDiscountPercent": 10
}
```

Invalid, inactive or self-referential codes are rejected.

### 3. Referral signup & referee welcome reward

On first authenticated login with a valid code, the auth service records the
signup (`SIGNED_UP`) and issues the referee welcome reward
(`kind: REFERREE`) with the configured referee discount percent. The reward is
issued with an expiry of `REFERRAL_REWARD_EXPIRY_DAYS` days.

### 4. Conversion & referrer reward payout (the payout gate)

When a referred user successfully converts into an enrollment
(`ReferralsService.trackConversion`), the referral is marked
`CONVERTED` and the referrer reward (`kind: REFERRER`) is issued — provided the
active referrer discount is greater than zero and the referrer has not yet
reached `REFERRAL_MAX_REWARDS_PER_REFERRER` rewards.

The reward:

- uses the configured `REFERRAL_REFERRER_DISCOUNT_PERCENT` as a percentage
  discount,
- is issued with an expiry of `REFERRAL_REWARD_EXPIRY_DAYS` days,
- is counted against the referrer's per-referrer reward cap.

> **Payout gating & quiz completion:** reward payout is gated on the referred
> user completing the conversion path (successful enrollment). The
> `20260929000000_persist_quiz_referral_payout_gates` migration persists the
> referral payout state together with quiz attempts/sessions, tying the payout
> gate to verified quiz-completion evidence.

### 5. Reward redemption

`POST /referrals/rewards/redeem` with
`{ "rewardId": "…", "enrollmentId": "…" }` marks an issued reward as
`REDEEMED` after a successful enrollment. Expired rewards cannot be redeemed and
are transitioned to `EXPIRED`.

`POST /referrals/rewards/preview` with `{ "originalPrice": 100, "rewardId": "…" }`
(prefer omitting `rewardId`) returns the discount that would be applied:
`discountAmount` and the `finalPrice` after discount.

### 6. Reward expiry & cleanup

Issued rewards carry an `expiresAt`; stale `ISSUED` rewards are transitioned to
`EXPIRED` when listed.

## Endpoints Summary

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/referrals/validate` | Public | Validate a referral code at registration. |
| `POST` | `/referrals/code` | Authenticated | Generate (or return) personal referral code. |
| `GET` | `/referrals/code` | Authenticated | Get own referral code. |
| `GET` | `/referrals/status` | Authenticated | Referral performance (signups, conversions, rewards). |
| `GET` | `/referrals/rewards` | Authenticated | List own referral rewards. |
| `POST` | `/referrals/rewards/preview` | Authenticated | Preview a reward discount. |
| `POST` | `/referrals/rewards/redeem` | Authenticated | Redeem a reward after enrollment. |
| `PATCH` | `/referrals/code/deactivate` | Authenticated | Deactivate own referral code. |
| `GET` | `/referrals/rules` | Admin | View reward issuance rules. |
| `PATCH` | `/referrals/rules` | Admin | Update reward issuance rules. |

## Related Documentation

- [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- [`docs/FRAUD_DETECTION.md`](FRAUD_DETECTION.md)

---

Thank you for contributing to the SorobanLard referral program! 🎉
