-- Document knowledge is scoped to the installed agent that uploaded it.
-- installedAgentId is denormalized onto chunks (null = business-wide, which
-- covers all manual entries and legacy chunks).
ALTER TABLE "BusinessKnowledgeBase" ADD COLUMN     "installedAgentId" TEXT;

-- Backfill existing document chunks from their source file's attribution.
UPDATE "BusinessKnowledgeBase" kb
SET "installedAgentId" = f."installedAgentId"
FROM "BusinessKnowledgeFile" f
WHERE kb."sourceFileId" = f."id" AND f."installedAgentId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "BusinessKnowledgeBase_businessId_installedAgentId_idx" ON "BusinessKnowledgeBase"("businessId", "installedAgentId");

-- Duplicate handling is per installed agent: the same PDF may be attached to
-- two different agents of one business with separate associations.
DROP INDEX "BusinessKnowledgeFile_businessId_contentHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "BusinessKnowledgeFile_businessId_installedAgentId_contentHash_key" ON "BusinessKnowledgeFile"("businessId", "installedAgentId", "contentHash");
