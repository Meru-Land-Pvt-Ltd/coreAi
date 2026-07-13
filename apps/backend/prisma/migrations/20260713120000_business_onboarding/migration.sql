-- Buyer onboarding progress on BusinessProfile.
ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);
ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "onboardingSkippedAt" TIMESTAMP(3);
ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "onboardingDataJson" JSONB;
