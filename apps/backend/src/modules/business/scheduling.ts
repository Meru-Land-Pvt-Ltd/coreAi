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
  open: string;
  close: string;
  closed: boolean;
};

export type SpecialDateOverride = {
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
};

export type AppointmentSchedule = {
  timeZone: string;
  days: Record<Weekday, DayHours>;
  defaultDurationMinutes: number;
  serviceDurations: Record<string, number>;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxSpokenSuggestions: number;
  calendarId: string;
  source: "configured" | "business_hours" | "defaults";
  useBusinessHours: boolean;
  specialDates?: SpecialDateOverride[];
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
  allSlots: AvailabilitySlot[];
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

  const buyerOwnsAppointmentHours = hasStructuredDays && structured.useBusinessHours === false;

  const legacyOpenHour = clampInt(legacyScheduling.openHour, 9, 0, 23);
  const legacyCloseHour = clampInt(legacyScheduling.closeHour, 17, 1, 24);

  const days = {} as Record<Weekday, DayHours>;
  for (const day of WEEKDAYS) {
    const structuredDay = record(structuredDays[day]);
    const apptDay: DayHours | undefined =
      structuredDay.open !== undefined
        ? {
            open: parseHHmm(structuredDay.open) ? String(structuredDay.open) : DEFAULTS.open,
            close: parseHHmm(structuredDay.close) ? String(structuredDay.close) : DEFAULTS.close,
            closed: structuredDay.closed === true
          }
        : undefined;

    if (buyerOwnsAppointmentHours) {
      days[day] = apptDay ?? { open: DEFAULTS.open, close: DEFAULTS.close, closed: true };
    } else if (hasBusinessHours) {
      const businessDay = fromBusinessHours[day] ?? { open: DEFAULTS.open, close: DEFAULTS.close, closed: true };
      const narrowBy = structured.useBusinessHours === true ? undefined : apptDay;
      days[day] = intersectDayHours(businessDay, narrowBy);
    } else if (apptDay) {
      days[day] = apptDay;
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
    source: buyerOwnsAppointmentHours
      ? "configured"
      : hasBusinessHours
        ? "business_hours"
        : hasStructuredDays
          ? "configured"
          : "defaults",
    useBusinessHours: !buyerOwnsAppointmentHours && (hasBusinessHours || !hasStructuredDays),
    confirmed: structured.confirmed === true
  };
}

/** Business hours as the outer boundary — used only for unconfirmed template days. */
function intersectDayHours(businessDay: DayHours, apptDay?: DayHours): DayHours {
  if (businessDay.closed) return { open: businessDay.open, close: businessDay.close, closed: true };
  if (!apptDay) return { ...businessDay };
  if (apptDay.closed) return { open: businessDay.open, close: businessDay.close, closed: true };
  const bOpen = parseHHmm(businessDay.open);
  const bClose = parseHHmm(businessDay.close);
  const aOpen = parseHHmm(apptDay.open);
  const aClose = parseHHmm(apptDay.close);
  if (!bOpen || !bClose || !aOpen || !aClose) return { ...businessDay };
  const openMin = Math.max(bOpen.hour * 60 + bOpen.minute, aOpen.hour * 60 + aOpen.minute);
  const closeMin = Math.min(bClose.hour * 60 + bClose.minute, aClose.hour * 60 + aClose.minute);
  if (openMin >= closeMin) return { open: businessDay.open, close: businessDay.close, closed: true };
  return {
    open: toHHmm(Math.floor(openMin / 60), openMin % 60),
    close: toHHmm(Math.floor(closeMin / 60), closeMin % 60),
    closed: false
  };
}

export function effectiveScheduleDayHours(schedule: AppointmentSchedule, date: string): DayHours {
  const base = schedule.days[weekdayOf(date, schedule.timeZone)];
  const special = schedule.specialDates?.find((entry) => entry.date === date);
  if (!special) return base;
  if (special.closed) return { ...base, closed: true };
  if (!schedule.useBusinessHours) return base;
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

export type CalendarStatus = "connected" | "not_connected" | "needs_reconnect" | "error" | "restricted";

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

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const agentDetails = asRecord(asRecord(agent?.configJson).businessDetails);
  const agentHours = agentDetails.contextVersion === 2 ? agentDetails.hours : undefined;

  const schedule = resolveAppointmentSchedule({
    configJson: agent?.configJson ?? null,
    hoursJson: agentHours !== undefined ? agentHours : business?.profile?.hoursJson ?? null,
    timeZone: business?.profile?.timeZone ?? null,
    calendarId: business?.profile?.calendarId ?? null
  });
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

  return { schedule, installedAgentId: agent?.id ?? null, ownerUserId: business?.ownerId ?? null };
}

async function loadAllBusyIntervals(input: {
  businessId: string;
  ownerUserId: string | null;
  schedule: AppointmentSchedule;
  date: string;
  excludeExternalCalendar?: boolean;
}): Promise<{ busy: BusyInterval[]; calendarStatus: CalendarStatus }> {
  const trivenBusy = await loadTrivenBusyIntervals({
    businessId: input.businessId,
    date: input.date,
    timeZone: input.schedule.timeZone
  });

  if (input.excludeExternalCalendar) {
    return { busy: trivenBusy, calendarStatus: "restricted" };
  }

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
  excludeExternalCalendar?: boolean;
}): Promise<BusinessDayAvailability> {
  const { schedule, ownerUserId } = await resolveScheduleForBusiness(input);
  const { busy, calendarStatus } = await loadAllBusyIntervals({
    businessId: input.businessId,
    ownerUserId,
    schedule,
    date: input.date,
    excludeExternalCalendar: input.excludeExternalCalendar
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
  excludeExternalCalendar?: boolean;
}): Promise<BusinessExactTimeResult> {
  const { schedule, ownerUserId } = await resolveScheduleForBusiness(input);
  const { busy, calendarStatus } = await loadAllBusyIntervals({
    businessId: input.businessId,
    ownerUserId,
    schedule,
    date: input.date,
    excludeExternalCalendar: input.excludeExternalCalendar
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

const DAY_TOKEN =
  "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const TIME_TOKEN = "(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?)";
/** "9–5", "9 to 5", "9 till 5", "9 through 5" — the separator between times. */
const TIME_RANGE_SEP = "(?:[-–—~]|to|until|till|thru|through)";
/** "Mon–Fri", "Mon to Fri", "Mon through Fri" — the separator between days. */
const DAY_RANGE_SEP = "(?:[-–—/]|to|through|thru|till|until)";

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

function parseTimeRangeTokens(openRaw: string, closeRaw: string): { open: string; close: string } | null {
  const open = parseTimeToken(openRaw);
  let close = parseTimeToken(closeRaw);
  if (!open || !close) return null;

  const openMinutes = Number(open.slice(0, 2)) * 60 + Number(open.slice(3));
  let closeMinutes = Number(close.slice(0, 2)) * 60 + Number(close.slice(3));
  const closeHadMeridiem = /am|pm|a\.m\.|p\.m\./i.test(closeRaw);

  if (closeMinutes <= openMinutes && !closeHadMeridiem && Number(close.slice(0, 2)) < 12) {
    closeMinutes += 12 * 60;
    close = `${String(Math.floor(closeMinutes / 60)).padStart(2, "0")}:${close.slice(3)}`;
  }
  if (closeMinutes <= openMinutes) return null;
  return { open, close };
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

function repairSplitDayWords(text: string): string {
  return text.replace(/([A-Za-z]{2,9})[ \t]*\n[ \t]*([a-z]{1,4})\b/g, (full, a: string, b: string) =>
    DAY_ALIASES[(a + b).toLowerCase()] ? a + b : full
  );
}

export type DocumentHoursSuggestion = {
  days: Partial<Record<Weekday, DayHours>>;
  sourceFilename: string | null;
};

const ALL_WEEK: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Day tokens (single or ranged) read from a fragment of text, in order. */
function readDayTargets(fragment: string): Weekday[] {
  const targets: Weekday[] = [];
  const re = new RegExp(`${DAY_TOKEN}(?:\\s*${DAY_RANGE_SEP}\\s*${DAY_TOKEN})?`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment)) !== null) {
    const from = DAY_ALIASES[match[1]?.toLowerCase() ?? ""];
    const to = match[2] ? DAY_ALIASES[match[2].toLowerCase()] : undefined;
    if (!from) continue;
    for (const day of to ? expandDayRange(from, to) : [from]) {
      if (!targets.includes(day)) targets.push(day);
    }
  }
  return targets;
}

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
  // All-week fallbacks ("open daily 9–9") never overwrite an explicit day row.
  const fallbackDays: Partial<Record<Weekday, DayHours>> = {};
  let sourceFilename: string | null = null;

  const inlineRe = new RegExp(
    `${DAY_TOKEN}\\s*(?:${DAY_RANGE_SEP}\\s*${DAY_TOKEN})?\\s*[:,]?\\s*(?:(closed)|${TIME_TOKEN}\\s*${TIME_RANGE_SEP}\\s*${TIME_TOKEN})`,
    "gi"
  );
  const bareRangeRe = new RegExp(`^${TIME_TOKEN}\\s*${TIME_RANGE_SEP}\\s*${TIME_TOKEN}$`, "i");
  const rangeAnywhereRe = new RegExp(`${TIME_TOKEN}\\s*${TIME_RANGE_SEP}\\s*${TIME_TOKEN}`, "i");
  const dayOnlyRe = new RegExp(`^${DAY_TOKEN}(?:\\s*${DAY_RANGE_SEP}\\s*${DAY_TOKEN})?\\s*[:,]?$`, "i");
  const allWeekRe = /\b(daily|all\s+days?|every\s?day|7\s+days(\s+a\s+week)?|week\s?long)\b/i;
  const hoursKeywordRe = /^(?:our\s+)?(?:timings?|opening\s+hours?|working\s+hours?|business\s+hours?|store\s+hours?|clinic\s+hours?|open|we(?:'|\s+a)re\s+open)\b/i;

  const noteSource = (chunk: (typeof chunks)[number]) => {
    sourceFilename ??= chunk.sourceFile?.filename ?? null;
  };

  for (const chunk of chunks) {
    const text = repairSplitDayWords(chunk.content ?? "");
    const lines = text.split("\n").map((line) => line.trim());
    // Day names parked from a day-only table row, waiting for the time line.
    let pendingDays: Weekday[] = [];

    for (const line of lines) {
      if (!line) continue; // blank lines never break a table row apart

      // 1) Day-first on one line: "Mon–Fri: 9 AM – 5 PM", "Sunday Closed".
      inlineRe.lastIndex = 0;
      let matchedInline = false;
      let match: RegExpExecArray | null;
      while ((match = inlineRe.exec(line)) !== null) {
        const from = DAY_ALIASES[match[1]?.toLowerCase() ?? ""];
        const to = match[2] ? DAY_ALIASES[match[2].toLowerCase()] : undefined;
        if (!from) continue;
        const targets = to ? expandDayRange(from, to) : [from];

        if (match[3]) {
          for (const day of targets) days[day] = { open: "09:00", close: "17:00", closed: true };
          matchedInline = true;
          noteSource(chunk);
          continue;
        }

        const range = parseTimeRangeTokens(match[4] ?? "", match[5] ?? "");
        if (!range) continue;
        for (const day of targets) days[day] = { ...range, closed: false };
        matchedInline = true;
        noteSource(chunk);
      }
      if (matchedInline) {
        pendingDays = [];
        continue;
      }

      // 2) Day-only table row: park the days for the next time line.
      if (dayOnlyRe.test(line)) {
        pendingDays = readDayTargets(line);
        continue;
      }

      // 3) Time (or "Closed") line completing a parked table row.
      if (pendingDays.length > 0) {
        if (/^closed\.?$/i.test(line)) {
          for (const day of pendingDays) days[day] = { open: "09:00", close: "17:00", closed: true };
          noteSource(chunk);
          pendingDays = [];
          continue;
        }
        const bare = bareRangeRe.exec(line);
        const range = bare ? parseTimeRangeTokens(bare[1] ?? "", bare[2] ?? "") : null;
        if (range) {
          for (const day of pendingDays) days[day] = { ...range, closed: false };
          noteSource(chunk);
          pendingDays = [];
          continue;
        }
        pendingDays = [];
      }

      // 4) Time-first with days after: "Timings: 10 AM – 8 PM (Mon–Sat)".
      const anywhere = rangeAnywhereRe.exec(line);
      if (anywhere) {
        const range = parseTimeRangeTokens(anywhere[1] ?? "", anywhere[2] ?? "");
        if (range) {
          const after = line.slice((anywhere.index ?? 0) + anywhere[0].length);
          const targets = readDayTargets(after);
          if (targets.length > 0) {
            for (const day of targets) days[day] = { ...range, closed: false };
            noteSource(chunk);
            continue;
          }

          // 5) Whole-week phrasing: "Open daily 9–9", "Timings: 10 AM to 8 PM".
          if (allWeekRe.test(line) || hoursKeywordRe.test(line)) {
            for (const day of ALL_WEEK) fallbackDays[day] = { ...range, closed: false };
            noteSource(chunk);
          }
        }
      }
    }
  }

  // Explicit day rows always beat the whole-week fallback.
  for (const day of ALL_WEEK) {
    if (!days[day] && fallbackDays[day]) days[day] = fallbackDays[day];
  }

  // Confidence bar: at least two weekdays extracted, otherwise no suggestion.
  return Object.keys(days).length >= 2 ? { days, sourceFilename } : null;
}
