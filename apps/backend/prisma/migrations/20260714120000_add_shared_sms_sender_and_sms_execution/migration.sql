-- CreateEnum
CREATE TYPE "SmsProvider" AS ENUM ('TWILIO');

-- CreateEnum
CREATE TYPE "SmsMessageType" AS ENUM ('APPOINTMENT_CONFIRMATION', 'TEST_SMS', 'MISSED_CALL_TEXT_BACK', 'WORKFLOW_SMS');

-- CreateEnum
CREATE TYPE "SmsExecutionStatus" AS ENUM ('QUEUED', 'ACCEPTED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERED', 'FAILED', 'SIMULATED');

-- AlterTable
ALTER TABLE "PlatformPhoneNumber" ADD COLUMN     "isPlatformSmsSender" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SmsExecution" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "appointmentId" TEXT,
    "dedupeKey" TEXT,
    "provider" "SmsProvider" NOT NULL DEFAULT 'TWILIO',
    "messageSid" TEXT,
    "messagingServiceSid" TEXT,
    "messageType" "SmsMessageType" NOT NULL DEFAULT 'WORKFLOW_SMS',
    "toPhone" TEXT NOT NULL,
    "fromPhone" TEXT,
    "body" TEXT NOT NULL,
    "status" "SmsExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "numSegments" INTEGER,
    "providerCostMicroUsd" INTEGER,
    "currency" TEXT,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsExecution_dedupeKey_key" ON "SmsExecution"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SmsExecution_messageSid_key" ON "SmsExecution"("messageSid");

-- CreateIndex
CREATE INDEX "SmsExecution_businessId_createdAt_idx" ON "SmsExecution"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsExecution_installedAgentId_idx" ON "SmsExecution"("installedAgentId");

-- CreateIndex
CREATE INDEX "SmsExecution_appointmentId_idx" ON "SmsExecution"("appointmentId");

-- CreateIndex
CREATE INDEX "SmsExecution_status_idx" ON "SmsExecution"("status");

-- CreateIndex
CREATE INDEX "SmsExecution_createdAt_idx" ON "SmsExecution"("createdAt");

-- CreateIndex
CREATE INDEX "SmsExecution_toPhone_createdAt_idx" ON "SmsExecution"("toPhone", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformPhoneNumber_isPlatformSmsSender_status_idx" ON "PlatformPhoneNumber"("isPlatformSmsSender", "status");

-- AddForeignKey
ALTER TABLE "SmsExecution" ADD CONSTRAINT "SmsExecution_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

