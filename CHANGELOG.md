# Changelog

All notable changes to the SorobanLard backend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-15

### Initial release

SorobanLard — NestJS backend for the online vocational skills learning platform built on Stellar/Soroban.

### Features

- Stellar wallet authentication (JWT + nonce issuance) and Google OAuth
- Phone OTP verification via Africa's Talking
- Course catalog: creation, approval, browsing, categories, prerequisites, checkout breakdown
- Lessons, enrollments, assignments, quizzes/exams, certificates (PDF generation, social share)
- Events module with Stellar event-poller ledger checkpointing for crash recovery
- Notifications, discussions, reviews, reports, disputes, coupons, wishlist, tags
- Gamification badges, leaderboard, live sessions, payouts, backups, uploads
- Search (Meilisearch), analytics, audit logging, moderation, privacy/KYC
- Instructor/session management, revenue and engagement reports
- Rate limiting (per-IP + role-based throttling), webhook HMAC-SHA256 signature verification
- Sentry error monitoring, structured logging, response caching (Redis)
- CAPTCHA verification before auth nonce issuance

### Bug fixes

- Audit log export bounded with default date range and batches
- Leaderboard persistence and rank movement snapshots
- Course detail cache invalidation; bounded analytics event scans
- Prisma pool connection limit and timeout configuration
- Certificate validation, fraud flag persistence, exam permissions, lesson Q&A endpoints
- Coupon expiresAt and discount bounds validation

### Performance

- Cache course details and leaderboard responses

### Documentation

- Scalability audit findings and verification limits
- Prisma pool controls, certificate queue, and persistent storage

---

## [Unreleased]

Changes accumulated since the last release. Run `npm run release` (standard-version) to
cut a new semantic version, regenerate this changelog, and create a git tag.
