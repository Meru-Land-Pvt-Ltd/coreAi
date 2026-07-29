ALTER TABLE "TelegramBotConnection"
ADD COLUMN "webhookConnectionId" TEXT,
ADD COLUMN "managerBotId" TEXT,
ADD COLUMN "provisioningMode" TEXT NOT NULL DEFAULT 'MANAGED',
ADD COLUMN "provisioningStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN "webhookStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "ownerNotificationStatus" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
ADD COLUMN "ownerNotificationNonceHash" TEXT,
ADD COLUMN "lastSuccessfulSendAt" TIMESTAMP(3),
ADD COLUMN "lastProviderErrorCode" TEXT,
ADD COLUMN "credentialRotatedAt" TIMESTAMP(3);

UPDATE "TelegramBotConnection"
SET "webhookConnectionId" =
  substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 12) ||
  substr(md5("id" || random()::text), 1, 12)
WHERE "webhookConnectionId" IS NULL;

ALTER TABLE "TelegramBotConnection"
ALTER COLUMN "webhookConnectionId" SET NOT NULL;

CREATE UNIQUE INDEX "TelegramBotConnection_webhookConnectionId_key"
ON "TelegramBotConnection"("webhookConnectionId");

CREATE TABLE "TelegramConversationState" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "installedAgentId" TEXT NOT NULL,
  "telegramConnectionId" TEXT NOT NULL,
  "telegramBotId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'STARTED',
  "contextJson" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramConversationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramConversationState_businessId_installedAgentId_telegramConnectionId_telegramChatId_key"
ON "TelegramConversationState"("businessId", "installedAgentId", "telegramConnectionId", "telegramChatId");
CREATE INDEX "TelegramConversationState_telegramConnectionId_telegramUserId_idx"
ON "TelegramConversationState"("telegramConnectionId", "telegramUserId");
CREATE INDEX "TelegramConversationState_expiresAt_idx"
ON "TelegramConversationState"("expiresAt");

CREATE TABLE "TelegramProcessedUpdate" (
  "id" TEXT NOT NULL,
  "telegramConnectionId" TEXT NOT NULL,
  "updateId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "payloadJson" JSONB NOT NULL,
  "workflowRunId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramProcessedUpdate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramProcessedUpdate_telegramConnectionId_updateId_key"
ON "TelegramProcessedUpdate"("telegramConnectionId", "updateId");
CREATE INDEX "TelegramProcessedUpdate_status_createdAt_idx"
ON "TelegramProcessedUpdate"("status", "createdAt");

CREATE TABLE "TelegramMessageExecution" (
  "id" TEXT NOT NULL,
  "workflowExecutionId" TEXT,
  "nodeId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "installedAgentId" TEXT NOT NULL,
  "telegramConnectionId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "messageId" TEXT,
  "idempotencyKey" TEXT,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestJson" JSONB,
  "responseJson" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramMessageExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramMessageExecution_idempotencyKey_key"
ON "TelegramMessageExecution"("idempotencyKey");
CREATE INDEX "TelegramMessageExecution_telegramConnectionId_status_idx"
ON "TelegramMessageExecution"("telegramConnectionId", "status");
CREATE INDEX "TelegramMessageExecution_businessId_installedAgentId_createdAt_idx"
ON "TelegramMessageExecution"("businessId", "installedAgentId", "createdAt");

CREATE TABLE "BusinessService" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "installedAgentId" TEXT,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "durationMinutes" INTEGER NOT NULL DEFAULT 30,
  "priceCents" INTEGER,
  "priceVisible" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "calendarId" TEXT,
  "routingRuleJson" JSONB,
  "staffMappingJson" JSONB,
  "bufferMinutes" INTEGER NOT NULL DEFAULT 10,
  "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
  "maximumAdvanceDays" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessService_businessId_installedAgentId_slug_key"
ON "BusinessService"("businessId", "installedAgentId", "slug");
CREATE INDEX "BusinessService_businessId_installedAgentId_active_idx"
ON "BusinessService"("businessId", "installedAgentId", "active");

ALTER TABLE "Appointment"
ADD COLUMN "installedAgentId" TEXT,
ADD COLUMN "customerEmail" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "bookingReference" TEXT,
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Appointment_bookingReference_key" ON "Appointment"("bookingReference");
CREATE UNIQUE INDEX "Appointment_idempotencyKey_key" ON "Appointment"("idempotencyKey");
CREATE INDEX "Appointment_installedAgentId_idx" ON "Appointment"("installedAgentId");

ALTER TABLE "TelegramConversationState"
ADD CONSTRAINT "TelegramConversationState_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramConversationState"
ADD CONSTRAINT "TelegramConversationState_installedAgentId_fkey"
FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramConversationState"
ADD CONSTRAINT "TelegramConversationState_telegramConnectionId_fkey"
FOREIGN KEY ("telegramConnectionId") REFERENCES "TelegramBotConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramProcessedUpdate"
ADD CONSTRAINT "TelegramProcessedUpdate_telegramConnectionId_fkey"
FOREIGN KEY ("telegramConnectionId") REFERENCES "TelegramBotConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramMessageExecution"
ADD CONSTRAINT "TelegramMessageExecution_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramMessageExecution"
ADD CONSTRAINT "TelegramMessageExecution_installedAgentId_fkey"
FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramMessageExecution"
ADD CONSTRAINT "TelegramMessageExecution_telegramConnectionId_fkey"
FOREIGN KEY ("telegramConnectionId") REFERENCES "TelegramBotConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessService"
ADD CONSTRAINT "BusinessService_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessService"
ADD CONSTRAINT "BusinessService_installedAgentId_fkey"
FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_installedAgentId_fkey"
FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
