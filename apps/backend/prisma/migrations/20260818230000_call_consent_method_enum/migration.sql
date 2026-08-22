-- The consent table shipped with `method` as TEXT while the schema declares it
-- as an enum, so every write failed with "type CallConsentMethod does not
-- exist". The four methods are a closed set by design — a consent record whose
-- method is a typo is worthless as evidence — so the enum is the right shape
-- and the column is converted to it. The table is new and empty, so the cast
-- cannot lose anything.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallConsentMethod') THEN
    CREATE TYPE "CallConsentMethod" AS ENUM ('WEB_REQUEST', 'VERBAL_CALL', 'IMPORTED_WRITTEN', 'OWNER_SELF');
  END IF;
END
$$;

ALTER TABLE "CallConsent"
  ALTER COLUMN "method" TYPE "CallConsentMethod"
  USING "method"::text::"CallConsentMethod";
