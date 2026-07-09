-- Incremental changes on top of 20260708061236_clear.
-- Guard enum creation so re-apply is safe if objects already exist.

DO $$ BEGIN
  CREATE TYPE "ContextLinkStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Business" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'active';

ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "totalTokenInput" INTEGER DEFAULT 0;
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "totalTokenOutput" INTEGER DEFAULT 0;
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "totalCostCents" INTEGER DEFAULT 0;
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "currentNodeId" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN IF NOT EXISTS "metadataJson" JSONB;

ALTER TABLE "ContextLink" ADD COLUMN IF NOT EXISTS "linkStatus" "ContextLinkStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS "WorkflowRun_currentNodeId_idx" ON "WorkflowRun"("currentNodeId");
CREATE INDEX IF NOT EXISTS "ContextLink_linkStatus_idx" ON "ContextLink"("linkStatus");
