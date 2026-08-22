-- Models an admin can add without a deploy. Providers ship new models
-- constantly; an architect who cannot pick one is on last month's platform.
CREATE TABLE "AdminLlmModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'flagship',
    "inputPricePer1M" DOUBLE PRECISION,
    "outputPricePer1M" DOUBLE PRECISION,
    "multimodal" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminLlmModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminLlmModel_modelId_key" ON "AdminLlmModel"("modelId");
CREATE INDEX "AdminLlmModel_providerId_idx" ON "AdminLlmModel"("providerId");
CREATE INDEX "AdminLlmModel_enabled_idx" ON "AdminLlmModel"("enabled");
