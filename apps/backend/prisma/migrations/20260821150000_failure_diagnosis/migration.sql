-- What the platform has learned about one kind of failure. Keyed by cause.
CREATE TABLE "FailureDiagnosis" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cause" TEXT,
    "remedy" TEXT,
    "scope" TEXT,
    "autoFixable" BOOLEAN NOT NULL DEFAULT false,
    "diagnosedAt" TIMESTAMP(3),
    "diagnosedBy" TEXT,
    "servedFromMemory" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureDiagnosis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FailureDiagnosis_signature_key" ON "FailureDiagnosis"("signature");
CREATE INDEX "FailureDiagnosis_diagnosedAt_idx" ON "FailureDiagnosis"("diagnosedAt");
CREATE INDEX "FailureDiagnosis_nodeType_lastSeenAt_idx" ON "FailureDiagnosis"("nodeType", "lastSeenAt");
CREATE INDEX "FailureDiagnosis_scope_autoFixable_idx" ON "FailureDiagnosis"("scope", "autoFixable");
