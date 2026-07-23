-- Strong SMS-to-execution attribution: direct provider-call association on the
-- SMS ledger (VapiCall.callId value; historical rows stay on the dedupeKey /
-- appointment heuristics).
ALTER TABLE "SmsExecution" ADD COLUMN "vapiCallId" TEXT;

CREATE INDEX "SmsExecution_vapiCallId_idx" ON "SmsExecution"("vapiCallId");

-- Immutable service-applicability snapshot per voice execution (pipeline
-- provider/model identifiers + selected service codes, or the UNPRICED reason).
ALTER TABLE "VapiCall" ADD COLUMN "pricingSnapshotJson" JSONB;
