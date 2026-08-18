-- Product Spec storage for published agent pages.
--
-- Fully additive: ONE nullable JSONB column on an existing table. No existing
-- column is altered, no data is rewritten, no default is backfilled, so the
-- statement takes only a brief catalog lock and every currently published page
-- keeps working untouched.
--
-- NULL means "this page has no Product Spec yet". Those pages are not broken:
-- the backend synthesizes a one-page spec from the older Face Blueprint at
-- read time (see product-spec-service.ts), so no migration of existing rows
-- is required and rollback is just dropping the column.

-- AlterTable
ALTER TABLE "PublishedAgentPage" ADD COLUMN "productJson" JSONB;
