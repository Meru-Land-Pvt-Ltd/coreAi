import { dateOnlyInZone, zonedWallClockToUtc } from "@coreai/shared";
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
  providerName?: string | null;
  startAt: string | Date;
  endAt?: string | Date | null;
  description?: string | null;
  summaryOverride?: string | null;
  reminderMinutes?: number | null | "off";
};

export function buildAppointmentEventContent(input: {
  businessName: string;
  customerName?: string | null;
  customerPhone: string;
  service?: string | null;
  providerName?: string | null;
  description?: string | null;
  summaryOverride?: string | null;
}): { summary: string; description: string } {
  const appointmentService = input.service?.trim() || "Appointment";
  const titleName = input.customerName?.trim() || input.customerPhone;
  const providerName = input.providerName?.trim() || null;
  const summary =
    input.summaryOverride?.trim() ||
    `${appointmentService} - ${titleName}${providerName ? ` with ${providerName}` : ""}`;

  const description =
    input.description ??
    [
      `Booked by Triven AI Receptionist for ${input.businessName}.`,
      input.customerName?.trim() ? `Customer: ${input.customerName.trim()}` : undefined,
      `Customer phone: ${input.customerPhone}`,
      providerName ? `With: ${providerName}` : undefined,
      input.service ? `Service: ${input.service}` : undefined
    ]
      .filter(Boolean)
      .join("\n");

  return { summary, description };
}

/** Google rejects reminders further out than 4 weeks. */
const MAX_REMINDER_MINUTES = 40320;

export type CalendarReminders = {
  reminders?: { useDefault: false; overrides: Array<{ method: "popup" | "email"; minutes: number }> };
};

export function buildEventReminders(reminderMinutes?: number | null | "off"): CalendarReminders {
  if (reminderMinutes === "off") {
    return { reminders: { useDefault: false, overrides: [] } };
  }

  if (typeof reminderMinutes !== "number" || !Number.isFinite(reminderMinutes) || reminderMinutes < 0) {
    return {};
  }

  const minutes = Math.min(Math.round(reminderMinutes), MAX_REMINDER_MINUTES);
  return {
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes },
        { method: "email", minutes }
      ]
    }
  };
}

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// Wall-clock ↔ UTC conversion lives in @coreai/shared (single implementation
// shared with the parser, public booking form, and frontend previews).
export { zonedWallClockToUtc };

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

export async function listCalendarBusyIntervals({
  userId,
  calendarId,
  timeZone,
  date
}: {
  userId: string;
  calendarId?: string | null;
  timeZone: string;
  date: string;
}): Promise<Array<{ start: number; end: number }>> {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const safeCalendarId = calendarId?.trim() || env.GOOGLE_CALENDAR_ID || "primary";

  const dayStart = zonedWallClockToUtc(date, 0, 0, timeZone);
  const dayEnd = zonedWallClockToUtc(date, 23, 59, timeZone);

  const events = await calendar.events.list({
    calendarId: safeCalendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250
  });

  return (events.data.items ?? [])
    .filter((event) => event.transparency !== "transparent" && event.status !== "cancelled")
    .map((event) => ({
      start: new Date(event.start?.dateTime ?? event.start?.date ?? 0).getTime(),
      end: new Date(event.end?.dateTime ?? event.end?.date ?? 0).getTime()
    }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start);
}

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
  const zone = timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  // Tomorrow 9:00 AM as wall-clock time in the target zone — never server-local.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const startAt = zonedWallClockToUtc(dateOnlyInZone(tomorrow, zone), 9, 0, zone);

  return {
    startAt,
    endAt: addMinutes(startAt, 30),
    timeZone: zone
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
  providerName,
  startAt,
  endAt,
  description,
  summaryOverride,
  reminderMinutes
}: CalendarAppointmentInput) {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const startDate = asDate(startAt);
  const endDate = endAt ? asDate(endAt) : addMinutes(startDate, 30);
  const safeCalendarId = calendarId?.trim() || env.GOOGLE_CALENDAR_ID || "primary";
  const safeTimeZone = timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const content = buildAppointmentEventContent({
    businessName,
    customerName,
    customerPhone,
    service,
    providerName,
    description,
    summaryOverride
  });
  const summary = content.summary;

  const response = await calendar.events.insert({
    calendarId: safeCalendarId,
    requestBody: {
      summary,
      description: content.description,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: safeTimeZone
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: safeTimeZone
      },
      ...buildEventReminders(reminderMinutes)
    }
  });

  return {
    id: response.data.id ?? null,
    htmlLink: response.data.htmlLink ?? null,
    calendarId: safeCalendarId,
    summary: response.data.summary ?? summary,
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    timeZone: safeTimeZone
  };
}

function googleApiStatus(error: unknown): number | null {
  const candidate = error as { code?: unknown; response?: { status?: unknown } } | null;
  const code = candidate?.code ?? candidate?.response?.status;
  return typeof code === "number" ? code : Number.isFinite(Number(code)) ? Number(code) : null;
}

export async function rescheduleGoogleCalendarAppointment({
  userId,
  calendarId,
  eventId,
  startAt,
  endAt,
  timeZone
}: {
  userId: string;
  calendarId?: string | null;
  eventId: string;
  startAt: Date;
  endAt: Date;
  timeZone?: string | null;
}): Promise<{ updated: boolean; missing: boolean; htmlLink: string | null }> {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const safeCalendarId = calendarId?.trim() || env.GOOGLE_CALENDAR_ID || "primary";
  const safeTimeZone = timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  try {
    const response = await calendar.events.patch({
      calendarId: safeCalendarId,
      eventId,
      requestBody: {
        start: { dateTime: startAt.toISOString(), timeZone: safeTimeZone },
        end: { dateTime: endAt.toISOString(), timeZone: safeTimeZone }
      }
    });
    return { updated: true, missing: false, htmlLink: response.data.htmlLink ?? null };
  } catch (error) {
    const status = googleApiStatus(error);
    if (status === 404 || status === 410) {
      return { updated: false, missing: true, htmlLink: null };
    }
    throw error;
  }
}

export async function cancelGoogleCalendarAppointment({
  userId,
  calendarId,
  eventId
}: {
  userId: string;
  calendarId?: string | null;
  eventId: string;
}): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const safeCalendarId = calendarId?.trim() || env.GOOGLE_CALENDAR_ID || "primary";

  try {
    await calendar.events.delete({ calendarId: safeCalendarId, eventId });
    return { deleted: true, alreadyGone: false };
  } catch (error) {
    const status = googleApiStatus(error);
    if (status === 404 || status === 410) {
      return { deleted: false, alreadyGone: true };
    }
    throw error;
  }
}

export async function ensureStaffGoogleCalendar({
  userId,
  businessName,
  providerName,
  providerEmail,
  timeZone
}: {
  userId: string;
  businessName: string;
  providerName: string;
  providerEmail?: string | null;
  timeZone?: string | null;
}): Promise<string> {
  const auth = await createAuthorizedGoogleOAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  const safeTimeZone = timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  const targetSummary = `${providerName.trim()} - ${businessName.trim()}`;

  try {
    const listRes = await calendar.calendarList.list({ maxResults: 100 });
    const existing = (listRes.data.items ?? []).find(
      (item) =>
        item.summary?.toLowerCase() === targetSummary.toLowerCase() ||
        item.summary?.toLowerCase() === providerName.trim().toLowerCase()
    );

    let calendarId = existing?.id ?? null;

    if (!calendarId) {
      const created = await calendar.calendars.insert({
        requestBody: {
          summary: targetSummary,
          timeZone: safeTimeZone
        }
      });
      calendarId = created.data.id ?? null;
    }

    if (calendarId && providerEmail && providerEmail.includes("@")) {
      try {
        await calendar.acl.insert({
          calendarId,
          requestBody: {
            role: "writer",
            scope: {
              type: "user",
              value: providerEmail.trim()
            }
          }
        });
      } catch (aclErr) {
        console.warn("[google-calendar] ACL insert warning (email share):", aclErr);
      }
    }

    return calendarId || "primary";
  } catch (error) {
    console.warn("[google-calendar] ensureStaffGoogleCalendar fallback to primary:", error);
    return "primary";
  }
}

