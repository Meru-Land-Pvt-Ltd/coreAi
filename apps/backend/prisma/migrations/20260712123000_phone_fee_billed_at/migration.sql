-- Tracks that the one-time "AI Receptionist No." fee was billed for this
-- number, so subsequent phone-capable agent purchases by the same buyer do
-- not re-bill the same number. Cleared when the number returns to AVAILABLE.
ALTER TABLE "PlatformPhoneNumber" ADD COLUMN IF NOT EXISTS "feeBilledAt" TIMESTAMP(3);
