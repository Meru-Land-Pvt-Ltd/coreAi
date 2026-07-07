-- CreateEnum
CREATE TYPE "ListingReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ListingPublishStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FREE', 'ONE_TIME', 'SUBSCRIPTION');

-- AlterTable
ALTER TABLE "AgentListing" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "buyerSetupInstructions" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "complianceChecks" JSONB,
ADD COLUMN     "dataHandling" JSONB,
ADD COLUMN     "demoVideoUrl" TEXT,
ADD COLUMN     "executionFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freeTrialEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fullDescription" TEXT,
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "includedFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "industryTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "installInstructions" TEXT,
ADD COLUMN     "pricingModel" "PricingModel" NOT NULL DEFAULT 'SUBSCRIPTION',
ADD COLUMN     "publishStatus" "ListingPublishStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requiredBuyerSetup" JSONB,
ADD COLUMN     "requiredIntegrations" JSONB,
ADD COLUMN     "reviewStatus" "ListingReviewStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "screenshotUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "setupTimeEstimate" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Business" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'active';

-- AlterTable
ALTER TABLE "WorkflowDefinition" ADD COLUMN     "buyerSetupSchema" JSONB,
ADD COLUMN     "configureJson" JSONB,
ADD COLUMN     "marketplaceJson" JSONB,
ADD COLUMN     "publishChecklist" JSONB,
ADD COLUMN     "publishStatus" "ListingPublishStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "requiredIntegrations" JSONB,
ADD COLUMN     "reviewStatus" "ListingReviewStatus" NOT NULL DEFAULT 'DRAFT';
