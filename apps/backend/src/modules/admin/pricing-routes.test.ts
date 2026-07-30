import { describe, expect, it } from "vitest";
import {
  isValidPhoneCallBreakdownSelection,
  serializeUsageService
} from "./pricing-routes";

describe("admin pricing phone-call breakdown fields", () => {
  it("allows selected services only when they are billed per minute", () => {
    expect(isValidPhoneCallBreakdownSelection(true, "PER_MINUTE")).toBe(true);
    expect(isValidPhoneCallBreakdownSelection(true, "PER_SMS")).toBe(false);
    expect(isValidPhoneCallBreakdownSelection(true, "PER_CALL")).toBe(false);
    expect(isValidPhoneCallBreakdownSelection(true, "PER_UNIT")).toBe(false);
    expect(isValidPhoneCallBreakdownSelection(false, "PER_UNIT")).toBe(true);
  });

  it("serializes the admin-managed visibility flag", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");

    expect(
      serializeUsageService({
        id: "price-1",
        code: "twilio_voice",
        name: "Twilio Voice",
        role: "Inbound call connectivity",
        unit: "PER_MINUTE",
        actualCostMicroUsd: 8_500,
        updatedCostMicroUsd: 8_500,
        showInPhoneCallBreakdown: true,
        isActive: true,
        sortOrder: 10,
        createdAt: now,
        updatedAt: now
      })
    ).toMatchObject({
      code: "twilio_voice",
      actualCostUsd: 0.0085,
      updatedCostUsd: 0.0085,
      showInPhoneCallBreakdown: true
    });
  });
});
