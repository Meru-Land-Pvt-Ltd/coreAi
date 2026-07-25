import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { retrieveRelevantKnowledge } from "./agent-knowledge";
import {
  detectFactIntents,
  extractAddressFromDocuments,
  formatAddressOneLine,
  isAddressComplete,
  loadBusinessFacts,
  lookupStructuredFacts
} from "./business-facts";
import { ingestKnowledgeFiles } from "./knowledge-files";

/**
 * Foundational business facts + address retrieval: structured configuration is
 * authoritative, PDF text is the fallback, paraphrased location questions all
 * retrieve the address, and nothing is ever invented.
 */

const RUN = `bizfacts-${process.pid}-${Date.now().toString(36)}`;

const ADDRESS_QUESTIONS = [
  "What is your address?",
  "Where is the clinic?",
  "Where are you located?",
  "What is your location?",
  "How can I reach your office?",
  "Where should I come for my appointment?",
  "Can you give me directions?",
  "Which part of the city are you in?",
  "Can you send me the address?",
  "Where do I need to arrive?"
];

// A normal brochure — heading/value layout with a MULTI-LINE address, plus
// unrelated sections that must not outrank the contact section.
const BROCHURE = [
  "Patient Reviews",
  "“Wonderful, gentle care!” — a happy patient. Rated 4.9 stars by hundreds of patients.",
  "",
  "Clinic Information",
  "Address",
  "4821 Maple Crest Drive,",
  "Riverton, Colorado 81201",
  "",
  "Parking",
  "Free patient parking behind the building.",
  "",
  "Cancellation Policy",
  "Please give 24 hours notice for cancellations. Late cancellations may incur a fee."
].join("\n");

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let otherBusinessId = "";
let workflowId = "";
let agentId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[business-facts.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Dental`, type: "clinic" } })
  ).id;
  otherBusinessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Other`, type: "spa" } })
  ).id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;
  agentId = (
    await prisma.installedAgent.create({ data: { businessId, workflowId, name: `${RUN} agent` } })
  ).id;

  await prisma.businessProfile.create({ data: { businessId, timeZone: "America/Denver" } });

  await ingestKnowledgeFiles({
    businessId,
    installedAgentId: agentId,
    files: [{ filename: "brochure.txt", mimeType: "text/plain", bytes: Buffer.from(BROCHURE) }]
  });
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.businessKnowledgeFile.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessProfile.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("address formatting and validation", () => {
  it("formats a multi-part address as one logical fact", () => {
    const address = {
      line1: "4821 Maple Crest Drive",
      line2: null,
      city: "Riverton",
      state: "Colorado",
      postalCode: "81201",
      country: null,
      landmark: null,
      directions: null,
      mapsLink: null,
      source: "manual",
      confirmedAt: null
    };
    expect(formatAddressOneLine(address)).toBe("4821 Maple Crest Drive, Riverton, Colorado 81201");
    expect(isAddressComplete(address)).toBe(true);
    expect(isAddressComplete({ ...address, city: null })).toBe(false);
  });
});

describe("fact intent detection", () => {
  it("recognizes every paraphrased location question", () => {
    for (const question of ADDRESS_QUESTIONS) {
      expect(detectFactIntents(question), question).toContain("address");
    }
  });

  it("does not fire the address intent on unrelated questions", () => {
    expect(detectFactIntents("How much does a cleaning cost?")).not.toContain("address");
    expect(detectFactIntents("Do you accept my insurance plan?")).not.toContain("address");
  });
});

describe("PDF address extraction", () => {
  it("extracts the multi-line heading/value address as ONE suggestion", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const suggestion = await extractAddressFromDocuments({ businessId, installedAgentId: agentId });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.formatted).toBe("4821 Maple Crest Drive, Riverton, Colorado 81201");
    expect(suggestion!.line1).toBe("4821 Maple Crest Drive");
    expect(suggestion!.city).toBe("Riverton");
    expect(suggestion!.state).toBe("Colorado");
    expect(suggestion!.postalCode).toBe("81201");
    expect(suggestion!.sourceFilename).toBe("brochure.txt");
  });

  it("extracts table-style addresses (heading and value collapsed by layout)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [file] = await ingestKnowledgeFiles({
      businessId: otherBusinessId,
      files: [
        {
          filename: "table.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("Contact | Details\nOffice | 77 Birchwood Avenue, Lakemont, Oregon 97401\nPhone | (555) 010-2000")
        }
      ]
    });
    expect(file.status).toBe("PROCESSED");

    const suggestion = await extractAddressFromDocuments({ businessId: otherBusinessId });
    expect(suggestion?.formatted).toBe("77 Birchwood Avenue, Lakemont, Oregon 97401");
  });

  it("returns null when no confident address exists — never invents one", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    await prisma.businessKnowledgeBase.deleteMany({ where: { businessId: otherBusinessId } });
    expect(await extractAddressFromDocuments({ businessId: otherBusinessId })).toBeNull();
  });
});

describe("hybrid retrieval for paraphrased questions", () => {
  it("every location paraphrase retrieves the contact chunk from the brochure", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    for (const question of ADDRESS_QUESTIONS) {
      const hits = await retrieveRelevantKnowledge({
        businessId,
        installedAgentId: agentId,
        query: question
      });
      const joined = hits.map((hit) => hit.content).join("\n");
      expect(joined, question).toContain("4821 Maple Crest Drive");
    }
  });

  it("contact sections outrank unrelated review/policy chunks for location questions", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const hits = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentId,
      query: "Where are you located?"
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain("4821 Maple Crest Drive");
  });
});

describe("structured facts priority", () => {
  it("a confirmed structured address answers first, exactly, for every paraphrase", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await prisma.businessProfile.update({
      where: { businessId },
      data: {
        addressLine1: "900 Summit Plaza",
        addressCity: "Riverton",
        addressState: "Colorado",
        addressPostalCode: "81205",
        addressSource: "manual",
        addressConfirmedAt: new Date()
      }
    });

    for (const question of ADDRESS_QUESTIONS) {
      const sections = await lookupStructuredFacts({ businessId, query: question });
      expect(sections.length, question).toBeGreaterThan(0);
      expect(sections[0].content).toContain("900 Summit Plaza, Riverton, Colorado 81205");
      expect(sections[0].score).toBe(100);
    }

    const facts = await loadBusinessFacts(businessId);
    expect(facts?.addressConfirmed).toBe(true);
    // The PDF still says Maple Crest — the confirmed structured value wins and
    // the document remains intact as knowledge (conflict is surfaced in the UI).
    expect(facts?.addressFormatted).toBe("900 Summit Plaza, Riverton, Colorado 81205");
  });

  it("without structured data the facts lookup returns nothing (documents are the fallback)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    expect(await lookupStructuredFacts({ businessId: otherBusinessId, query: "What is your address?" })).toHaveLength(0);
  });

  it("businesses stay isolated — one business's address never answers for another", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const sections = await lookupStructuredFacts({ businessId: otherBusinessId, query: "Where are you located?" });
    expect(JSON.stringify(sections)).not.toContain("Summit Plaza");
  });
});
