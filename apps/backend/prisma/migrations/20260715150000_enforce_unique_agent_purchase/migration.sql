-- One InstalledAgent per business per listing. NULL listingId rows (architect
-- sandbox/browser-test agents) are exempt: Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX "InstalledAgent_businessId_listingId_key" ON "InstalledAgent"("businessId", "listingId");
