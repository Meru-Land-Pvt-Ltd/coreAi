-- AlterTable: confirmation metadata for structured weekly Business Hours.
ALTER TABLE "BusinessProfile" ADD COLUMN "hoursSource" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "hoursConfirmedAt" TIMESTAMP(3);

-- CreateTable: date-specific overrides (holidays, special hours, closures).
CREATE TABLE "BusinessSpecialHours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'special',
    "closed" BOOLEAN NOT NULL DEFAULT true,
    "periodsJson" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSpecialHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessSpecialHours_businessId_idx" ON "BusinessSpecialHours"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSpecialHours_businessId_date_key" ON "BusinessSpecialHours"("businessId", "date");

-- AddForeignKey
ALTER TABLE "BusinessSpecialHours" ADD CONSTRAINT "BusinessSpecialHours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing businesses that already saved usable weekly hours are
-- treated as buyer-confirmed manual hours, so their live agents keep
-- answering exactly as before this migration (never silently degraded to
-- "not confirmed"). Businesses without saved hours stay unconfirmed and see
-- "Business Hours not configured".
UPDATE "BusinessProfile"
SET "hoursSource" = 'manual', "hoursConfirmedAt" = CURRENT_TIMESTAMP
WHERE "hoursJson" IS NOT NULL
  AND jsonb_typeof("hoursJson") = 'array'
  AND jsonb_array_length("hoursJson") > 0;
