-- CC/BCC recipients on outbound proxy email. Additive only.
ALTER TABLE "EmailMessage" ADD COLUMN "ccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailMessage" ADD COLUMN "bccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
