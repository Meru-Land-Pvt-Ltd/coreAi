-- Canonical per-agent execution billing, segmented usage invoices, explicit
-- purchase invoice lifecycle metadata, and buyer spending alerts.

CREATE TYPE "PaymentInvoiceKind" AS ENUM (
    'PURCHASE',
    'TRIAL',
    'POST_TRIAL',
    'SUBSCRIPTION_RENEWAL'
);

CREATE TYPE "AgentUsageSource" AS ENUM ('WORKFLOW', 'VAPI');

ALTER TABLE "Business"
    ADD COLUMN "spendingAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "spendingAlertThresholdCents" INTEGER NOT NULL DEFAULT 5000,
    ADD COLUMN "spendingAlertLastNotifiedMonth" TEXT,
    ADD COLUMN "spendingAlertLastNotifiedAt" TIMESTAMP(3);

ALTER TABLE "InstalledAgent"
    ADD COLUMN "executionFeeCents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "trialExecutionLimit" INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN "trialExecutionsUsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "executionBillingStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Snapshot current terms for existing installs. New installs write the
-- snapshot directly and are not affected by later listing edits.
UPDATE "InstalledAgent" AS installed
SET "executionFeeCents" = listing."executionFeeCents"
FROM "AgentListing" AS listing
WHERE installed."listingId" = listing."id";

ALTER TABLE "Payment"
    ADD COLUMN "invoiceKind" "PaymentInvoiceKind" NOT NULL DEFAULT 'PURCHASE',
    ADD COLUMN "invoiceKey" TEXT,
    ADD COLUMN "periodStart" TIMESTAMP(3),
    ADD COLUMN "periodEnd" TIMESTAMP(3),
    ADD COLUMN "dueAt" TIMESTAMP(3),
    ADD COLUMN "graceEndsAt" TIMESTAMP(3),
    ADD COLUMN "paidAt" TIMESTAMP(3),
    ADD COLUMN "suspendedAt" TIMESTAMP(3),
    ADD COLUMN "paymentAttemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "paymentPendingAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_invoiceKey_key" ON "Payment"("invoiceKey");

UPDATE "Payment"
SET "invoiceKind" = 'TRIAL'
WHERE "status" = 'TRIALING'
   OR lower(COALESCE("description", '')) LIKE '%trial%';

UPDATE "Payment" AS payment
SET
    "periodStart" = COALESCE(payment."periodStart", payment."createdAt"),
    "periodEnd" = COALESCE(
        payment."periodEnd",
        payment."createdAt" +
          (CASE WHEN listing."trialDays" > 0 THEN listing."trialDays" ELSE 7 END) *
          INTERVAL '1 day'
    )
FROM "AgentListing" AS listing
WHERE payment."listingId" = listing."id"
  AND payment."invoiceKind" = 'TRIAL';

-- The old converter changed the original trial row to FAILED when its charge
-- failed. Restore the lifecycle row so the scheduler can complete it and
-- create a separate post-trial overdue invoice.
UPDATE "Payment"
SET "status" = 'TRIALING'
WHERE "invoiceKind" = 'TRIAL'
  AND "status" = 'FAILED';

-- A canceled trial with a later paid acquisition was a successful historical
-- conversion, not a debt. Preserve it as a completed zero-dollar trial.
UPDATE "Payment" AS trial
SET "status" = 'COMPLETED'
WHERE trial."invoiceKind" = 'TRIAL'
  AND trial."status" = 'CANCELED'
  AND EXISTS (
      SELECT 1
      FROM "Payment" AS paid
      WHERE paid."userId" = trial."userId"
        AND paid."listingId" = trial."listingId"
        AND paid."status" = 'SUCCEEDED'
        AND paid."createdAt" >= trial."createdAt"
  );

UPDATE "Payment"
SET "paidAt" = COALESCE("updatedAt", "createdAt")
WHERE "status" = 'SUCCEEDED';

-- Seed the trial quota before application traffic starts. This closes the
-- deployment race where an existing trial with 50+ historical executions
-- could otherwise claim another free post-cutover run before reconciliation.
WITH "trialEvents" AS (
    SELECT installed."id" AS "installedAgentId", 'VAPI:' || call."callId" AS "eventKey"
    FROM "InstalledAgent" AS installed
    JOIN "Business" AS business ON business."id" = installed."businessId"
    JOIN "Payment" AS payment
      ON payment."userId" = business."ownerId"
     AND payment."listingId" = installed."listingId"
     AND payment."invoiceKind" = 'TRIAL'
    JOIN "AgentListing" AS listing ON listing."id" = installed."listingId"
    JOIN "VapiCall" AS call
      ON call."installedAgentId" = installed."id"
     AND call."executionMode" = 'LIVE'
     AND (call."billingRecordedAt" IS NOT NULL OR call."endedAt" IS NOT NULL)
    WHERE COALESCE(call."endedAt", call."billingRecordedAt", call."createdAt") >=
          COALESCE(payment."periodStart", payment."createdAt")
      AND COALESCE(call."endedAt", call."billingRecordedAt", call."createdAt") <
          COALESCE(
              payment."periodEnd",
              payment."createdAt" + GREATEST(listing."trialDays", 0) * INTERVAL '1 day'
          )
      AND COALESCE(call."endedAt", call."billingRecordedAt", call."createdAt") <
          installed."executionBillingStartedAt"

    UNION

    SELECT
      installed."id" AS "installedAgentId",
      CASE
        WHEN run."externalCallId" IS NOT NULL
          THEN upper(COALESCE(run."callProvider", 'WORKFLOW')) || ':' || run."externalCallId"
        ELSE 'WORKFLOW:' || run."id"
      END AS "eventKey"
    FROM "InstalledAgent" AS installed
    JOIN "Business" AS business ON business."id" = installed."businessId"
    JOIN "Payment" AS payment
      ON payment."userId" = business."ownerId"
     AND payment."listingId" = installed."listingId"
     AND payment."invoiceKind" = 'TRIAL'
    JOIN "AgentListing" AS listing ON listing."id" = installed."listingId"
    JOIN "WorkflowRun" AS run
      ON run."installedAgentId" = installed."id"
     AND run."mode" = 'LIVE'
     AND run."status" = 'COMPLETED'
     AND run."finishedAt" IS NOT NULL
    WHERE run."finishedAt" >= COALESCE(payment."periodStart", payment."createdAt")
      AND run."finishedAt" <
          COALESCE(
              payment."periodEnd",
              payment."createdAt" + GREATEST(listing."trialDays", 0) * INTERVAL '1 day'
          )
      AND run."finishedAt" < installed."executionBillingStartedAt"
),
"trialCounts" AS (
    SELECT "installedAgentId", COUNT(DISTINCT "eventKey")::INTEGER AS "executionCount"
    FROM "trialEvents"
    GROUP BY "installedAgentId"
)
UPDATE "InstalledAgent" AS installed
SET "trialExecutionsUsed" =
    LEAST(installed."trialExecutionLimit", counts."executionCount")
FROM "trialCounts" AS counts
WHERE installed."id" = counts."installedAgentId";

ALTER TABLE "BusinessUsageInvoice"
    ADD COLUMN "installedAgentId" TEXT,
    ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "graceEndsAt" TIMESTAMP(3),
    ADD COLUMN "closedAt" TIMESTAMP(3),
    ADD COLUMN "paymentAttemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "paymentPendingAt" TIMESTAMP(3);

ALTER TABLE "BusinessUsageInvoice"
    ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP INDEX IF EXISTS "BusinessUsageInvoice_businessId_billingMonth_key";

CREATE UNIQUE INDEX "BusinessUsageInvoice_installedAgentId_billingMonth_sequence_key"
    ON "BusinessUsageInvoice"("installedAgentId", "billingMonth", "sequence");
CREATE INDEX "BusinessUsageInvoice_businessId_billingMonth_idx"
    ON "BusinessUsageInvoice"("businessId", "billingMonth");
CREATE INDEX "BusinessUsageInvoice_installedAgentId_status_idx"
    ON "BusinessUsageInvoice"("installedAgentId", "status");

ALTER TABLE "BusinessUsageInvoice"
    ADD CONSTRAINT "BusinessUsageInvoice_installedAgentId_fkey"
    FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AgentUsageExecution" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "usageInvoiceId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "source" "AgentUsageSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "executionNumber" INTEGER NOT NULL,
    "trialExecution" BOOLEAN NOT NULL DEFAULT false,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "freeReason" TEXT,
    "unitPriceMicroUsd" INTEGER NOT NULL,
    "amountMicroUsd" INTEGER NOT NULL,
    "actualCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "legacyBilledCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentUsageExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentUsageExecution_workflowRunId_key"
    ON "AgentUsageExecution"("workflowRunId");
CREATE UNIQUE INDEX "AgentUsageExecution_dedupeKey_key"
    ON "AgentUsageExecution"("dedupeKey");
CREATE UNIQUE INDEX "AgentUsageExecution_installedAgentId_executionNumber_key"
    ON "AgentUsageExecution"("installedAgentId", "executionNumber");
CREATE INDEX "AgentUsageExecution_businessId_billingMonth_idx"
    ON "AgentUsageExecution"("businessId", "billingMonth");
CREATE INDEX "AgentUsageExecution_installedAgentId_billingMonth_idx"
    ON "AgentUsageExecution"("installedAgentId", "billingMonth");
CREATE INDEX "AgentUsageExecution_usageInvoiceId_idx"
    ON "AgentUsageExecution"("usageInvoiceId");
CREATE INDEX "AgentUsageExecution_occurredAt_idx"
    ON "AgentUsageExecution"("occurredAt");

ALTER TABLE "AgentUsageExecution"
    ADD CONSTRAINT "AgentUsageExecution_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentUsageExecution"
    ADD CONSTRAINT "AgentUsageExecution_installedAgentId_fkey"
    FOREIGN KEY ("installedAgentId") REFERENCES "InstalledAgent"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentUsageExecution"
    ADD CONSTRAINT "AgentUsageExecution_workflowRunId_fkey"
    FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentUsageExecution"
    ADD CONSTRAINT "AgentUsageExecution_usageInvoiceId_fkey"
    FOREIGN KEY ("usageInvoiceId") REFERENCES "BusinessUsageInvoice"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
