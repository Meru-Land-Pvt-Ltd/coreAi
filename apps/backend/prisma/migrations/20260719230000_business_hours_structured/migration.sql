-- The structured Business Hours columns and BusinessSpecialHours table were
-- created by migration 20260719213000_hours_confirmation_and_special_hours.
--
-- This migration only backfills confirmation metadata for existing businesses
-- that already have a usable weekly schedule.

UPDATE "BusinessProfile"
SET
  "hoursSource" = COALESCE("hoursSource", 'manual'),
  "hoursConfirmedAt" = COALESCE("hoursConfirmedAt", CURRENT_TIMESTAMP)
WHERE "hoursJson" IS NOT NULL
  AND jsonb_typeof("hoursJson") = 'array'
  AND jsonb_array_length("hoursJson") > 0;
