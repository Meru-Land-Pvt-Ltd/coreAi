-- AlterTable
ALTER TABLE "BusinessPhoneNumber" ADD COLUMN     "configJson" JSONB,
ADD COLUMN     "provider" "ConnectorProvider" NOT NULL DEFAULT 'TWILIO';

-- AlterTable
ALTER TABLE "PlatformPhoneNumber" ADD COLUMN     "capabilities" JSONB,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "locality" TEXT,
ADD COLUMN     "providerNumberId" TEXT,
ADD COLUMN     "region" TEXT;
