-- The two ways IN: a clock and a private link.
--
-- Until this migration an agent could only start when a human typed on a page.
-- ScheduledAgentRun gives an installed agent its own clock; AgentWebhookEndpoint
-- gives it a private URL another app can post to. Both hang off the INSTALLED
-- agent, never the shared WorkflowDefinition, because one workflow is installed
-- by many businesses and one buyer's schedule is not another's.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScheduledAgentRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'daily',
    "hourLocal" INTEGER NOT NULL DEFAULT 9,
    "minuteLocal" INTEGER NOT NULL DEFAULT 0,
    "weekdayLocal" INTEGER,
    "timeZone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastWorkflowRunId" TEXT,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentWebhookEndpoint" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "signingSecretCipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastDeliveryAt" TIMESTAMP(3),
    "deliveryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledAgentRun_installedAgentId_nodeId_key" ON "ScheduledAgentRun"("installedAgentId", "nodeId");
CREATE INDEX IF NOT EXISTS "ScheduledAgentRun_status_nextRunAt_idx" ON "ScheduledAgentRun"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "ScheduledAgentRun_businessId_idx" ON "ScheduledAgentRun"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentWebhookEndpoint_tokenHash_key" ON "AgentWebhookEndpoint"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentWebhookEndpoint_installedAgentId_nodeId_key" ON "AgentWebhookEndpoint"("installedAgentId", "nodeId");
CREATE INDEX IF NOT EXISTS "AgentWebhookEndpoint_businessId_idx" ON "AgentWebhookEndpoint"("businessId");
CREATE INDEX IF NOT EXISTS "AgentWebhookEndpoint_status_idx" ON "AgentWebhookEndpoint"("status");

-- AddForeignKey
ALTER TABLE "ScheduledAgentRun" ADD CONSTRAINT "ScheduledAgentRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledAgentRun" ADD CONSTRAINT "ScheduledAgentRun_installedAgentId_fkey" FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledAgentRun" ADD CONSTRAINT "ScheduledAgentRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentWebhookEndpoint" ADD CONSTRAINT "AgentWebhookEndpoint_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentWebhookEndpoint" ADD CONSTRAINT "AgentWebhookEndpoint_installedAgentId_fkey" FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentWebhookEndpoint" ADD CONSTRAINT "AgentWebhookEndpoint_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
