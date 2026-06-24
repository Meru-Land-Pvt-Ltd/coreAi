-- CreateEnum
CREATE TYPE "ConnectorProvider" AS ENUM ('GMAIL');

-- CreateTable
CREATE TABLE "ConnectorCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "externalAccountEmail" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "scope" TEXT,
    "tokenType" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorCredential_userId_idx" ON "ConnectorCredential"("userId");

-- CreateIndex
CREATE INDEX "ConnectorCredential_provider_idx" ON "ConnectorCredential"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCredential_userId_provider_key" ON "ConnectorCredential"("userId", "provider");

-- AddForeignKey
ALTER TABLE "ConnectorCredential" ADD CONSTRAINT "ConnectorCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
