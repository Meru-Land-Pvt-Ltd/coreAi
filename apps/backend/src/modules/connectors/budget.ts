/**
 * WHAT A BUSINESS MAY SPEND ON OUTSIDE SERVICES IN ONE DAY.
 *
 * The engine has always had a spending ceiling. Nothing ever passed it one, so
 * it never ran — the check was written as "if a budget was supplied", and no
 * caller supplied one. A ceiling that is never handed a number is not a
 * ceiling, and this is the file that gives it one.
 *
 * The default is deliberately a real number rather than "unlimited". Apollo,
 * Hunter, Instantly and MillionVerifier all charge per lookup, and the failure
 * everyone in this business has seen at least once is a loop that runs
 * overnight against a metered API. A business that genuinely needs more can be
 * given more; a business that does not should never be able to lose a month of
 * credits before breakfast.
 */

/**
 * The default daily ceiling, in US cents, per business across all connectors.
 *
 * $25. High enough that ordinary use never touches it; low enough that a
 * runaway is a bad morning rather than a bad month.
 */
export const DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS = 2_500;

/**
 * Read a business's ceiling out of their installed agent's config.
 *
 * A business may be given a higher one. They may not be given "no limit": a
 * zero or negative value falls back to the default rather than switching the
 * ceiling off, because "0" in a config field is far more often a mistake than
 * a decision, and the cost of reading it as "unlimited" is somebody's bill.
 */
export function connectorBudgetCentsFor(configJson: unknown): number {
  if (!configJson || typeof configJson !== "object") return DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS;

  const raw = (configJson as Record<string, unknown>).connectorDailyBudgetCents;
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);

  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CONNECTOR_DAILY_BUDGET_CENTS;
  return Math.floor(value);
}
