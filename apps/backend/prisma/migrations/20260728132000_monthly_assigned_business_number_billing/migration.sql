-- Snapshot Twilio's account-specific monthly number price on each inventory
-- row. The buyer fee is stored separately because it follows the platform
-- rule: round(provider monthly USD) + 1 USD.
ALTER TABLE "PlatformPhoneNumber"
  ADD COLUMN IF NOT EXISTS "providerMonthlyPriceMicroUsd" INTEGER,
  ADD COLUMN IF NOT EXISTS "billingMonthlyPriceMicroUsd" INTEGER,
  ADD COLUMN IF NOT EXISTS "pricingCurrency" TEXT,
  ADD COLUMN IF NOT EXISTS "pricingNumberType" TEXT,
  ADD COLUMN IF NOT EXISTS "pricingFetchedAt" TIMESTAMP(3);

UPDATE "BusinessUsageInvoiceLineItem"
SET "serviceName" = 'Assigned Business Number'
WHERE "serviceCode" = 'phone_number';
