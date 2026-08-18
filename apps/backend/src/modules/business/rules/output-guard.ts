/**
 * Output-validation hook (plan Part 4): flags high-risk promises in an AI
 * reply BEFORE it goes out. It never blocks silently — it returns structured
 * violations and the calling runtime decides what to do (regenerate, soften,
 * or surface to the owner in test mode).
 */

export type HighRiskViolationType = "UNVERIFIED_PRICE" | "UNVERIFIED_BOOKING_TIME" | "GUARANTEED_OUTCOME";

export type HighRiskViolation = {
  type: HighRiskViolationType;
  detail: string;
};

export type HighRiskContext = {
  /** Whether this deployment can actually book appointments. */
  canBook: boolean;
  /** Slot labels the runtime has actually verified as available (e.g. "3:00 PM"). */
  verifiedSlots?: string[];
  /** True only when prices in the reply come from verified business facts. */
  verifiedPrices?: boolean;
};

const PRICE_PATTERN = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const TIME_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s?(a\.?m\.?|p\.?m\.?)\b/gi;
const BOOKING_CUE = /\b(booked|booking confirmed|confirmed|scheduled|reserved|see you at|appointment is|appointment at|appointment set)\b/i;
// No trailing \b after "%" — the boundary would never match before a space.
const GUARANTEE_PATTERNS: RegExp[] = [/\bguaranteed?\b/i, /\bno risk\b/i, /\b100\s?%/];

/** "3 PM" / "3:00 p.m." / "03:00PM" all canonicalize to "3:00pm". */
function canonicalTime(hour: string, minutes: string | undefined, meridiem: string): string {
  const h = String(Number.parseInt(hour, 10));
  const mm = minutes ?? "00";
  const ampm = meridiem.toLowerCase().startsWith("a") ? "am" : "pm";
  return `${h}:${mm}${ampm}`;
}

function extractTimes(text: string): string[] {
  const times: string[] = [];
  for (const match of text.matchAll(new RegExp(TIME_PATTERN.source, "gi"))) {
    times.push(canonicalTime(match[1], match[2], match[3]));
  }
  return times;
}

export function validateHighRiskPromises(
  replyText: string,
  context: HighRiskContext
): { ok: boolean; violations: HighRiskViolation[] } {
  const violations: HighRiskViolation[] = [];
  const reply = replyText ?? "";

  // (a) Specific prices the business has not verified.
  if (context.verifiedPrices !== true) {
    const prices = reply.match(PRICE_PATTERN) ?? [];
    for (const price of prices) {
      violations.push({
        type: "UNVERIFIED_PRICE",
        detail: `Reply states a specific price (${price.trim()}) but prices are not verified for this business.`
      });
    }
  }

  // (b) Booking-time confirmations for slots the runtime never verified.
  if (context.canBook && BOOKING_CUE.test(reply)) {
    const verified = new Set((context.verifiedSlots ?? []).flatMap((slot) => extractTimes(slot)));
    for (const time of extractTimes(reply)) {
      if (!verified.has(time)) {
        violations.push({
          type: "UNVERIFIED_BOOKING_TIME",
          detail: `Reply confirms ${time} but that slot was not in the verified availability list.`
        });
      }
    }
  }

  // (c) Guaranteed outcomes — service businesses must never promise these.
  for (const pattern of GUARANTEE_PATTERNS) {
    const match = reply.match(pattern);
    if (match) {
      violations.push({
        type: "GUARANTEED_OUTCOME",
        detail: `Reply promises a guaranteed outcome ("${match[0]}").`
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
