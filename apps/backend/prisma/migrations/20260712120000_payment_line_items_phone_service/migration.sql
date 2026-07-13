-- Fee breakdown on agent purchase payments (agent price + "AI Receptionist No." number fee).
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "lineItemsJson" JSONB;

-- Seed the per-phone-number price on the admin pricing board. The buyer-facing
-- label lives in "name" (never the provider name); admin edits the price via
-- the existing /admin/pricing/services UI. PER_UNIT services are excluded from
-- per-call usage metering, so this row cannot double-bill calls.
INSERT INTO "PlatformUsageService" (
    "id",
    "code",
    "name",
    "role",
    "unit",
    "actualCostMicroUsd",
    "updatedCostMicroUsd",
    "sortOrder",
    "updatedAt"
) VALUES (
    'svc_phone_number',
    'phone_number',
    'AI Receptionist No.',
    'Dedicated business phone number',
    'PER_UNIT',
    1150000,
    2000000,
    80,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
