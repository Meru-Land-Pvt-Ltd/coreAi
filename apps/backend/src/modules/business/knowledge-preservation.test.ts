import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { loadBusinessAgentKnowledge, retrieveRelevantKnowledge } from "./agent-knowledge";
import { refreshLiveAssistantKnowledge } from "./deploy";
import {
  ingestKnowledgeFiles,
  listKnowledgeFiles,
  repairKnowledgeFiles,
  replaceManualKnowledge
} from "./knowledge-files";

/**
 * Knowledge preservation, per-agent scoping, truthful readiness, and repair:
 * setup saves must never erase PDF chunks; each installed agent sees only its
 * own documents; PROCESSED is not "ready" unless chunks really exist; broken
 * records are repairable from stored bytes without re-upload.
 */

const RUN = `knowpres-${process.pid}-${Date.now().toString(36)}`;

const DOC_A =
  "Clinic address: 12 Harbor Lane, Springfield.\n\nConsultation fee: forty five dollars for new patients.";
const DOC_B =
  "Emergency appointments: call before 10am for a same-day emergency slot.\n\nCancellation policy: 24 hours notice required.";

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let workflowId = "";
let agentAId = "";
let agentBId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[knowledge-preservation.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "clinic" } })
  ).id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: {
        name: `${RUN} wf`,
        workflowJson: { nodes: [{ id: "n1", data: { type: "ai.voice_conversation" } }], edges: [] },
        architectUserId: ownerId
      }
    })
  ).id;
  agentAId = (
    await prisma.installedAgent.create({ data: { businessId, workflowId, name: `${RUN} A` } })
  ).id;
  agentBId = (
    await prisma.installedAgent.create({ data: { businessId, workflowId, name: `${RUN} B` } })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.businessKnowledgeFile.deleteMany({ where: { businessId } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("setup saves preserve document knowledge", () => {
  it("replaceManualKnowledge replaces manual entries but never touches PDF chunks", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [file] = await ingestKnowledgeFiles({
      businessId,
      installedAgentId: agentAId,
      files: [{ filename: "clinic-a.txt", mimeType: "text/plain", bytes: Buffer.from(DOC_A) }]
    });
    expect(file.status).toBe("PROCESSED");

    await replaceManualKnowledge(businessId, [{ title: "Manual v1", content: "We speak Spanish." }]);
    // Repeated saves (reopen + save again) — never duplicates, never chunk loss.
    await replaceManualKnowledge(businessId, [{ title: "Manual v2", content: "We speak French." }]);
    await replaceManualKnowledge(businessId, [{ title: "Manual v2", content: "We speak French." }]);

    const chunks = await prisma.businessKnowledgeBase.findMany({ where: { sourceFileId: file.id } });
    expect(chunks.length).toBe(file.chunkCount);
    expect(chunks.length).toBeGreaterThan(0);

    const manual = await prisma.businessKnowledgeBase.findMany({
      where: { businessId, sourceFileId: null }
    });
    expect(manual).toHaveLength(1);
    expect(manual[0].title).toBe("Manual v2");

    // Document knowledge still reaches the loader after the "save".
    const loaded = await loadBusinessAgentKnowledge({ businessId, installedAgentId: agentAId });
    expect(loaded.knowledge.join("\n")).toContain("Harbor Lane");
  });
});

describe("per-agent scoping", () => {
  it("two agents in one business see only their own documents", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [fileB] = await ingestKnowledgeFiles({
      businessId,
      installedAgentId: agentBId,
      files: [{ filename: "clinic-b.txt", mimeType: "text/plain", bytes: Buffer.from(DOC_B) }]
    });
    expect(fileB.status).toBe("PROCESSED");

    const forA = await loadBusinessAgentKnowledge({ businessId, installedAgentId: agentAId });
    const forB = await loadBusinessAgentKnowledge({ businessId, installedAgentId: agentBId });

    expect(forA.knowledge.join("\n")).toContain("Harbor Lane");
    expect(forA.knowledge.join("\n")).not.toContain("Emergency appointments");
    expect(forB.knowledge.join("\n")).toContain("Emergency appointments");
    expect(forB.knowledge.join("\n")).not.toContain("Harbor Lane");

    // Retrieval respects the same boundary.
    const hitsA = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentAId,
      query: "what are the rules for emergency appointments?"
    });
    expect(hitsA.map((hit) => hit.content).join("\n")).not.toContain("same-day emergency slot");

    const hitsB = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentBId,
      query: "what are the rules for emergency appointments?"
    });
    expect(hitsB.map((hit) => hit.content).join("\n")).toContain("same-day emergency slot");
  });

  it("the same PDF can serve two agents with separate associations", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const bytes = Buffer.from(DOC_A);
    const [again] = await ingestKnowledgeFiles({
      businessId,
      installedAgentId: agentBId,
      files: [{ filename: "clinic-a.txt", mimeType: "text/plain", bytes }]
    });

    // Same bytes, DIFFERENT agent → its own record, not a dedup hit.
    expect(again.alreadyExisted).toBe(false);
    expect(again.status).toBe("PROCESSED");

    // Same bytes, SAME agent → idempotent.
    const [dup] = await ingestKnowledgeFiles({
      businessId,
      installedAgentId: agentBId,
      files: [{ filename: "clinic-a.txt", mimeType: "text/plain", bytes }]
    });
    expect(dup.alreadyExisted).toBe(true);
    expect(dup.id).toBe(again.id);

    const forB = await loadBusinessAgentKnowledge({ businessId, installedAgentId: agentBId });
    expect(forB.knowledge.join("\n")).toContain("Harbor Lane");
  });
});

describe("truthful readiness and repair", () => {
  it("a PROCESSED file with missing chunks is not ready and repair restores it from stored bytes", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const files = await listKnowledgeFiles(businessId);
    const target = files.find((file) => file.filename === "clinic-a.txt" && file.ready)!;
    expect(target).toBeTruthy();

    // Simulate the historical bug: chunks wiped while the record says PROCESSED.
    await prisma.businessKnowledgeBase.deleteMany({ where: { sourceFileId: target.id } });

    const broken = (await listKnowledgeFiles(businessId)).find((file) => file.id === target.id)!;
    expect(broken.status).toBe("PROCESSED");
    expect(broken.ready).toBe(false);
    expect(broken.actualChunkCount).toBe(0);

    // Dry-run reports, changes nothing.
    const dry = await repairKnowledgeFiles({ apply: false, businessId });
    const dryRow = dry.find((row) => row.fileId === target.id)!;
    expect(dryRow.action).toBe("would_reprocess");
    expect((await listKnowledgeFiles(businessId)).find((f) => f.id === target.id)!.ready).toBe(false);

    // Apply re-extracts from stored bytes — no re-upload needed.
    const applied = await repairKnowledgeFiles({ apply: true, businessId });
    const appliedRow = applied.find((row) => row.fileId === target.id)!;
    expect(appliedRow.action).toBe("reprocessed");

    const repaired = (await listKnowledgeFiles(businessId)).find((file) => file.id === target.id)!;
    expect(repaired.ready).toBe(true);
    expect(repaired.actualChunkCount).toBeGreaterThan(0);

    // Idempotent: a healthy corpus is a no-op.
    const second = await repairKnowledgeFiles({ apply: true, businessId });
    expect(second.every((row) => row.action === "ok")).toBe(true);
  });

  it("a file without stored bytes is marked re-upload required, never shown ready", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [file] = await ingestKnowledgeFiles({
      businessId,
      installedAgentId: agentAId,
      files: [{ filename: "lost-bytes.txt", mimeType: "text/plain", bytes: Buffer.from(`${DOC_B}\n\nExtra line for hash.`) }]
    });
    await prisma.businessKnowledgeFile.update({
      where: { id: file.id },
      data: { contentBytes: new Uint8Array(0) }
    });

    const applied = await repairKnowledgeFiles({ apply: true, businessId });
    const row = applied.find((entry) => entry.fileId === file.id)!;
    expect(row.action).toBe("reupload_required");

    const listed = (await listKnowledgeFiles(businessId)).find((entry) => entry.id === file.id)!;
    expect(listed.status).toBe("REUPLOAD_REQUIRED");
    expect(listed.ready).toBe(false);
    expect(listed.errorMessage).toContain("upload it again");
    expect(await prisma.businessKnowledgeBase.count({ where: { sourceFileId: file.id } })).toBe(0);
  });

  it("reprocessing replaces stale chunks atomically", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const target = (await listKnowledgeFiles(businessId)).find(
      (file) => file.filename === "clinic-b.txt" && file.ready
    )!;

    // Inject a stale/bogus chunk attributed to the file.
    await prisma.businessKnowledgeBase.create({
      data: {
        businessId,
        installedAgentId: agentBId,
        title: "stale",
        content: "OUTDATED PRICE: nine hundred dollars",
        sourceFileId: target.id,
        chunkIndex: 99
      }
    });

    const { reprocessKnowledgeFile } = await import("./knowledge-files");
    const result = await reprocessKnowledgeFile(businessId, target.id);
    expect(result.status).toBe("PROCESSED");

    const contents = (
      await prisma.businessKnowledgeBase.findMany({ where: { sourceFileId: target.id } })
    ).map((chunk) => chunk.content);
    expect(contents.join("\n")).not.toContain("OUTDATED PRICE");
    expect(contents.length).toBe(result.chunkCount);
  });
});

/**
 * QA (2026-07-30): "Now it is picking names & all from PDF but I added doctor
 * name as well in input field, it is not picking that."
 *
 * Typed entries and document chunks live in the same table and both retrieve
 * fine — the gap was that only the document routes pushed the refreshed prompt
 * to the live assistant, so a typed fact sat in the database while the deployed
 * agent answered from its previous snapshot.
 */
describe("typed knowledge is retrievable alongside document knowledge", () => {
  it("a doctor name typed into the setup form is retrieved for a roster question", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await ingestKnowledgeFiles({
      businessId,
      installedAgentId: agentAId,
      files: [
        {
          filename: "roster.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("Our Doctors\nDr. Amelia Hart — Cardiology.\nDr. Rajesh Menon — Orthopaedics.")
        }
      ]
    });
    await replaceManualKnowledge(businessId, [
      { title: "Doctors", content: "Dr. Sunita Balan — Endodontics. Joined this year." }
    ]);

    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentAId,
      query: "Who are all your doctors?"
    });
    const combined = sections.map((section) => section.content).join("\n");

    // The typed name and the PDF names must BOTH be present.
    expect(combined).toContain("Sunita Balan");
    expect(combined).toContain("Amelia Hart");
    expect(combined).toContain("Rajesh Menon");
  });

  it("typed entries are carried in the prompt snapshot the assistant is deployed with", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const { knowledge, manualCount } = await loadBusinessAgentKnowledge({
      businessId,
      installedAgentId: agentAId
    });

    expect(manualCount).toBeGreaterThan(0);
    expect(knowledge.join("\n")).toContain("Sunita Balan");
  });

  it("a later setup save that replaces typed entries does not drop document chunks", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    await replaceManualKnowledge(businessId, [
      { title: "Doctors", content: "Dr. Sunita Balan — Endodontics. Dr. Iqbal Shah — Periodontics." }
    ]);

    const sections = await retrieveRelevantKnowledge({
      businessId,
      installedAgentId: agentAId,
      query: "List every doctor you have"
    });
    const combined = sections.map((section) => section.content).join("\n");

    expect(combined).toContain("Iqbal Shah");
    expect(combined).toContain("Amelia Hart");
  });
});

describe("live sync result", () => {
  it("reports attempted=false before Go-live instead of failing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const sync = await refreshLiveAssistantKnowledge(businessId);
    expect(sync.attempted).toBe(false);
    expect(sync.ok).toBe(true);
    expect(sync.error).toBeNull();
  });
});
