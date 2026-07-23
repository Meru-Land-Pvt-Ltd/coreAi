/**
 * Current-month synthetic "accruing" invoice deduplication — the ONE rule both
 * billing pages share so they can never disagree.
 *
 * A synthetic accrued row may be shown ONLY when the backend has not already
 * persisted a current-month statement. ANY real current-month invoice —
 * PENDING/OPEN (OPEN is the legacy alias), OVERDUE, PAID, or one explicitly
 * flagged isAccruing — suppresses the synthetic row; only VOID invoices are
 * ignored (a voided statement no longer represents the month's usage; new
 * billable usage creates a fresh PENDING segment which then suppresses the
 * synthetic row itself). Synthetic rows use the "accrued-" id prefix — a real
 * invoice id must never start with that prefix.
 */

export const SYNTHETIC_ACCRUAL_ID_PREFIX = "accrued-";

export type AccrualCheckInvoice = {
  id?: string;
  billingMonth?: string | null;
  status?: string | null;
  isAccruing?: boolean | null;
};

export function isSyntheticAccrualId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SYNTHETIC_ACCRUAL_ID_PREFIX);
}

/** The persisted invoice (if any) that makes a synthetic row redundant. */
export function findPersistedCurrentAccrual<T extends AccrualCheckInvoice>(
  invoices: readonly T[],
  currentMonth: string
): T | undefined {
  return invoices.find((invoice) => {
    if (invoice.billingMonth !== currentMonth) return false;
    if (isSyntheticAccrualId(invoice.id)) return false;
    const status = (invoice.status ?? "").toUpperCase();
    if (status === "VOID") return false;
    return true;
  });
}

/**
 * Show the synthetic accrued row only when there is real current-month usage
 * AND no persisted current-month statement already representing it.
 */
export function shouldShowSyntheticAccrual(params: {
  invoices: readonly AccrualCheckInvoice[];
  currentMonth: string;
  executionCount: number;
  costUsd: number;
}): boolean {
  if (params.executionCount <= 0 || params.costUsd <= 0) return false;
  return findPersistedCurrentAccrual(params.invoices, params.currentMonth) === undefined;
}
