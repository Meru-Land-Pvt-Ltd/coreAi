import { describe, expect, it } from "vitest";
import {
  addUtcCalendarMonth,
  initialAgentPurchasePeriod,
  nextSubscriptionInvoicePeriod,
  paidPaymentCoversAgentInvoice,
  paymentsForInstalledAgent,
  sameInstalledAgentPaymentScope,
  type AgentPaymentPeriod
} from "./agent-payment-scope";

function payment(
  overrides: Partial<AgentPaymentPeriod> = {}
): AgentPaymentPeriod {
  return {
    id: "payment-1",
    userId: "buyer-1",
    businessId: "business-1",
    listingId: "listing-1",
    installedAgentId: "agent-1",
    status: "SUCCEEDED",
    invoiceKind: "PURCHASE",
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    paidAt: new Date("2026-07-09T00:00:00.000Z"),
    periodStart: new Date("2026-07-09T00:00:00.000Z"),
    periodEnd: new Date("2026-08-09T00:00:00.000Z"),
    dueAt: null,
    ...overrides
  };
}

describe("installed-agent payment scope", () => {
  it("does not merge different installed agents with the same listing or name", () => {
    expect(
      sameInstalledAgentPaymentScope(
        payment(),
        payment({ id: "payment-2", installedAgentId: "agent-2" })
      )
    ).toBe(false);
  });

  it("uses business and listing only for a legacy payment without an agent id", () => {
    expect(
      sameInstalledAgentPaymentScope(
        payment(),
        payment({ installedAgentId: null })
      )
    ).toBe(true);
    expect(
      sameInstalledAgentPaymentScope(
        payment(),
        payment({
          installedAgentId: null,
          businessId: "business-2"
        })
      )
    ).toBe(false);
  });

  it("selects only payments belonging to the concrete installed agent", () => {
    const rows = [
      payment(),
      payment({
        id: "payment-2",
        installedAgentId: "agent-2"
      }),
      payment({
        id: "payment-legacy",
        installedAgentId: null
      })
    ];

    expect(
      paymentsForInstalledAgent(rows, {
        id: "agent-1",
        businessId: "business-1",
        listingId: "listing-1"
      }).map((row) => row.id)
    ).toEqual(["payment-1", "payment-legacy"]);
  });
});

describe("paid-period reconciliation", () => {
  const postTrialDebt = payment({
    id: "post-trial-1",
    status: "OVERDUE",
    invoiceKind: "POST_TRIAL",
    createdAt: new Date("2026-07-24T00:00:00.000Z"),
    paidAt: null,
    periodStart: new Date("2026-07-24T00:00:00.000Z"),
    periodEnd: new Date("2026-08-01T00:00:00.000Z"),
    dueAt: new Date("2026-07-24T00:00:00.000Z")
  });

  it("cancels a post-trial debt already covered by the paid subscription period", () => {
    expect(
      paidPaymentCoversAgentInvoice(
        payment(),
        postTrialDebt,
        "SUBSCRIPTION"
      )
    ).toBe(true);
  });

  it("does not cancel a later monthly invoice using an expired paid period", () => {
    expect(
      paidPaymentCoversAgentInvoice(
        payment({
          periodStart: new Date("2026-06-01T00:00:00.000Z"),
          periodEnd: new Date("2026-07-01T00:00:00.000Z")
        }),
        postTrialDebt,
        "SUBSCRIPTION"
      )
    ).toBe(false);
  });

  it("treats a paid one-time agent as permanently covered", () => {
    expect(
      paidPaymentCoversAgentInvoice(
        payment({
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-02-01T00:00:00.000Z")
        }),
        postTrialDebt,
        "ONE_TIME"
      )
    ).toBe(true);
  });

  it("never reconciles debt across installed-agent ids", () => {
    expect(
      paidPaymentCoversAgentInvoice(
        payment({ installedAgentId: "agent-2" }),
        postTrialDebt,
        "ONE_TIME"
      )
    ).toBe(false);
  });
});

describe("billing cadence", () => {
  it("generates the next subscription period from the paid period end date", () => {
    expect(
      nextSubscriptionInvoicePeriod(
        payment({
          periodStart: new Date("2026-07-09T10:30:00.000Z"),
          periodEnd: new Date("2026-08-09T10:30:00.000Z")
        })
      )
    ).toEqual({
      start: new Date("2026-08-09T10:30:00.000Z"),
      end: new Date("2026-09-09T10:30:00.000Z")
    });
  });

  it("clamps end-of-month renewals instead of skipping a month", () => {
    expect(
      addUtcCalendarMonth(new Date("2026-01-31T10:30:00.000Z"))
    ).toEqual(new Date("2026-02-28T10:30:00.000Z"));
  });

  it("stores a monthly period only for subscription purchases", () => {
    const purchasedAt = new Date("2026-07-09T10:15:00.000Z");

    expect(initialAgentPurchasePeriod("SUBSCRIPTION", purchasedAt)).toEqual({
      start: purchasedAt,
      end: new Date("2026-08-09T10:15:00.000Z")
    });
    expect(initialAgentPurchasePeriod("ONE_TIME", purchasedAt)).toEqual({
      start: purchasedAt,
      end: null
    });
  });
});
