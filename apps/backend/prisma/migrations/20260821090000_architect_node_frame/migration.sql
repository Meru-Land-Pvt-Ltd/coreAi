-- A Node Frame an architect filled in through the builder.
CREATE TABLE "ArchitectNodeFrame" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "declarationJson" JSONB NOT NULL,
    "secretsJson" JSONB,
    "problems" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectNodeFrame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchitectNodeFrame_architectUserId_frameId_key" ON "ArchitectNodeFrame"("architectUserId", "frameId");
CREATE INDEX "ArchitectNodeFrame_architectUserId_status_idx" ON "ArchitectNodeFrame"("architectUserId", "status");

ALTER TABLE "ArchitectNodeFrame" ADD CONSTRAINT "ArchitectNodeFrame_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
