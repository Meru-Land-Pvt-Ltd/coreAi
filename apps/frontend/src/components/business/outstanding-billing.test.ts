import { describe, expect, it } from "vitest";
import {
  outstandingExecutionCents,
  outstandingSubscriptionCents
} from "./outstanding-billing";

describe("outstanding billing totals", () => {
  it("totals only pending and overdue subscription debts", () => {
    expect(
      outstandingSubscriptionCents([
        {
          amountCents: 10_000,
          status: "PENDING",
          invoiceKind: "POST_TRIAL"
        },
        {
          amountCents: 20_000,
          status: "OVERDUE",
          invoiceKind: "SUBSCRIPTION_RENEWAL"
        },
        {
          amountCents: 30_000,
          status: "SUCCEEDED",
          invoiceKind: "SUBSCRIPTION_RENEWAL"
        },
        {
          amountCents: 40_000,
          status: "PENDING",
          invoiceKind: "PURCHASE"
        }
      ])
    ).toBe(30_000);
  });

  it("totals real unpaid execution invoices without projections", () => {
    expect(
      outstandingExecutionCents([
        { amountCents: 1_200, status: "OPEN" },
        { amountCents: 2_400, status: "PENDING" },
        { amountCents: 3_600, status: "OVERDUE" },
        { amountCents: 9_900, status: "PAID" }
      ])
    ).toBe(7_200);
  });
});
