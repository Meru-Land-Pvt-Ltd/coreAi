-- CreateEnum
CREATE TYPE "ArchitectEarningStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "architectEarningStatus" "ArchitectEarningStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "architectEarningReviewedAt" TIMESTAMP(3),
ADD COLUMN "architectEarningReviewedByUserId" TEXT;

-- Grandfather existing marketplace sales as already approved for architect earnings.
UPDATE "Payment"
SET "architectEarningStatus" = 'APPROVED'
WHERE "listingId" IS NOT NULL
  AND "status" IN ('TRIALING', 'SUCCEEDED', 'PENDING');
