import { describe, expect, it } from "vitest";
import {
  calculateUsageInvoiceLineAmountUsd,
  effectiveUsageInvoiceRateUsd,
  formatUsageInvoiceAmountUsd,
  formatUsageInvoiceRate,
  phoneCallBreakdownOrder,
  usageInvoiceRowOrder
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

  it("shows the dedicated number price without a unit suffix", () => {
    expect(
      formatUsageInvoiceRate({
        serviceCode: "phone_number",
        unit: "PER_UNIT",
        quantity: 1,
        unitPriceUsd: 2,
        billedCostUsd: 2
      })
    ).toBe("$2.00");
  });

  it("orders invoice rows with the number first and platform last", () => {
    const codes = [
      "platform_service",
      "sms_confirmation",
      "phone_call_minutes",
      "phone_number",
      "google_calendar"
    ];
    expect(
      codes.sort(
        (left, right) =>
          usageInvoiceRowOrder(left) - usageInvoiceRowOrder(right)
      )
    ).toEqual([
      "phone_number",
      "phone_call_minutes",
      "sms_confirmation",
      "google_calendar",
      "platform_service"
    ]);
  });

  it("orders the phone-call breakdown like the configured workflow", () => {
    const codes = [
      "elevenlabs_flash_v25",
      "openai_gpt4o_mini",
      "twilio_voice",
      "deepgram_nova3"
    ];
    expect(
      codes.sort(
        (left, right) =>
          phoneCallBreakdownOrder(left) - phoneCallBreakdownOrder(right)
      )
    ).toEqual([
      "twilio_voice",
      "deepgram_nova3",
      "openai_gpt4o_mini",
      "elevenlabs_flash_v25"
    ]);
  });
});
