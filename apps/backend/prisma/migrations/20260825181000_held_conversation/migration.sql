-- TIMER'S PATIENCE FLAVOR: one held conversation, waiting for reply or timeout.
CREATE TABLE "HeldConversation" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "architectUserId" TEXT,
    "threadKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "contextJson" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firedAt" TIMESTAMP(3),

    CONSTRAINT "HeldConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HeldConversation_status_dueAt_idx" ON "HeldConversation"("status", "dueAt");
CREATE INDEX "HeldConversation_installedAgentId_threadKey_status_idx" ON "HeldConversation"("installedAgentId", "threadKey", "status");
