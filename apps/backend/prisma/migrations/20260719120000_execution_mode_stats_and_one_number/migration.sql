-- VapiCall execution mode: LIVE by default; test/preview/demo calls are
-- stamped by the Vapi webhook and excluded from production stats and billing.
ALTER TABLE "VapiCall" ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'LIVE';

-- CreateIndex
CREATE INDEX "VapiCall_businessId_executionMode_idx" ON "VapiCall"("businessId", "executionMode");

-- Best-effort backfill: mark historical architect browser-test and buyer
-- preview/demo calls using the purpose recorded in the stored webhook payload.
UPDATE "VapiCall" SET "executionMode" = 'ARCHITECT_DRY_RUN'
WHERE 'ARCHITECT_TEST' IN (
  "metadataJson"#>>'{message,assistant,metadata,purpose}',
  "metadataJson"#>>'{assistant,metadata,purpose}',
  "metadataJson"#>>'{message,call,assistantOverrides,metadata,purpose}',
  "metadataJson"#>>'{message,call,metadata,purpose}',
  "metadataJson"#>>'{call,metadata,purpose}',
  "metadataJson"#>>'{metadata,purpose}'
);

UPDATE "VapiCall" SET "executionMode" = 'BUSINESS_TEST'
WHERE "executionMode" = 'LIVE'
  AND (
    'BUYER_SETUP_PREVIEW' IN (
      "metadataJson"#>>'{message,assistant,metadata,purpose}',
      "metadataJson"#>>'{assistant,metadata,purpose}',
      "metadataJson"#>>'{message,call,assistantOverrides,metadata,purpose}',
      "metadataJson"#>>'{message,call,metadata,purpose}',
      "metadataJson"#>>'{call,metadata,purpose}',
      "metadataJson"#>>'{metadata,purpose}'
    )
    OR 'MARKETPLACE_DEMO' IN (
      "metadataJson"#>>'{message,assistant,metadata,purpose}',
      "metadataJson"#>>'{assistant,metadata,purpose}',
      "metadataJson"#>>'{message,call,assistantOverrides,metadata,purpose}',
      "metadataJson"#>>'{message,call,metadata,purpose}',
      "metadataJson"#>>'{call,metadata,purpose}',
      "metadataJson"#>>'{metadata,purpose}'
    )
  );

-- WorkflowRun external call linkage: one call → one run. Duplicate webhook
-- deliveries hit the unique constraint instead of creating a second run.
-- (Postgres unique treats NULLs as distinct, so unlinked rows are unaffected.)
ALTER TABLE "WorkflowRun" ADD COLUMN     "callProvider" TEXT,
ADD COLUMN     "externalCallId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_callProvider_externalCallId_key" ON "WorkflowRun"("callProvider", "externalCallId");

-- One active Triven number per business. First release any historical
-- duplicate assignments (keep the newest), mirroring unassignPlatformNumber,
-- then enforce it with a partial unique index.
WITH ranked AS (
  SELECT id, "phoneNumber",
         ROW_NUMBER() OVER (
           PARTITION BY "businessId"
           ORDER BY "assignedAt" DESC NULLS LAST, "updatedAt" DESC
         ) AS rn
  FROM "PlatformPhoneNumber"
  WHERE "status" = 'ASSIGNED' AND "isPlatformSmsSender" = false AND "businessId" IS NOT NULL
),
released AS (
  UPDATE "PlatformPhoneNumber" p
  SET "status" = 'AVAILABLE',
      "businessId" = NULL,
      "buyerUserId" = NULL,
      "installedAgentId" = NULL,
      "assignedAt" = NULL,
      "feeBilledAt" = NULL
  FROM ranked
  WHERE p.id = ranked.id AND ranked.rn > 1
  RETURNING p."phoneNumber"
)
UPDATE "BusinessPhoneNumber" b
SET "isActive" = false, "installedAgentId" = NULL
FROM released r
WHERE b."phoneNumber" = r."phoneNumber" AND b."isActive" = true;

-- Partial unique index (raw SQL — not expressible in schema.prisma): at most
-- one ASSIGNED non-SMS-sender platform number per business.
CREATE UNIQUE INDEX "PlatformPhoneNumber_one_assigned_per_business_key"
ON "PlatformPhoneNumber"("businessId")
WHERE "status" = 'ASSIGNED' AND "isPlatformSmsSender" = false AND "businessId" IS NOT NULL;
