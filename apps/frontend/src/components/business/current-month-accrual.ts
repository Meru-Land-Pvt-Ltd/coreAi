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

export type AgentAccrualIdentity = {
  agentId?: string | null;
  installedAgentId?: string | null;
  listingId?: string | null;
};

export type AgentAccrualUsage = AgentAccrualIdentity & {
  agentName: string;
  callCount: number;
  executionCount?: number;
  billedCostUsd: number;
};

export type AgentScopedAccrualInvoice = AccrualCheckInvoice & {
  installedAgentId?: string | null;
  agentBreakdown?: readonly AgentAccrualIdentity[];
};

export function isSyntheticAccrualId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SYNTHETIC_ACCRUAL_ID_PREFIX);
}

export function agentAccrualKey(
  agent: AgentAccrualIdentity
): string | null {
  return agent.installedAgentId ?? agent.agentId ?? agent.listingId ?? null;
}

function invoiceAgentKeys(invoice: AgentScopedAccrualInvoice) {
  const keys = new Set<string>();
  if (invoice.installedAgentId) keys.add(invoice.installedAgentId);
  for (const agent of invoice.agentBreakdown ?? []) {
    const key = agentAccrualKey(agent);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * One synthetic statement per agent with chargeable execution usage. A real
 * current-month invoice suppresses only its own agent, never other agents.
 */
export function syntheticAgentAccruals<T extends AgentAccrualUsage>(params: {
  invoices: readonly AgentScopedAccrualInvoice[];
  currentMonth: string;
  agents: readonly T[];
}) {
  const persistedAgentKeys = new Set<string>();
  for (const invoice of params.invoices) {
    if (invoice.billingMonth !== params.currentMonth) continue;
    if (isSyntheticAccrualId(invoice.id)) continue;
    if ((invoice.status ?? "").toUpperCase() === "VOID") continue;
    for (const key of invoiceAgentKeys(invoice)) persistedAgentKeys.add(key);
  }

  return params.agents.flatMap((agent) => {
    const key = agentAccrualKey(agent);
    const executionCount = agent.executionCount ?? agent.callCount;
    if (!key || executionCount <= 0 || agent.billedCostUsd <= 0) return [];
    if (persistedAgentKeys.has(key)) return [];

    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "");
    return [{
      id: `${SYNTHETIC_ACCRUAL_ID_PREFIX}${params.currentMonth}-${safeKey}`,
      invoiceNumber: `ACCRUED-${params.currentMonth.replace("-", "")}-${safeKey
        .slice(-6)
        .toUpperCase()}`,
      agent,
      executionCount
    }];
  });
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
