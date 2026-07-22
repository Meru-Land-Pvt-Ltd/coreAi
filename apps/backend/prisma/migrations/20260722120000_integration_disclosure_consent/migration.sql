-- Versioned pre-OAuth disclosure consent records (Google Limited Use).
-- Relation-free by design: rows are compliance evidence and must survive
-- account deletion. Never store OAuth tokens or credentials in this table.

-- CreateTable
CREATE TABLE "IntegrationDisclosureConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT,
    "integration" TEXT NOT NULL,
    "disclosureVersion" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationDisclosureConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationDisclosureConsent_userId_integration_createdAt_idx" ON "IntegrationDisclosureConsent"("userId", "integration", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationDisclosureConsent_businessId_idx" ON "IntegrationDisclosureConsent"("businessId");
