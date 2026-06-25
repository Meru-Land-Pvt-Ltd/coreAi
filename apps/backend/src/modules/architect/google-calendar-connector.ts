import { google } from "googleapis";
import { env } from "../../config/env";
import { createAuthorizedGoogleOAuthClient } from "./gmail-connector";

export type CalendarAppointmentInput = {
  userId: string;
  calendarId?: string | null;
  timeZone?: string | null;
  businessName: string;
  customerName?: string | null;
  customerPhone: string;
  service?: string | null;
  startAt: string | Date;
  endAt?: string | Date | null;
  description?: string | null;
};

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function getDefaultAppointmentWindow(timeZone?: string | null) {
  const startAt = new Date();
  startAt.setDate(startAt.getDate() + 1);
  startAt.setHours(9, 0, 0, 0);

  return {
    startAt,
    endAt: addMinutes(startAt, 30),
    timeZone: timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE
  };
}

export async function createGoogleCalendarAppointment({
  userId,
  calendarId,
  timeZone,
  businessName,
  customerName,
  customerPhone,
  service,
  startAt,
  endAt,
  description
}: CalendarAppointmentInput) {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const startDate = asDate(startAt);
  const endDate = endAt ? asDate(endAt) : addMinutes(startDate, 30);
  const safeCalendarId = calendarId?.trim() || env.GOOGLE_CALENDAR_ID || "primary";
  const safeTimeZone = timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const appointmentService = service?.trim() || "Appointment";
  const titleName = customerName?.trim() || customerPhone;

  const response = await calendar.events.insert({
    calendarId: safeCalendarId,
    requestBody: {
      summary: `${appointmentService} - ${titleName}`,
      description:
        description ??
        [
          `Booked by CORE AI Receptionist for ${businessName}.`,
          `Customer phone: ${customerPhone}`,
          service ? `Service: ${service}` : undefined
        ]
          .filter(Boolean)
          .join("\n"),
      start: {
        dateTime: startDate.toISOString(),
        timeZone: safeTimeZone
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: safeTimeZone
      }
    }
  });

  return {
    id: response.data.id ?? null,
    htmlLink: response.data.htmlLink ?? null,
    calendarId: safeCalendarId,
    summary: response.data.summary ?? `${appointmentService} - ${titleName}`,
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    timeZone: safeTimeZone
  };
}
