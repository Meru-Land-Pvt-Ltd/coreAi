import { zonedWallClockToUtc } from "@coreai/shared";
import { prisma } from "../../lib/prisma";

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type DayHours = {
  /** "HH:mm" 24h wall-clock in the schedule's timezone. */
  open: string;
  close: string;
  closed: boolean;
};

export type SpecialDateOverride = {
  /** "YYYY-MM-DD" in the schedule's timezone. */
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
};

export type AppointmentSchedule = {
  timeZone: string;
  days: Record<Weekday, DayHours>;
  defaultDurationMinutes: number;
  /** Normalized service name → duration minutes. */
  serviceDurations: Record<string, number>;
  bufferMinutes: number;
  /** Distance between candidate start times. */
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  /** Cap for SPOKEN suggestions only — never applied to the computation. */
  maxSpokenSuggestions: number;
  calendarId: string;
  /** Where the hours came from — shown to the buyer for review. */
  source: "configured" | "business_hours" | "defaults";
  useBusinessHours: boolean;
  /** Special-date overrides — only populated when useBusinessHours. */
  specialDates?: SpecialDateOverride[];
  /** Buyer explicitly confirmed the appointment hours. */
  confirmed: boolean;
};

export type BusyInterval = { start: number; end: number };

export type AvailabilitySlot = { startAt: string; label: string; minutes: number };

export type DayAvailability = {
  date: string;
  timeZone: string;
  closed: boolean;
  openLabel: string | null;
  closeLabel: string | null;
  durationMinutes: number;
  /** EVERY free slot for the day — the real availability. */
  allSlots: AvailabilitySlot[];
  /** Balanced sample for conversation (morning/afternoon/evening spread). */
  spokenSlots: AvailabilitySlot[];
};

export type ExactTimeVerdict =
  | "available"
  | "occupied"
  | "outside_hours"
  | "closed_day"
  | "insufficient_time_before_closing"
  | "past"
  | "too_soon"
  | "beyond_advance_limit"
  | "invalid";

/* -------------------------------- helpers -------------------------------- */

const DEFAULTS = {
  open: "09:00",
  close: "17:00",
  durationMinutes: 30,
  bufferMinutes: 10,
  minNoticeMinutes: 60,
  maxAdvanceDays: 60,
  maxSpokenSuggestions: 5
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseHHmm(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function toHHmm(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeServiceName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Weekday of a calendar date in a timezone. */
export function weekdayOf(date: string, timeZone: string): Weekday {
  const noon = zonedWallClockToUtc(date, 12, 0, timeZone);
  const name = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone })
    .format(noon)
    .toLowerCase() as Weekday;
  return WEEKDAYS.includes(name) ? name : "monday";
}

function slotLabel(startAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone
  }).format(startAt);
}

function hourLabel(hhmm: string, date: string, timeZone: string): string {
  const parsed = parseHHmm(hhmm);
  if (!parsed) return hhmm;
  return slotLabel(zonedWallClockToUtc(date, parsed.hour, parsed.minute, timeZone), timeZone);
}

/* --------------------------- schedule resolution --------------------------- */

type HoursJsonRow = { day?: unknown; open?: unknown; close?: unknown; closed?: unknown };

function dayHoursFromBusinessHours(hoursJson: unknown): Partial<Record<Weekday, DayHours>> {
  if (!Array.isArray(hoursJson)) return {};
  const result: Partial<Record<Weekday, DayHours>> = {};
  for (const row of hoursJson as HoursJsonRow[]) {
    const day = String(row?.day ?? "").toLowerCase() as Weekday;
    if (!WEEKDAYS.includes(day)) continue;
    const open = parseHHmm(row?.open) ? String(row!.open) : DEFAULTS.open;
    const close = parseHHmm(row?.close) ? String(row!.close) : DEFAULTS.close;
    result[day] = { open, close, closed: row?.closed === true };
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveAppointmentSchedule(input: {
  configJson: unknown;
  hoursJson?: unknown;
  timeZone?: string | null;
  calendarId?: string | null;
}): AppointmentSchedule {
  const config = record(input.configJson);
  const structured = record(config.appointmentSchedule);
  const legacyScheduling = { ...record(config.dentalConfig), ...record(config.scheduling) };

  const defaultDurationMinutes = clampInt(
    structured.defaultDurationMinutes ??
    legacyScheduling.serviceDurationMinutes ??
    legacyScheduling.defaultDurationMinutes,
    DEFAULTS.durationMinutes,
    5,
    480
  );
  const bufferMinutes = clampInt(
    structured.bufferMinutes ?? legacyScheduling.bufferMinutes,
    DEFAULTS.bufferMinutes,
    0,
    120
  );

  const serviceDurations: Record<string, number> = {};
  for (const [name, minutes] of Object.entries(record(structured.serviceDurations))) {
    const normalized = normalizeServiceName(name);
    const value = clampInt(minutes, 0, 5, 480);
    if (normalized && value >= 5) serviceDurations[normalized] = value;
  }

  const fromBusinessHours = dayHoursFromBusinessHours(input.hoursJson);
  const structuredDays = record(structured.days);
  const hasStructuredDays = WEEKDAYS.some((day) => record(structuredDays[day]).open !== undefined);
  const hasBusinessHours = Object.keys(fromBusinessHours).length > 0;

  const inheritsBusinessHours = structured.useBusinessHours === true;
  const useStructuredDays = hasStructuredDays && !inheritsBusinessHours;

  // Legacy single open/close (configJson.scheduling.openHour/closeHour) only
  // applies when neither structured days nor business hours exist.
  const legacyOpenHour = clampInt(legacyScheduling.openHour, 9, 0, 23);
  const legacyCloseHour = clampInt(legacyScheduling.closeHour, 17, 1, 24);

  const days = {} as Record<Weekday, DayHours>;
  for (const day of WEEKDAYS) {
    const structuredDay = record(structuredDays[day]);
    if (useStructuredDays) {
      const open = parseHHmm(structuredDay.open) ? String(structuredDay.open) : DEFAULTS.open;
      const close = parseHHmm(structuredDay.close) ? String(structuredDay.close) : DEFAULTS.close;
      days[day] = { open, close, closed: structuredDay.closed === true };
    } else if (hasBusinessHours) {
      days[day] =
        fromBusinessHours[day] ??
        // A weekday absent from saved business hours is treated as closed —
        // the buyer listed the days they are open.
        { open: DEFAULTS.open, close: DEFAULTS.close, closed: true };
    } else {
      days[day] = {
        open: toHHmm(legacyOpenHour),
        close: toHHmm(Math.min(legacyCloseHour, 23), legacyCloseHour === 24 ? 59 : 0),
        closed: day === "sunday"
      };
    }
  }

  const slotIntervalMinutes = clampInt(
    structured.slotIntervalMinutes,
    defaultDurationMinutes + bufferMinutes,
    5,
    240
  );

  return {
    timeZone: (input.timeZone ?? "").trim() || "America/Los_Angeles",
    days,
    defaultDurationMinutes,
    serviceDurations,
    bufferMinutes,
    slotIntervalMinutes,
    minNoticeMinutes: clampInt(structured.minNoticeMinutes, DEFAULTS.minNoticeMinutes, 0, 7 * 24 * 60),
    maxAdvanceDays: clampInt(structured.maxAdvanceDays, DEFAULTS.maxAdvanceDays, 1, 365),
    maxSpokenSuggestions: clampInt(
      structured.maxSpokenSuggestions ??
      legacyScheduling.maximumSlotsToShow ??
      legacyScheduling.maxSlotsToShow ??
      legacyScheduling.slotsToOffer,
      DEFAULTS.maxSpokenSuggestions,
      2,
      10
    ),
    calendarId: (input.calendarId ?? "").trim() || "primary",
    source: useStructuredDays ? "configured" : hasBusinessHours ? "business_hours" : "defaults",
    useBusinessHours: !useStructuredDays,
    confirmed: structured.confirmed === true
  };
}

export function effectiveScheduleDayHours(schedule: AppointmentSchedule, date: string): DayHours {
  const base = schedule.days[weekdayOf(date, schedule.timeZone)];
  const special = schedule.specialDates?.find((entry) => entry.date === date);
  if (!special) return base;
  if (special.closed) return { ...base, closed: true };
  return {
    open: special.open ?? base.open,
    close: special.close ?? base.close,
    closed: false
  };
}

/** Duration for a (possibly speech-mangled) service name. */
export function serviceDurationFor(schedule: AppointmentSchedule, serviceName?: string | null): number {
  const normalized = normalizeServiceName(serviceName);
  if (!normalized) return schedule.defaultDurationMinutes;
  if (schedule.serviceDurations[normalized]) return schedule.serviceDurations[normalized];

  // "dental cleaning" / "teeth cleaning" / "cleaning appointment" → "cleaning".
  for (const [known, minutes] of Object.entries(schedule.serviceDurations)) {
    if (normalized.includes(known) || known.includes(normalized)) return minutes;
  }
  return schedule.defaultDurationMinutes;
}

/* ------------------------------ availability ------------------------------ */

export function overlapsBusy(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  return busy.some((interval) => startMs < interval.end && endMs > interval.start);
}

export function computeDayAvailability(input: {
  schedule: AppointmentSchedule;
  date: string;
  serviceName?: string | null;
  busy: BusyInterval[];
  now?: Date;
}): DayAvailability {
  const { schedule, date, busy } = input;
  const now = input.now ?? new Date();
  const hours = effectiveScheduleDayHours(schedule, date);
  const durationMinutes = serviceDurationFor(schedule, input.serviceName);

  const base: DayAvailability = {
    date,
    timeZone: schedule.timeZone,
    closed: hours.closed,
    openLabel: hours.closed ? null : hourLabel(hours.open, date, schedule.timeZone),
    closeLabel: hours.closed ? null : hourLabel(hours.close, date, schedule.timeZone),
    durationMinutes,
    allSlots: [],
    spokenSlots: []
  };

  if (hours.closed) return base;

  const open = parseHHmm(hours.open) ?? { hour: 9, minute: 0 };
  const close = parseHHmm(hours.close) ?? { hour: 17, minute: 0 };
  const openMinutes = open.hour * 60 + open.minute;
  const closeMinutes = close.hour * 60 + close.minute;
  const earliestStartMs = now.getTime() + schedule.minNoticeMinutes * 60_000;

  for (
    let minutes = openMinutes;
    minutes + durationMinutes <= closeMinutes;
    minutes += schedule.slotIntervalMinutes
  ) {
    const startAt = zonedWallClockToUtc(date, Math.floor(minutes / 60), minutes % 60, schedule.timeZone);
    const startMs = startAt.getTime();
    const endMs = startMs + durationMinutes * 60_000;
    // Buffer keeps a gap on both sides of existing events.
    const paddedStart = startMs - schedule.bufferMinutes * 60_000;
    const paddedEnd = endMs + schedule.bufferMinutes * 60_000;

    if (startMs < earliestStartMs) continue;
    if (overlapsBusy(paddedStart, paddedEnd, busy)) continue;

    base.allSlots.push({
      startAt: startAt.toISOString(),
      label: slotLabel(startAt, schedule.timeZone),
      minutes
    });
  }

  base.spokenSlots = selectSpokenSuggestions(base.allSlots, schedule.maxSpokenSuggestions);
  return base;
}

export function selectSpokenSuggestions(
  allSlots: AvailabilitySlot[],
  max: number
): AvailabilitySlot[] {
  if (allSlots.length <= max) return [...allSlots];
  const picks = new Set<number>();
  picks.add(0);
  picks.add(allSlots.length - 1);
  const between = max - 2;
  for (let i = 1; i <= between; i++) {
    picks.add(Math.round((i * (allSlots.length - 1)) / (between + 1)));
  }
  return [...picks].sort((a, b) => a - b).map((index) => allSlots[index]);
}

/** Truthful verdict for one exact requested time. */
export function checkExactTime(input: {
  schedule: AppointmentSchedule;
  date: string;
  hour: number;
  minute: number;
  serviceName?: string | null;
  busy: BusyInterval[];
  now?: Date;
}): { verdict: ExactTimeVerdict; startAt: string | null; closeLabel: string | null; durationMinutes: number } {
  const { schedule, date, hour, minute } = input;
  const now = input.now ?? new Date();
  const durationMinutes = serviceDurationFor(schedule, input.serviceName);

  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { verdict: "invalid", startAt: null, closeLabel: null, durationMinutes };
  }

  const hours = effectiveScheduleDayHours(schedule, date);
  const closeLabel = hours.closed ? null : hourLabel(hours.close, date, schedule.timeZone);

  if (hours.closed) return { verdict: "closed_day", startAt: null, closeLabel, durationMinutes };

  const startAt = zonedWallClockToUtc(date, hour, minute, schedule.timeZone);
  const startMs = startAt.getTime();

  if (startMs < now.getTime()) {
    return { verdict: "past", startAt: startAt.toISOString(), closeLabel, durationMinutes };
  }
  if (startMs < now.getTime() + schedule.minNoticeMinutes * 60_000) {
    return { verdict: "too_soon", startAt: startAt.toISOString(), closeLabel, durationMinutes };
  }
  if (startMs > now.getTime() + schedule.maxAdvanceDays * 24 * 60 * 60_000) {
    return { verdict: "beyond_advance_limit", startAt: startAt.toISOString(), closeLabel, durationMinutes };
  }

  const open = parseHHmm(hours.open)!;
  const close = parseHHmm(hours.close)!;
  const requestedMinutes = hour * 60 + minute;
  const openMinutes = open.hour * 60 + open.minute;
  const closeMinutes = close.hour * 60 + close.minute;

  if (requestedMinutes < openMinutes || requestedMinutes >= closeMinutes) {
    return { verdict: "outside_hours", startAt: startAt.toISOString(), closeLabel, durationMinutes };
  }
  if (requestedMinutes + durationMinutes > closeMinutes) {
    return {
      verdict: "insufficient_time_before_closing",
      startAt: startAt.toISOString(),
      closeLabel,
      durationMinutes
    };
  }

  const endMs = startMs + durationMinutes * 60_000;
  const paddedStart = startMs - input.schedule.bufferMinutes * 60_000;
  const paddedEnd = endMs + input.schedule.bufferMinutes * 60_000;
  if (overlapsBusy(paddedStart, paddedEnd, input.busy)) {
    return { verdict: "occupied", startAt: startAt.toISOString(), closeLabel, durationMinutes };
  }

  return { verdict: "available", startAt: startAt.toISOString(), closeLabel, durationMinutes };
}

/* ------------------------------ busy loading ------------------------------ */

/** Triven's own (non-cancelled, LIVE) appointments as busy intervals. */
export async function loadTrivenBusyIntervals(input: {
  businessId: string;
  date: string;
  timeZone: string;
}): Promise<BusyInterval[]> {
  const dayStart = zonedWallClockToUtc(input.date, 0, 0, input.timeZone);
  const dayEnd = zonedWallClockToUtc(input.date, 23, 59, input.timeZone);

  const appointments = await prisma.appointment.findMany({
    where: {
      businessId: input.businessId,
      executionMode: "LIVE",
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
      NOT: { status: { in: ["CANCELLED", "CANCELED"] } }
    },
    select: { startAt: true, endAt: true }
  });

  return appointments.map((appointment) => ({
    start: appointment.startAt.getTime(),
    end: appointment.endAt.getTime()
  }));
}

/* --------------------------- DB-level orchestration ------------------------ */

import { classifyCalendarError } from "../architect/calendar-errors";
import { listCalendarBusyIntervals } from "../architect/google-calendar-connector";

export type CalendarStatus = "connected" | "not_connected" | "needs_reconnect" | "error";

/** Resolve the schedule for a business's testable/live agent (agent-scoped). */
export async function resolveScheduleForBusiness(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<{ schedule: AppointmentSchedule; installedAgentId: string | null; ownerUserId: string | null }> {
  const [business, agent] = await Promise.all([
    prisma.business.findUnique({
      where: { id: input.businessId },
      select: { ownerId: true, profile: { select: { hoursJson: true, timeZone: true, calendarId: true } } }
    }),
    input.installedAgentId
      ? prisma.installedAgent.findFirst({
        where: { id: input.installedAgentId, businessId: input.businessId },
        select: { id: true, configJson: true }
      })
      : prisma.installedAgent.findFirst({
        where: { businessId: input.businessId, status: { in: ["ACTIVE", "PROVISIONING"] } },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        select: { id: true, configJson: true }
      })
  ]);

  const schedule = resolveAppointmentSchedule({
    configJson: agent?.configJson ?? null,
    hoursJson: business?.profile?.hoursJson ?? null,
    timeZone: business?.profile?.timeZone ?? null,
    calendarId: business?.profile?.calendarId ?? null
  });

  if (schedule.useBusinessHours) {
    const specialRows = await prisma.businessSpecialHours.findMany({
      where: { businessId: input.businessId },
      select: { date: true, closed: true, periodsJson: true }
    });
    if (specialRows.length > 0) {
      schedule.specialDates = specialRows.map((row) => {
        const periods = Array.isArray(row.periodsJson)
          ? (row.periodsJson as Array<{ open?: unknown; close?: unknown }>)
          : [];
        const first = periods[0];
        const last = periods[periods.length - 1];
        return {
          date: row.date,
          closed: row.closed,
          ...(!row.closed && parseHHmm(first?.open) ? { open: String(first!.open) } : {}),
          ...(!row.closed && parseHHmm(last?.close) ? { close: String(last!.close) } : {})
        };
      });
    }
  }

  return { schedule, installedAgentId: agent?.id ?? null, ownerUserId: business?.ownerId ?? null };
}

async function loadAllBusyIntervals(input: {
  businessId: string;
  ownerUserId: string | null;
  schedule: AppointmentSchedule;
  date: string;
}): Promise<{ busy: BusyInterval[]; calendarStatus: CalendarStatus }> {
  const trivenBusy = await loadTrivenBusyIntervals({
    businessId: input.businessId,
    date: input.date,
    timeZone: input.schedule.timeZone
  });

  if (!input.ownerUserId) {
    return { busy: trivenBusy, calendarStatus: "not_connected" };
  }

  try {
    const googleBusy = await listCalendarBusyIntervals({
      userId: input.ownerUserId,
      calendarId: input.schedule.calendarId,
      timeZone: input.schedule.timeZone,
      date: input.date
    });
    return { busy: [...trivenBusy, ...googleBusy], calendarStatus: "connected" };
  } catch (error) {
    const classified = classifyCalendarError(error, "availability");
    const calendarStatus: CalendarStatus =
      classified.code === "CALENDAR_NOT_CONNECTED"
        ? "not_connected"
        : classified.code === "CALENDAR_TOKEN_EXPIRED" || classified.code === "CALENDAR_REAUTH_REQUIRED"
          ? "needs_reconnect"
          : "error";
    // NEVER fabricate availability on calendar failure — the caller reports
    // that live availability cannot be confirmed right now.
    return { busy: trivenBusy, calendarStatus };
  }
}

export type BusinessDayAvailability = DayAvailability & {
  calendarStatus: CalendarStatus;
  totalFreeSlots: number;
};

/** Full-day availability for one business/agent — demo, live, and booking all use this. */
export async function computeBusinessAvailability(input: {
  businessId: string;
  installedAgentId?: string | null;
  date: string;
  serviceName?: string | null;
  now?: Date;
}): Promise<BusinessDayAvailability> {
  const { schedule, ownerUserId } = await resolveScheduleForBusiness(input);
  const { busy, calendarStatus } = await loadAllBusyIntervals({
    businessId: input.businessId,
    ownerUserId,
    schedule,
    date: input.date
  });

  const day = computeDayAvailability({
    schedule,
    date: input.date,
    serviceName: input.serviceName,
    busy,
    now: input.now
  });

  return { ...day, calendarStatus, totalFreeSlots: day.allSlots.length };
}

export type BusinessExactTimeResult = {
  verdict: ExactTimeVerdict;
  startAt: string | null;
  closeLabel: string | null;
  durationMinutes: number;
  calendarStatus: CalendarStatus;
  /** Nearby alternatives when the requested time is not available. */
  alternatives: AvailabilitySlot[];
};

/** Direct truthful check of one requested time — the "Is 5 PM available?" path. */
export async function checkBusinessExactTime(input: {
  businessId: string;
  installedAgentId?: string | null;
  date: string;
  hour: number;
  minute: number;
  serviceName?: string | null;
  now?: Date;
}): Promise<BusinessExactTimeResult> {
  const { schedule, ownerUserId } = await resolveScheduleForBusiness(input);
  const { busy, calendarStatus } = await loadAllBusyIntervals({
    businessId: input.businessId,
    ownerUserId,
    schedule,
    date: input.date
  });

  const result = checkExactTime({
    schedule,
    date: input.date,
    hour: input.hour,
    minute: input.minute,
    serviceName: input.serviceName,
    busy,
    now: input.now
  });

  let alternatives: AvailabilitySlot[] = [];
  if (result.verdict !== "available") {
    const day = computeDayAvailability({
      schedule,
      date: input.date,
      serviceName: input.serviceName,
      busy,
      now: input.now
    });
    // Closest-first alternatives around the requested time.
    const requestedMinutes = input.hour * 60 + input.minute;
    alternatives = [...day.allSlots]
      .sort((a, b) => Math.abs(a.minutes - requestedMinutes) - Math.abs(b.minutes - requestedMinutes))
      .slice(0, 3)
      .sort((a, b) => a.minutes - b.minutes);
  }

  return { ...result, calendarStatus, alternatives };
}

export async function revalidateAndReserveSlot<T>(input: {
  businessId: string;
  installedAgentId?: string | null;
  date: string;
  hour: number;
  minute: number;
  serviceName?: string | null;
  now?: Date;
  createBooking: () => Promise<T>;
}): Promise<
  | { ok: true; booking: T; startAt: string; durationMinutes: number }
  | { ok: false; result: BusinessExactTimeResult }
> {
  const lockKey = `booking:${input.businessId}:${input.date}:${input.hour}:${input.minute}`;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const check = await checkBusinessExactTime(input);
      if (check.verdict !== "available" || !check.startAt) {
        return { ok: false as const, result: check };
      }

      const booking = await input.createBooking();
      return { ok: true as const, booking, startAt: check.startAt, durationMinutes: check.durationMinutes };
    },
    { timeout: 20_000 }
  );
}

/* ------------------------ brochure hours extraction ------------------------ */

const DAY_ALIASES: Record<string, Weekday> = {
  sun: "sunday", sunday: "sunday",
  mon: "monday", monday: "monday",
  tue: "tuesday", tues: "tuesday", tuesday: "tuesday",
  wed: "wednesday", weds: "wednesday", wednesday: "wednesday",
  thu: "thursday", thur: "thursday", thurs: "thursday", thursday: "thursday",
  fri: "friday", friday: "friday",
  sat: "saturday", saturday: "saturday"
};

function parseTimeToken(token: string): string | null {
  const match = token.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = (match[3] ?? "").replace(/\./g, "");
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function expandDayRange(from: Weekday, to: Weekday): Weekday[] {
  // Business ranges read Monday-first ("Mon–Fri", "Fri–Sun").
  const order: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return [];
  if (start <= end) return order.slice(start, end + 1);
  return [...order.slice(start), ...order.slice(0, end + 1)];
}

export type DocumentHoursSuggestion = {
  days: Partial<Record<Weekday, DayHours>>;
  sourceFilename: string | null;
};

/**
 * Best-effort opening-hours extraction from uploaded document chunks
 * ("Monday – Friday: 8:00 AM – 6:00 PM", "Sunday: Closed"). Returned as a
 * SUGGESTION only — it becomes the appointment schedule exclusively after the
 * buyer reviews and confirms it in setup; it never overrides settings itself.
 */
export async function extractHoursFromDocuments(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<DocumentHoursSuggestion | null> {
  const chunks = await prisma.businessKnowledgeBase.findMany({
    where: {
      businessId: input.businessId,
      sourceFileId: { not: null },
      ...(input.installedAgentId === undefined
        ? {}
        : { OR: [{ installedAgentId: null }, { installedAgentId: input.installedAgentId }] })
    },
    select: { content: true, sourceFile: { select: { filename: true } } },
    orderBy: { createdAt: "asc" }
  });

  const days: Partial<Record<Weekday, DayHours>> = {};
  let sourceFilename: string | null = null;

  const dayToken = "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
  const timeToken = "(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?)";
  const lineRe = new RegExp(
    `${dayToken}\\s*(?:[-–—to]+\\s*${dayToken})?\\s*[:,]?\\s*(?:(closed)|${timeToken}\\s*(?:[-–—]|to)\\s*${timeToken})`,
    "gi"
  );

  for (const chunk of chunks) {
    for (const line of (chunk.content ?? "").split("\n")) {
      lineRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = lineRe.exec(line)) !== null) {
        const fromDay = DAY_ALIASES[match[1]?.toLowerCase() ?? ""];
        const toDay = match[2] ? DAY_ALIASES[match[2].toLowerCase()] : undefined;
        if (!fromDay) continue;
        const targets = toDay ? expandDayRange(fromDay, toDay) : [fromDay];

        if (match[3]) {
          for (const day of targets) days[day] = { open: "09:00", close: "17:00", closed: true };
          sourceFilename ??= chunk.sourceFile?.filename ?? null;
          continue;
        }

        const open = parseTimeToken(match[4] ?? "");
        const close = parseTimeToken(match[5] ?? "");
        if (!open || !close) continue;
        for (const day of targets) days[day] = { open, close, closed: false };
        sourceFilename ??= chunk.sourceFile?.filename ?? null;
      }
    }
  }

  // Confidence bar: at least two weekdays extracted, otherwise no suggestion.
  return Object.keys(days).length >= 2 ? { days, sourceFilename } : null;
}
