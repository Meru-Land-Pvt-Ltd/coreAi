-- Persist admin-created architect builder groups across refresh.
CREATE TABLE "ArchitectNodeGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectNodeGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchitectNodeGroup_name_key" ON "ArchitectNodeGroup"("name");
