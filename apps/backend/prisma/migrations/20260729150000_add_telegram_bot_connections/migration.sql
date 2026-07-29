CREATE TABLE "TelegramBotConnection" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "installedAgentId" TEXT NOT NULL,
  "requestedUsername" TEXT NOT NULL,
  "botUserId" TEXT,
  "botUsername" TEXT,
  "botDisplayName" TEXT NOT NULL,
  "botTokenEncrypted" TEXT,
  "webhookSecretEncrypted" TEXT NOT NULL,
  "setupNonceHash" TEXT,
  "telegramOwnerUserId" TEXT,
  "ownerChatId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastWebhookAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramBotConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramBotConnection_installedAgentId_key"
ON "TelegramBotConnection"("installedAgentId");

CREATE UNIQUE INDEX "TelegramBotConnection_requestedUsername_key"
ON "TelegramBotConnection"("requestedUsername");

CREATE UNIQUE INDEX "TelegramBotConnection_botUserId_key"
ON "TelegramBotConnection"("botUserId");

CREATE UNIQUE INDEX "TelegramBotConnection_botUsername_key"
ON "TelegramBotConnection"("botUsername");

CREATE INDEX "TelegramBotConnection_businessId_idx"
ON "TelegramBotConnection"("businessId");

CREATE INDEX "TelegramBotConnection_status_idx"
ON "TelegramBotConnection"("status");

CREATE INDEX "TelegramBotConnection_telegramOwnerUserId_status_idx"
ON "TelegramBotConnection"("telegramOwnerUserId", "status");

ALTER TABLE "TelegramBotConnection"
ADD CONSTRAINT "TelegramBotConnection_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramBotConnection"
ADD CONSTRAINT "TelegramBotConnection_installedAgentId_fkey"
FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
