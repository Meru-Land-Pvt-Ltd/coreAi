-- Vapi call recording URL (present only when the End Flow node has recording enabled)
ALTER TABLE "VapiCall" ADD COLUMN "recordingUrl" TEXT;
