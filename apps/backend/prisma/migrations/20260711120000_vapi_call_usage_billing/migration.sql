-- Per-call usage billing fields on VapiCall (AI Receptionist monthly billing).

ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "installedAgentId" TEXT;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "durationSeconds" INTEGER;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "durationMinutes" DOUBLE PRECISION;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "smsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "vapiCostMicroUsd" INTEGER;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "actualCostMicroUsd" INTEGER;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "billedCostMicroUsd" INTEGER;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "usageLineItemsJson" JSONB;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "vapiCostBreakdownJson" JSONB;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "billingMonth" TEXT;
ALTER TABLE "VapiCall" ADD COLUMN IF NOT EXISTS "billingRecordedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "VapiCall_businessId_billingMonth_idx" ON "VapiCall"("businessId", "billingMonth");
CREATE INDEX IF NOT EXISTS "VapiCall_installedAgentId_idx" ON "VapiCall"("installedAgentId");
