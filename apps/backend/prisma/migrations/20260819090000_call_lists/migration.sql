-- Call lists: a business works through its own people, one at a time.
CREATE TABLE "CallList" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My list',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "windowStartHour" INTEGER NOT NULL DEFAULT 9,
    "windowEndHour" INTEGER NOT NULL DEFAULT 20,
    "maxConcurrentCalls" INTEGER NOT NULL DEFAULT 3,
    "maxCallsPerPersonPerDay" INTEGER NOT NULL DEFAULT 1,
    "budgetUsd" INTEGER NOT NULL DEFAULT 50,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "lastSweptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stoppedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CallList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallListPerson" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "timeZone" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "attemptsToday" INTEGER NOT NULL DEFAULT 0,
    "attemptsDay" TEXT,
    "lastOutcome" TEXT,
    "lastCallId" TEXT,
    "lastError" TEXT,
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CallListPerson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallSuppression" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'call',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallSuppression_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallList_status_lastSweptAt_idx" ON "CallList"("status", "lastSweptAt");
CREATE INDEX "CallList_businessId_idx" ON "CallList"("businessId");
CREATE INDEX "CallList_installedAgentId_idx" ON "CallList"("installedAgentId");

-- The same number can never be queued twice on one list.
CREATE UNIQUE INDEX "CallListPerson_listId_phone_key" ON "CallListPerson"("listId", "phone");
CREATE INDEX "CallListPerson_listId_status_nextAttemptAt_idx" ON "CallListPerson"("listId", "status", "nextAttemptAt");
CREATE INDEX "CallListPerson_phone_idx" ON "CallListPerson"("phone");

-- One suppression per number per business; checked before every dial.
CREATE UNIQUE INDEX "CallSuppression_businessId_phone_key" ON "CallSuppression"("businessId", "phone");
CREATE INDEX "CallSuppression_phone_idx" ON "CallSuppression"("phone");

ALTER TABLE "CallList" ADD CONSTRAINT "CallList_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallList" ADD CONSTRAINT "CallList_installedAgentId_fkey" FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallList" ADD CONSTRAINT "CallList_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallListPerson" ADD CONSTRAINT "CallListPerson_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CallList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallSuppression" ADD CONSTRAINT "CallSuppression_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
