import { normalizePhoneE164 } from "../../../architect/twilio-connector";

/**
 * Phone is the ONLY reliable identifier for the callers this product serves —
 * consumers and patients who usually have no company and never share an email.
 * Everything CRM-side keys off a normalized E.164 string.
 */

export function toE164(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneE164(raw ?? "");
  return normalized ? normalized : null;
}

/**
 * Match candidates for a caller number.
 *
 * CRMs store phone numbers however a human typed them — "+1 (555) 123-4567",
 * "555-123-4567", "5551234567". Searching only the E.164 form silently misses
 * returning customers, so a lookup tries the E.164 string, the digits, and the
 * national-significant digits (E.164 minus country code).
 */
export function phoneSearchVariants(raw: string | null | undefined): string[] {
  const e164 = toE164(raw);
  if (!e164) return [];

  const digits = e164.replace(/\D/g, "");
  const variants = new Set<string>([e164, digits]);

  // Last 10 digits covers NANP national format and most local-format entries.
  if (digits.length > 10) variants.add(digits.slice(-10));

  return [...variants].filter(Boolean);
}

/** Last-N-digits key used for cache matching when formats disagree. */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const e164 = toE164(raw);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : digits;
}
