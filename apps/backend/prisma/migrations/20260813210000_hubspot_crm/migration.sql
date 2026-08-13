-- CreateEnum
CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT');

-- CreateEnum
CREATE TYPE "CrmConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'PENDING');

-- CreateTable
CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" "CrmProvider" NOT NULL DEFAULT 'HUBSPOT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "portalId" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "status" "CrmConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContactCache" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "owner" TEXT,
    "stage" TEXT,
    "lastActivity" TIMESTAMP(3),
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "insight" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContactCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmObjectMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "trivenEntity" TEXT NOT NULL,
    "trivenId" TEXT NOT NULL,
    "hubspotObject" TEXT NOT NULL,
    "hubspotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmObjectMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWebhookEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "businessId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CrmWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmConnection_businessId_idx" ON "CrmConnection"("businessId");

-- CreateIndex
CREATE INDEX "CrmConnection_businessId_isActive_idx" ON "CrmConnection"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "CrmConnection_portalId_idx" ON "CrmConnection"("portalId");

-- CreateIndex
CREATE INDEX "CrmConnection_status_idx" ON "CrmConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_businessId_provider_key" ON "CrmConnection"("businessId", "provider");

-- CreateIndex
CREATE INDEX "CrmContactCache_businessId_idx" ON "CrmContactCache"("businessId");

-- CreateIndex
CREATE INDEX "CrmContactCache_phone_idx" ON "CrmContactCache"("phone");

-- CreateIndex
CREATE INDEX "CrmContactCache_email_idx" ON "CrmContactCache"("email");

-- CreateIndex
CREATE INDEX "CrmContactCache_lastSynced_idx" ON "CrmContactCache"("lastSynced");

-- CreateIndex
CREATE INDEX "CrmContactCache_businessId_phone_idx" ON "CrmContactCache"("businessId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContactCache_connectionId_contactId_key" ON "CrmContactCache"("connectionId", "contactId");

-- CreateIndex
CREATE INDEX "CrmObjectMapping_businessId_idx" ON "CrmObjectMapping"("businessId");

-- CreateIndex
CREATE INDEX "CrmObjectMapping_hubspotObject_hubspotId_idx" ON "CrmObjectMapping"("hubspotObject", "hubspotId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmObjectMapping_connectionId_trivenEntity_trivenId_key" ON "CrmObjectMapping"("connectionId", "trivenEntity", "trivenId");

-- CreateIndex
CREATE INDEX "CrmWebhookEvent_status_createdAt_idx" ON "CrmWebhookEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CrmWebhookEvent_businessId_idx" ON "CrmWebhookEvent"("businessId");

-- AddForeignKey
ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContactCache" ADD CONSTRAINT "CrmContactCache_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CrmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmObjectMapping" ADD CONSTRAINT "CrmObjectMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CrmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

