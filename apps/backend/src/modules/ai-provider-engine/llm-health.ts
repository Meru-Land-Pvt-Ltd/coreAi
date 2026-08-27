const UNAVAILABLE_TTL_MS = 30 * 60 * 1000;

const BILLING_FAILURE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b402\b|insufficient\s+balance|insufficient\s+funds/i, label: "out of credit" },
  { pattern: /\b429\b|quota|rate.?limit.*exceed|billing\s+hard\s+limit/i, label: "over quota" },
  { pattern: /\b401\b|\b403\b|invalid[_\s-]?api[_\s-]?key|unauthorized|account.*(suspend|deactivat)/i, label: "key rejected" },
  /* THE PROBE'S OWN VERDICTS WERE THROWN AWAY. The health probe exists to
     catch a dead key BEFORE a customer meets it, and it hands its answer here
     as one of these three exact phrases — but only "over quota" happened to
     match a pattern above, so a rejected key or an empty account was quietly
     ignored and the provider stayed in use until a real customer's run failed
     on it. The probe's own words count. */
  { pattern: /^out of credit$|^key rejected$|^over quota$/i, label: "the provider refused our account" }
];

type Entry = { reason: string; until: number };

const unavailable = new Map<string, Entry>();

/** Returns the failure label when the message means the account cannot run. */
export function classifyProviderFailure(message: string | null | undefined): string | null {
  const text = (message ?? "").trim();
  if (!text) return null;

  for (const { pattern, label } of BILLING_FAILURE_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function recordLlmProviderFailure(
  providerId: string,
  message: string | null | undefined,
  now = Date.now()
): string | null {
  const label = classifyProviderFailure(message);
  if (!label) return null;

  unavailable.set(providerId, { reason: label, until: now + UNAVAILABLE_TTL_MS });
  return label;
}

export function recordLlmProviderSuccess(providerId: string): void {
  unavailable.delete(providerId);
}

export function llmProviderBlockReason(providerId: string, now = Date.now()): string | null {
  const entry = unavailable.get(providerId);
  if (!entry) return null;

  if (entry.until <= now) {
    unavailable.delete(providerId);
    return null;
  }
  return entry.reason;
}

/** Test seam. */
export function resetLlmProviderHealth(): void {
  unavailable.clear();
}
