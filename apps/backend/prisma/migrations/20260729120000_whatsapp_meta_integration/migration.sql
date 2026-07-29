-- AlterEnum
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'WHATSAPP';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'PENDING');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "businessId" TEXT,
    "displayName" TEXT,
    "businessName" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "webhookVerifyTokenEnc" TEXT NOT NULL,
    "appSecretEnc" TEXT,
    "status" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "qualityRating" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "lastMessage" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "wamid" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "mediaUrl" TEXT,
    "status" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppWebhookLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "headersJson" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppWebhookLog_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppConnection_phoneNumberId_key" ON "WhatsAppConnection"("phoneNumberId");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppConnection_architectUserId_phoneNumber_key" ON "WhatsAppConnection"("architectUserId", "phoneNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppConnection_architectUserId_idx" ON "WhatsAppConnection"("architectUserId");
CREATE INDEX IF NOT EXISTS "WhatsAppConnection_status_idx" ON "WhatsAppConnection"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppConversation_connectionId_contactPhone_key" ON "WhatsAppConversation"("connectionId", "contactPhone");
CREATE INDEX IF NOT EXISTS "WhatsAppConversation_connectionId_idx" ON "WhatsAppConversation"("connectionId");
CREATE INDEX IF NOT EXISTS "WhatsAppConversation_contactPhone_idx" ON "WhatsAppConversation"("contactPhone");

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_wamid_key" ON "WhatsAppMessage"("wamid");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_conversationId_idx" ON "WhatsAppMessage"("conversationId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_timestamp_idx" ON "WhatsAppMessage"("timestamp");

CREATE INDEX IF NOT EXISTS "WhatsAppWebhookLog_connectionId_idx" ON "WhatsAppWebhookLog"("connectionId");
CREATE INDEX IF NOT EXISTS "WhatsAppWebhookLog_createdAt_idx" ON "WhatsAppWebhookLog"("createdAt");

-- FKs
DO $$ BEGIN
  ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "WhatsAppWebhookLog" ADD CONSTRAINT "WhatsAppWebhookLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
