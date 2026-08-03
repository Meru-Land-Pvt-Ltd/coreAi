-- AlterEnum
ALTER TYPE "ConnectorProvider" ADD VALUE 'CALENDLY';

-- AlterTable
ALTER TABLE "ConnectorCredential" ADD COLUMN "metadata" JSONB;
