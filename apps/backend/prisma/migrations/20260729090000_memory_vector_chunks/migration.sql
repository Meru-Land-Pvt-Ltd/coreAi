-- Smart Memory Node vector storage.
-- Requires a postgres image that ships pgvector (compose now uses pgvector/pgvector:pg16-trixie).
-- The image swap must be deployed BEFORE this migration runs.

-- Preflight: fail with an actionable message when the postgres binary lacks pgvector,
-- instead of an opaque CREATE EXTENSION error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE EXCEPTION 'pgvector extension is not available in this postgres image. Deploy the pgvector/pgvector:pg16-trixie image (see docker-compose*.yml) before running this migration.';
  END IF;
END $$;

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MemoryChunk" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "nodeRunId" TEXT,
    "threadId" TEXT,
    "workflowId" TEXT,
    "nodeId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'node_output',
    "sourceLabel" TEXT,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MemoryChunk_scopeKey_contentHash_key" ON "MemoryChunk"("scopeKey", "contentHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemoryChunk_scopeKey_idx" ON "MemoryChunk"("scopeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemoryChunk_workflowRunId_idx" ON "MemoryChunk"("workflowRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MemoryChunk_threadId_idx" ON "MemoryChunk"("threadId");

-- Approximate-nearest-neighbour index for cosine similarity search (NULL rows are skipped).
CREATE INDEX IF NOT EXISTS "MemoryChunk_embedding_idx" ON "MemoryChunk" USING hnsw ("embedding" vector_cosine_ops);
