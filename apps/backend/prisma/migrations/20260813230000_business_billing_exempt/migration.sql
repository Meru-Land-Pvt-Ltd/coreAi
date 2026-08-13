-- Internal/demo businesses that billing must never suspend. Usage and
-- invoices are still recorded; only the suspension enforcement is skipped, so
-- an exempt account never loses its agent or its phone number.

ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "billingExempt" BOOLEAN NOT NULL DEFAULT false;
