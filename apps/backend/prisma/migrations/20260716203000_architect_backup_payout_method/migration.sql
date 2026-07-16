CREATE TABLE "ArchitectBackupPayoutMethod" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "bankName" TEXT,
    "accountHolderName" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "currency" TEXT NOT NULL DEFAULT 'inr',
    "accountLast4" TEXT,
    "routingLast4" TEXT,
    "stripeAccountId" TEXT,
    "stripeExternalAccountId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectBackupPayoutMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchitectBackupPayoutMethod_architectUserId_key"
ON "ArchitectBackupPayoutMethod"("architectUserId");

CREATE INDEX "ArchitectBackupPayoutMethod_country_idx"
ON "ArchitectBackupPayoutMethod"("country");

ALTER TABLE "ArchitectBackupPayoutMethod"
ADD CONSTRAINT "ArchitectBackupPayoutMethod_architectUserId_fkey"
FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
