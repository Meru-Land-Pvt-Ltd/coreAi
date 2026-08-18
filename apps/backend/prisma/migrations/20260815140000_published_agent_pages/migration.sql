-- Published agent pages (triven.ai/a/<slug>). Fully additive: one new table
-- holding the public hosted page for each approved listing — slug, template
-- ("chat" | "voice" | "media" | "form"), and architect-editable copy. No
-- existing table is altered; no existing row is modified or dropped.

CREATE TABLE IF NOT EXISTS "PublishedAgentPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'chat',
    "headline" TEXT,
    "welcomeMessage" TEXT,
    "suggestedPrompts" TEXT[],
    "accentColor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublishedAgentPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PublishedAgentPage_slug_key" ON "PublishedAgentPage"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "PublishedAgentPage_listingId_key" ON "PublishedAgentPage"("listingId");
CREATE INDEX IF NOT EXISTS "PublishedAgentPage_workflowId_idx" ON "PublishedAgentPage"("workflowId");
CREATE INDEX IF NOT EXISTS "PublishedAgentPage_architectUserId_idx" ON "PublishedAgentPage"("architectUserId");
ALTER TABLE "PublishedAgentPage" ADD CONSTRAINT "PublishedAgentPage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "AgentListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
