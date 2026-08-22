-- Outbound calling needs Vapi to know the number it dials from.
-- Registering a number with Vapi returns an id; this is where we keep it.
ALTER TABLE "PlatformPhoneNumber" ADD COLUMN IF NOT EXISTS "vapiPhoneNumberId" TEXT;
