ALTER TABLE "TelegramConversationState"
ADD COLUMN "chatStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "lastDeliveryError" TEXT;

CREATE INDEX "TelegramConversationState_telegramConnectionId_chatStatus_idx"
ON "TelegramConversationState"("telegramConnectionId", "chatStatus");
