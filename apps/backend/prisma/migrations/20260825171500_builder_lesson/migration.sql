-- THE BUILDER'S LEARNED LESSONS: Tier 1 of the self-healing loop.
CREATE TABLE "BuilderLesson" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "workflowId" TEXT,
    "note" TEXT NOT NULL,
    "canvasTypesJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PERSONAL',
    "shareOptOut" BOOLEAN NOT NULL DEFAULT false,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "BuilderLesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuilderLesson_architectUserId_status_idx" ON "BuilderLesson"("architectUserId", "status");
