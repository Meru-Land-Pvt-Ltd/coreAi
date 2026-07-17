-- CreateEnum
CREATE TYPE "SmsConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "SmsConsentMethod" AS ENUM ('VERBAL_CALL', 'WEB_FORM');

-- CreateEnum
CREATE TYPE "SmsConsentPurpose" AS ENUM ('TRANSACTIONAL_BOOKING');

-- AlterEnum
ALTER TYPE "SmsExecutionStatus" ADD VALUE 'SUPPRESSED';

-- AlterEnum
ALTER TYPE "SmsMessageType" ADD VALUE 'TEAM_NOTIFICATION';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "publicBookingSlug" TEXT;

-- CreateTable
CREATE TABLE "SmsConsent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "messagingProgram" TEXT NOT NULL DEFAULT 'TRANSACTIONAL_BOOKING',
    "status" "SmsConsentStatus" NOT NULL,
    "method" "SmsConsentMethod" NOT NULL,
    "purpose" "SmsConsentPurpose" NOT NULL DEFAULT 'TRANSACTIONAL_BOOKING',
    "consentAt" TIMESTAMP(3),
    "optOutAt" TIMESTAMP(3),
    "optOutSource" TEXT,
    "businessNamePresented" TEXT,
    "disclosureVersion" TEXT NOT NULL,
    "disclosureHash" TEXT,
    "vapiCallId" TEXT,
    "appointmentId" TEXT,
    "sourceUrl" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsConsent_phoneNumber_idx" ON "SmsConsent"("phoneNumber");

-- CreateIndex
CREATE INDEX "SmsConsent_businessId_status_idx" ON "SmsConsent"("businessId", "status");

-- CreateIndex
CREATE INDEX "SmsConsent_vapiCallId_idx" ON "SmsConsent"("vapiCallId");

-- CreateIndex
CREATE INDEX "SmsConsent_installedAgentId_idx" ON "SmsConsent"("installedAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsConsent_businessId_phoneNumber_messagingProgram_key" ON "SmsConsent"("businessId", "phoneNumber", "messagingProgram");

-- CreateIndex
CREATE UNIQUE INDEX "Business_publicBookingSlug_key" ON "Business"("publicBookingSlug");

-- AddForeignKey
ALTER TABLE "SmsConsent" ADD CONSTRAINT "SmsConsent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill public booking slugs for existing businesses.
-- Slug = sanitized lowercase business name + "-" + last 6 chars of the cuid
-- (the id suffix guarantees uniqueness even for duplicate business names).
UPDATE "Business"
SET "publicBookingSlug" = trim(both '-' from (
      trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')))
      || '-' || right("id", 6)
    ))
WHERE "publicBookingSlug" IS NULL;
