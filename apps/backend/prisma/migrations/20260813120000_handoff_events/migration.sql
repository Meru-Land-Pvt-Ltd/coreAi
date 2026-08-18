-- Human handoff audit trail: one row per attempted AI→human transfer on any
-- channel. Voice transfers redirect the live Twilio call leg to the business's
-- team phone; the dial-result callback settles the final status.

CREATE TABLE IF NOT EXISTS "HandoffEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'VOICE',
    "executionMode" TEXT NOT NULL DEFAULT 'LIVE',
    "vapiCallId" TEXT,
    "twilioCallSid" TEXT,
    "customerPhone" TEXT,
    "destination" TEXT,
    "reason" TEXT,
    "requestedBy" TEXT NOT NULL DEFAULT 'customer',
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "waitSeconds" INTEGER,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HandoffEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HandoffEvent_businessId_createdAt_idx" ON "HandoffEvent"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "HandoffEvent_businessId_status_idx" ON "HandoffEvent"("businessId", "status");
CREATE INDEX IF NOT EXISTS "HandoffEvent_vapiCallId_idx" ON "HandoffEvent"("vapiCallId");

ALTER TABLE "HandoffEvent"
  ADD CONSTRAINT "HandoffEvent_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
