
import type { ExecutionMode } from "./execution-mode";

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** Deprecated/legacy IANA zone names → their canonical modern equivalents. */
const TIMEZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires"
};

export function normalizeTimeZone(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_TIME_ZONE;
  return TIMEZONE_ALIASES[trimmed] ?? trimmed;
}

/* ------------------------------ validation ------------------------------- */

const validZoneCache = new Map<string, boolean>();

export function isValidTimeZone(value: string | null | undefined): boolean {
  const zone = (value ?? "").trim();
  if (!zone) return false;

  const cached = validZoneCache.get(zone);
  if (cached !== undefined) return cached;

  let valid = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    valid = true;
  } catch {
    valid = false;
  }

  validZoneCache.set(zone, valid);
  return valid;
}

export type ExecutionTimezoneResult =
  | { ok: true; timeZone: string; source: "selected" | "business" | "workflow" }
  | { ok: false; errorCode: "CALENDAR_TIMEZONE_MISSING" | "CALENDAR_TIMEZONE_INVALID"; attempted: string | null };

export function resolveExecutionTimezone(params: {
  executionMode: ExecutionMode;
  selectedTestTimezone?: string | null;
  businessTimezone?: string | null;
  workflowTimezone?: string | null;
}): ExecutionTimezoneResult {
  const candidates: Array<{ raw: string | null | undefined; source: "selected" | "business" | "workflow" }> =
    params.executionMode === "ARCHITECT_DRY_RUN"
      ? [
          { raw: params.selectedTestTimezone, source: "selected" },
          { raw: params.workflowTimezone, source: "workflow" }
        ]
      : [
          { raw: params.businessTimezone, source: "business" },
          { raw: params.workflowTimezone, source: "workflow" }
        ];

  let attempted: string | null = null;

  for (const candidate of candidates) {
    const trimmed = (candidate.raw ?? "").trim();
    if (!trimmed) continue;

    const normalized = TIMEZONE_ALIASES[trimmed] ?? trimmed;
    attempted = normalized;

    if (isValidTimeZone(normalized)) {
      return { ok: true, timeZone: normalized, source: candidate.source };
    }
  }

  return attempted
    ? { ok: false, errorCode: "CALENDAR_TIMEZONE_INVALID", attempted }
    : { ok: false, errorCode: "CALENDAR_TIMEZONE_MISSING", attempted: null };
}

/* --------------------------- wall-clock ↔ UTC ---------------------------- */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Milliseconds to add to a UTC instant to express it as wall-clock in `timeZone`. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
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

/**
 * Convert a wall-clock time (date + h:m) in `timeZone` to the correct UTC Date.
 * Runs the offset fix-point twice so DST transitions land on the right side:
 * a nonexistent local time (spring-forward gap) resolves to the instant after
 * the jump; an ambiguous time (fall-back overlap) resolves to the earlier
 * occurrence.
 */
export function zonedWallClockToUtc(dateStr: string, hour: number, minute: number, timeZone: string): Date {
  const naiveUtc = new Date(`${dateStr}T${pad2(hour)}:${pad2(minute)}:00Z`);
  let offset = timeZoneOffsetMs(naiveUtc, timeZone);
  let result = new Date(naiveUtc.getTime() - offset);

  // Second pass: if the first guess landed across a DST boundary the offset
  // changes; re-derive with the corrected offset.
  const secondOffset = timeZoneOffsetMs(result, timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    result = new Date(naiveUtc.getTime() - offset);
  }

  return result;
}

/** "YYYY-MM-DD" for the current moment as seen in `timeZone`. */
export function dateOnlyInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export type ZonedTimeDescription = {
  requestedLocalDate: string;
  requestedLocalTime: string;
  timeZone: string;
  startAtUtc: string;
  endAtUtc: string;
  displayDate: string;
  displayTime: string;
};

export function describeZonedTime(params: {
  date: string;
  hour: number;
  minute: number;
  timeZone: string;
  durationMinutes?: number;
}): ZonedTimeDescription {
  const startAt = zonedWallClockToUtc(params.date, params.hour, params.minute, params.timeZone);
  const endAt = new Date(startAt.getTime() + (params.durationMinutes ?? 30) * 60 * 1000);

  return {
    requestedLocalDate: params.date,
    requestedLocalTime: `${pad2(params.hour)}:${pad2(params.minute)}`,
    timeZone: params.timeZone,
    startAtUtc: startAt.toISOString(),
    endAtUtc: endAt.toISOString(),
    displayDate: startAt.toLocaleDateString("en-US", {
      timeZone: params.timeZone,
      month: "long",
      day: "numeric",
      year: "numeric"
    }),
    displayTime: startAt.toLocaleTimeString("en-US", {
      timeZone: params.timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    })
  };
}

/* ------------------------------ UI choices ------------------------------- */

export type TimezoneOption = { value: string; label: string };

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: "America/New_York", label: "America/New_York (Eastern US)" },
  { value: "America/Chicago", label: "America/Chicago (Central US)" },
  { value: "America/Denver", label: "America/Denver (Mountain US)" },
  { value: "America/Phoenix", label: "America/Phoenix (Arizona)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific US)" },
  { value: "America/Anchorage", label: "America/Anchorage (Alaska)" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii)" },
  { value: "America/Toronto", label: "America/Toronto (Eastern Canada)" },
  { value: "America/Vancouver", label: "America/Vancouver (Pacific Canada)" },
  { value: "America/Mexico_City", label: "America/Mexico_City (Mexico)" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (Brazil)" },
  { value: "Europe/London", label: "Europe/London (UK)" },
  { value: "Europe/Dublin", label: "Europe/Dublin (Ireland)" },
  { value: "Europe/Paris", label: "Europe/Paris (France)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (Germany)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (Spain)" },
  { value: "Europe/Rome", label: "Europe/Rome (Italy)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (Netherlands)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (UAE)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (India)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (Singapore)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (Hong Kong)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (Japan)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (Australia East)" },
  { value: "Australia/Perth", label: "Australia/Perth (Australia West)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (New Zealand)" }
];
