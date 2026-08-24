-- The second toggle on a model: may it run at all, including inside agents
-- businesses already bought. Same pair as the node switches.
ALTER TABLE "AdminLlmModel" ADD COLUMN "runningEnabled" BOOLEAN NOT NULL DEFAULT true;

-- A whole provider's switch — for when a provider is down or being retired,
-- rather than switching its models off one at a time.
CREATE TABLE "AdminLlmProvider" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminLlmProvider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminLlmProvider_providerId_key" ON "AdminLlmProvider"("providerId");
