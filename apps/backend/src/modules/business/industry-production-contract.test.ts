import { describe, expect, it } from "vitest";
import {
  DEFAULT_DENTAL_AFTER_HOURS_POLICY,
  DEFAULT_MEDICAL_AFTER_HOURS_POLICY,
  TRIVEN_AGENT_TAXONOMY_ENTRIES,
  industryTagsForCategorySelection,
  resolveBrowseIndustries,
  tagsMatchVerticalCategory,
  targetIndustryForSubindustry
} from "@coreai/shared";
import {
  normalizeOnboardingTaxonomy,
  onboardingInvalidTargetSubindustry,
  onboardingTaxonomyMismatch,
  scoreListingForOnboarding
} from "./onboarding-routes";

describe("cross-industry production contract", () => {
  it("keeps the exact 25 launch mappings unique", () => {
    expect(TRIVEN_AGENT_TAXONOMY_ENTRIES).toHaveLength(25);
    expect(new Set(TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => entry.subindustry)).size).toBe(25);
    expect(new Set(TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => entry.agentName)).size).toBe(25);
  });

  it("rejects unknown subindustries under a protected launch industry", () => {
    expect(
      onboardingInvalidTargetSubindustry({
        industry: "Legal",
        businessType: "Random Consultancy"
      })
    ).toBe("Random Consultancy");
  });

  it("rejects an Industry/Subindustry mismatch", () => {
    expect(targetIndustryForSubindustry("Residential Real Estate")).toBe("Real Estate");
    expect(onboardingTaxonomyMismatch({ industry: "Automotive", businessType: "Residential Real Estate" })).toEqual({
      expected: "Real Estate",
      actual: "Automotive"
    });
  });

  it("keeps legacy dental onboarding compatible", () => {
    expect(normalizeOnboardingTaxonomy({ businessType: "solo" })).toMatchObject({
      businessType: "Dental Clinics",
      industry: "Healthcare"
    });
  });

  it("ranks exact subindustry matches above generic cross-industry matches", () => {
    const buyer = { industry: "Legal", businessType: "Law Firms", challenges: ["scheduling"] };
    const law = scoreListingForOnboarding(
      { id: "law", name: "Legal Receptionist AI", category: "Law Firms", industryTags: ["Legal", "Law Firms"], tags: ["booking"] },
      buyer
    );
    const dental = scoreListingForOnboarding(
      { id: "dental", name: "Dental AI Receptionist", category: "Dental Clinics", industryTags: ["Healthcare", "Dental Clinics"], tags: ["booking"] },
      buyer
    );
    expect(law.score).toBeGreaterThan(dental.score);
  });

  it("does not proactively triage medical callers by platform default", () => {
    expect(DEFAULT_MEDICAL_AFTER_HOURS_POLICY.emergencyCategory).toBe("MEDICAL");
    expect(DEFAULT_MEDICAL_AFTER_HOURS_POLICY.emergencyScreeningEnabled).toBe(false);
    expect(DEFAULT_DENTAL_AFTER_HOURS_POLICY.emergencyScreeningEnabled).toBe(true);
  });
  it.each([
    ["Healthcare", "Dental Clinics"],
    ["Real Estate", "Residential Real Estate"],
    ["Automotive", "Car Dealerships"],
    ["Legal", "Law Firms"]
  ])("carries %s / %s through marketplace matching", (industry, subindustry) => {
    const tags = industryTagsForCategorySelection(industry as Parameters<typeof industryTagsForCategorySelection>[0], subindustry);
    expect(resolveBrowseIndustries(tags)).toContain(industry);
    expect(tagsMatchVerticalCategory(tags, subindustry)).toBe(true);
    const match = scoreListingForOnboarding(
      { id: `${industry}-${subindustry}`, name: `${subindustry} Agent`, category: subindustry, industryTags: tags },
      { industry, businessType: subindustry, challenges: ["scheduling"] }
    );
    expect(match.score).toBeGreaterThanOrEqual(85);
  });

});
