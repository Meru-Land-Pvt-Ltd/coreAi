-- Admin-controlled "Featured" marketplace slot.
--
-- The marketplace previously featured whichever listing sorted first, so the
-- slot was never actually chosen by anyone. featuredAt is set only by the admin
-- toggle; NULL means not featured, and the timestamp orders multiple picks
-- (most recently featured first).

ALTER TABLE "AgentListing"
  ADD COLUMN IF NOT EXISTS "featuredAt" TIMESTAMP(3);

-- Partial index: the marketplace only ever reads the featured rows.
CREATE INDEX IF NOT EXISTS "AgentListing_featuredAt_idx"
  ON "AgentListing"("featuredAt")
  WHERE "featuredAt" IS NOT NULL;
