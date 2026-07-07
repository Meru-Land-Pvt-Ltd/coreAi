-- AlterTable
ALTER TABLE "User" ADD COLUMN "phone" TEXT,
ADD COLUMN "location" TEXT,
ADD COLUMN "timezone" TEXT;

-- AlterTable
ALTER TABLE "ArchitectProfile" ADD COLUMN "displayName" TEXT,
ADD COLUMN "tagline" TEXT,
ADD COLUMN "githubUrl" TEXT,
ADD COLUMN "linkedinUrl" TEXT,
ADD COLUMN "twitterHandle" TEXT,
ADD COLUMN "experienceBand" TEXT,
ADD COLUMN "notificationPrefs" JSONB,
ADD COLUMN "privacyPrefs" JSONB,
ADD COLUMN "agentsPaused" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "LoginHistoryStatus" AS ENUM ('SUCCESS', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ArchitectRefundAction" AS ENUM ('PAUSE_ALL_AGENTS', 'DELETE_ACCOUNT');

-- CreateEnum
CREATE TYPE "RefundSettlementStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "UserLoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "location" TEXT,
    "ipMasked" TEXT,
    "userAgent" TEXT,
    "status" "LoginHistoryStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActiveSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenSid" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "location" TEXT,
    "ipMasked" TEXT,
    "userAgent" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchitectRefundSettlement" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "action" "ArchitectRefundAction" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "RefundSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectRefundSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserLoginHistory_userId_idx" ON "UserLoginHistory"("userId");

-- CreateIndex
CREATE INDEX "UserLoginHistory_createdAt_idx" ON "UserLoginHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserActiveSession_tokenSid_key" ON "UserActiveSession"("tokenSid");

-- CreateIndex
CREATE INDEX "UserActiveSession_userId_idx" ON "UserActiveSession"("userId");

-- CreateIndex
CREATE INDEX "UserActiveSession_revokedAt_idx" ON "UserActiveSession"("revokedAt");

-- CreateIndex
CREATE INDEX "UserActiveSession_expiresAt_idx" ON "UserActiveSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ArchitectRefundSettlement_architectUserId_idx" ON "ArchitectRefundSettlement"("architectUserId");

-- CreateIndex
CREATE INDEX "ArchitectRefundSettlement_status_idx" ON "ArchitectRefundSettlement"("status");

-- AddForeignKey
ALTER TABLE "UserLoginHistory" ADD CONSTRAINT "UserLoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActiveSession" ADD CONSTRAINT "UserActiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
