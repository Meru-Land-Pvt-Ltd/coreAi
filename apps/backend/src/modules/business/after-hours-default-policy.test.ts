import { describe, expect, it } from "vitest";
import {
  DEFAULT_DENTAL_AFTER_HOURS_POLICY,
  DEFAULT_GENERAL_AFTER_HOURS_POLICY,
  DEFAULT_MEDICAL_AFTER_HOURS_POLICY,
  emergencyCategoryForBusinessType,
  isPlatformDefaultAfterHoursPolicy,
  platformDefaultAfterHoursPolicy,
  policyScreensForEmergencies
} from "@coreai/shared";
import { resolveAfterHoursPolicy } from "./after-hours-state";

describe("platform after-hours default is derived from the business type", () => {
  it("a dental practice still gets the dental screening default", () => {
    const policy = resolveAfterHoursPolicy({ configJson: {}, businessType: "Dental practice" });
    expect(policy).toBe(DEFAULT_DENTAL_AFTER_HOURS_POLICY);
    expect(policy.enabled).toBe(true);
    expect(policy.emergencyCategory).toBe("DENTAL");
    expect(policy.emergencyContactMethod).toBe("SMS");
    expect(policy.offerAppointmentBooking).toBe(true);
    expect(policyScreensForEmergencies(policy)).toBe(true);
  });

  it("a medical practice is categorized as MEDICAL but does not proactively triage by default", () => {
    const policy = resolveAfterHoursPolicy({ configJson: {}, businessType: "Pediatric clinic" });
    expect(policy).toBe(DEFAULT_MEDICAL_AFTER_HOURS_POLICY);
    expect(policy.emergencyCategory).toBe("MEDICAL");
    expect(policyScreensForEmergencies(policy)).toBe(false);
  });

  it("non-clinical businesses get NO proactive screening, so booking is not gated", () => {
    for (const type of ["salon", "AC installation agency", "Law firm", "gym", "Service Business", "restaurant"]) {
      const policy = resolveAfterHoursPolicy({ configJson: {}, businessType: type });
      expect(policy, type).toBe(DEFAULT_GENERAL_AFTER_HOURS_POLICY);
      expect(policy.enabled, type).toBe(true);
      expect(policy.offerAppointmentBooking, type).toBe(true);
      expect(policyScreensForEmergencies(policy), type).toBe(false);
    }
  });

  it("an unknown or missing business type is treated as non-clinical", () => {
    for (const type of [undefined, null, "", "   ", "tufjygkhi", "solo"]) {
      expect(resolveAfterHoursPolicy({ configJson: {}, businessType: type })).toBe(
        DEFAULT_GENERAL_AFTER_HOURS_POLICY
      );
    }
  });

  it("falls back to the buyer's saved businessDetails.businessType when none is passed", () => {
    const dental = resolveAfterHoursPolicy({
      configJson: { businessDetails: { businessType: "dentistry" } }
    });
    expect(dental.emergencyCategory).toBe("DENTAL");

    const salon = resolveAfterHoursPolicy({
      configJson: { businessDetails: { businessType: "salon" } }
    });
    expect(salon.emergencyCategory).toBe("NONE");
  });

  it("a buyer-saved policy always wins over the default", () => {
    const policy = resolveAfterHoursPolicy({
      businessType: "salon",
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
    // Even for a salon, an architect who shipped an explicit node policy wins.
    const nodeOnly = resolveAfterHoursPolicy({ configJson: {}, workflowJson, businessType: "salon" });
    expect(nodeOnly.emergencyCategory).toBe("MEDICAL");
    expect(isPlatformDefaultAfterHoursPolicy(nodeOnly)).toBe(false);

    const buyerWins = resolveAfterHoursPolicy({
      configJson: { afterHoursPolicy: { enabled: true, emergencyScreeningEnabled: true, emergencyCategory: "DENTAL" } },
      workflowJson
    });
    expect(buyerWins.emergencyCategory).toBe("DENTAL");
  });

  it("only the frozen singletons count as platform defaults", () => {
    expect(isPlatformDefaultAfterHoursPolicy(DEFAULT_DENTAL_AFTER_HOURS_POLICY)).toBe(true);
    expect(isPlatformDefaultAfterHoursPolicy(DEFAULT_MEDICAL_AFTER_HOURS_POLICY)).toBe(true);
    expect(isPlatformDefaultAfterHoursPolicy(DEFAULT_GENERAL_AFTER_HOURS_POLICY)).toBe(true);
    expect(isPlatformDefaultAfterHoursPolicy({ ...DEFAULT_DENTAL_AFTER_HOURS_POLICY })).toBe(false);
    expect(isPlatformDefaultAfterHoursPolicy(null)).toBe(false);
  });
});

describe("emergencyCategoryForBusinessType", () => {
  it("maps dental wording", () => {
    for (const type of ["dental", "Dental Practice", "dentist office", "Orthodontics", "oral surgery"]) {
      expect(emergencyCategoryForBusinessType(type), type).toBe("DENTAL");
    }
  });

  it("maps medical wording", () => {
    for (const type of ["medical clinic", "Doctor's surgery", "urgent care", "dermatology", "physiotherapy"]) {
      expect(emergencyCategoryForBusinessType(type), type).toBe("MEDICAL");
    }
  });

  it("leaves everything else at NONE", () => {
    for (const type of ["salon", "barbershop", "gym", "law firm", "HVAC", "plumbing", "carpet cleaning"]) {
      expect(emergencyCategoryForBusinessType(type), type).toBe("NONE");
    }
  });

  it("animal care never screens — 911 is the wrong instruction for a pet", () => {
    for (const type of ["veterinary clinic", "vet surgery", "animal hospital", "pet dental clinic", "pet grooming"]) {
      expect(emergencyCategoryForBusinessType(type), type).toBe("NONE");
    }
  });

  it("dental wins when a human-care type mentions both", () => {
    expect(emergencyCategoryForBusinessType("dental clinic")).toBe("DENTAL");
  });

  it("platformDefaultAfterHoursPolicy agrees with the category mapping", () => {
    expect(platformDefaultAfterHoursPolicy("dental")).toBe(DEFAULT_DENTAL_AFTER_HOURS_POLICY);
    expect(platformDefaultAfterHoursPolicy("clinic")).toBe(DEFAULT_MEDICAL_AFTER_HOURS_POLICY);
    expect(platformDefaultAfterHoursPolicy("salon")).toBe(DEFAULT_GENERAL_AFTER_HOURS_POLICY);
  });
});
