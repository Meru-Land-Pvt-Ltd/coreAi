-- Structured Business Address on BusinessProfile — the single authoritative
-- copy read/written by Business Settings AND Agent Setup. All columns are
-- nullable: existing businesses keep working and simply show a
-- "not configured" warning until the buyer adds an address.
ALTER TABLE "BusinessProfile"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressState" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT,
  ADD COLUMN "addressLandmark" TEXT,
  ADD COLUMN "addressDirections" TEXT,
  ADD COLUMN "addressMapsLink" TEXT,
  ADD COLUMN "addressSource" TEXT,
  ADD COLUMN "addressConfirmedAt" TIMESTAMP(3);
