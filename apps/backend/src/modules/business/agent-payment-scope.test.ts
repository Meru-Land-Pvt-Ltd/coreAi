import { describe, expect, it } from "vitest";
import {
  AGENT_INVOICE_CYCLE_DAYS,
  addAgentInvoiceCycle,
  agentBillingAnchorAt,
  agentBillingPeriodFor,
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
  it("uses the paid purchase date even when a legacy period starts on the first", () => {
    expect(
      agentBillingAnchorAt({
        agentCreatedAt: new Date("2026-07-25T00:00:00.000Z"),
        referenceAt: new Date("2026-07-26T00:00:00.000Z"),
        payments: [
          payment({
            createdAt: new Date("2026-07-24T00:00:00.000Z"),
            paidAt: new Date("2026-07-24T00:00:00.000Z"),
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            periodEnd: new Date("2026-08-01T00:00:00.000Z")
          })
        ]
      })
    ).toEqual(new Date("2026-07-24T00:00:00.000Z"));
  });

  it("uses a 30-day invoice cycle", () => {
    expect(AGENT_INVOICE_CYCLE_DAYS).toBe(30);
    expect(
      addAgentInvoiceCycle(new Date("2026-07-09T10:30:00.000Z"))
    ).toEqual(new Date("2026-08-08T10:30:00.000Z"));
  });

  it("generates a 30-day subscription period from the paid period end date", () => {
    expect(
      nextSubscriptionInvoicePeriod(
        payment({
          periodStart: new Date("2026-07-09T10:30:00.000Z"),
          periodEnd: new Date("2026-08-08T10:30:00.000Z")
        })
      )
    ).toEqual({
      start: new Date("2026-08-08T10:30:00.000Z"),
      end: new Date("2026-09-07T10:30:00.000Z")
    });
  });

  it("ignores a legacy monthly period end and renews 30 days after purchase", () => {
    const anchor = new Date("2026-07-24T10:30:00.000Z");
    expect(
      nextSubscriptionInvoicePeriod(
        payment({
          createdAt: anchor,
          paidAt: anchor,
          periodStart: anchor,
          periodEnd: new Date("2026-08-01T00:00:00.000Z")
        }),
        anchor
      )
    ).toEqual({
      start: new Date("2026-08-23T10:30:00.000Z"),
      end: new Date("2026-09-22T10:30:00.000Z")
    });
  });

  it("advances every paid renewal by another 30 days", () => {
    const anchor = new Date("2026-07-20T00:00:00.000Z");
    const firstRenewal = nextSubscriptionInvoicePeriod(
      payment({
        createdAt: anchor,
        paidAt: anchor,
        periodStart: anchor,
        periodEnd: new Date("2026-08-01T00:00:00.000Z")
      }),
      anchor
    );
    const secondRenewal = nextSubscriptionInvoicePeriod(
      payment({
        periodStart: firstRenewal.start,
        periodEnd: firstRenewal.end
      }),
      anchor
    );

    expect(firstRenewal).toEqual({
      start: new Date("2026-08-19T00:00:00.000Z"),
      end: new Date("2026-09-18T00:00:00.000Z")
    });
    expect(secondRenewal).toEqual({
      start: new Date("2026-09-18T00:00:00.000Z"),
      end: new Date("2026-10-18T00:00:00.000Z")
    });
  });

  it("makes a usage invoice due after 30 days and starts a new period at the boundary", () => {
    const anchor = new Date("2026-07-25T10:30:00.000Z");
    expect(
      agentBillingPeriodFor(
        anchor,
        new Date("2026-08-24T10:29:59.000Z")
      )
    ).toMatchObject({
      key: "2026-07",
      start: anchor,
      end: new Date("2026-08-24T10:30:00.000Z"),
      dueAt: new Date("2026-08-24T10:30:00.000Z"),
      graceEndsAt: new Date("2026-08-31T10:30:00.000Z")
    });
    expect(
      agentBillingPeriodFor(
        anchor,
        new Date("2026-08-24T10:30:00.000Z")
      )
    ).toMatchObject({
      key: "2026-08",
      start: new Date("2026-08-24T10:30:00.000Z"),
      end: new Date("2026-09-23T10:30:00.000Z"),
      dueAt: new Date("2026-09-23T10:30:00.000Z")
    });
  });

  it("keeps the 30-day cadence across a calendar-month boundary", () => {
    const anchor = new Date("2026-01-31T10:30:00.000Z");
    expect(
      nextSubscriptionInvoicePeriod(
        payment({
          periodStart: anchor,
          periodEnd: new Date("2026-02-28T10:30:00.000Z")
        }),
        anchor
      )
    ).toEqual({
      start: new Date("2026-03-02T10:30:00.000Z"),
      end: new Date("2026-04-01T10:30:00.000Z")
    });
  });

  it("starts post-trial billing at trial end without counting trial days", () => {
    expect(
      agentBillingAnchorAt({
        agentCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
        referenceAt: new Date("2026-07-08T00:00:00.000Z"),
        payments: [
          payment({
            status: "COMPLETED",
            invoiceKind: "TRIAL",
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            periodEnd: new Date("2026-07-08T00:00:00.000Z")
          }),
          payment({
            status: "OVERDUE",
            invoiceKind: "POST_TRIAL",
            periodStart: new Date("2026-07-08T00:00:00.000Z"),
            periodEnd: new Date("2026-08-08T00:00:00.000Z")
          })
        ]
      })
    ).toEqual(new Date("2026-07-08T00:00:00.000Z"));
  });

  it("stores a 30-day period only for subscription purchases", () => {
    const purchasedAt = new Date("2026-07-09T10:15:00.000Z");

    expect(initialAgentPurchasePeriod("SUBSCRIPTION", purchasedAt)).toEqual({
      start: purchasedAt,
      end: new Date("2026-08-08T10:15:00.000Z")
    });
    expect(initialAgentPurchasePeriod("ONE_TIME", purchasedAt)).toEqual({
      start: purchasedAt,
      end: null
    });
  });
});
