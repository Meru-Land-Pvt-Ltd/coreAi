WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "installedAgentId"
           ORDER BY "updatedAt" DESC, "createdAt" DESC
         ) AS rn
  FROM "BusinessPhoneNumber"
  WHERE "isActive" = true AND "installedAgentId" IS NOT NULL
)
UPDATE "BusinessPhoneNumber" b
SET "installedAgentId" = NULL
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

-- 2. Same de-duplication on the inventory mirror.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "installedAgentId"
           ORDER BY "assignedAt" DESC NULLS LAST, "updatedAt" DESC
         ) AS rn
  FROM "PlatformPhoneNumber"
  WHERE "status" = 'ASSIGNED'
    AND "isPlatformSmsSender" = false
    AND "installedAgentId" IS NOT NULL
)
UPDATE "PlatformPhoneNumber" p
SET "installedAgentId" = NULL
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

-- 3. Make the runtime's implicit choice explicit: an active number with no
--    agent link, in a business with exactly ONE active agent, belongs to that
--    agent. Businesses with several active agents are deliberately left NULL
--    rather than guessed at.
UPDATE "BusinessPhoneNumber" b
SET "installedAgentId" = sole.agent_id
FROM (
  SELECT "businessId", MIN(id) AS agent_id, COUNT(*) AS agent_count
  FROM "InstalledAgent"
  WHERE "status" = 'ACTIVE'
  GROUP BY "businessId"
) sole
WHERE b."businessId" = sole."businessId"
  AND sole.agent_count = 1
  AND b."isActive" = true
  AND b."installedAgentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "BusinessPhoneNumber" x
    WHERE x."installedAgentId" = sole.agent_id AND x."isActive" = true
  );

-- 4. Mirror the routing link onto the inventory row.
UPDATE "PlatformPhoneNumber" p
SET "installedAgentId" = b."installedAgentId"
FROM "BusinessPhoneNumber" b
WHERE b."phoneNumber" = p."phoneNumber"
  AND b."isActive" = true
  AND b."installedAgentId" IS NOT NULL
  AND p."status" = 'ASSIGNED'
  AND p."isPlatformSmsSender" = false
  AND p."installedAgentId" IS DISTINCT FROM b."installedAgentId";

-- 5. Swap the per-business cap for per-agent caps. The old index is keyed on
--    businessId alone; re-keying it to (businessId, installedAgentId) would be
--    useless because Postgres treats NULLs as distinct, letting a business
--    hoard unlimited free numbers.
DROP INDEX IF EXISTS "PlatformPhoneNumber_one_assigned_per_business_key";

CREATE UNIQUE INDEX "BusinessPhoneNumber_one_active_per_agent_key"
ON "BusinessPhoneNumber"("installedAgentId")
WHERE "isActive" = true AND "installedAgentId" IS NOT NULL;

CREATE UNIQUE INDEX "PlatformPhoneNumber_one_assigned_per_agent_key"
ON "PlatformPhoneNumber"("installedAgentId")
WHERE "status" = 'ASSIGNED'
  AND "isPlatformSmsSender" = false
  AND "installedAgentId" IS NOT NULL;
