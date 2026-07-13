-- Email hardening: suppression list, outbound idempotency, delivery-event fields,
-- buyer notification toggles, and two new message statuses.
-- Additive only — no data rewrites, safe on production.

-- New email message statuses (PG >= 12: allowed in a transaction as long as the
-- new values are not used within this same migration).
ALTER TYPE "EmailMessageStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "EmailMessageStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';

-- Buyer notification toggles
ALTER TABLE "BusinessEmailAlias" ADD COLUMN "customerConfirmationEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BusinessEmailAlias" ADD COLUMN "internalSummaryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Outbound idempotency + delivery event timestamps
ALTER TABLE "EmailMessage" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN "bouncedAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN "complainedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EmailMessage_idempotencyKey_key" ON "EmailMessage"("idempotencyKey");

-- Suppression list (permanent bounces / complaints / manual blocks)
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SES',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSuppression_emailAddress_key" ON "EmailSuppression"("emailAddress");
CREATE INDEX "EmailSuppression_active_idx" ON "EmailSuppression"("active");
