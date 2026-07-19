-- CreateEnum
CREATE TYPE "InstallSource" AS ENUM ('MARKETPLACE_PURCHASE', 'FREE_INSTALL', 'TRIAL', 'ARCHITECT_SELF_TEST', 'ADMIN_ASSIGNMENT');

-- CreateTable
CREATE TABLE "UserRoleMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserRoleMembership_role_idx" ON "UserRoleMembership"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleMembership_userId_role_key" ON "UserRoleMembership"("userId", "role");

-- AddForeignKey
ALTER TABLE "UserRoleMembership" ADD CONSTRAINT "UserRoleMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "InstalledAgent" ADD COLUMN "installSource" "InstallSource" NOT NULL DEFAULT 'MARKETPLACE_PURCHASE';

-- Backfill: every existing user keeps their current role as a membership so
-- membership-based authorization is equivalent to the legacy single-role
-- checks from the first deploy. Deterministic ids keep a re-run idempotent.
INSERT INTO "UserRoleMembership" ("id", "userId", "role", "createdAt")
SELECT 'urm_' || "id" || '_' || lower("role"::text), "id", "role", CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId", "role") DO NOTHING;
