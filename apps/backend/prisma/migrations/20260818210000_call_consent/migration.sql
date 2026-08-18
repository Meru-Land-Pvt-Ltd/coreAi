-- Proof that a person asked this business to phone them.
--
-- The FCC treats an AI voice as an "artificial voice" under the TCPA, so an
-- outbound sales call needs that person's prior express consent. This table is
-- that proof: who, for which business, how they said yes, and the words they
-- were shown. No row, no call — enforced in the runner, not by policy.

CREATE TABLE IF NOT EXISTS "CallConsent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPTED_IN',
    "method" TEXT NOT NULL,
    "evidence" TEXT,
    "disclosureText" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallConsent_businessId_phoneNumber_key" ON "CallConsent"("businessId", "phoneNumber");
CREATE INDEX IF NOT EXISTS "CallConsent_businessId_status_idx" ON "CallConsent"("businessId", "status");

ALTER TABLE "CallConsent" ADD CONSTRAINT "CallConsent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
