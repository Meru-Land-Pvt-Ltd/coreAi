-- Smart Memory v2: record-level storage with tenant identity + cascade cleanup.
-- MemoryRecord keeps the complete original text of every captured piece of memory;
-- MemoryChunk rows become searchable sections of a record. Deleting a Business,
-- InstalledAgent, WorkflowDefinition, or User cascades to records, and records
-- cascade to chunks.

-- CreateTable
CREATE TABLE IF NOT EXISTS "MemoryRecord" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "architectUserId" TEXT,
    "workflowId" TEXT,
    "workflowRunId" TEXT,
    "threadId" TEXT,
    "nodeId" TEXT,
    "testSessionId" TEXT,
    "callerKey" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'node_output',
    "sourceLabel" TEXT,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL,
    "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MemoryRecord_scopeKey_contentHash_key" ON "MemoryRecord"("scopeKey", "contentHash");
CREATE INDEX IF NOT EXISTS "MemoryRecord_scopeKey_idx" ON "MemoryRecord"("scopeKey");
CREATE INDEX IF NOT EXISTS "MemoryRecord_businessId_createdAt_idx" ON "MemoryRecord"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "MemoryRecord_architectUserId_createdAt_idx" ON "MemoryRecord"("architectUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MemoryRecord_testSessionId_idx" ON "MemoryRecord"("testSessionId");
CREATE INDEX IF NOT EXISTS "MemoryRecord_createdAt_idx" ON "MemoryRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_installedAgentId_fkey" FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: chunks become sections of a record (legacy rows keep NULL recordId).
ALTER TABLE "MemoryChunk" ADD COLUMN IF NOT EXISTS "recordId" TEXT;

-- AddForeignKey
ALTER TABLE "MemoryChunk" ADD CONSTRAINT "MemoryChunk_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MemoryRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemoryChunk_recordId_idx" ON "MemoryChunk"("recordId");
