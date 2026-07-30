ALTER TABLE "PlatformUsageService"
ADD COLUMN "showInPhoneCallBreakdown" BOOLEAN NOT NULL DEFAULT false;

UPDATE "PlatformUsageService"
SET "showInPhoneCallBreakdown" = true
WHERE "code" IN (
    'twilio_voice',
    'deepgram_nova3',
    'openai_gpt4o_mini',
    'elevenlabs_flash_v25'
);
