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

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Milliseconds to add to a UTC instant to express it as wall-clock in `timeZone`. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

/** Convert a wall-clock time (date + h:m) in `timeZone` to the correct UTC Date. */
export function zonedWallClockToUtc(dateStr: string, hour: number, minute: number, timeZone: string): Date {
  const naiveUtc = new Date(`${dateStr}T${pad2(hour)}:${pad2(minute)}:00Z`);
  const offset = timeZoneOffsetMs(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offset);
}

function formatSlotLabel(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

export type AvailableSlotsInput = {
  userId: string;
  calendarId?: string | null;
  timeZone?: string | null;
  date: string;
  openHour?: number;
  closeHour?: number;
  durationMinutes?: number;
  bufferMinutes?: number;
  maxSlots?: number;
};

/**
 * Compute open appointment slots on `date` from the business's Google Calendar:
 * walk the practice-hours window in (duration + buffer) steps and drop any slot
 * that overlaps an existing event or is in the past. Backs the Vapi
 * `check_availability` tool. Returns wall-clock labels like "10:00 AM".
 */
export async function listAvailableSlots({
  userId,
  calendarId,
  timeZone,
  date,
  openHour = 9,
  closeHour = 17,
  durationMinutes = 30,
  bufferMinutes = 10,
  maxSlots = 3
}: AvailableSlotsInput): Promise<{ date: string; slots: string[]; timeZone: string }> {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const safeCalendarId = calendarId?.trim() || env.GOOGLE_CALENDAR_ID || "primary";
  const safeTimeZone = timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  const dayStart = zonedWallClockToUtc(date, 0, 0, safeTimeZone);
  const dayEnd = zonedWallClockToUtc(date, 23, 59, safeTimeZone);

  const events = await calendar.events.list({
    calendarId: safeCalendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250
  });

  const busy = (events.data.items ?? [])
    .map((event) => ({
      start: new Date(event.start?.dateTime ?? event.start?.date ?? 0).getTime(),
      end: new Date(event.end?.dateTime ?? event.end?.date ?? 0).getTime()
    }))
    .filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end));

  const step = Math.max(durationMinutes + Math.max(bufferMinutes, 0), 5);
  const now = Date.now();
  const slots: string[] = [];

  for (
    let minutes = openHour * 60;
    minutes + durationMinutes <= closeHour * 60 && slots.length < maxSlots;
    minutes += step
  ) {
    const slotStart = zonedWallClockToUtc(date, Math.floor(minutes / 60), minutes % 60, safeTimeZone);
    const startMs = slotStart.getTime();
    const endMs = startMs + durationMinutes * 60 * 1000;
    if (startMs < now) continue;
    const overlaps = busy.some((b) => startMs < b.end && endMs > b.start);
    if (!overlaps) slots.push(formatSlotLabel(slotStart, safeTimeZone));
  }

  return { date, slots, timeZone: safeTimeZone };
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
