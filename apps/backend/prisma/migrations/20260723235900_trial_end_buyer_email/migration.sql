-- Retryable delivery marker for the buyer notification sent when an agent
-- trial is completed. Existing completed trials remain NULL and are picked up
-- by the next billing-cycle run.
ALTER TABLE "Payment"
ADD COLUMN "trialEndedEmailSentAt" TIMESTAMP(3);
