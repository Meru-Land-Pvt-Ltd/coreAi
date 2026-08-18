-- Hard monthly ceiling on live AI usage per business. null = platform default
-- (LIVE_USAGE_HARD_CAP_CENTS env), 0 = explicitly unlimited. The notified
-- columns claim the once-per-month "cap reached" email, mirroring the
-- spending-alert pattern.

ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "usageHardCapCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "usageCapNotifiedMonth" TEXT,
  ADD COLUMN IF NOT EXISTS "usageCapNotifiedAt" TIMESTAMP(3);
