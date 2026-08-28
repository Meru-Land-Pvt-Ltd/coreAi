import { describe, expect, it } from "vitest";
import { buildUsageInvoiceData, usageLineItemsInCents } from "./usage-invoice-pdf";

/**
 * THE HALF OF THE BILL WITH NO DOCUMENT (2026-08-28).
 *
 * "Download all invoices" walked the agent purchases only. The monthly usage
 * invoices — most of what a business actually pays us — had no PDF route at
 * all, so they were skipped in silence while the toast said the download was
 * ready.
 */

const billTo = {
  billingName: "Bright Smile Dental",
  billingEmail: "owner@brightsmile.example",
  billingAddress: "12 High Street, 90210"
};

describe("a usage invoice can be rendered", () => {
  it("adds up to the amount we charge, to the cent", () => {
    /* Three rows that each round down on their own. Rounded separately they
       come to 3 cents; the invoice is 4. The rows must reach the total. */
    const items = [
      { serviceName: "Voice minutes", amountMicroUsd: 14_900, quantity: 2, unitPriceMicroUsd: 7_450 },
      { serviceName: "SMS", amountMicroUsd: 14_900, quantity: 3, unitPriceMicroUsd: 4_966 },
      { serviceName: "Platform", amountMicroUsd: 14_900, quantity: 1, unitPriceMicroUsd: 14_900 }
    ];
    const totalMicroUsd = 44_700;

    const rows = usageLineItemsInCents(items, totalMicroUsd, "usd");
    const summed = rows.reduce((total, row) => total + row.amountCents, 0);

    expect(summed).toBe(Math.round(totalMicroUsd / 10_000));
  });

  it("names the month, the agent, and who it is for", () => {
    const data = buildUsageInvoiceData(
      {
        invoiceNumber: "USG-2026-08-001",
        issuedAt: new Date("2026-08-01T00:00:00.000Z"),
        billingMonth: "2026-08",
        totalMicroUsd: 1_234_500,
        currency: "usd",
        status: "OPEN",
        stripePaymentIntentId: null,
        installedAgent: { name: "Reception Agent" },
        lineItems: []
      },
      billTo
    );

    expect(data.amountCents).toBe(123);
    expect(data.agentName).toBe("Reception Agent");
    expect(data.businessName).toBe("Bright Smile Dental");
    expect(data.billingAddress).toBe("12 High Street, 90210");
    /* OPEN is our word, not a word a customer would recognise on a bill. */
    expect(data.status).toBe("PENDING");
    expect(data.lineItems?.[0]?.label).toContain("2026-08");
  });
});
