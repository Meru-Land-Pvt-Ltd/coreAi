/*
  Warnings:

  - The values [REVISION_REQUESTED,DISPUTED] on the enum `ProjectStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `approvedAt` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `architectId` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `categoryId` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `demoInputJson` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `installCount` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `isFree` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `workflowJson` on the `AgentListing` table. All the data in the column will be lost.
  - You are about to drop the column `totalEarningsCents` on the `ArchitectProfile` table. All the data in the column will be lost.
  - You are about to drop the column `selectedArchitectUserId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `workspaceId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `firebaseUid` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `createdByUserId` on the `WorkflowDefinition` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `WorkflowDefinition` table. All the data in the column will be lost.
  - You are about to drop the column `workspaceId` on the `WorkflowDefinition` table. All the data in the column will be lost.
  - You are about to drop the `AgentInstallation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BusinessMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Category` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HumanApproval` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentTransaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkflowNodeLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkflowRun` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Workspace` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkspaceConnector` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkspaceLlmKey` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `architectUserId` to the `AgentListing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `architectUserId` to the `WorkflowDefinition` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ProjectStatus_new" AS ENUM ('OPEN', 'PROPOSAL_REVIEW', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');
ALTER TABLE "public"."Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus_new" USING ("status"::text::"ProjectStatus_new");
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "public"."ProjectStatus_old";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- DropForeignKey
ALTER TABLE "AgentInstallation" DROP CONSTRAINT "AgentInstallation_listingId_fkey";

-- DropForeignKey
ALTER TABLE "AgentInstallation" DROP CONSTRAINT "AgentInstallation_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "AgentInstallation" DROP CONSTRAINT "AgentInstallation_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "AgentListing" DROP CONSTRAINT "AgentListing_architectId_fkey";

-- DropForeignKey
ALTER TABLE "AgentListing" DROP CONSTRAINT "AgentListing_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "BusinessMember" DROP CONSTRAINT "BusinessMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "BusinessMember" DROP CONSTRAINT "BusinessMember_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "HumanApproval" DROP CONSTRAINT "HumanApproval_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "HumanApproval" DROP CONSTRAINT "HumanApproval_runId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT "PaymentTransaction_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_selectedArchitectUserId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowDefinition" DROP CONSTRAINT "WorkflowDefinition_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowDefinition" DROP CONSTRAINT "WorkflowDefinition_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowNodeLog" DROP CONSTRAINT "WorkflowNodeLog_runId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowRun" DROP CONSTRAINT "WorkflowRun_installationId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowRun" DROP CONSTRAINT "WorkflowRun_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "Workspace" DROP CONSTRAINT "Workspace_ownerUserId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceConnector" DROP CONSTRAINT "WorkspaceConnector_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceLlmKey" DROP CONSTRAINT "WorkspaceLlmKey_workspaceId_fkey";

-- DropIndex
DROP INDEX "AgentListing_architectId_idx";

-- DropIndex
DROP INDEX "AgentListing_categoryId_idx";

-- DropIndex
DROP INDEX "AgentListing_slug_key";

-- DropIndex
DROP INDEX "Project_selectedArchitectUserId_idx";

-- DropIndex
DROP INDEX "Project_workspaceId_idx";

-- DropIndex
DROP INDEX "User_firebaseUid_key";

-- DropIndex
DROP INDEX "WorkflowDefinition_createdByUserId_idx";

-- DropIndex
DROP INDEX "WorkflowDefinition_isTemplate_idx";

-- DropIndex
DROP INDEX "WorkflowDefinition_workspaceId_idx";

-- AlterTable
ALTER TABLE "AgentListing" DROP COLUMN "approvedAt",
DROP COLUMN "architectId",
DROP COLUMN "categoryId",
DROP COLUMN "demoInputJson",
DROP COLUMN "installCount",
DROP COLUMN "isFree",
DROP COLUMN "slug",
DROP COLUMN "version",
DROP COLUMN "workflowJson",
ADD COLUMN     "architectUserId" TEXT NOT NULL,
ADD COLUMN     "workflowId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ArchitectProfile" DROP COLUMN "totalEarningsCents",
ADD COLUMN     "hourlyRateCents" INTEGER;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "selectedArchitectUserId",
DROP COLUMN "workspaceId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "avatarUrl",
DROP COLUMN "firebaseUid";

-- AlterTable
ALTER TABLE "WorkflowDefinition" DROP COLUMN "createdByUserId",
DROP COLUMN "version",
DROP COLUMN "workspaceId",
ADD COLUMN     "architectUserId" TEXT NOT NULL;

-- DropTable
DROP TABLE "AgentInstallation";

-- DropTable
DROP TABLE "AuditLog";

-- DropTable
DROP TABLE "BusinessMember";

-- DropTable
DROP TABLE "Category";

-- DropTable
DROP TABLE "HumanApproval";

-- DropTable
DROP TABLE "PaymentTransaction";

-- DropTable
DROP TABLE "WorkflowNodeLog";

-- DropTable
DROP TABLE "WorkflowRun";

-- DropTable
DROP TABLE "Workspace";

-- DropTable
DROP TABLE "WorkspaceConnector";

-- DropTable
DROP TABLE "WorkspaceLlmKey";

-- DropEnum
DROP TYPE "ApprovalStatus";

-- DropEnum
DROP TYPE "ConnectorAuthType";

-- DropEnum
DROP TYPE "InstallationStatus";

-- DropEnum
DROP TYPE "PaymentPurpose";

-- DropEnum
DROP TYPE "PaymentStatus";

-- DropEnum
DROP TYPE "RunStatus";

-- DropEnum
DROP TYPE "StepStatus";

-- DropEnum
DROP TYPE "WorkspaceRole";

-- CreateIndex
CREATE INDEX "AgentListing_architectUserId_idx" ON "AgentListing"("architectUserId");

-- CreateIndex
CREATE INDEX "AgentListing_workflowId_idx" ON "AgentListing"("workflowId");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectProposal_projectId_idx" ON "ProjectProposal"("projectId");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_architectUserId_idx" ON "WorkflowDefinition"("architectUserId");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_createdAt_idx" ON "WorkflowDefinition"("createdAt");

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentListing" ADD CONSTRAINT "AgentListing_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentListing" ADD CONSTRAINT "AgentListing_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
