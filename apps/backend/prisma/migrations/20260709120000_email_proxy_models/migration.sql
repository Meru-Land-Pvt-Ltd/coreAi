-- CreateEnum
CREATE TYPE "ContextLinkStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailAliasStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmailReplyHandlingMode" AS ENUM ('TRIVEN_INBOX', 'FORWARD_ONLY', 'TRIVEN_AND_FORWARD');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED', 'BOUNCED', 'COMPLAINED');

-- CreateEnum
CREATE TYPE "EmailPurpose" AS ENUM ('CUSTOMER_FOLLOW_UP', 'BOOKING_CONFIRMATION', 'CALL_SUMMARY', 'INTERNAL_NOTIFICATION', 'REPLY', 'TEST');

-- AlterTable
ALTER TABLE "ContextLink" ADD COLUMN     "linkStatus" "ContextLinkStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "currentNodeId" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "metadataJson" JSONB,
ADD COLUMN     "totalCostCents" INTEGER DEFAULT 0,
ADD COLUMN     "totalTokenInput" INTEGER DEFAULT 0,
ADD COLUMN     "totalTokenOutput" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "BusinessEmailAlias" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "buyerUserId" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'reply.triven.ai',
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "forwardToEmail" TEXT,
    "replyHandlingMode" "EmailReplyHandlingMode" NOT NULL DEFAULT 'TRIVEN_AND_FORWARD',
    "status" "EmailAliasStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT NOT NULL DEFAULT 'SES',
    "sesIdentityStatus" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessEmailAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "aliasId" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "replyToEmail" TEXT,
    "subject" TEXT NOT NULL,
    "textBody" TEXT,
    "htmlBody" TEXT,
    "providerMessageId" TEXT,
    "sesMessageId" TEXT,
    "threadKey" TEXT,
    "inReplyTo" TEXT,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "purpose" "EmailPurpose" NOT NULL DEFAULT 'CUSTOMER_FOLLOW_UP',
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessEmailAlias_emailAddress_key" ON "BusinessEmailAlias"("emailAddress");

-- CreateIndex
CREATE INDEX "BusinessEmailAlias_businessId_idx" ON "BusinessEmailAlias"("businessId");

-- CreateIndex
CREATE INDEX "BusinessEmailAlias_status_idx" ON "BusinessEmailAlias"("status");

-- CreateIndex
CREATE INDEX "EmailMessage_businessId_createdAt_idx" ON "EmailMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_aliasId_idx" ON "EmailMessage"("aliasId");

-- CreateIndex
CREATE INDEX "EmailMessage_sesMessageId_idx" ON "EmailMessage"("sesMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_toEmail_status_idx" ON "EmailMessage"("toEmail", "status");

-- CreateIndex
CREATE INDEX "ContextLink_linkStatus_idx" ON "ContextLink"("linkStatus");

-- CreateIndex
CREATE INDEX "WorkflowRun_currentNodeId_idx" ON "WorkflowRun"("currentNodeId");

-- AddForeignKey
ALTER TABLE "BusinessEmailAlias" ADD CONSTRAINT "BusinessEmailAlias_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_aliasId_fkey" FOREIGN KEY ("aliasId") REFERENCES "BusinessEmailAlias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

