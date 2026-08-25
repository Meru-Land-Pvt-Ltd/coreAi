-- NODE 013 — APPROVAL: a drafted customer reply held until the owner's yes.
CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "workflowRunId" TEXT,
    "architectUserId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "draftSubject" TEXT NOT NULL,
    "draftBody" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingApproval_token_key" ON "PendingApproval"("token");
CREATE INDEX "PendingApproval_businessId_idx" ON "PendingApproval"("businessId");
CREATE INDEX "PendingApproval_status_idx" ON "PendingApproval"("status");
