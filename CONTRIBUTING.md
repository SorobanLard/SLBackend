# Contributing to SorobanLard Backend

First off, thank you for considering a contribution to the SorobanLard backend! 🎉

This document explains how to set up a local development environment, run the
tests and linters, and submit a pull request that follows the project's
conventions.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database & Migrations](#database--migrations)
- [Running the App Locally](#running-the-app-locally)
- [Running Tests](#running-tests)
- [Lint & Format](#lint--format)
- [Project Layout](#project-layout)
- [Pull Request Checklist](#pull-request-checklist)
- [Commit & Branch Conventions](#commit--branch-conventions)

## Prerequisites

- **Node.js** 18+ and **npm**
- **PostgreSQL** (15+)
- **Redis** (for caching, rate limiting and BullMQ job queues)
- **Meilisearch** (optional locally, required for full-text search)
- **Docker** (optional, for spinning up the local infra via `docker-compose.yml`)

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/SorobanLard/SLBackend.git
cd SLBackend

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env
#    → then fill in the required values (see below)

# 4. Set up the database schema
npx prisma migrate dev
npx prisma generate

# 5. Start the development server
npm run start:dev
```

### Local infrastructure (optional)

The default local stack can be started with Docker Compose:

```bash
docker compose up -d postgres redis meilisearch
```

The API is then served at `http://localhost:3000/api/v1` and the Swagger UI at
`http://localhost:3000/docs`.

## Environment Variables

Copy `.env.example` to `.env` and adjust the values for your local setup.
Key groups:

| Group | Variables | Notes |
| --- | --- | --- |
| Server | `NODE_ENV`, `PORT`, `API_PREFIX`, `APP_BASE_URL`, `PUBLIC_API_URL`, `FRONTEND_URL` | API is prefixed with `API_PREFIX` (default `api/v1`) |
| Logging / Sentry | `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Optional error monitoring |
| Auth | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | JWT secrets are required |
| Database | `DATABASE_URL`, `PRISMA_CONNECTION_LIMIT`, `PRISMA_POOL_TIMEOUT_SECONDS` | PostgreSQL via Prisma |
| Stellar | `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_HORIZON_URL`, `SOROBANLARD_CONTRACT_ID`, `USDC_TOKEN_ADDRESS`, `ADMIN_STELLAR_ADDRESS`, `TREASURY_STELLAR_ADDRESS` | On-chain payment rail |
| File storage / CDN | `UPLOAD_DIR`, `MAX_FILE_SIZE_MB`, `CDN_*` | |
| Email / SMS | `SMTP_*`, `AFRICASTALKING_*` | |
| Redis | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `QUEUE_*`, `CACHE_TTL_SECONDS` | |
| Rate limiting | `THROTTLE_*`, `RATE_LIMIT_*`, `ROLE_THROTTLE_*` | |
| CAPTCHA | `CAPTCHA_SECRET_KEY`, `CAPTCHA_VERIFY_URL`, `CAPTCHA_TIMEOUT_MS`, `CAPTCHA_MAX_FAILURES`, `CAPTCHA_BLOCK_DURATION_SECONDS` | Required before auth nonce issuance |
| Fraud detection | `FRAUD_*` | See [`docs/FRAUD_DETECTION.md`](docs/FRAUD_DETECTION.md) |
| Referrals | `REFERRAL_*` | See [`docs/REFERRAL_PROGRAM.md`](docs/REFERRAL_PROGRAM.md) |
| Webhooks | `WEBHOOK_SECRET`, `WEBHOOK_SECRET_*` | |

Never commit real secrets — `.env` is git-ignored; use `.env.example` as the
template for new variables.

## Database & Migrations

```bash
# Development — generate migration + apply it
npx prisma migrate dev --name descriptive_change

# Production / CI — apply pending migrations without a new one
npx prisma migrate deploy

# Regenerate the Prisma client after schema changes
npx prisma generate
```

## Running the App Locally

```bash
npm run start:dev   # watch mode
npm run start       # production build
npm run start:prod  # run dist/
```

## Running Tests

```bash
npm run test        # run all Jest unit tests
npm run test:cov    # run tests with coverage
```

The CI pipeline runs the test suite against a disposable PostgreSQL + Redis
instance, so make sure migrations apply cleanly before opening a PR.

## Lint & Format

```bash
npm run lint   # ESLint (with --fix)
npm run format # Prettier
```

Please make sure `npm run lint` and `npm run build` pass before submitting a PR.

## Project Layout

```
src/
├── main.ts               # Bootstrap, global pipes/filters/interceptors, Swagger
├── app.module.ts         # Root module wiring
├── common/               # Cross-module concerns (Prisma, Stellar, guards, filters…)
└── modules/              # Feature modules (auth, users, courses, …, fraud-review…)
prisma/                   # schema.prisma + migrations/
docs/                     # Feature documentation (fraud, referrals, …)
```

## Pull Request Checklist

Before you open a PR, please make sure that:

- [ ] The change builds (`npm run build`) and lints (`npm run lint`) cleanly.
- [ ] New/changed unit tests pass (`npm run test`).
- [ ] Documentation (README / `docs/`) is updated for user-facing changes.
- [ ] No secrets or `.env` files are committed.
- [ ] The PR is linked to the issue it closes (`Closes #NNN`).

## Commit & Branch Conventions

- Branch from the latest `main`.
- Use short-lived branches, e.g. `feat/<short-name>` or `fix/<short-name>`.
- Write commits following the Conventional Commits style:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Reference the related issue in the PR description so it auto-closes on merge
  (e.g. `Closes #158`).

Thank you for helping build SorobanLard! 🚀
```

Wait — the project layout mention "fraud-review" module — actual module is enrollments. Let me not invent module names. Fix: `└── modules/              # Feature modules (auth, users, courses, …, enrollments, referrals, …)`.

Let me write it now.</think>Now creating `CONTRIBUTING.md` for issue #160:<tool_call>write<arg_key>content</arg_key><arg_value># Contributing to SorobanLard Backend

First off, thank you for considering a contribution to the SorobanLard backend! 🎉

This document explains how to set up a local development environment, run the
tests and linters, and submit a pull request that follows the project's
conventions.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database & Migrations](#database--migrations)
- [Running the App Locally](#running-the-app-locally)
- [Running Tests](#running-tests)
- [Lint & Format](#lint--format)
- [Project Layout](#project-layout)
- [Pull Request Checklist](#pull-request-checklist)
- [Commit & Branch Conventions](#commit--branch-conventions)

## Prerequisites

- **Node.js** 18+ and **npm**
- **PostgreSQL** (15+)
- **Redis** (caching, rate limiting and BullMQ job queues)
- **Meilisearch** (optional locally, required for full-text search)
- **Docker** (optional, for the local infra via `docker-compose.yml`)

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/SorobanLard/SLBackend.git
cd SLBackend

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env
#    → then fill in the required values (see below)

# 4. Set up the database schema
npx prisma migrate dev
npx prisma generate

# 5. Start the development server
npm run start:dev
```

### Local infrastructure (optional)

The default local stack can be started with Docker Compose:

```bash
docker compose up -d postgres redis meilisearch
```

The API is then served at `http://localhost:3000/api/v1` and the Swagger UI at
`http://localhost:3000/docs`.

## Environment Variables

Copy `.env.example` to `.env` and adjust the values for your local setup.
Key groups:

| Group | Variables | Notes |
| --- | --- | --- |
| Server | `NODE_ENV`, `PORT`, `API_PREFIX`, `APP_BASE_URL`, `PUBLIC_API_URL`, `FRONTEND_URL` | API is prefixed with `API_PREFIX` (default `api/v1`) |
| Logging / Sentry | `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Optional error monitoring |
| Auth | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | JWT secrets are required |
| Database | `DATABASE_URL`, `PRISMA_CONNECTION_LIMIT`, `PRISMA_POOL_TIMEOUT_SECONDS` | PostgreSQL via Prisma |
| Stellar | `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_HORIZON_URL`, `SOROBANLARD_CONTRACT_ID`, `USDC_TOKEN_ADDRESS`, `ADMIN_STELLAR_ADDRESS`, `TREASURY_STELLAR_ADDRESS` | On-chain payment rail |
| File storage / CDN | `UPLOAD_DIR`, `MAX_FILE_SIZE_MB`, `CDN_*` | |
| Email / SMS | `SMTP_*`, `AFRICASTALKING_*` | |
| Redis | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `QUEUE_*`, `CACHE_TTL_SECONDS` | |
| Rate limiting | `THROTTLE_*`, `RATE_LIMIT_*`, `ROLE_THROTTLE_*` | |
| CAPTCHA | `CAPTCHA_SECRET_KEY`, `CAPTCHA_VERIFY_URL`, `CAPTCHA_TIMEOUT_MS`, `CAPTCHA_MAX_FAILURES`, `CAPTCHA_BLOCK_DURATION_SECONDS` | Required before auth nonce issuance |
| Fraud detection | `FRAUD_*` | See [`docs/FRAUD_DETECTION.md`](docs/FRAUD_DETECTION.md) |
| Referrals | `REFERRAL_*` | See [`docs/REFERRAL_PROGRAM.md`](docs/REFERRAL_PROGRAM.md) |
| Webhooks | `WEBHOOK_SECRET`, `WEBHOOK_SECRET_*` | |

Never commit real secrets — `.env` is git-ignored; use `.env.example` as the
template for any new variable you introduce.

## Database & Migrations

```bash
# Development — generate migration + apply it
npx prisma migrate dev --name descriptive_change

# Production / CI — apply pending migrations without generating a new one
npx prisma migrate deploy

# Regenerate the Prisma client after schema changes
npx prisma generate
```

## Running the App Locally

```bash
npm run start:dev   # watch mode
npm run start       # production build
npm run start:prod  # run dist/
```

## Running Tests

```bash
npm run test        # run all Jest unit tests
npm run test:cov    # run tests with coverage
```

The CI pipeline runs the test suite against disposable PostgreSQL and Redis
services, so make sure the migrations apply cleanly before opening a PR.

## Lint & Format

```bash
npm run lint   # ESLint (includes --fix)
npm run format # Prettier
```

Please make sure `npm run lint` and `npm run build` pass before submitting a PR.

## Project Layout

```
src/
├── main.ts               # Bootstrap, global pipes/filters/interceptors, Swagger
├── app.module.ts         # Root module wiring
├── common/               # Cross-module concerns (Prisma, Stellar, guards, filters…)
└── modules/              # Feature modules (auth, users, courses, …, fraud, referrals, …)
prisma/                   # schema.prisma + migrations/
docs/                     # Feature documentation (fraud detection, referral program, …)
```

## Pull Request Checklist

Before you open a PR, please make sure that:

- [ ] The change builds (`npm run build`) and lints (`npm run lint`) cleanly.
- [ ] New/changed unit tests pass (`npm run test`).
- [ ] Documentation (README / `docs/`) is updated for user-facing changes.
- [ ] No secrets or `.env` files are committed.
- [ ] The PR is linked to the issue it closes (`Closes #NNN`).

## Commit & Branch Conventions

- Branch from the latest `main`.
- Use short-lived branches, e.g. `feat/<short-name>` or `fix/<short-name>`.
- Write commits following the Conventional Commits style: `feat:`, `fix:`,
  `docs:`, `refactor:`, `test:`, `chore:`.
- Reference the related issue in the PR description so it auto-closes on merge
  (e.g. `Closes #158`).

Thank you for helping build SorobanLard! 🚀
