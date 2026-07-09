-- CreateEnum
CREATE TYPE "ContextLinkStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAILED');

-- AlterTable
ALTER TABLE "Business" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'active';

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "totalTokenInput" INTEGER DEFAULT 0,
ADD COLUMN "totalTokenOutput" INTEGER DEFAULT 0,
ADD COLUMN "totalCostCents" INTEGER DEFAULT 0,
ADD COLUMN "currentNodeId" TEXT,
ADD COLUMN "metadataJson" JSONB;

-- AlterTable
ALTER TABLE "ContextLink" ADD COLUMN "linkStatus" "ContextLinkStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "WorkflowRun_currentNodeId_idx" ON "WorkflowRun"("currentNodeId");

-- CreateIndex
CREATE INDEX "ContextLink_linkStatus_idx" ON "ContextLink"("linkStatus");
