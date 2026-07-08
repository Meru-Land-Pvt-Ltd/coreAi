-- CreateEnum
CREATE TYPE "PhoneWebhookStatus" AS ENUM ('CONFIGURED', 'MISSING', 'FAILED', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlatformPhoneStatus" ADD VALUE 'ARCHIVED';
ALTER TYPE "PlatformPhoneStatus" ADD VALUE 'RELEASED';
ALTER TYPE "PlatformPhoneStatus" ADD VALUE 'ERROR';

-- AlterTable
ALTER TABLE "PlatformPhoneNumber" ADD COLUMN     "a2pStatus" TEXT,
ADD COLUMN     "buyerUserId" TEXT,
ADD COLUMN     "complianceStatus" TEXT,
ADD COLUMN     "e164" TEXT,
ADD COLUMN     "installedAgentId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "mmsEnabled" BOOLEAN,
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "purchasedByAdminId" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smsWebhookUrl" TEXT,
ADD COLUMN     "voiceEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "voiceWebhookUrl" TEXT,
ADD COLUMN     "webhookStatus" "PhoneWebhookStatus" NOT NULL DEFAULT 'UNKNOWN';

-- Backfill: normalized E.164 for existing rows (strip everything except + and digits).
UPDATE "PlatformPhoneNumber"
SET "e164" = NULLIF(regexp_replace("phoneNumber", '[^+0-9]', '', 'g'), '')
WHERE "e164" IS NULL;

-- Backfill: capability booleans from the capabilities JSON where present.
UPDATE "PlatformPhoneNumber"
SET "voiceEnabled" = COALESCE(("capabilities"->>'voice')::boolean, "voiceEnabled"),
    "smsEnabled"   = COALESCE(("capabilities"->>'sms')::boolean, "smsEnabled"),
    "mmsEnabled"   = ("capabilities"->>'mms')::boolean
WHERE "capabilities" IS NOT NULL;

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_idx" ON "AdminAuditLog"("adminUserId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPhoneNumber_e164_key" ON "PlatformPhoneNumber"("e164");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPhoneNumber_twilioSid_key" ON "PlatformPhoneNumber"("twilioSid");

-- CreateIndex
CREATE INDEX "PlatformPhoneNumber_installedAgentId_idx" ON "PlatformPhoneNumber"("installedAgentId");

