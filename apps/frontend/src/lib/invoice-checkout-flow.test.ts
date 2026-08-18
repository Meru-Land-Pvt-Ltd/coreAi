import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve relative to this test file so the suite passes regardless of the
// vitest invocation cwd (e.g. `vitest --root apps/frontend` from the repo root).
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const billingSource = readFileSync(
  resolve(frontendRoot, "src/app/business/(protected)/billingandusage/page.tsx"),
  "utf8"
);
const invoiceDetailSource = readFileSync(
  resolve(
    frontendRoot,
    "src/app/business/(protected)/billingandusage/billing/page.tsx"
  ),
  "utf8"
);
const checkoutSource = readFileSync(
  resolve(frontendRoot, "src/app/business/(protected)/checkout/page.tsx"),
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
