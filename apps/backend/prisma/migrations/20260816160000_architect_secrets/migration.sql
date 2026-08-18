-- Per-architect encrypted secret locker ("My Keys"). Fully additive: one new
-- table, no existing table is altered or rewritten. The value column holds the
-- AES-256-GCM(iv.authTag.ciphertext) bundle produced by the shared crypto
-- helper (same encoding as PlatformApiSetting and the Telegram/Calendly token
-- columns). Plaintext is never stored. Cascade on the owner so deleting an
-- architect account removes their keys.

-- CreateTable
CREATE TABLE "ArchitectSecret" (
    "id" TEXT NOT NULL,
    "architectUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchitectSecret_architectUserId_idx" ON "ArchitectSecret"("architectUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectSecret_architectUserId_name_key" ON "ArchitectSecret"("architectUserId", "name");

-- AddForeignKey
ALTER TABLE "ArchitectSecret" ADD CONSTRAINT "ArchitectSecret_architectUserId_fkey" FOREIGN KEY ("architectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
