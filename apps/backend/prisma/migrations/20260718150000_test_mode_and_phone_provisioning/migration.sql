-- CreateEnum
CREATE TYPE "PhoneProvisioningStatus" AS ENUM ('LOCATION_REQUIRED', 'SEARCHING', 'NUMBER_SELECTED', 'PURCHASE_PENDING', 'PURCHASED', 'WEBHOOK_CONFIGURATION_PENDING', 'VAPI_MAPPING_PENDING', 'ACTIVE', 'FAILED', 'RELEASE_PENDING', 'RELEASED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowRunMode" ADD VALUE 'ARCHITECT_DRY_RUN';
ALTER TYPE "WorkflowRunMode" ADD VALUE 'BUSINESS_TEST';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "testSessionId" TEXT;

-- CreateTable
CREATE TABLE "TestCalendarEvent" (
    "id" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "workflowId" TEXT,
    "workflowRunId" TEXT,
    "testSessionId" TEXT,
    "serviceName" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "calendarId" TEXT,
    "googleEventId" TEXT,
    "htmlLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneProvisioningRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "status" "PhoneProvisioningStatus" NOT NULL DEFAULT 'NUMBER_SELECTED',
    "requestedCountry" TEXT NOT NULL,
    "requestedRegion" TEXT,
    "requestedLocality" TEXT,
    "actualCountry" TEXT,
    "actualRegion" TEXT,
    "actualLocality" TEXT,
    "fallbackType" TEXT,
    "fallbackConfirmedAt" TIMESTAMP(3),
    "selectedPhoneNumber" TEXT NOT NULL,
    "platformPhoneNumberId" TEXT,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "auditJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneProvisioningRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestCalendarEvent_ownerUserId_idx" ON "TestCalendarEvent"("ownerUserId");

-- CreateIndex
CREATE INDEX "TestCalendarEvent_businessId_idx" ON "TestCalendarEvent"("businessId");

-- CreateIndex
CREATE INDEX "TestCalendarEvent_testSessionId_idx" ON "TestCalendarEvent"("testSessionId");

-- CreateIndex
CREATE INDEX "TestCalendarEvent_executionMode_idx" ON "TestCalendarEvent"("executionMode");

-- CreateIndex
CREATE INDEX "PhoneProvisioningRequest_businessId_idx" ON "PhoneProvisioningRequest"("businessId");

-- CreateIndex
CREATE INDEX "PhoneProvisioningRequest_status_idx" ON "PhoneProvisioningRequest"("status");

-- CreateIndex
CREATE INDEX "PhoneProvisioningRequest_selectedPhoneNumber_idx" ON "PhoneProvisioningRequest"("selectedPhoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneProvisioningRequest_businessId_clientRequestId_key" ON "PhoneProvisioningRequest"("businessId", "clientRequestId");

-- CreateIndex
CREATE INDEX "Appointment_executionMode_idx" ON "Appointment"("executionMode");

