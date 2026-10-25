# Contributing

Thanks for taking the time to contribute! This document covers the conventions we follow in this repository.

## Getting started

1. Fork the repository and create a feature branch off `main`.
2. Install dependencies and set up your local environment as described in the README.
3. Make your changes, keeping commits focused and descriptive.
4. Open a pull request against `main`.

## Pull requests

- Keep PRs scoped to a single concern where possible.
- Describe the motivation and the approach in the PR description.
- Link the issue(s) the PR resolves.
- Make sure CI passes before requesting review.

## Database migrations

This is a 3-repo project: the frontend repo depends on the shape of this API, so
backward-incompatible database changes must be visible to consumers.

When a Prisma migration is **backward-incompatible**, call it out explicitly in the
PR description. A migration is considered backward-incompatible when it:

- removes (drops) a column,
- renames a column, or
- changes a non-nullable constraint (e.g. making a nullable column `NOT NULL`, or
  adding a required column without a default).

For each such migration, include a short note in the PR description covering:

- the migration name (e.g. `20260928000000_add_certificate_revoke_fields_and_fraud_held`),
- what changed and why,
- which consumers (frontend/contract repos) are affected and what they need to do.

Purely additive migrations (new tables, new nullable columns, new indexes) do not
require a note, but are still welcome to be mentioned for context.

## Code style

- Follow the existing patterns, types, and module structure in the codebase.
- Keep changes surgical; avoid unrelated refactors in the same PR.
