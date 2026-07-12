-- Email proxy models only. ContextLink / WorkflowRun columns are in 20260708062525_memory_block.
-- Guarded so re-apply is safe if objects already exist.

DO $$ BEGIN
  CREATE TYPE "EmailAliasStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailReplyHandlingMode" AS ENUM ('TRIVEN_INBOX', 'FORWARD_ONLY', 'TRIVEN_AND_FORWARD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED', 'BOUNCED', 'COMPLAINED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailPurpose" AS ENUM ('CUSTOMER_FOLLOW_UP', 'BOOKING_CONFIRMATION', 'CALL_SUMMARY', 'INTERNAL_NOTIFICATION', 'REPLY', 'TEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BusinessEmailAlias" (
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

CREATE TABLE IF NOT EXISTS "EmailMessage" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessEmailAlias_emailAddress_key" ON "BusinessEmailAlias"("emailAddress");
CREATE INDEX IF NOT EXISTS "BusinessEmailAlias_businessId_idx" ON "BusinessEmailAlias"("businessId");
CREATE INDEX IF NOT EXISTS "BusinessEmailAlias_status_idx" ON "BusinessEmailAlias"("status");
CREATE INDEX IF NOT EXISTS "EmailMessage_businessId_createdAt_idx" ON "EmailMessage"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_aliasId_idx" ON "EmailMessage"("aliasId");
CREATE INDEX IF NOT EXISTS "EmailMessage_sesMessageId_idx" ON "EmailMessage"("sesMessageId");
CREATE INDEX IF NOT EXISTS "EmailMessage_toEmail_status_idx" ON "EmailMessage"("toEmail", "status");

DO $$ BEGIN
  ALTER TABLE "BusinessEmailAlias"
    ADD CONSTRAINT "BusinessEmailAlias_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailMessage"
    ADD CONSTRAINT "EmailMessage_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailMessage"
    ADD CONSTRAINT "EmailMessage_aliasId_fkey"
    FOREIGN KEY ("aliasId") REFERENCES "BusinessEmailAlias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
