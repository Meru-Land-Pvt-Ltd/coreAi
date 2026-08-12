import assert from "node:assert/strict";
import {
  TRIVEN_AGENT_TAXONOMY,
  TRIVEN_AGENT_TAXONOMY_ENTRIES,
  suggestedAgentNameForSubindustry,
  targetIndustryForSubindustry,
  getCategoriesForIndustry,
  industryTagsForCategorySelection,
  resolveBrowseIndustries,
  tagsMatchVerticalCategory,
  agentMatchesSearchQuery
} from "../packages/shared/dist/index.js";

assert.equal(TRIVEN_AGENT_TAXONOMY_ENTRIES.length, 24);
assert.equal(TRIVEN_AGENT_TAXONOMY.Healthcare.length, 17);
assert.equal(TRIVEN_AGENT_TAXONOMY["Real Estate"].length, 2);
assert.equal(TRIVEN_AGENT_TAXONOMY.Automotive.length, 3);
assert.equal(TRIVEN_AGENT_TAXONOMY.Legal.length, 2);
assert.equal(new Set(TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => entry.subindustry)).size, 24);
assert.equal(new Set(TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => entry.agentName)).size, 24);
assert.equal(suggestedAgentNameForSubindustry("Commercial Real Estate"), "Commercial Property AI Agent");
assert.equal(suggestedAgentNameForSubindustry("Car Rental Services"), "Car Rental Reservation AI");
assert.equal(suggestedAgentNameForSubindustry("Notary Services"), "Notary Appointment AI");
assert.equal(targetIndustryForSubindustry("Law Firms"), "Legal");
assert.deepEqual(getCategoriesForIndustry("Real Estate"), ["Residential Real Estate", "Commercial Real Estate"]);
const automotiveTags = industryTagsForCategorySelection("Automotive", "Auto Service Centers");
assert.ok(resolveBrowseIndustries(automotiveTags).includes("Automotive"));
assert.ok(tagsMatchVerticalCategory(automotiveTags, "Auto Service Centers"));
assert.ok(!tagsMatchVerticalCategory(automotiveTags, "Car Dealerships"));
assert.deepEqual(resolveBrowseIndustries(["Custom"]), ["SaaS & Technology"]);
assert.deepEqual(resolveBrowseIndustries(["Education", "Tutoring", "Custom"]), ["Education"]);
assert.deepEqual(resolveBrowseIndustries(["Software Companies"]), ["SaaS & Technology"]);
assert.equal(
  agentMatchesSearchQuery(
    {
      name: "Clinic Front Desk AI",
      category: "Dental Clinics",
      description: "Answers missed calls",
      tags: [],
      industries: ["Healthcare", "Dental Clinics"]
    },
    "saas technology"
  ),
  false
);
console.log("Industry taxonomy production contract: PASS (24/24)");
