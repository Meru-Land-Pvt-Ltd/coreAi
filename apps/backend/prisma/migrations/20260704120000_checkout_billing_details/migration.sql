-- Persist checkout billing contact details on Business (latest) and Payment (per invoice).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "billingName" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "billingName" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;
