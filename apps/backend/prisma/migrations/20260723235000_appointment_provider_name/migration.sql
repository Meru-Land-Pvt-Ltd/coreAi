-- The doctor/practitioner/staff member the customer chose for this booking —
-- preserved across reschedules and included in calendar event title/details.
ALTER TABLE "Appointment" ADD COLUMN "providerName" TEXT;
