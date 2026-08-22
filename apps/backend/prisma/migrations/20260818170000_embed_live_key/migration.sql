-- Safe live mode for embedded agents.
--
-- A published page is public, so "this business installed the agent" is not
-- enough to spend their money: many businesses install the same listing, and
-- anyone can open the page. The buyer therefore mints a key for their own
-- website. No key = the page stays the demo it has always been.
--
-- The key is NOT a secret — it lives in the buyer's HTML by construction. The
-- daily ceiling beside it is the guard that actually bounds the bill.

-- AlterTable
ALTER TABLE "InstalledAgent" ADD COLUMN IF NOT EXISTS "embedKeyHash" TEXT;
ALTER TABLE "InstalledAgent" ADD COLUMN IF NOT EXISTS "embedKeyCipher" TEXT;
ALTER TABLE "InstalledAgent" ADD COLUMN IF NOT EXISTS "embedDailyLimit" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InstalledAgent_embedKeyHash_key" ON "InstalledAgent"("embedKeyHash");
