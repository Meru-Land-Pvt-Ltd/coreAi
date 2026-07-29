import { describe, expect, it } from "vitest";
import { buildTransparentExecutionPricing } from "./transparent-execution-pricing";

describe("transparent execution pricing", () => {
  it("shows only the three buyer-facing pricing categories", () => {
    const result = buildTransparentExecutionPricing({
      voice: {
        billingRatePerMinuteUsd: 0.0664,
        serviceBreakdown: [
          { serviceId: "twilio_voice", billingRateUsd: 0.0085 },
          { serviceId: "deepgram_nova3", billingRateUsd: 0.0077 },
          { serviceId: "google_calendar", billingRateUsd: 0 }
        ]
      },
      sms: { billingRatePerSmsUsd: 0.01 },
      calendar: { billingRateUsd: 1 }
    });

    expect(result).toEqual([
      {
        serviceId: "sms_confirmation",
        label: "SMS confirmation",
        icon: "message",
        billingRateUsd: 0.01
      },
      {
        serviceId: "phone_call_minutes",
        label: "Phone Call Minutes",
        icon: "phone",
        billingRateUsd: 0.0664
      },
      {
        serviceId: "google_calendar",
        label: "Appointment booking",
        icon: "calendar",
        billingRateUsd: 1
      }
    ]);
  });

  it("does not turn unavailable rates into zero-cost prices", () => {
    expect(
      buildTransparentExecutionPricing({
        voice: {
          billingRatePerMinuteUsd: null,
          serviceBreakdown: []
        },
        sms: null,
        calendar: null
      }).every((item) => item.billingRateUsd === null)
    ).toBe(true);
  });

  it("accepts the legacy buyer-safe SMS rate field during rollout", () => {
    const [sms] = buildTransparentExecutionPricing({
      voice: {
        billingRatePerMinuteUsd: 0.05,
        serviceBreakdown: [
          {
            serviceId: "fixture_google_calendar",
            billingRateUsd: 0.002
          }
        ]
      },
      sms: {
        billingRatePerSmsUsd: null,
        billingRateUsd: 0.015
      },
      calendar: null
    });

    expect(sms?.billingRateUsd).toBe(0.015);
  });
});
