-- Add Cartesia Sonic 2 alongside the existing ElevenLabs voice rate.
UPDATE "PlatformUsageService"
SET
    "isActive" = true,
    "showInPhoneCallBreakdown" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'elevenlabs_flash_v25';

INSERT INTO "PlatformUsageService" (
    "id",
    "code",
    "name",
    "role",
    "unit",
    "actualCostMicroUsd",
    "updatedCostMicroUsd",
    "showInPhoneCallBreakdown",
    "isActive",
    "sortOrder",
    "updatedAt"
) VALUES (
    'svc_cartesia_sonic_2',
    'cartesia_sonic_2',
    'Cartesia Sonic 2',
    'Text-to-speech voice output',
    'PER_MINUTE',
    45000,
    45000,
    true,
    true,
    41,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "role" = EXCLUDED."role",
    "unit" = EXCLUDED."unit",
    "actualCostMicroUsd" = EXCLUDED."actualCostMicroUsd",
    "updatedCostMicroUsd" = EXCLUDED."updatedCostMicroUsd",
    "showInPhoneCallBreakdown" = EXCLUDED."showInPhoneCallBreakdown",
    "isActive" = EXCLUDED."isActive",
    "sortOrder" = EXCLUDED."sortOrder",
    "updatedAt" = CURRENT_TIMESTAMP;
