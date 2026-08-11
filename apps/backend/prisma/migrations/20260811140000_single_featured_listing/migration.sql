-- Exactly one featured listing at a time.
--
-- The marketplace renders a single Featured slot, so a second featured row was
-- invisible — it silently lost. Enforce the rule in the database rather than
-- trusting every future write path to clear the previous pick.

-- Keep only the most recently featured row, in case any duplicates exist.
UPDATE "AgentListing"
SET "featuredAt" = NULL
WHERE "featuredAt" IS NOT NULL
  AND id <> (
    SELECT id FROM "AgentListing"
    WHERE "featuredAt" IS NOT NULL
    ORDER BY "featuredAt" DESC, id ASC
    LIMIT 1
  );

DROP INDEX IF EXISTS "AgentListing_featuredAt_idx";

-- Unique on a constant, restricted to featured rows: at most ONE row may have
-- a non-null featuredAt. A second insert/update violates the index.
CREATE UNIQUE INDEX IF NOT EXISTS "AgentListing_single_featured_key"
  ON "AgentListing" ((true))
  WHERE "featuredAt" IS NOT NULL;
