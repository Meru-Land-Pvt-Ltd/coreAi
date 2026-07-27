import { describe, expect, it } from "vitest";
import {
  calculateUsageInvoiceLineAmountUsd,
  effectiveUsageInvoiceRateUsd,
  formatUsageInvoiceAmountUsd,
  formatUsageInvoiceRate
} from "./usage-invoice-rate";

describe("usage invoice rate formatting", () => {
  it("shows the Admin Billing Cost supplied by the invoice API", () => {
    const row = {
      unit: "PER_MINUTE",
      quantity: 5,
      unitPriceUsd: 0.335,
      billedCostUsd: 1.675
    };

    expect(effectiveUsageInvoiceRateUsd(row)).toBe(0.335);
    expect(formatUsageInvoiceRate(row)).toBe("$0.335 / min");
  });

  it("rounds invoice rates to at most three decimal places", () => {
    expect(
      formatUsageInvoiceRate({
        unit: "PER_MINUTE",
        quantity: 9.27,
        unitPriceUsd: 0.3345,
        billedCostUsd: 3.1017
      })
    ).toBe("$0.335 / min");
  });

  it("shows usage line amounts with exactly three decimal places", () => {
    expect(formatUsageInvoiceAmountUsd(0.009 * 9.27)).toBe("$0.083");
    expect(formatUsageInvoiceAmountUsd(9.27)).toBe("$9.270");
  });

  it("calculates line amounts from the rounded values displayed on the invoice", () => {
    const quantity = 9.2727;
    expect(
      calculateUsageInvoiceLineAmountUsd({
        unit: "PER_MINUTE",
        quantity,
        unitPriceUsd: 0.0085,
        billedCostUsd: 0.0788
      })
    ).toBe(0.083);
    expect(
      calculateUsageInvoiceLineAmountUsd({
        unit: "PER_MINUTE",
        quantity,
        unitPriceUsd: 1,
        billedCostUsd: 9.2727
      })
    ).toBe(9.27);
  });

  it("maps Admin Billing Cost for SMS, call, and unit billing bases", () => {
    expect(
      formatUsageInvoiceRate({
        unit: "PER_SMS",
        quantity: 2,
        unitPriceUsd: 0.01,
        billedCostUsd: 0.02
      })
    ).toBe("$0.01 / SMS");
    expect(
      formatUsageInvoiceRate({
        unit: "PER_CALL",
        quantity: 1,
        unitPriceUsd: 0.25,
        billedCostUsd: 0.25
      })
    ).toBe("$0.25 / call");
    expect(
      formatUsageInvoiceRate({
        unit: "PER_UNIT",
        quantity: 1,
        unitPriceUsd: 2,
        billedCostUsd: 2
      })
    ).toBe("$2.00 / unit");
  });
});
