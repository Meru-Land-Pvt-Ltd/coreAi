ALTER TABLE "Payment"
ADD COLUMN "pendingReminderSentAt" TIMESTAMP(3),
ADD COLUMN "pendingReminderCount" INTEGER NOT NULL DEFAULT 0;
