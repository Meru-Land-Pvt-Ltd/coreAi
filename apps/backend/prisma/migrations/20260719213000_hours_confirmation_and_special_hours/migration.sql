-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "hoursConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "hoursSource" TEXT;

-- CreateTable
CREATE TABLE "BusinessSpecialHours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'special',
    "closed" BOOLEAN NOT NULL DEFAULT true,
    "periodsJson" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSpecialHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessSpecialHours_businessId_idx" ON "BusinessSpecialHours"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSpecialHours_businessId_date_key" ON "BusinessSpecialHours"("businessId", "date");

-- AddForeignKey
ALTER TABLE "BusinessSpecialHours" ADD CONSTRAINT "BusinessSpecialHours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "BusinessKnowledgeFile_businessId_installedAgentId_contentHash_k" RENAME TO "BusinessKnowledgeFile_businessId_installedAgentId_contentHa_key";

