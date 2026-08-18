-- Design Brain dials for published agent pages. Fully additive: one new
-- nullable JSON column on PublishedAgentPage holding the validated
-- DesignConfig (theme / composerPosition / density / bubbleStyle /
-- showHistorySidebar). NULL means "all defaults" — no existing row changes
-- meaning, no table is dropped or rewritten.

ALTER TABLE "PublishedAgentPage" ADD COLUMN IF NOT EXISTS "designJson" JSONB;
