import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { retrieveRelevantKnowledge } from "./agent-knowledge";
import { ingestKnowledgeFiles } from "./knowledge-files";

/**
 * QA (2026-07-29): "If a hospital document contains multiple doctor names, the
 * AI only captures the doctor name displayed on the UI/profile card and ignores
 * the additional doctor names mentioned within the uploaded document."
 *
 * A roster spans several chunks, but retrieval returned a fixed top-4 lexical
 * cut, so "who are all your doctors?" surfaced whichever single chunk scored
 * highest and the agent answered as though that was the whole team.
 */

const RUN = `enum-${process.pid}-${Date.now().toString(36)}`;

/* Long enough to be split into several chunks, with the roster deliberately
   spread across the document the way a real brochure spreads it. */
const FILLER = (label: string) =>
  `${label}. ${"Our practice has served the community for many years and is committed to gentle, modern care for every patient who walks through our doors. ".repeat(12)}`;

const HOSPITAL_BROCHURE = [
  "About Us",
  FILLER("Welcome to Riverton Medical Center"),
  "",
  "Our Doctors",
  "Dr. Amelia Hart — Cardiology. Board certified, 18 years of practice.",
  "Dr. Rajesh Menon — Orthopaedics. Specialises in sports injuries.",
  FILLER("Patient experience"),
  "Dr. Clara Whitfield — Paediatrics. Sees children from birth to sixteen.",
  "Dr. Samuel Okoye — Dermatology. Clinic runs Tuesdays and Thursdays.",
  FILLER("Facilities"),
  "Dr. Priya Raghavan — Neurology. Available for referrals only.",
  "",
  "Parking",
  "Free patient parking is available behind the building."
].join("\n");

const DOCTORS = [
  "Amelia Hart",
  "Rajesh Menon",
  "Clara Whitfield",
  "Samuel Okoye",
  "Priya Raghavan"
];

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let workflowId = "";
let agentId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[knowledge-enumeration.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Hospital`, type: "clinic" } })
  ).id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;
  agentId = (
    await prisma.installedAgent.create({ data: { businessId, workflowId, name: `${RUN} agent` } })
  ).id;

  await ingestKnowledgeFiles({
    businessId,
    installedAgentId: agentId,
    files: [
      { filename: "hospital.txt", mimeType: "text/plain", bytes: Buffer.from(HOSPITAL_BROCHURE) }
    ]
  });
});

afterAll(async () => {
  if (!dbAvailable) {
    throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");
  }
  await prisma.businessKnowledgeFile.deleteMany({ where: { businessId } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

const namesIn = (text: string) => DOCTORS.filter((doctor) => text.includes(doctor));

describe("enumeration questions retrieve the whole roster", () => {
  it("chunked the brochure into more than one section", async () => {
    const chunks = await prisma.businessKnowledgeBase.count({ where: { businessId } });
    expect(chunks).toBeGreaterThan(1);
  });

  it("'who are all your doctors' returns every doctor in the document", async () => {
    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentId,
      query: "Who are all your doctors?"
    });

    const combined = sections.map((section) => section.content).join("\n");
    expect(namesIn(combined)).toEqual(DOCTORS);
  });

  it.each([
    "Can you list the doctors?",
    "Which doctors work there?",
    "Do you have any other physicians?",
    "What are the names of your specialists?"
  ])("phrasing that asks for a list also returns them all: %s", async (query) => {
    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentId,
      query
    });

    const combined = sections.map((section) => section.content).join("\n");
    expect(namesIn(combined)).toEqual(DOCTORS);
  });

  it("a narrow question is still answered narrowly — no whole-document dump", async () => {
    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentId,
      query: "Is parking free?"
    });

    const combined = sections.map((section) => section.content).join("\n");
    expect(combined).toContain("parking");
    expect(sections.length).toBeLessThanOrEqual(4);
  });

  it("stays within the retrieval character budget", async () => {
    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentId,
      query: "Please list every single doctor and specialist and consultant you have"
    });

    const total = sections.reduce((sum, section) => sum + section.content.length, 0);
    expect(total).toBeLessThanOrEqual(8_000);
  });

  it("returns retrieved chunks whole — never sliced mid-section", async () => {
    /* The per-section cap must stay at or above the ingest chunker's ceiling,
       otherwise whatever a document lists last in a chunk is dropped. */
    const rows = await prisma.businessKnowledgeBase.findMany({
      where: { businessId },
      select: { content: true, chunkIndex: true }
    });
    const longest = Math.max(...rows.map((row) => (row.content ?? "").length));
    expect(longest).toBeGreaterThan(1_600);

    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentId,
      query: "Who are all your doctors?"
    });

    for (const section of sections) {
      const source = rows.find((row) => (row.content ?? "").startsWith(section.content.slice(0, 80)));
      expect(source?.content).toBe(section.content);
    }
  });
});
