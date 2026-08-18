-- Admin-controlled palette name and group for architect builder nodes.
ALTER TABLE "ArchitectNodeVisibility"
  ADD COLUMN IF NOT EXISTS "label" TEXT,
  ADD COLUMN IF NOT EXISTS "group" TEXT;
