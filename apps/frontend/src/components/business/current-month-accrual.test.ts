import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_ACCRUAL_ID_PREFIX,
  findPersistedCurrentAccrual,
  isSyntheticAccrualId,
  shouldShowSyntheticAccrual
} from "@/components/business/current-month-accrual";

/**
 * Current-month invoice deduplication — the shared rule used by BOTH billing
 * pages (billingandusage/page.tsx and billingandusage/billing/page.tsx).
 * A synthetic "accruing" row may only appear when no persisted, non-VOID
 * current-month invoice already represents the month's usage.
 */

const CURRENT_MONTH = "2026-07";
const PRIOR_MONTH = "2026-06";

type AgentUsageBreakdown = {
  agentId: string | null;
  installedAgentId?: string | null;
  agentName: string;
  callCount: number;
  executionCount?: number;
  durationMinutes: number;
  billedCostUsd: number;
  amountCents: number;
  serviceCosts: Array<{
    serviceCode: string;
    serviceName: string;
    unit: string;
    quantity: number;
    billedCostUsd: number;
    amountCents: number;
  }>;
};

/** Mirrors the UsageInvoice shape both billing pages consume. */
type UsageInvoice = {
  id: string;
  invoiceNumber: string;
  billingMonth: string;
  status: string;
  amountCents: number;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  callCount: number;
  agentBreakdown: AgentUsageBreakdown[];
  isAccruing?: boolean;
};

function agentBreakdown(overrides: Partial<AgentUsageBreakdown> = {}): AgentUsageBreakdown {
  return {
    agentId: "listing-1",
    installedAgentId: "installed-1",
    agentName: "Reception Agent",
    callCount: 6,
    executionCount: 6,
    durationMinutes: 14,
    billedCostUsd: 12.34,
    amountCents: 1234,
    serviceCosts: [
      {
        serviceCode: "VOICE",
        serviceName: "Voice execution",
        unit: "minute",
        quantity: 14,
        billedCostUsd: 12.34,
        amountCents: 1234
      }
    ],
    ...overrides
  };
}

function usageInvoice(overrides: Partial<UsageInvoice> = {}): UsageInvoice {
  return {
    id: "inv-1",
    invoiceNumber: "USG-202607-0001",
    billingMonth: CURRENT_MONTH,
    status: "OPEN",
    amountCents: 1234,
    issuedAt: "2026-07-20T00:00:00.000Z",
    dueAt: "2026-08-07T00:00:00.000Z",
    paidAt: null,
    callCount: 6,
    agentBreakdown: [agentBreakdown()],
    ...overrides
  };
}

/** The exact params both pages pass when there is real current-month usage. */
function accrualParams(invoices: UsageInvoice[], overrides: Partial<{ executionCount: number; costUsd: number }> = {}) {
  return {
    invoices,
    currentMonth: CURRENT_MONTH,
    executionCount: 6,
    costUsd: 12.34,
    ...overrides
  };
}

/** The synthetic statement both pages construct when the helper allows it. */
function syntheticStatement(): UsageInvoice {
  return usageInvoice({
    id: `${SYNTHETIC_ACCRUAL_ID_PREFIX}${CURRENT_MONTH}`,
    invoiceNumber: `ACCRUED-${CURRENT_MONTH.replace("-", "")}`,
    status: "PENDING",
    paidAt: null,
    isAccruing: true
  });
}

describe("shouldShowSyntheticAccrual", () => {
  it("shows a single synthetic row when no real invoice exists", () => {
    expect(shouldShowSyntheticAccrual(accrualParams([]))).toBe(true);

    // Page semantics: the synthetic row is appended, producing exactly ONE
    // current-month row overall.
    const allUsageInvoices: UsageInvoice[] = [...[], syntheticStatement()];
    const currentMonthRows = allUsageInvoices.filter((invoice) => invoice.billingMonth === CURRENT_MONTH);
    expect(currentMonthRows).toHaveLength(1);
    expect(isSyntheticAccrualId(currentMonthRows[0]!.id)).toBe(true);
  });

  it("suppresses the synthetic row when a current-month OPEN invoice exists", () => {
    expect(shouldShowSyntheticAccrual(accrualParams([usageInvoice({ status: "OPEN" })]))).toBe(false);
  });

  it("suppresses the synthetic row for a PENDING current-month invoice", () => {
    expect(shouldShowSyntheticAccrual(accrualParams([usageInvoice({ status: "PENDING" })]))).toBe(false);
  });

  it("suppresses the synthetic row for an OVERDUE current-month invoice", () => {
    expect(shouldShowSyntheticAccrual(accrualParams([usageInvoice({ status: "OVERDUE" })]))).toBe(false);
  });

  it("suppresses the synthetic row for a PAID current-month invoice", () => {
    expect(
      shouldShowSyntheticAccrual(
        accrualParams([usageInvoice({ status: "PAID", paidAt: "2026-07-21T00:00:00.000Z" })])
      )
    ).toBe(false);
  });

  it("suppresses the synthetic row for an unknown non-VOID status such as FAILED", () => {
    // The UsageInvoice status union has no FAILED; current product policy is
    // that ANY real non-VOID current-month invoice wins over the synthetic row.
    expect(shouldShowSyntheticAccrual(accrualParams([usageInvoice({ status: "FAILED" })]))).toBe(false);
  });

  it("still shows the synthetic row when the only current-month invoice is VOID", () => {
    // A voided statement no longer represents the month's usage.
    expect(shouldShowSyntheticAccrual(accrualParams([usageInvoice({ status: "VOID" })]))).toBe(true);
  });

  it("suppresses the synthetic row for a persisted isAccruing-flagged invoice regardless of status", () => {
    for (const status of ["PENDING", "OPEN", "PROCESSING"]) {
      expect(
        shouldShowSyntheticAccrual(accrualParams([usageInvoice({ status, isAccruing: true })]))
      ).toBe(false);
    }
  });

  it("ignores an existing synthetic 'accrued-' row so it can never suppress (or duplicate) itself", () => {
    const existingSynthetic = syntheticStatement();
    expect(isSyntheticAccrualId(existingSynthetic.id)).toBe(true);
    expect(shouldShowSyntheticAccrual(accrualParams([existingSynthetic]))).toBe(true);

    // Real invoice ids never carry the synthetic prefix, so a real row and a
    // synthetic row can never collide by id.
    expect(isSyntheticAccrualId(usageInvoice().id)).toBe(false);
    expect(usageInvoice().id.startsWith(SYNTHETIC_ACCRUAL_ID_PREFIX)).toBe(false);
  });

  it("is not suppressed by a prior-month invoice", () => {
    const priorMonth = usageInvoice({
      id: "inv-prior",
      invoiceNumber: "USG-202606-0001",
      billingMonth: PRIOR_MONTH,
      status: "PAID",
      paidAt: "2026-07-01T00:00:00.000Z"
    });
    expect(shouldShowSyntheticAccrual(accrualParams([priorMonth]))).toBe(true);
  });

  it("never shows an empty accrual: zero executions or zero cost → false even with no invoices", () => {
    expect(shouldShowSyntheticAccrual(accrualParams([], { executionCount: 0 }))).toBe(false);
    expect(shouldShowSyntheticAccrual(accrualParams([], { costUsd: 0 }))).toBe(false);
    expect(shouldShowSyntheticAccrual(accrualParams([], { executionCount: 0, costUsd: 0 }))).toBe(false);
  });

  it("agent-scoped filtering on the detail page cannot reintroduce a duplicate row", () => {
    const realCurrentMonthInvoice = usageInvoice({ status: "OPEN" });
    const invoices = [realCurrentMonthInvoice];

    // Detail-page semantics: synthetic suppressed, so allUsageInvoices is just
    // the persisted list.
    const showSyntheticAccrual = shouldShowSyntheticAccrual(accrualParams(invoices));
    expect(showSyntheticAccrual).toBe(false);
    const allUsageInvoices = [...invoices]; // no synthetic appended

    // Scope by an agentId contained in the real invoice's breakdown, exactly
    // like billingandusage/billing/page.tsx (installedAgentId ?? agentId).
    const agentId = "installed-1";
    const scopedUsageInvoices = allUsageInvoices.filter((item) =>
      item.agentBreakdown.some((agent) => (agent.installedAgentId ?? agent.agentId) === agentId)
    );
    const currentMonthRows = scopedUsageInvoices.filter((item) => item.billingMonth === CURRENT_MONTH);
    expect(currentMonthRows).toHaveLength(1);
    expect(currentMonthRows[0]!.id).toBe(realCurrentMonthInvoice.id);

    // Re-running the shared rule on the FULL list still refuses a synthetic
    // row — scoping never re-adds one.
    expect(shouldShowSyntheticAccrual(accrualParams(allUsageInvoices))).toBe(false);
  });
});

describe("findPersistedCurrentAccrual", () => {
  it("returns the persisted current-month invoice that suppresses the synthetic row", () => {
    const suppressing = usageInvoice({ status: "PENDING" });
    const priorMonth = usageInvoice({ id: "inv-prior", billingMonth: PRIOR_MONTH, status: "PAID" });
    expect(findPersistedCurrentAccrual([priorMonth, suppressing], CURRENT_MONTH)).toBe(suppressing);
  });

  it("returns undefined when only VOID, synthetic, or other-month rows exist", () => {
    const invoices = [
      usageInvoice({ id: "inv-void", status: "VOID" }),
      syntheticStatement(),
      usageInvoice({ id: "inv-prior", billingMonth: PRIOR_MONTH, status: "PAID" })
    ];
    expect(findPersistedCurrentAccrual(invoices, CURRENT_MONTH)).toBeUndefined();
  });
});

describe("isSyntheticAccrualId", () => {
  it("recognizes only ids with the accrued- prefix", () => {
    expect(isSyntheticAccrualId(`${SYNTHETIC_ACCRUAL_ID_PREFIX}2026-07`)).toBe(true);
    expect(isSyntheticAccrualId("inv-1")).toBe(false);
    expect(isSyntheticAccrualId(null)).toBe(false);
    expect(isSyntheticAccrualId(undefined)).toBe(false);
  });
});
