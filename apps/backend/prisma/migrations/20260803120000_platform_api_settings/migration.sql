-- CreateTable
CREATE TABLE "PlatformApiSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformApiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformApiSetting_key_key" ON "PlatformApiSetting"("key");

-- CreateIndex
CREATE INDEX "PlatformApiSetting_updatedAt_idx" ON "PlatformApiSetting"("updatedAt");

-- AddForeignKey
ALTER TABLE "PlatformApiSetting" ADD CONSTRAINT "PlatformApiSetting_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

