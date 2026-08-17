/**
 * Value formatting for Visual Results — the rules that decide how a number or
 * a missing value is allowed to LOOK, in one place so the Result Viewer and
 * the generated product pages can never disagree.
 *
 * The payload comes from a language model, so "empty" arrives in a dozen
 * disguises: "", "N/A", "null", "(missing)". A paid product shows a quiet dash
 * for all of them — never the model's apology text.
 */

/**
 * Everything a model says when it means "nothing here". Lower-cased on lookup.
 * Deliberately conservative: "none" and "nil" are NOT here, because in a real
 * table they are often the honest answer.
 */
const BLANK_VALUES = new Set([
  "",
  "-",
  "--",
  "---",
  "—",
  "–",
  "n/a",
  "n.a.",
  "na",
  "null",
  "nan",
  "undefined",
  "unknown",
  "missing",
  "(missing)",
  "not available",
  "no data"
]);

/** The one glyph an empty value is ever allowed to render as. */
export const EMPTY_GLYPH = "—";

/**
 * A value ready to paint: the trimmed text, or a quiet em dash when the model
 * gave us nothing usable.
 */
export function displayValue(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return BLANK_VALUES.has(trimmed.toLowerCase()) ? EMPTY_GLYPH : trimmed;
}

/** True when `displayValue` would fall back to the dash. */
export function isBlankValue(raw: string | null | undefined): boolean {
  return displayValue(raw) === EMPTY_GLYPH;
}

function trimZero(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** Compact human number for axis/value labels: 1_200_000 → "1.2M". */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trimZero(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(value / 1_000)}K`;
  return trimZero(value);
}

/**
 * A cell that reads as a quantity: an optional sign or accounting paren, an
 * optional currency mark, digits with thousands separators, an optional
 * decimal, an optional magnitude letter, an optional percent.
 * "1,200" · "$1,200.00" · "(4.5)" · "12.5%" · "1.2M" → yes. "Intro" → no.
 */
const NUMERIC_RE = /^[-+(]?\s*[$€£¥₹₩]?\s*\d[\d,   ]*(?:\.\d+)?\s*[KkMmBbTt]?\s*%?\s*\)?$/;

/** True when a single cell reads as a quantity. */
export function isNumericValue(raw: string | null | undefined): boolean {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return false;
  return NUMERIC_RE.test(trimmed);
}

/**
 * A column is numeric when every value it actually has is a quantity — blanks
 * are skipped, and a column of nothing but blanks is not numeric. Numeric
 * columns get right-aligned tabular figures so the digits line up in a stack,
 * which is the single biggest thing separating a real table from a dump.
 */
export function isNumericColumn(rows: string[][], index: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const cell = row[index] ?? "";
    if (isBlankValue(cell)) continue;
    if (!isNumericValue(cell)) return false;
    seen += 1;
  }
  return seen > 0;
}

// ---------------------------------------------------------------------------
// How a stat's number is allowed to be SIZED.
// ---------------------------------------------------------------------------

/**
 * Marks a stat's box as the thing its number measures itself against.
 *
 * A number must be sized by the room its own card has, not by how wide the
 * screen is. The two are not the same thing and the gap between them is what
 * broke: four stats side by side inside a standard-width column give each card
 * ~156px of usable space no matter how large the monitor is, and a 36px
 * "$128,430" needs 182px. Sized off the viewport it rendered "$128,..." — a
 * paid dashboard may truncate a customer's name, never its own headline
 * number. Sized off the card it steps down to 28px and fits, and it steps back
 * up to 36px the moment the architect widens the page.
 *
 * Pair one of the scales below with this on the ancestor that owns the width.
 */
export const STAT_MEASURE = "@container";

/**
 * A stat card's number. Tops out at 36px — the Result Viewer's stat cards and
 * the spec's stat node, which both sit inside a padded card.
 */
export const STAT_VALUE_TYPE =
  "text-2xl @[8.5rem]:text-[1.75rem] @[11rem]:text-3xl @[13rem]:text-4xl";

/**
 * A stat card's number where the card is allowed to run bigger — the sections
 * library's stat block, which has no padding of its own.
 */
export const STAT_VALUE_TYPE_WIDE =
  "text-2xl @[8.5rem]:text-3xl @[12rem]:text-4xl @[15rem]:text-[2.75rem]";

/**
 * A proof-strip number — the stats band, where the number IS the section.
 * Tops out at 48px.
 */
export const STAT_VALUE_TYPE_DISPLAY =
  "text-[1.75rem] @[9rem]:text-4xl @[13rem]:text-[2.5rem] @[16rem]:text-5xl";

export type DeltaDirection = "up" | "down" | "flat";

/**
 * Which way a delta points. An explicit `deltaDir` from the payload wins;
 * otherwise the text decides — a leading minus falls, a leading plus or digit
 * rises, and anything else ("same as last week") stays neutral rather than
 * turning green by accident.
 */
export function deltaDirection(
  delta: string | null | undefined,
  declared?: "up" | "down"
): DeltaDirection {
  if (declared) return declared;
  const value = (delta ?? "").trim();
  if (/^[-−–]/.test(value)) return "down";
  if (/^[+0-9]/.test(value)) return "up";
  return "flat";
}
