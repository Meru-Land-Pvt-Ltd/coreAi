-- Admin-controlled visibility of architect workflow-builder palette nodes.
CREATE TABLE "ArchitectNodeVisibility" (
    "id" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectNodeVisibility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchitectNodeVisibility_nodeType_key" ON "ArchitectNodeVisibility"("nodeType");
CREATE INDEX "ArchitectNodeVisibility_visible_idx" ON "ArchitectNodeVisibility"("visible");
