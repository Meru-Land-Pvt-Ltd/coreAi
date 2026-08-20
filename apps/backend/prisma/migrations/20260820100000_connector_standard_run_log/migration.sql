-- The Connector Standard: where a connector's runs and daily self-tests are recorded.

CREATE TABLE "ConnectorRun" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "businessId" TEXT,
    "installedAgentId" TEXT,
    "workflowRunId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT,
    "unitsProduced" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConnectorRun_businessId_connectorId_createdAt_idx" ON "ConnectorRun"("businessId", "connectorId", "createdAt");
CREATE INDEX "ConnectorRun_installedAgentId_createdAt_idx" ON "ConnectorRun"("installedAgentId", "createdAt");
CREATE INDEX "ConnectorRun_connectorId_createdAt_idx" ON "ConnectorRun"("connectorId", "createdAt");

CREATE TABLE "ConnectorHealthCheck" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "healthy" BOOLEAN NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "missingKeys" TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorHealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConnectorHealthCheck_connectorId_checkedAt_idx" ON "ConnectorHealthCheck"("connectorId", "checkedAt");
CREATE INDEX "ConnectorHealthCheck_healthy_checkedAt_idx" ON "ConnectorHealthCheck"("healthy", "checkedAt");
