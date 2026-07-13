-- Architect payout schedule (frequency, payout day, minimum threshold) on ArchitectProfile.
ALTER TABLE "ArchitectProfile" ADD COLUMN IF NOT EXISTS "payoutSchedule" JSONB;
