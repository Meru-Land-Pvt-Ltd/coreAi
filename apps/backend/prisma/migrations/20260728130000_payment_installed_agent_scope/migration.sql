-- Scope every acquisition and recurring agent invoice to the concrete
-- installed agent. The listing fallback is retained only for legacy rows.
ALTER TABLE "Payment"
ADD COLUMN IF NOT EXISTS "installedAgentId" TEXT;

UPDATE "Payment" payment
SET "installedAgentId" = (
  SELECT installed."id" AS "installedAgentId"
  FROM "InstalledAgent" installed
  INNER JOIN "Business" business
    ON business."id" = installed."businessId"
  WHERE installed."listingId" = payment."listingId"
    AND (
      installed."businessId" = payment."businessId"
      OR (
        payment."businessId" IS NULL
        AND business."ownerId" = payment."userId"
      )
    )
  ORDER BY
    CASE
      WHEN installed."businessId" = payment."businessId" THEN 0
      ELSE 1
    END,
    installed."createdAt" DESC
  LIMIT 1
)
WHERE payment."installedAgentId" IS NULL
  AND payment."listingId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Payment_installedAgentId_idx"
ON "Payment"("installedAgentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Payment_installedAgentId_fkey'
  ) THEN
    ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_installedAgentId_fkey"
    FOREIGN KEY ("installedAgentId")
    REFERENCES "InstalledAgent"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
