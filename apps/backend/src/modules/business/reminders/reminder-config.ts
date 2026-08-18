/**
 * Per-agent appointment-reminder configuration.
 *
 * Stored on InstalledAgent.configJson.reminders as:
 *   { enabled?: boolean; offsetsMinutes?: number[] }
 *
 * Absent/malformed config resolves to the safe default: enabled, one reminder
 * 24 hours before the appointment. Offsets are always normalized here so every
 * consumer (scheduler, routes) sees the same clamped, deduped shape.
 */

/** Smallest allowed reminder lead time: 5 minutes before the appointment. */
export const MIN_REMINDER_OFFSET_MINUTES = 5;
/** Largest allowed reminder lead time: 7 days before the appointment. */
export const MAX_REMINDER_OFFSET_MINUTES = 7 * 24 * 60;
/** At most this many reminders per appointment. */
export const MAX_REMINDER_OFFSETS = 3;
/** Default: a single reminder 24h before the appointment. */
export const DEFAULT_REMINDER_OFFSETS_MINUTES = [24 * 60];

export type ReminderConfig = {
  enabled: boolean;
  /** Normalized: integers, clamped to 5..10080, deduped, max 3, descending. */
  offsetsMinutes: number[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a raw offsets list: keep finite numbers, round to whole minutes,
 * clamp into the allowed window, dedupe, sort descending (earliest send
 * first), cap at MAX_REMINDER_OFFSETS.
 */
export function normalizeReminderOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REMINDER_OFFSETS_MINUTES];

  const clamped = raw
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) =>
      Math.min(MAX_REMINDER_OFFSET_MINUTES, Math.max(MIN_REMINDER_OFFSET_MINUTES, Math.round(value)))
    );

  const deduped = [...new Set(clamped)].sort((a, b) => b - a).slice(0, MAX_REMINDER_OFFSETS);
  return deduped.length > 0 ? deduped : [...DEFAULT_REMINDER_OFFSETS_MINUTES];
}

/**
 * Resolve the reminder config from an InstalledAgent.configJson value.
 * Tolerant of null / non-object / partial shapes — never throws.
 */
export function resolveReminderConfig(configJson: unknown): ReminderConfig {
  const reminders = isRecord(configJson) ? configJson.reminders : undefined;

  if (!isRecord(reminders)) {
    return { enabled: true, offsetsMinutes: [...DEFAULT_REMINDER_OFFSETS_MINUTES] };
  }

  const enabled = typeof reminders.enabled === "boolean" ? reminders.enabled : true;
  const offsetsMinutes =
    "offsetsMinutes" in reminders
      ? normalizeReminderOffsets(reminders.offsetsMinutes)
      : [...DEFAULT_REMINDER_OFFSETS_MINUTES];

  return { enabled, offsetsMinutes };
}
