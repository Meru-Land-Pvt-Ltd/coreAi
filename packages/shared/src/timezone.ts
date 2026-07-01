/**
 * Timezone canonicalization shared by the backend (persist/read) and the buyer
 * setup UI (display/default). Keeps a single source of truth so a legacy or
 * browser-reported alias like `Asia/Calcutta` always resolves to `Asia/Kolkata`.
 */

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** Deprecated/legacy IANA zone names → their canonical modern equivalents. */
const TIMEZONE_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires"
};

/**
 * Canonicalizes an IANA timezone string. Maps deprecated aliases to their modern
 * names and falls back to {@link DEFAULT_TIME_ZONE} when empty/unset. Unknown but
 * otherwise valid zones pass through unchanged.
 */
export function normalizeTimeZone(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_TIME_ZONE;
  return TIMEZONE_ALIASES[trimmed] ?? trimmed;
}
