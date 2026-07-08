-- CreateEnum
CREATE TYPE "WorkflowRunMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NodeRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'WAITING', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ContextLinkType" AS ENUM ('BACKLINK', 'REFERENCE', 'SUMMARY_SOURCE');

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "businessId" TEXT,
    "triggeredByUserId" TEXT,
    "mode" "WorkflowRunMode" NOT NULL DEFAULT 'TEST',
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "threadId" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "nodeLabel" TEXT,
    "status" "NodeRunStatus" NOT NULL DEFAULT 'PENDING',
    "executionOrder" INTEGER NOT NULL DEFAULT 0,
    "threadId" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "summary" TEXT,
    "variablesJson" JSONB,
    "filesJson" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "costCents" INTEGER,
    "tokenInput" INTEGER,
    "tokenOutput" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextLink" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "fromNodeRunId" TEXT NOT NULL,
    "toNodeRunId" TEXT NOT NULL,
    "linkType" "ContextLinkType" NOT NULL DEFAULT 'BACKLINK',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_idx" ON "WorkflowRun"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowRun_installedAgentId_idx" ON "WorkflowRun"("installedAgentId");

-- CreateIndex
CREATE INDEX "WorkflowRun_businessId_idx" ON "WorkflowRun"("businessId");

-- CreateIndex
CREATE INDEX "WorkflowRun_threadId_idx" ON "WorkflowRun"("threadId");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");

-- CreateIndex
CREATE INDEX "WorkflowRun_createdAt_idx" ON "WorkflowRun"("createdAt");

-- CreateIndex
CREATE INDEX "NodeRun_workflowRunId_idx" ON "NodeRun"("workflowRunId");

-- CreateIndex
CREATE INDEX "NodeRun_workflowRunId_nodeId_idx" ON "NodeRun"("workflowRunId", "nodeId");

-- CreateIndex
CREATE INDEX "NodeRun_threadId_idx" ON "NodeRun"("threadId");

-- CreateIndex
CREATE INDEX "NodeRun_status_idx" ON "NodeRun"("status");

-- CreateIndex
CREATE INDEX "ContextLink_workflowRunId_idx" ON "ContextLink"("workflowRunId");

-- CreateIndex
CREATE INDEX "ContextLink_fromNodeRunId_idx" ON "ContextLink"("fromNodeRunId");

-- CreateIndex
CREATE INDEX "ContextLink_toNodeRunId_idx" ON "ContextLink"("toNodeRunId");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_installedAgentId_fkey" FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeRun" ADD CONSTRAINT "NodeRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextLink" ADD CONSTRAINT "ContextLink_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextLink" ADD CONSTRAINT "ContextLink_fromNodeRunId_fkey" FOREIGN KEY ("fromNodeRunId") REFERENCES "NodeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextLink" ADD CONSTRAINT "ContextLink_toNodeRunId_fkey" FOREIGN KEY ("toNodeRunId") REFERENCES "NodeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
