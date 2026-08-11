import { describe, expect, it } from "vitest";
import {
  TRIVEN_AGENT_TAXONOMY,
  TRIVEN_AGENT_TAXONOMY_ENTRIES,
  suggestedAgentNameForSubindustry,
  targetIndustryForSubindustry
} from "./agent-industry-taxonomy";
import {
  getCategoriesForIndustry,
  industryTagsForCategorySelection,
  resolveBrowseIndustries,
  tagsMatchVerticalCategory
} from "./industry-browse";
import { normalizeAgentConfigure } from "./agent-configure";

describe("Triven target agent taxonomy", () => {
  it("contains the requested 25 Architect-created agent targets", () => {
    expect(TRIVEN_AGENT_TAXONOMY_ENTRIES).toHaveLength(25);
    expect(TRIVEN_AGENT_TAXONOMY.Healthcare).toHaveLength(18);
    expect(TRIVEN_AGENT_TAXONOMY["Real Estate"]).toHaveLength(2);
    expect(TRIVEN_AGENT_TAXONOMY.Automotive).toHaveLength(3);
    expect(TRIVEN_AGENT_TAXONOMY.Legal).toHaveLength(2);
  });

  it("maps exact subindustries to the expected suggested agent names", () => {
    expect(suggestedAgentNameForSubindustry("Dental Clinics")).toBe("Dental AI Receptionist");
    expect(suggestedAgentNameForSubindustry("Commercial Real Estate")).toBe("Commercial Property AI Agent");
    expect(suggestedAgentNameForSubindustry("Car Rental Services")).toBe("Car Rental Reservation AI");
    expect(suggestedAgentNameForSubindustry("Notary Services")).toBe("Notary Appointment AI");
  });

  it("resolves exact subindustries back to their parent industries", () => {
    expect(targetIndustryForSubindustry("Cardiology Clinics")).toBe("Healthcare");
    expect(targetIndustryForSubindustry("Residential Real Estate")).toBe("Real Estate");
    expect(targetIndustryForSubindustry("Auto Service Centers")).toBe("Automotive");
    expect(targetIndustryForSubindustry("Law Firms")).toBe("Legal");
  });

  it("exposes the exact target subindustries in Architect industry filtering", () => {
    expect(getCategoriesForIndustry("Healthcare")).toContain("Fertility Clinics");
    expect(getCategoriesForIndustry("Real Estate")).toEqual([
      "Residential Real Estate",
      "Commercial Real Estate"
    ]);
    expect(getCategoriesForIndustry("Automotive")).toEqual([
      "Car Dealerships",
      "Auto Service Centers",
      "Car Rental Services"
    ]);
    expect(getCategoriesForIndustry("Legal")).toEqual(["Law Firms", "Notary Services"]);
  });

  it("persists parent industry + exact subindustry + compatibility aliases", () => {
    const tags = industryTagsForCategorySelection("Automotive", "Auto Service Centers");
    const normalized = normalizeAgentConfigure({
      basics: {
        category: "Auto Service Centers",
        industryTags: tags
      }
    });

    expect(normalized.basics.industryTags).toContain("Automotive");
    expect(normalized.basics.industryTags).toContain("Auto Service Centers");
    expect(normalized.basics.industryTags).toContain("Auto Repair");
    expect(resolveBrowseIndustries(normalized.basics.industryTags)).toContain("Automotive");
    expect(tagsMatchVerticalCategory(normalized.basics.industryTags, "Auto Service Centers")).toBe(true);
    expect(tagsMatchVerticalCategory(normalized.basics.industryTags, "Car Dealerships")).toBe(false);
  });
});
