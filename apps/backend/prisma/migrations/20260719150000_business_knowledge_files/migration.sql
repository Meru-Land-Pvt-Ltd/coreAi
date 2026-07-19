-- Buyer-uploaded knowledge documents (PDF/DOCX/TXT). Raw bytes stay in the row
-- so reprocessing needs no external storage; list APIs never select them.
CREATE TABLE "BusinessKnowledgeFile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT,
    "contentBytes" BYTEA NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "extractedChars" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessKnowledgeFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessKnowledgeFile_businessId_contentHash_key" ON "BusinessKnowledgeFile"("businessId", "contentHash");

-- CreateIndex
CREATE INDEX "BusinessKnowledgeFile_businessId_idx" ON "BusinessKnowledgeFile"("businessId");

-- CreateIndex
CREATE INDEX "BusinessKnowledgeFile_installedAgentId_idx" ON "BusinessKnowledgeFile"("installedAgentId");

-- AddForeignKey
ALTER TABLE "BusinessKnowledgeFile" ADD CONSTRAINT "BusinessKnowledgeFile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessKnowledgeFile" ADD CONSTRAINT "BusinessKnowledgeFile_installedAgentId_fkey" FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Document-derived knowledge chunks: deleting the source file cascades away
-- every BusinessKnowledgeBase row extracted from it.
ALTER TABLE "BusinessKnowledgeBase" ADD COLUMN     "sourceFileId" TEXT,
ADD COLUMN     "chunkIndex" INTEGER,
ADD COLUMN     "sourceSection" TEXT;

-- CreateIndex
CREATE INDEX "BusinessKnowledgeBase_sourceFileId_idx" ON "BusinessKnowledgeBase"("sourceFileId");

-- AddForeignKey
ALTER TABLE "BusinessKnowledgeBase" ADD CONSTRAINT "BusinessKnowledgeBase_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "BusinessKnowledgeFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
