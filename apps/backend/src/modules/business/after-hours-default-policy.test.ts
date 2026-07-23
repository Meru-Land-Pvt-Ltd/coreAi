import { describe, expect, it } from "vitest";
import {
  DEFAULT_DENTAL_AFTER_HOURS_POLICY,
  isPlatformDefaultAfterHoursPolicy,
  policyScreensForEmergencies
} from "@coreai/shared";
import { resolveAfterHoursPolicy } from "./after-hours-state";

describe("platform dental after-hours default (no Configure step)", () => {
  it("applies the dental default when nothing was configured", () => {
    const policy = resolveAfterHoursPolicy({ configJson: {} });
    expect(policy).toBe(DEFAULT_DENTAL_AFTER_HOURS_POLICY);
    expect(policy.enabled).toBe(true);
    expect(policy.emergencyCategory).toBe("DENTAL");
    expect(policy.emergencyContactMethod).toBe("SMS");
    expect(policy.offerAppointmentBooking).toBe(true);
    expect(policyScreensForEmergencies(policy)).toBe(true);
  });

  it("a buyer-saved policy always wins over the default", () => {
    const policy = resolveAfterHoursPolicy({
      configJson: {
        afterHoursPolicy: {
          enabled: true,
          emergencyScreeningEnabled: true,
          emergencyCategory: "SERVICE",
          emergencyContactMethod: "EMAIL"
        }
      }
    });
    expect(isPlatformDefaultAfterHoursPolicy(policy)).toBe(false);
    expect(policy.emergencyCategory).toBe("SERVICE");
    expect(policy.emergencyContactMethod).toBe("EMAIL");
  });

  it("a buyer who explicitly disabled after-hours routing stays disabled", () => {
    const policy = resolveAfterHoursPolicy({
      configJson: { afterHoursPolicy: { enabled: false, emergencyCategory: "DENTAL" } }
    });
    expect(policy.enabled).toBe(false);
    expect(isPlatformDefaultAfterHoursPolicy(policy)).toBe(false);
    expect(policyScreensForEmergencies(policy)).toBe(false);
  });

  it("an architect voice-node policy beats the default but not the buyer", () => {
    const workflowJson = {
      nodes: [
        {
          data: {
            type: "ai.voice_conversation",
            afterHoursPolicy: { enabled: true, emergencyScreeningEnabled: true, emergencyCategory: "MEDICAL" }
          }
        }
      ]
    };
    const nodeOnly = resolveAfterHoursPolicy({ configJson: {}, workflowJson });
    expect(nodeOnly.emergencyCategory).toBe("MEDICAL");
    expect(isPlatformDefaultAfterHoursPolicy(nodeOnly)).toBe(false);

    const buyerWins = resolveAfterHoursPolicy({
      configJson: { afterHoursPolicy: { enabled: true, emergencyScreeningEnabled: true, emergencyCategory: "DENTAL" } },
      workflowJson
    });
    expect(buyerWins.emergencyCategory).toBe("DENTAL");
  });

  it("only the frozen singleton counts as the platform default", () => {
    expect(isPlatformDefaultAfterHoursPolicy(DEFAULT_DENTAL_AFTER_HOURS_POLICY)).toBe(true);
    expect(isPlatformDefaultAfterHoursPolicy({ ...DEFAULT_DENTAL_AFTER_HOURS_POLICY })).toBe(false);
    expect(isPlatformDefaultAfterHoursPolicy(null)).toBe(false);
  });
});
