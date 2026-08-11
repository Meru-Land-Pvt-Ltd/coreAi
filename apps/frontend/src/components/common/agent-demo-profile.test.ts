import { describe, expect, it } from "vitest";
import { getAgentDemoProfile } from "./agent-demo-profile";

describe("getAgentDemoProfile", () => {
  it("uses legal-specific labels for law firms", () => {
    const profile = getAgentDemoProfile({
      listingName: "Legal Receptionist AI",
      industry: "Legal",
      subindustry: "Law Firms"
    });

    expect(profile.businessNameLabel).toBe("Law Firm Name");
    expect(profile.contactNameLabel).toContain("Attorney");
    expect(profile.servicesLabel).toContain("Practice Areas");
  });

  it("uses dealership labels for vehicle sales agents", () => {
    const profile = getAgentDemoProfile({
      listingName: "Vehicle Sales AI Agent",
      industry: "Automotive",
      subindustry: "Car Dealerships"
    });

    expect(profile.businessNameLabel).toBe("Dealership Name");
    expect(profile.servicesLabel).toContain("Vehicle");
  });

  it("uses brokerage labels for real estate agents", () => {
    const profile = getAgentDemoProfile({
      listingName: "Residential Property AI Agent",
      industry: "Real Estate",
      subindustry: "Residential Real Estate"
    });

    expect(profile.businessNameLabel).toBe("Agency / Brokerage Name");
    expect(profile.contactNameLabel).toContain("Agent / Broker");
  });

  it("keeps healthcare provider wording without dental-only defaults", () => {
    const profile = getAgentDemoProfile({
      listingName: "Cardiology AI Receptionist",
      industry: "Healthcare",
      subindustry: "Cardiology Clinics"
    });

    expect(profile.businessNameLabel).toBe("Cardiology Clinic Name");
    expect(profile.contactNameLabel).toBe("Provider / Team Contact");
    expect(profile.servicesPlaceholder).not.toContain("Tooth Extraction");
  });
});
