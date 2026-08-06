import { isValidTimeZone, normalizeTimeZone, zonedWallClockToUtc } from "@coreai/shared";

function resolveZone(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (trimmed && isValidTimeZone(trimmed)) return normalizeTimeZone(trimmed);
  return "UTC";
}

/** Convert `YYYY-MM-DDTHH:mm` (datetime-local) in `timeZone` to an ISO UTC string. */
export function datetimeLocalToIso(localValue: string, timeZone: string): string {
  const trimmed = localValue.trim();
  if (!trimmed) return "";
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(trimmed);
  if (!match) return "";
  const date = match[1]!;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  return zonedWallClockToUtc(date, hour, minute, resolveZone(timeZone)).toISOString();
}

/** Convert an ISO instant to `YYYY-MM-DDTHH:mm` for a datetime-local input in `timeZone`. */
export function isoToDatetimeLocal(iso: string, timeZone: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    const loose = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(trimmed);
    return loose?.[1] ?? "";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Teams-style window lengths for availability / one-off booking ranges. */
export const CALENDLY_WINDOW_DURATION_OPTIONS = [
  { value: String(1 * 24 * 60 * 60 * 1000), label: "1 day", ms: 1 * 24 * 60 * 60 * 1000 },
  { value: String(3 * 24 * 60 * 60 * 1000), label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { value: String(7 * 24 * 60 * 60 * 1000), label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: String(14 * 24 * 60 * 60 * 1000), label: "14 days", ms: 14 * 24 * 60 * 60 * 1000 },
  { value: String(30 * 24 * 60 * 60 * 1000), label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 }
] as const;

export const DEFAULT_CALENDLY_WINDOW_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function addMsToIso(startIso: string, durationMs: number): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(durationMs) || durationMs <= 0) return "";
  return new Date(start.getTime() + durationMs).toISOString();
}

export function inferWindowDurationMs(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return DEFAULT_CALENDLY_WINDOW_DURATION_MS;
  }
  const delta = end.getTime() - start.getTime();
  if (delta <= 0) return DEFAULT_CALENDLY_WINDOW_DURATION_MS;
  return CALENDLY_WINDOW_DURATION_OPTIONS.reduce((best, option) => {
    return Math.abs(option.ms - delta) < Math.abs(best.ms - delta) ? option : best;
  }, CALENDLY_WINDOW_DURATION_OPTIONS[2]!).ms;
}

export function nowDatetimeLocalInZone(timeZone: string): string {
  return isoToDatetimeLocal(new Date().toISOString(), timeZone);
}

export function formatIsoForDisplay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatSlotDayLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Other";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatSlotTimeLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveZone(timeZone),
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export type SlotDayGroup = {
  dayKey: string;
  dayLabel: string;
  options: Array<{ value: string; timeLabel: string; label: string }>;
};

export function groupAvailableSlotsByDay(
  options: Array<{ value: string; label: string }>,
  timeZone: string
): SlotDayGroup[] {
  const groups = new Map<string, SlotDayGroup>();
  for (const option of options) {
    const dayLabel = formatSlotDayLabel(option.value, timeZone);
    const dayKey = isoToDatetimeLocal(option.value, timeZone).slice(0, 10) || dayLabel;
    const existing = groups.get(dayKey);
    const entry = {
      value: option.value,
      timeLabel: formatSlotTimeLabel(option.value, timeZone),
      label: option.label
    };
    if (existing) {
      existing.options.push(entry);
    } else {
      groups.set(dayKey, { dayKey, dayLabel, options: [entry] });
    }
  }
  return [...groups.values()];
}
