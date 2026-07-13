-- Replace locally stored payout credentials with Stripe Connect references and
-- add identifiers/status fields for real Stripe transfers and bank payouts.
ALTER TABLE "ArchitectPayoutMethod"
  ALTER COLUMN "bankName" DROP NOT NULL,
  ALTER COLUMN "accountHolderName" DROP NOT NULL,
  ALTER COLUMN "accountNumber" DROP NOT NULL,
  ALTER COLUMN "ifscCode" DROP NOT NULL,
  ADD COLUMN "country" TEXT NOT NULL DEFAULT 'IN',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'inr',
  ADD COLUMN "accountLast4" TEXT,
  ADD COLUMN "routingLast4" TEXT,
  ADD COLUMN "stripeAccountId" TEXT,
  ADD COLUMN "stripeExternalAccountId" TEXT,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false;

-- Preserve only display-safe suffixes from legacy methods, then remove the
-- sensitive values. Legacy users must reconnect through Stripe before payout.
UPDATE "ArchitectPayoutMethod"
SET
  "accountLast4" = RIGHT(REGEXP_REPLACE(COALESCE("accountNumber", ''), '[^0-9]', '', 'g'), 4),
  "routingLast4" = RIGHT(COALESCE("ifscCode", ''), 4),
  "verificationStatus" = 'REQUIRES_ACTION',
  "accountNumber" = NULL,
  "ifscCode" = NULL;

CREATE UNIQUE INDEX "ArchitectPayoutMethod_stripeAccountId_key"
  ON "ArchitectPayoutMethod"("stripeAccountId");
CREATE INDEX "ArchitectPayoutMethod_country_idx"
  ON "ArchitectPayoutMethod"("country");
CREATE INDEX "ArchitectPayoutMethod_verificationStatus_idx"
  ON "ArchitectPayoutMethod"("verificationStatus");
DROP INDEX IF EXISTS "ArchitectPayoutMethod_ifscCode_idx";

ALTER TABLE "ArchitectPayout"
  ALTER COLUMN "status" SET DEFAULT 'PENDING',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'usd',
  ADD COLUMN "stripeTransferId" TEXT,
  ADD COLUMN "stripePayoutId" TEXT,
  ADD COLUMN "arrivalDate" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "failureMessage" TEXT;

CREATE UNIQUE INDEX "ArchitectPayout_stripeTransferId_key"
  ON "ArchitectPayout"("stripeTransferId");
CREATE UNIQUE INDEX "ArchitectPayout_stripePayoutId_key"
  ON "ArchitectPayout"("stripePayoutId");
