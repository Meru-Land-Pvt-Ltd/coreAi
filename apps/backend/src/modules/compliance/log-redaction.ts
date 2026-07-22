
const SECRET_KEY_PATTERN =
  /token|secret|password|api[-_]?key|authorization|credential|signature|cookie/i;

const PII_KEY_PATTERN =
  /(^|_)(phone|mobile|name|email|attendee|description)s?($|_)|customer_?(name|phone)|patient_?(name|phone)|full_?name/i;

const CALENDAR_PAYLOAD_KEY_PATTERN = /^(items|attendees|description|summary|conferenceData|organizer|creator)$/i;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••${digits.slice(-4)}`;
}

export function stripUrlQuery(value: string): string {
  const queryStart = value.indexOf("?");
  return queryStart === -1 ? value : value.slice(0, queryStart);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikePhone(value: string): boolean {
  return /^\+?[\d\s().-]{7,20}$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7;
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";

  if (typeof value === "string") {
    if (looksLikeUrl(value)) return stripUrlQuery(value);
    if (looksLikePhone(value)) return maskPhone(value);
    return value;
  }

  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    if (CALENDAR_PAYLOAD_KEY_PATTERN.test(key)) {
      result[key] = "[omitted]";
      continue;
    }
    if (PII_KEY_PATTERN.test(key)) {
      result[key] =
        typeof entry === "string" ? (looksLikePhone(entry) ? maskPhone(entry) : "[redacted]") : "[redacted]";
      continue;
    }
    result[key] = redactForLog(entry, depth + 1);
  }
  return result;
}
