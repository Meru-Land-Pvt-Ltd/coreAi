import { describe, expect, it } from "vitest";
import type { UsageLineItem } from "../../lib/usage-pricing";
import {
  customerFacingUsageLineItems,
  repriceUsageInvoiceLineItems,
  rollupCustomerUsageLineItems,
  rollupRecordedUsageLineItems,
  usageInvoiceBillingRateMicroUsd
} from "./usage-invoice-line-items";

function line(
  serviceCode: string,
  serviceName: string,
  invoiceLabel: string | undefined,
  billedCostMicroUsd: number,
  billingRateMicroUsd?: number
): UsageLineItem {
  return {
    serviceCode,
    serviceName,
    ...(invoiceLabel ? { invoiceLabel } : {}),
    unit: "PER_MINUTE",
    quantity: 2,
    ...(billingRateMicroUsd === undefined ? {} : { billingRateMicroUsd }),
    actualCostMicroUsd: 10,
    billedCostMicroUsd
  };
}

function unusedLine(serviceCode: string): UsageLineItem {
  return {
    serviceCode,
    serviceName: "Unused service",
    invoiceLabel: "Unused invoice item",
    unit: "PER_UNIT",
    quantity: 0,
    actualCostMicroUsd: 0,
    billedCostMicroUsd: 0
  };
}

describe("customer-facing usage invoice lines", () => {
  it("uses the immutable Admin Invoice label instead of the vendor service name", () => {
    const rows = customerFacingUsageLineItems(
      [line("voice_vendor", "Do not expose this vendor", "Inbound connectivity", 40)],
      new Map([["voice_vendor", "A newer label"]])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceCode: "voice_vendor",
      serviceName: "Inbound connectivity",
      invoiceLabel: "Inbound connectivity",
      billedCostMicroUsd: 40
    });
    expect(rows[0]?.serviceName).not.toContain("vendor");
  });

  it("uses the current Admin Invoice label when a historical snapshot has none", () => {
    const rows = customerFacingUsageLineItems(
      [line("speech_to_text", "Internal STT service", undefined, 75)],
      new Map([["speech_to_text", "Speech transcription"]])
    );

    expect(rows[0]?.invoiceLabel).toBe("Speech transcription");
  });

  it("combines every platform service under one Platform service line", () => {
    const rows = rollupCustomerUsageLineItems(
      [
        [line("database_storage", "Internal database", "Call records", 30)],
        [line("google_calendar", "Calendar vendor", "Appointments", 20)]
      ],
      new Map()
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceCode: "platform_service",
      serviceName: "Platform service",
      invoiceLabel: "Platform service",
      unit: "PER_MINUTE",
      quantity: 4,
      billedCostMicroUsd: 50
    });
  });

  it("uses the execution count for a unit-priced Platform service", () => {
    const billingCosts = new Map([
      [
        "database_storage",
        {
          unit: "PER_UNIT" as const,
          billingCostMicroUsd: 500_000
        }
      ],
      [
        "google_calendar",
        {
          unit: "PER_UNIT" as const,
          billingCostMicroUsd: 0
        }
      ]
    ]);
    const rows = rollupCustomerUsageLineItems(
      [
        repriceUsageInvoiceLineItems(
          [
            { ...line("database_storage", "Internal database", "Call records", 30), quantity: 9.27 },
            { ...line("google_calendar", "Calendar vendor", "Appointments", 0), quantity: 9.27 }
          ],
          billingCosts
        ),
        repriceUsageInvoiceLineItems(
          [
            { ...line("database_storage", "Internal database", "Call records", 30), quantity: 4.5 },
            { ...line("google_calendar", "Calendar vendor", "Appointments", 0), quantity: 4.5 }
          ],
          billingCosts
        )
      ],
      new Map()
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceCode: "platform_service",
      unit: "PER_UNIT",
      quantity: 2,
      billingRateMicroUsd: 500_000,
      billedCostMicroUsd: 1_000_000
    });
  });

  it("keeps usage services separate with their recorded names and codes", () => {
    const rows = rollupRecordedUsageLineItems([
      [
        line("twilio_voice", "Twilio Voice", "Inbound connectivity", 40),
        line("deepgram_nova3", "Deepgram Nova 3", "Transcription", 30)
      ],
      [line("twilio_voice", "Twilio Voice", "Inbound connectivity", 20)]
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      serviceCode: "twilio_voice",
      serviceName: "Twilio Voice",
      quantity: 4,
      billedCostMicroUsd: 60
    });
    expect(rows[1]).toMatchObject({
      serviceCode: "deepgram_nova3",
      serviceName: "Deepgram Nova 3",
      quantity: 2,
      billedCostMicroUsd: 30
    });
  });

  it("omits configured services that recorded no usage and no cost", () => {
    expect(
      customerFacingUsageLineItems(
        [unusedLine("unused_number"), line("voice", "Voice", "Voice usage", 20)],
        new Map()
      )
    ).toHaveLength(1);
    expect(rollupRecordedUsageLineItems([[unusedLine("unused_number")]])).toEqual([]);
  });

  it("keeps the Admin Billing Cost snapshot when all usage has the same rate", () => {
    const rolledUp = rollupCustomerUsageLineItems(
      [
        [line("voice", "Voice", "Voice usage", 670_000, 335_000)],
        [line("voice", "Voice", "Voice usage", 670_000, 335_000)]
      ],
      new Map()
    );
    const row = rolledUp[0];

    expect(row?.quantity).toBe(4);
    expect(row?.billedCostMicroUsd).toBe(1_340_000);
    expect(row?.billingRateMicroUsd).toBe(335_000);
    expect(row && usageInvoiceBillingRateMicroUsd(row)).toBe(335_000);
  });

  it("derives an effective rate only when Admin Billing Cost changed during the invoice", () => {
    const rolledUp = rollupCustomerUsageLineItems(
      [
        [line("voice", "Voice", "Voice usage", 20_000, 10_000)],
        [line("voice", "Voice", "Voice usage", 28_000, 14_000)]
      ],
      new Map()
    );
    const row = rolledUp[0];

    expect(row?.quantity).toBe(4);
    expect(row?.billedCostMicroUsd).toBe(48_000);
    expect(row?.billingRateMicroUsd).toBeUndefined();
    expect(row && usageInvoiceBillingRateMicroUsd(row)).toBe(12_000);
  });

  it("calculates the buyer amount from the current Admin Billing Cost", () => {
    const [repriced] = repriceUsageInvoiceLineItems(
      [line("voice", "Voice", "Voice usage", 100_000, 50_000)],
      new Map([
        [
          "voice",
          {
            unit: "PER_MINUTE",
            billingCostMicroUsd: 1_000_000
          }
        ]
      ])
    );

    expect(repriced).toMatchObject({
      unit: "PER_MINUTE",
      quantity: 2,
      billingRateMicroUsd: 1_000_000,
      billedCostMicroUsd: 2_000_000
    });
  });
});
