-- Pricing lifecycle on the canonical execution row: PENDING → PRICED →
-- INVOICED; UNPRICED marks preserved-but-unpriced usage awaiting rate
-- configuration (USAGE_RATE_NOT_CONFIGURED).
ALTER TABLE "VapiCall" ADD COLUMN     "pricingState" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "VapiCall_pricingState_idx" ON "VapiCall"("pricingState");

-- Backfill: already-settled rows are PRICED; invoiced rows are INVOICED.
UPDATE "VapiCall" SET "pricingState" = 'PRICED' WHERE "billingRecordedAt" IS NOT NULL;
UPDATE "VapiCall" SET "pricingState" = 'INVOICED' WHERE "usageInvoiceId" IS NOT NULL;
