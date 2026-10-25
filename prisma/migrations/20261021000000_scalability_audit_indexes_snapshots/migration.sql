-- Add materialized leaderboard values and preserve rank movement between refreshes.
ALTER TABLE "leaderboard_snapshots"
  ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previousRank" INTEGER;

-- Align the fraud-check rolling windows with Enrollment's actual columns.
CREATE INDEX "enrollments_studentId_enrolledAt_idx"
  ON "enrollments"("studentId", "enrolledAt");

-- Efficiently serve actor-filtered audit history in reverse chronological order.
CREATE INDEX "admin_audit_logs_actorId_createdAt_idx"
  ON "admin_audit_logs"("actorId", "createdAt");
