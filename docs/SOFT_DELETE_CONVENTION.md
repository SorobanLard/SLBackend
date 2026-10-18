# Soft-Delete Convention

This document records the soft-delete convention used across the Prisma models that
have a corresponding restore path in the `backups` module. It exists so that future
models follow the same pattern consistently instead of mixing soft-delete and hard
`DELETE` semantics.

## Why soft-delete

The backups module supports restoring courses and enrollments
(`backups/restore.service.ts`, `backups/enrollment-restore.service.ts`). A restore is
only possible if the underlying row still exists, so any model that participates in a
restore path must be soft-deleted rather than hard-deleted.

## Convention

Any model that has a restore path in `backups`/`restore` services MUST:

1. Carry a nullable `deletedAt DateTime?` field (preferred) or an `isDeleted Boolean`
   flag when a timestamp is not meaningful.
2. Have a supporting index on the soft-delete field so that "active rows" queries and
   restore lookups stay efficient, e.g. `@@index([deletedAt])` or
   `@@index([isDeleted])`.
3. Treat `deletedAt IS NULL` (or `isDeleted = false`) as "active" in all read paths.
4. Set `deletedAt` (or `isDeleted = true`) on delete instead of issuing a hard
   `DELETE`, so the row remains available to the restore services.

## Models touched by restore paths

When auditing `prisma/schema.prisma`, confirm each of the following models has the
soft-delete field and its supporting `@@index`:

- `Course` — restored by `backups/restore.service.ts`
- `Enrollment` — restored by `backups/enrollment-restore.service.ts`

If a new model gains a restore path, add it to this list and make sure it satisfies
the convention above before shipping the restore logic.

## Adding a new restorable model

1. Add `deletedAt DateTime?` (or `isDeleted Boolean @default(false)`) to the model.
2. Add `@@index([deletedAt])` (or `@@index([isDeleted])`).
3. Update delete handlers to set the soft-delete field instead of hard-deleting.
4. Filter active rows with `deletedAt: null` (or `isDeleted: false`) in queries.
5. Register the model in the restore service and in the list above.
