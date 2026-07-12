-- Store the Google Calendar event link so buyers can open the booking on the calendar.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "calendarEventLink" TEXT;
