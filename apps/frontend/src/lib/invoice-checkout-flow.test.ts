import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const billingSource = readFileSync(
  resolve(process.cwd(), "src/app/business/(protected)/billingandusage/page.tsx"),
  "utf8"
);
const invoiceDetailSource = readFileSync(
  resolve(
    process.cwd(),
    "src/app/business/(protected)/billingandusage/billing/page.tsx"
  ),
  "utf8"
);
const checkoutSource = readFileSync(
  resolve(process.cwd(), "src/app/business/(protected)/checkout/page.tsx"),
  "utf8"
);

describe("invoice checkout flow", () => {
  it("never charges an invoice directly from billing pages", () => {
    for (const source of [billingSource, invoiceDetailSource]) {
      expect(source).not.toContain(
        "`/payments/invoices/${invoice.id}/pay`"
      );
      expect(source).not.toContain(
        "`/business/billing/usage-invoices/${invoice.id}/pay`"
      );
      expect(source).toContain("businessInvoiceCheckoutPath");
    }
  });

  it("settles the exact invoice in checkout and only accepts PAID", () => {
    expect(checkoutSource).toContain(
      "`/payments/invoices/${invoiceId}/pay`"
    );
    expect(checkoutSource).toContain(
      "`/business/billing/usage-invoices/${invoiceId}/pay`"
    );
    expect(checkoutSource).toContain(
      'response.data?.status?.toUpperCase() !== "PAID"'
    );
    expect(checkoutSource).toContain('mode: "invoice"');
  });
});
