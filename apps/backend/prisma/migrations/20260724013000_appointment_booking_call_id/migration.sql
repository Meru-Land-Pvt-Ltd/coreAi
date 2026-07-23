-- Canonical booking↔call link: consent and confirmation tools resolve the
-- exact SMS recipient from the appointment created on THIS call instead of
-- independently re-normalizing a phone number.
ALTER TABLE "Appointment" ADD COLUMN "bookingCallId" TEXT;

CREATE INDEX "Appointment_bookingCallId_idx" ON "Appointment"("bookingCallId");
