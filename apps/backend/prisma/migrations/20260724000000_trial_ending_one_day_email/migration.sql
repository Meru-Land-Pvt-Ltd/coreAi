-- Retryable, one-time delivery marker for the final-24-hours trial reminder.
ALTER TABLE "Payment"
ADD COLUMN "trialEndingOneDayEmailSentAt" TIMESTAMP(3);
