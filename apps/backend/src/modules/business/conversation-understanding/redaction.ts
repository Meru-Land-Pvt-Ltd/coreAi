/**
 * Deterministic PII redaction for call transcripts and summaries.
 *
 * Redacts, before storage:
 *   - Payment card numbers (13-19 digits, optionally space/dash separated) —
 *     ONLY when the digits pass the Luhn checksum.
 *   - CVV/CVC/security codes (3-4 digits within ~12 chars of the label).
 *   - SSNs (###-##-#### / ### ## #### forms, or the label "SSN"/"social
 *     security" followed shortly by 9 digits).
 *
 * Documented tradeoffs (deliberately conservative — it is better to keep a
 * phone number than to destroy operational data):
 *   - Phone numbers are never card candidates: cards need >= 13 digits, so
 *     10-digit local numbers and 11-digit "1XXXXXXXXXX" numbers can never
 *     match. Digit runs immediately preceded by '+' (E.164, 10-15 digits) are
 *     skipped wholesale, even when 13-19 digits long and Luhn-valid.
 *   - A '+'-prefixed run that happens to CONTAIN a card after the phone
 *     (e.g. "+16505551234 4111111111111111" with no word between) is treated
 *     as phone data and kept. Rare in transcripts; accepted risk.
 *   - Luhn passes for ~10% of random 13-19 digit numbers, so an occasional
 *     order/reference id may be redacted. Accepted: false-positive redaction
 *     of an id is cheaper than storing a real card number.
 *   - When a separated run could form several group-aligned candidates (card
 *     followed by a phone in one run: "4111 1111 1111 1111 650 555 1234"),
 *     the SMALLEST Luhn-valid group window wins, so trailing phone groups
 *     survive.
 *   - Bare unlabeled 9-digit numbers are NOT treated as SSNs (they are just
 *     as often order ids or phone fragments).
 *
 * Idempotent: replacement tokens contain no digits, so running the redactor
 * over already-redacted text changes nothing.
 */

export type RedactionCategory = "CARD" | "CVV" | "SSN";

export const REDACTION_TOKENS: Record<RedactionCategory, string> = {
  CARD: "[CARD REDACTED]",
  CVV: "[CVV REDACTED]",
  SSN: "[SSN REDACTED]"
};

interface RedactionSpan {
  start: number;
  end: number;
  category: RedactionCategory;
}

const MIN_CARD_DIGITS = 13;
const MAX_CARD_DIGITS = 19;

/** Maximal runs of digits with single space/dash separators between digits. */
const DIGIT_RUN_RE = /\d(?:[ -]?\d)*/g;

/** ###-##-#### or ### ## #### with no adjacent digits. */
const SSN_SEPARATED_RE = /(?<!\d)\d{3}([- ])\d{2}\1\d{4}(?!\d)/g;

/** "SSN"/"social security (number)" then <=12 non-digits then 9 digits. */
const SSN_LABELED_RE =
  /\b(?:ssn|social security(?:\s+number)?)\b(\D{0,12}?)(\d{3}[- ]?\d{2}[- ]?\d{4})(?!\d)/gi;

/** CVV-ish label then <=12 non-digits then a standalone 3-4 digit code. */
const CVV_RE =
  /\b(?:cvv2?|cvc2?|security code|card verification(?:\s+(?:value|code|number))?)\b(\D{0,12}?)(\d{3,4})(?!\d)/gi;

export function luhnValid(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function collectCardSpans(text: string, spans: RedactionSpan[]): void {
  for (const match of text.matchAll(DIGIT_RUN_RE)) {
    const runStart = match.index;
    const run = match[0];
    // E.164 guard: a '+'-prefixed run is phone data — never a card candidate.
    if (runStart > 0 && text[runStart - 1] === "+") continue;

    // Split the run into contiguous digit groups with absolute offsets.
    const groups: { start: number; end: number; digitCount: number }[] = [];
    let cursor = 0;
    while (cursor < run.length) {
      if (run[cursor] === " " || run[cursor] === "-") {
        cursor += 1;
        continue;
      }
      const groupStart = cursor;
      while (cursor < run.length && run[cursor] >= "0" && run[cursor] <= "9") cursor += 1;
      groups.push({
        start: runStart + groupStart,
        end: runStart + cursor,
        digitCount: cursor - groupStart
      });
    }

    // Slide a group-aligned window; the smallest Luhn-valid window in the
    // 13-19 digit range wins so trailing phone groups in the same run survive.
    let i = 0;
    while (i < groups.length) {
      let matchedEnd = -1;
      let digitCount = 0;
      for (let j = i; j < groups.length; j += 1) {
        digitCount += groups[j].digitCount;
        if (digitCount > MAX_CARD_DIGITS) break;
        if (digitCount < MIN_CARD_DIGITS) continue;
        const windowDigits = text
          .slice(groups[i].start, groups[j].end)
          .replace(/[ -]/g, "");
        if (luhnValid(windowDigits)) {
          spans.push({ start: groups[i].start, end: groups[j].end, category: "CARD" });
          matchedEnd = j;
          break;
        }
      }
      i = matchedEnd >= 0 ? matchedEnd + 1 : i + 1;
    }
  }
}

function collectSsnSpans(text: string, spans: RedactionSpan[]): void {
  for (const match of text.matchAll(SSN_SEPARATED_RE)) {
    spans.push({ start: match.index, end: match.index + match[0].length, category: "SSN" });
  }
  for (const match of text.matchAll(SSN_LABELED_RE)) {
    const digits = match[2];
    const start = match.index + match[0].length - digits.length;
    spans.push({ start, end: start + digits.length, category: "SSN" });
  }
}

function collectCvvSpans(text: string, spans: RedactionSpan[]): void {
  for (const match of text.matchAll(CVV_RE)) {
    const digits = match[2];
    const start = match.index + match[0].length - digits.length;
    spans.push({ start, end: start + digits.length, category: "CVV" });
  }
}

function overlaps(a: RedactionSpan, b: RedactionSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

export function redactSensitiveText(text: string): { redacted: string; found: string[] } {
  if (!text) return { redacted: text ?? "", found: [] };

  const candidates: RedactionSpan[] = [];
  // Collection order doubles as overlap priority: CARD > SSN > CVV.
  collectCardSpans(text, candidates);
  collectSsnSpans(text, candidates);
  collectCvvSpans(text, candidates);

  const accepted: RedactionSpan[] = [];
  for (const span of candidates) {
    if (!accepted.some((existing) => overlaps(existing, span))) accepted.push(span);
  }
  accepted.sort((a, b) => a.start - b.start);

  let redacted = "";
  let cursor = 0;
  const found: string[] = [];
  for (const span of accepted) {
    redacted += text.slice(cursor, span.start) + REDACTION_TOKENS[span.category];
    cursor = span.end;
    found.push(span.category);
  }
  redacted += text.slice(cursor);

  return { redacted, found };
}

const CATEGORY_LABELS: Record<RedactionCategory, { singular: string; plural: string }> = {
  CARD: { singular: "card number", plural: "card numbers" },
  CVV: { singular: "CVV", plural: "CVVs" },
  SSN: { singular: "SSN", plural: "SSNs" }
};

/** True when the redactor found anything sensitive. */
export function hasRedactions(found: string[]): boolean {
  return found.length > 0;
}

/**
 * Human-readable summary of what was redacted, e.g.
 * "Redacted 2 card numbers, 1 SSN". Empty string when nothing was found.
 */
export function redactionSummary(found: string[]): string {
  if (found.length === 0) return "";
  const order: RedactionCategory[] = ["CARD", "CVV", "SSN"];
  const counts = new Map<RedactionCategory, number>();
  for (const item of found) {
    const category = item as RedactionCategory;
    if (order.includes(category)) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const category of order) {
    const count = counts.get(category);
    if (!count) continue;
    const label = CATEGORY_LABELS[category];
    parts.push(`${count} ${count === 1 ? label.singular : label.plural}`);
  }
  return parts.length > 0 ? `Redacted ${parts.join(", ")}` : "";
}
