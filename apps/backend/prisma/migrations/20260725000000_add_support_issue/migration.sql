-- CreateTable
CREATE TABLE "SupportIssue" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "issue" TEXT NOT NULL DEFAULT '',
    "documentName" TEXT,
    "documentMimeType" TEXT,
    "documentSizeBytes" INTEGER,
    "documentBytes" BYTEA,
    "voiceName" TEXT,
    "voiceMimeType" TEXT,
    "voiceDurationSec" INTEGER,
    "voiceSizeBytes" INTEGER,
    "voiceBytes" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportIssue_status_idx" ON "SupportIssue"("status");

-- CreateIndex
CREATE INDEX "SupportIssue_email_idx" ON "SupportIssue"("email");

-- CreateIndex
CREATE INDEX "SupportIssue_createdAt_idx" ON "SupportIssue"("createdAt");
