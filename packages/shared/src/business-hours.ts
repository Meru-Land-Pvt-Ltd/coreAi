/**
 * Canonical structured Business Hours engine.
 *
 * One weekly schedule shape is shared by the editor UI, the setup/settings
 * endpoints, the agent prompt, the live answering decision, and the runtime
 * fact lookup — so the demo, voice tests, and live calls always agree.
 *
 * Storage stays on BusinessProfile.hoursJson. Two row shapes are accepted:
 *  - legacy: { day, open, close, closed }
 *  - structured: { day, closed, periods: [{open, close}, …], note? }
 * The writer keeps `open`/`close` mirrored to the first/last period so older
 * readers (appointment fallback, legacy prompts) keep working.
 *
 * All times are "HH:mm" 24h wall-clock strings in the business timezone.
 * Hours are never invented: when nothing is configured the engine reports
 * "unconfigured" and callers must say hours are not confirmed.
 */

export const BUSINESS_WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;

export type BusinessWeekday = (typeof BUSINESS_WEEK_DAYS)[number];

export type HoursPeriod = {
  /** "HH:mm" 24h. */
  open: string;
  close: string;
};

export type BusinessHoursDay = {
  day: BusinessWeekday;
  closed: boolean;
  /** Working periods in order; two periods = a break between them. */
  periods: HoursPeriod[];
  /** Optional note, e.g. "Emergency appointments only". */
  note?: string;
};

export type WeeklyHours = BusinessHoursDay[];

export type SpecialHoursKind = "holiday" | "special" | "closure";

export type SpecialHoursEntry = {
  /** Calendar date "YYYY-MM-DD" in the business timezone. */
  date: string;
  closed: boolean;
  periods: HoursPeriod[];
  note?: string;
  kind: SpecialHoursKind;
};

/* --------------------------------- parsing -------------------------------- */

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseHHmmToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(HHMM_RE);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutes12h(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12} ${meridiem}` : `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function normalizePeriod(value: unknown): HoursPeriod | null {
  const row = value as { open?: unknown; close?: unknown } | null;
  const open = parseHHmmToMinutes(row?.open);
  const close = parseHHmmToMinutes(row?.close);
  if (open === null || close === null) return null;
  return { open: String(row!.open).trim(), close: String(row!.close).trim() };
}

/** Accepts legacy and structured rows; returns null when nothing usable is stored. */
export function normalizeWeeklyHours(hoursJson: unknown): WeeklyHours | null {
  if (!Array.isArray(hoursJson) || hoursJson.length === 0) return null;

  const byDay = new Map<BusinessWeekday, BusinessHoursDay>();

  for (const raw of hoursJson) {
    const row = raw as {
      day?: unknown;
      open?: unknown;
      close?: unknown;
      closed?: unknown;
      periods?: unknown;
      note?: unknown;
    } | null;
    const day = String(row?.day ?? "").toLowerCase() as BusinessWeekday;
    if (!BUSINESS_WEEK_DAYS.includes(day)) continue;

    const closed = row?.closed === true;
    let periods: HoursPeriod[] = [];

    if (Array.isArray(row?.periods)) {
      periods = (row!.periods as unknown[]).map(normalizePeriod).filter((p): p is HoursPeriod => p !== null);
    }
    if (periods.length === 0) {
      const single = normalizePeriod({ open: row?.open, close: row?.close });
      if (single) periods = [single];
    }

    const note = typeof row?.note === "string" && row.note.trim() ? row.note.trim() : undefined;
    byDay.set(day, { day, closed, periods: closed ? [] : periods, ...(note ? { note } : {}) });
  }

  if (byDay.size === 0) return null;

  // Days the buyer did not list are closed — they listed the days they operate.
  return BUSINESS_WEEK_DAYS.map(
    (day) => byDay.get(day) ?? { day, closed: true, periods: [] }
  );
}

/** True when at least one day is open with a valid period. */
export function hasConfiguredHours(weekly: WeeklyHours | null): boolean {
  return Boolean(weekly?.some((day) => !day.closed && day.periods.length > 0));
}

/**
 * Serialize for storage: structured `periods` plus mirrored legacy
 * `open`/`close` (first open → last close) so older readers keep working.
 */
export function toStoredHoursJson(weekly: WeeklyHours): Array<Record<string, unknown>> {
  return weekly.map((day) => {
    const first = day.periods[0];
    const last = day.periods[day.periods.length - 1];
    return {
      day: day.day,
      closed: day.closed,
      periods: day.periods.map((period) => ({ open: period.open, close: period.close })),
      ...(day.note ? { note: day.note } : {}),
      ...(first && last && !day.closed ? { open: first.open, close: last.close } : {})
    };
  });
}

/* ------------------------------- validation ------------------------------- */

export type HoursValidationIssue = { day?: BusinessWeekday; date?: string; message: string };

function validatePeriods(periods: HoursPeriod[]): string[] {
  const issues: string[] = [];
  const spans: Array<{ start: number; end: number }> = [];

  for (const period of periods) {
    const start = parseHHmmToMinutes(period.open);
    const end = parseHHmmToMinutes(period.close);
    if (start === null || end === null) {
      issues.push("Times must use HH:mm format");
      continue;
    }
    if (end <= start) {
      issues.push(`Closing time ${formatMinutes12h(end)} must be after opening time ${formatMinutes12h(start)}`);
      continue;
    }
    spans.push({ start, end });
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      issues.push("Working periods must not overlap");
      break;
    }
  }

  return issues;
}

export function validateWeeklyHours(weekly: WeeklyHours): HoursValidationIssue[] {
  const issues: HoursValidationIssue[] = [];

  for (const day of weekly) {
    if (day.closed) continue;
    if (day.periods.length === 0) {
      issues.push({ day: day.day, message: "Open days need at least one working period" });
      continue;
    }
    for (const message of validatePeriods(day.periods)) {
      issues.push({ day: day.day, message });
    }
  }

  return issues;
}

export function validateSpecialHours(entries: SpecialHoursEntry[]): HoursValidationIssue[] {
  const issues: HoursValidationIssue[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!DATE_RE.test(entry.date)) {
      issues.push({ date: entry.date, message: "Dates must use YYYY-MM-DD format" });
      continue;
    }
    if (seen.has(entry.date)) {
      issues.push({ date: entry.date, message: "Duplicate special-hours date" });
      continue;
    }
    seen.add(entry.date);

    if (!entry.closed) {
      if (entry.periods.length === 0) {
        issues.push({ date: entry.date, message: "Special open days need at least one period" });
        continue;
      }
      for (const message of validatePeriods(entry.periods)) {
        issues.push({ date: entry.date, message });
      }
    }
  }

  return issues;
}

export function isValidIanaTimeZone(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ date helpers ------------------------------ */

/** "YYYY-MM-DD" of `now` in a timezone. */
export function dateInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function weekdayOfDate(date: string, timeZone: string): BusinessWeekday {
  // Noon UTC of the calendar date is the same calendar date in every timezone
  // when formatted with that date's own zone — weekday only needs the date.
  const probe = new Date(`${date}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
    .format(probe)
    .toLowerCase() as BusinessWeekday;
  return BUSINESS_WEEK_DAYS.includes(name) ? name : "monday";
}

export function addDaysToDate(date: string, days: number): string {
  const probe = new Date(`${date}T12:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() + days);
  return probe.toISOString().slice(0, 10);
}

/** Wall-clock minutes since midnight of `now` in a timezone. */
export function minutesOfDayInTimeZone(timeZone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/* --------------------------- effective schedule ---------------------------- */

export type EffectiveDayHours = {
  date: string;
  weekday: BusinessWeekday;
  closed: boolean;
  periods: HoursPeriod[];
  note?: string;
  /** Where these hours came from for this date. */
  source: "special" | "weekly" | "unconfigured";
};

/** Hours in effect for one calendar date — special entries override the week. */
export function effectiveHoursForDate(input: {
  weekly: WeeklyHours | null;
  special?: SpecialHoursEntry[] | null;
  date: string;
  timeZone: string;
}): EffectiveDayHours {
  const weekday = weekdayOfDate(input.date, input.timeZone);
  const special = input.special?.find((entry) => entry.date === input.date);

  if (special) {
    return {
      date: input.date,
      weekday,
      closed: special.closed,
      periods: special.closed ? [] : special.periods,
      ...(special.note ? { note: special.note } : {}),
      source: "special"
    };
  }

  const day = input.weekly?.find((row) => row.day === weekday);
  if (!day || !hasConfiguredHours(input.weekly)) {
    return { date: input.date, weekday, closed: true, periods: [], source: "unconfigured" };
  }

  return {
    date: input.date,
    weekday,
    closed: day.closed,
    periods: day.closed ? [] : day.periods,
    ...(day.note ? { note: day.note } : {}),
    source: "weekly"
  };
}

export type BusinessOpenStatus = {
  /** "unknown" = hours not configured — never guess. */
  state: "open" | "closed" | "unknown";
  timeZone: string;
  date: string;
  weekday: BusinessWeekday;
  /** Set when open: today's period being served. */
  closesAt?: string;
  /** Set when closed but reopening later today. */
  reopensTodayAt?: string;
  /** Next opening after now (may be today or a later day). */
  nextOpen?: { date: string; weekday: BusinessWeekday; opensAt: string; isToday: boolean };
  today: EffectiveDayHours;
};

/** Truthful "are you open right now" with next-opening lookup (3 weeks ahead). */
export function businessOpenStatus(input: {
  weekly: WeeklyHours | null;
  special?: SpecialHoursEntry[] | null;
  timeZone: string;
  now?: Date;
}): BusinessOpenStatus {
  const now = input.now ?? new Date();
  const date = dateInTimeZone(input.timeZone, now);
  const today = effectiveHoursForDate({ ...input, date });

  if (today.source === "unconfigured" && !input.special?.length && !hasConfiguredHours(input.weekly)) {
    return { state: "unknown", timeZone: input.timeZone, date, weekday: today.weekday, today };
  }

  const nowMinutes = minutesOfDayInTimeZone(input.timeZone, now);

  if (!today.closed) {
    for (const period of today.periods) {
      const open = parseHHmmToMinutes(period.open)!;
      const close = parseHHmmToMinutes(period.close)!;
      if (nowMinutes >= open && nowMinutes < close) {
        return {
          state: "open",
          timeZone: input.timeZone,
          date,
          weekday: today.weekday,
          closesAt: formatMinutes12h(close),
          today
        };
      }
    }

    // Closed at this moment — maybe a break or before opening.
    const upcoming = today.periods
      .map((period) => parseHHmmToMinutes(period.open)!)
      .filter((open) => open > nowMinutes)
      .sort((a, b) => a - b)[0];
    if (upcoming !== undefined) {
      return {
        state: "closed",
        timeZone: input.timeZone,
        date,
        weekday: today.weekday,
        reopensTodayAt: formatMinutes12h(upcoming),
        nextOpen: { date, weekday: today.weekday, opensAt: formatMinutes12h(upcoming), isToday: true },
        today
      };
    }
  }

  // Closed for the rest of today — find the next open day.
  for (let offset = 1; offset <= 21; offset++) {
    const candidateDate = addDaysToDate(date, offset);
    const candidate = effectiveHoursForDate({ ...input, date: candidateDate });
    if (!candidate.closed && candidate.periods.length > 0) {
      const opensAt = formatMinutes12h(parseHHmmToMinutes(candidate.periods[0].open)!);
      return {
        state: "closed",
        timeZone: input.timeZone,
        date,
        weekday: today.weekday,
        nextOpen: { date: candidateDate, weekday: candidate.weekday, opensAt, isToday: false },
        today
      };
    }
  }

  return { state: "closed", timeZone: input.timeZone, date, weekday: today.weekday, today };
}

/* ------------------------------- formatting -------------------------------- */

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatPeriodsLabel(periods: HoursPeriod[]): string {
  return periods
    .map(
      (period) =>
        `${formatMinutes12h(parseHHmmToMinutes(period.open) ?? 0)}–${formatMinutes12h(parseHHmmToMinutes(period.close) ?? 0)}`
    )
    .join(", ");
}

/** "Monday: 9 AM–1 PM, 3 PM–6 PM (Emergency only)" per day; null when unconfigured. */
export function formatWeeklySummaryLines(weekly: WeeklyHours | null): string[] | null {
  if (!hasConfiguredHours(weekly)) return null;

  return (weekly ?? []).map((day) => {
    const label = capitalize(day.day);
    if (day.closed || day.periods.length === 0) return `${label}: Closed`;
    const note = day.note ? ` (${day.note})` : "";
    return `${label}: ${formatPeriodsLabel(day.periods)}${note}`;
  });
}

export function formatSpecialHoursLines(entries: SpecialHoursEntry[]): string[] {
  return entries.map((entry) => {
    const note = entry.note ? ` (${entry.note})` : "";
    if (entry.closed) return `${entry.date}: Closed${note}`;
    return `${entry.date}: ${formatPeriodsLabel(entry.periods)}${note}`;
  });
}

/** One human sentence for "are you open right now". */
export function describeOpenStatus(status: BusinessOpenStatus): string {
  if (status.state === "unknown") {
    return "Operating hours have not been confirmed yet.";
  }

  const weekdayLabel = capitalize(status.weekday);

  if (status.state === "open") {
    return `Open now (${weekdayLabel}) — closes at ${status.closesAt}.`;
  }

  if (status.reopensTodayAt) {
    return `Currently closed (${weekdayLabel}) — reopens today at ${status.reopensTodayAt}.`;
  }

  if (status.nextOpen) {
    const nextLabel = status.nextOpen.isToday ? "today" : `${capitalize(status.nextOpen.weekday)} (${status.nextOpen.date})`;
    return `Currently closed (${weekdayLabel}) — next open ${nextLabel} at ${status.nextOpen.opensAt}.`;
  }

  return `Currently closed (${weekdayLabel}).`;
}
