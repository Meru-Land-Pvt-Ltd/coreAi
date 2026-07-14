export function canonicalPromptVariableKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const KNOWN_PROMPT_VARIABLES = [
  "assistantName",
  "businessId",
  "businessName",
  "businessType",
  "contactName",
  "businessHours",
  "services",
  "servicesList",
  "faqs",
  "knowledge",
  "tone",
  "escalationRules",
  "customerName",
  "callerName",
  "customerPhone",
  "callerPhone",
  "appointmentService",
  "service",
  "bookingLabel",
  "bookingUrl",
  "teamPhone",
  "calendarId",
  "callReason",
  "fallbackResponse",
  "calendarBookingRules",
  "customInstructions",
  "silencePolicy",
  "currentDateTime",
  "currentDate",
  "todayDate",
  "tomorrowDate",
  "timeZone"
] as const;

const KNOWN_PROMPT_VARIABLE_KEYS = new Set(
  KNOWN_PROMPT_VARIABLES.map((name) => canonicalPromptVariableKey(name))
);

const TOKEN_PATTERN = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;

/** Raw {{variable}} names found in the text, deduped, in order of appearance. */
export function extractPromptVariables(text: string): string[] {
  if (!text || !text.includes("{{")) return [];

  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const name = (match[1] ?? "").trim();
    const key = canonicalPromptVariableKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    found.push(name);
  }

  return found;
}

export function findUnknownPromptVariables(
  text: string,
  opts: { nodePrefixes?: readonly string[] } = {}
): string[] {
  const prefixes = (opts.nodePrefixes ?? [])
    .map((prefix) => canonicalPromptVariableKey(prefix))
    .filter(Boolean);

  return extractPromptVariables(text).filter((name) => {
    const key = canonicalPromptVariableKey(name);
    if (KNOWN_PROMPT_VARIABLE_KEYS.has(key)) return false;
    return !prefixes.some((prefix) => key.startsWith(prefix));
  });
}
