import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { describe, expect, it } from "vitest";
import { buildInvoicePdfBuffer } from "./mailer";

describe("invoice PDF generation", () => {
  it("includes itemized rows and shows zero paid for an unpaid invoice", async () => {
    const pdf = await buildInvoicePdfBuffer({
      invoiceNumber: "USE-2026-0001",
      date: new Date("2026-07-25T10:30:00.000Z"),
      businessName: "Asha Clinic",
      businessEmail: "billing@example.com",
      billingAddress: "42 Example Street",
      agentName: "Reception Agent",
      description: "July agent usage",
      amountCents: 1525,
      currency: "usd",
      status: "OVERDUE",
      lineItems: [
        {
          label: "Voice service",
          quantity: 3,
          unitPriceDisplay: "$4.00",
          amountCents: 1200
        },
        { label: "Text messaging service", amountCents: 325 }
      ]
    });
    const parsed = await pdfParse(pdf);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(parsed.text).toContain("USE-2026-0001");
    expect(parsed.text).toContain("Voice service");
    expect(parsed.text).toContain("Text messaging service");
    expect(parsed.text).toContain("$4.00");
    expect(parsed.text).toContain("OVERDUE");
    expect(parsed.text).toContain("Amount Paid");
    expect(parsed.text).toContain("$0.00");
    expect(parsed.text).toContain("Balance Due");
    expect(parsed.text).toContain("$15.25");
  });

  it("continues long itemized invoices onto additional pages", async () => {
    const pdf = await buildInvoicePdfBuffer({
      invoiceNumber: "USE-2026-LONG",
      date: new Date("2026-07-25T10:30:00.000Z"),
      businessName: "Asha Clinic",
      businessEmail: "billing@example.com",
      agentName: "Reception Agent",
      description: "Long usage invoice",
      amountCents: 2400,
      currency: "usd",
      status: "PAID",
      lineItems: Array.from({ length: 18 }, (_, index) => ({
        label: `Usage service ${index + 1}`,
        amountCents: 100 + index
      }))
    });
    const parsed = await pdfParse(pdf);

    expect(parsed.numpages).toBeGreaterThan(1);
    expect(parsed.text).toContain("Usage service 1");
    expect(parsed.text).toContain("Usage service 18");
    expect(parsed.text).toContain("INVOICE - CONTINUED");
  });
});
