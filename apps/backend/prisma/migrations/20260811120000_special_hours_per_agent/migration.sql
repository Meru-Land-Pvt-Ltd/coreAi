-- Special hours (holidays / closures) become per InstalledAgent.
--
-- They were keyed by business alone, so a holiday closure applied to every
-- agent in the account: a nail salon shutting for a holiday also closed the
-- wedding planner sharing that business row.
--
-- Existing rows keep installedAgentId = NULL, which the read path treats as a
-- business-wide closure honoured by every agent. Nothing changes for anyone
-- until an agent saves its own closures.

ALTER TABLE "BusinessSpecialHours"
  ADD COLUMN IF NOT EXISTS "installedAgentId" TEXT;

-- The old key allowed one row per (business, date). Per-agent closures need the
-- agent in the key. Postgres treats NULLs as distinct, so legacy business-wide
-- rows stay unique per date via the partial index below.
ALTER TABLE "BusinessSpecialHours"
  DROP CONSTRAINT IF EXISTS "BusinessSpecialHours_businessId_date_key";

DROP INDEX IF EXISTS "BusinessSpecialHours_businessId_date_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessSpecialHours_businessId_installedAgentId_date_key"
  ON "BusinessSpecialHours"("businessId", "installedAgentId", "date");

-- NULLs are distinct in a multi-column unique index, so guard the legacy
-- business-wide rows separately: still one per (business, date).
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessSpecialHours_business_wide_date_key"
  ON "BusinessSpecialHours"("businessId", "date")
  WHERE "installedAgentId" IS NULL;

CREATE INDEX IF NOT EXISTS "BusinessSpecialHours_installedAgentId_idx"
  ON "BusinessSpecialHours"("installedAgentId");

ALTER TABLE "BusinessSpecialHours"
  ADD CONSTRAINT "BusinessSpecialHours_installedAgentId_fkey"
  FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
