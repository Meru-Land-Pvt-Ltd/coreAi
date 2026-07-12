-- CreateEnum
CREATE TYPE "UsageServiceUnit" AS ENUM ('PER_MINUTE', 'PER_SMS', 'PER_CALL', 'PER_UNIT');

-- CreateTable
CREATE TABLE "PlatformUsageService" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "unit" "UsageServiceUnit" NOT NULL DEFAULT 'PER_MINUTE',
    "actualCostMicroUsd" INTEGER NOT NULL,
    "updatedCostMicroUsd" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUsageService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUsageService_code_key" ON "PlatformUsageService"("code");

-- CreateIndex
CREATE INDEX "PlatformUsageService_isActive_sortOrder_idx" ON "PlatformUsageService"("isActive", "sortOrder");

-- Seed AI Receptionist infrastructure costs from Triven pricing board report (July 2026).
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
) VALUES
    ('svc_twilio_voice', 'twilio_voice', 'Twilio Voice', 'Inbound call connectivity', 'PER_MINUTE', 8500, 8500, 10, CURRENT_TIMESTAMP),
    ('svc_deepgram_nova3', 'deepgram_nova3', 'Deepgram Nova 3', 'Speech-to-text transcription', 'PER_MINUTE', 7700, 7700, 20, CURRENT_TIMESTAMP),
    ('svc_openai_gpt4o_mini', 'openai_gpt4o_mini', 'OpenAI GPT-4o Mini', 'Conversation intelligence / LLM', 'PER_MINUTE', 10000, 10000, 30, CURRENT_TIMESTAMP),
    ('svc_elevenlabs_flash_v25', 'elevenlabs_flash_v25', 'ElevenLabs Flash v2.5', 'Text-to-speech voice output', 'PER_MINUTE', 40000, 40000, 40, CURRENT_TIMESTAMP),
    ('svc_database_storage', 'database_storage', 'Firebase / MongoDB', 'Call logs and records', 'PER_MINUTE', 200, 200, 50, CURRENT_TIMESTAMP),
    ('svc_google_calendar', 'google_calendar', 'Google Calendar API', 'Appointment booking', 'PER_MINUTE', 0, 0, 60, CURRENT_TIMESTAMP),
    ('svc_sms_confirmation', 'sms_confirmation', 'SMS Confirmation', 'Post-call SMS confirmation', 'PER_SMS', 10000, 10000, 70, CURRENT_TIMESTAMP);
