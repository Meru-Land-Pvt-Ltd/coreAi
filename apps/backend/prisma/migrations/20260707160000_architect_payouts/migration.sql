-- CreateEnum
CREATE TYPE "ArchitectPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ArchitectPayoutMethod" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectPayoutMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchitectPayout" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "ArchitectPayoutStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectPayoutMethod_architectUserId_key" ON "ArchitectPayoutMethod"("architectUserId");

-- CreateIndex
CREATE INDEX "ArchitectPayoutMethod_ifscCode_idx" ON "ArchitectPayoutMethod"("ifscCode");

-- CreateIndex
CREATE INDEX "ArchitectPayout_architectUserId_idx" ON "ArchitectPayout"("architectUserId");

-- CreateIndex
CREATE INDEX "ArchitectPayout_status_idx" ON "ArchitectPayout"("status");

-- CreateIndex
CREATE INDEX "ArchitectPayout_createdAt_idx" ON "ArchitectPayout"("createdAt");

-- AddForeignKey
ALTER TABLE "ArchitectPayoutMethod" ADD CONSTRAINT "ArchitectPayoutMethod_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitectPayout" ADD CONSTRAINT "ArchitectPayout_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
