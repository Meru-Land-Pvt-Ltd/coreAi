-- The second toggle: may this node run at all, anywhere, including inside
-- agents a business has already bought.
ALTER TABLE "ArchitectNodeVisibility" ADD COLUMN "executionEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ArchitectNodeVisibility" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "ArchitectNodeVisibility" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "ArchitectNodeVisibility" ADD COLUMN "pausedByUserId" TEXT;
CREATE INDEX "ArchitectNodeVisibility_executionEnabled_idx" ON "ArchitectNodeVisibility"("executionEnabled");
