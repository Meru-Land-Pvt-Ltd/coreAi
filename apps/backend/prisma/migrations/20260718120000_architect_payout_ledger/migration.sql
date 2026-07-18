-- CreateEnum
CREATE TYPE "ArchitectPayoutOrigin" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "ArchitectEarningState" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_SUCCEEDED', 'HELD', 'AVAILABLE_FOR_TRANSFER', 'TRANSFER_PROCESSING', 'TRANSFERRED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED', 'REVERSAL_PENDING', 'REVERSED', 'NEGATIVE_ADJUSTMENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ArchitectLedgerEntryType" AS ENUM ('REFUND_ADJUSTMENT', 'DISPUTE_HOLD', 'DISPUTE_RELEASE', 'DISPUTE_LOSS', 'TRANSFER_REVERSAL', 'MANUAL_ADJUSTMENT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "StripeWebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'SKIPPED_DUPLICATE', 'SKIPPED_STALE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArchitectPayoutStatus" ADD VALUE 'RESERVED';
ALTER TYPE "ArchitectPayoutStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "ArchitectPayoutStatus" ADD VALUE 'PAID';
ALTER TYPE "ArchitectPayoutStatus" ADD VALUE 'CANCELED';
ALTER TYPE "ArchitectPayoutStatus" ADD VALUE 'REVERSED';

-- AlterTable
ALTER TABLE "ArchitectPayout" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "destinationLast4" TEXT,
ADD COLUMN     "destinationType" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "feeCents" INTEGER,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastStripeEventCreatedAt" TIMESTAMP(3),
ADD COLUMN     "livemode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "netCents" INTEGER,
ADD COLUMN     "origin" "ArchitectPayoutOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "stripeBalanceTransactionId" TEXT,
ADD COLUMN     "stripeConnectedAccountId" TEXT;

-- AlterTable
ALTER TABLE "ArchitectPayoutMethod" ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "livemode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "requirementsJson" JSONB,
ADD COLUMN     "transfersCapability" TEXT;

-- CreateTable
CREATE TABLE "ArchitectEarning" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "listingId" TEXT,
    "paymentId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "grossAmountCents" INTEGER NOT NULL,
    "platformCommissionCents" INTEGER NOT NULL,
    "architectGrossCents" INTEGER NOT NULL,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "disputeCents" INTEGER NOT NULL DEFAULT 0,
    "reversalCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "architectNetCents" INTEGER NOT NULL,
    "status" "ArchitectEarningState" NOT NULL DEFAULT 'PAYMENT_SUCCEEDED',
    "statusBeforeDispute" "ArchitectEarningState",
    "holdUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "transferredAt" TIMESTAMP(3),
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeTransferId" TEXT,
    "stripeTransferReversalId" TEXT,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "settlementVersion" INTEGER NOT NULL DEFAULT 1,
    "lastStripeEventCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchitectLedgerEntry" (
    "id" TEXT NOT NULL,
    "earningId" TEXT,
    "architectUserId" TEXT NOT NULL,
    "entryType" "ArchitectLedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchitectLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "objectId" TEXT,
    "eventCreatedAt" TIMESTAMP(3) NOT NULL,
    "processingStatus" "StripeWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastErrorCode" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectEarning_paymentId_key" ON "ArchitectEarning"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectEarning_stripeTransferId_key" ON "ArchitectEarning"("stripeTransferId");

-- CreateIndex
CREATE INDEX "ArchitectEarning_architectUserId_status_idx" ON "ArchitectEarning"("architectUserId", "status");

-- CreateIndex
CREATE INDEX "ArchitectEarning_status_holdUntil_idx" ON "ArchitectEarning"("status", "holdUntil");

-- CreateIndex
CREATE INDEX "ArchitectEarning_listingId_idx" ON "ArchitectEarning"("listingId");

-- CreateIndex
CREATE INDEX "ArchitectEarning_stripePaymentIntentId_idx" ON "ArchitectEarning"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "ArchitectEarning_livemode_idx" ON "ArchitectEarning"("livemode");

-- CreateIndex
CREATE INDEX "ArchitectLedgerEntry_earningId_idx" ON "ArchitectLedgerEntry"("earningId");

-- CreateIndex
CREATE INDEX "ArchitectLedgerEntry_architectUserId_createdAt_idx" ON "ArchitectLedgerEntry"("architectUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectLedgerEntry_entryType_sourceId_earningId_key" ON "ArchitectLedgerEntry"("entryType", "sourceId", "earningId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_eventType_createdAt_idx" ON "StripeWebhookEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_objectId_idx" ON "StripeWebhookEvent"("objectId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_processingStatus_idx" ON "StripeWebhookEvent"("processingStatus");

-- CreateIndex
CREATE INDEX "ArchitectPayout_architectUserId_createdAt_idx" ON "ArchitectPayout"("architectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ArchitectPayout_stripeConnectedAccountId_idx" ON "ArchitectPayout"("stripeConnectedAccountId");

-- CreateIndex
CREATE INDEX "ArchitectPayout_livemode_idx" ON "ArchitectPayout"("livemode");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectPayout_architectUserId_clientRequestId_deliveryMet_key" ON "ArchitectPayout"("architectUserId", "clientRequestId", "deliveryMethod", "livemode");

-- CreateIndex
CREATE INDEX "ArchitectPayoutMethod_livemode_idx" ON "ArchitectPayoutMethod"("livemode");

-- AddForeignKey
ALTER TABLE "ArchitectEarning" ADD CONSTRAINT "ArchitectEarning_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitectEarning" ADD CONSTRAINT "ArchitectEarning_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitectLedgerEntry" ADD CONSTRAINT "ArchitectLedgerEntry_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "ArchitectEarning"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitectLedgerEntry" ADD CONSTRAINT "ArchitectLedgerEntry_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

