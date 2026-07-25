import { describe, expect, it } from "vitest";
import type { UsageLineItem } from "../../lib/usage-pricing";
import {
  customerFacingUsageLineItems,
  rollupCustomerUsageLineItems,
  rollupRecordedUsageLineItems
} from "./usage-invoice-line-items";

function line(
  serviceCode: string,
  serviceName: string,
  invoiceLabel: string | undefined,
  billedCostMicroUsd: number
): UsageLineItem {
  return {
    serviceCode,
    serviceName,
    ...(invoiceLabel ? { invoiceLabel } : {}),
    unit: "PER_MINUTE",
    quantity: 2,
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
});
