import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { deliverKnowledgeToAiConfig, runWorkflowTest } from "./workflow-runner";

/**
 * NODE 011 — KNOWLEDGE, against the engine.
 *
 * The split that matters: in the builder there is no business, so the
 * architect's practice facts stand in and SAY they are a sample; live, the
 * node reads the business's real library through the same retrieval every
 * live channel already trusts. And whatever it found rides into the next
 * Brain's context with the one instruction that makes a library worth
 * having — answer from these, admit when the answer is not here.
 */

const RUN = `knownode-${process.pid}-${Date.now().toString(36)}`;

function graph(sampleFacts?: string) {
  return {
    nodes: [
      { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
      { id: "lib", data: { type: "ai.knowledge", nodeKind: "ai", title: "Knowledge", ...(sampleFacts === undefined ? {} : { sampleFacts }) } },
      { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
    ],
    edges: [
      { id: "e1", source: "ear", target: "lib" },
      { id: "e2", source: "lib", target: "out" }
    ]
  };
}

const QUESTION = { from: "ana@customer.com", subject: "Price?", body: "What does whitening cost?" };

describe("Knowledge — the practice shelf (builder, no business)", () => {
  it("hands the practice facts over and says they are a sample", async () => {
    const result = await runWorkflowTest({
      userId: `know-${process.pid}`,
      workflowId: `test-run-know-${process.pid}`,
      workflowJson: graph("Whitening costs $200. A cleaning costs $80."),
      input: { email: QUESTION } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "lib");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("practice facts");
    // Never lets a sample masquerade as the real library.
    expect(log?.message).toContain("sample");
    expect((log?.output as { preview?: string })?.preview).toContain("Whitening costs $200");
  });

  it("with an empty shelf it says what to do, not nothing", async () => {
    const result = await runWorkflowTest({
      userId: `know-${process.pid}`,
      workflowId: `test-run-knowempty-${process.pid}`,
      workflowJson: graph(),
      input: { email: QUESTION } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "lib");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("No practice facts typed in yet");
  });
});

describe("Knowledge → Brain delivery", () => {
  it("merges the facts into llmContext with the honesty instruction", () => {
    const config = { data: { llmRequirements: "Answer the customer." } } as never;
    const context = { knowledge: "Whitening costs $200." } as never;
    deliverKnowledgeToAiConfig(config, context);
    const data = (config as { data: Record<string, unknown> }).data;
    expect(String(data.llmContext)).toContain("FACTS FROM THE BUSINESS'S LIBRARY");
    expect(String(data.llmContext)).toContain("Whitening costs $200.");
    expect(String(data.llmContext)).toContain("rather than guessing");
  });

  it("does nothing when no Knowledge node ran", () => {
    const config = { data: { llmRequirements: "Answer the customer." } } as never;
    deliverKnowledgeToAiConfig(config, {} as never);
    const data = (config as { data: Record<string, unknown> }).data;
    expect(data.llmContext).toBeUndefined();
  });
});

describe("Knowledge — the real library (a business attached)", () => {
  let dbAvailable = false;
  let ownerId = "";
  let businessId = "";
  let workflowId = "";
  let installedAgentId = "";

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch {
      console.warn("[knowledge-node.test] database unreachable — live-library tests skipped");
      return;
    }
    ownerId = (await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } })).id;
    businessId = (await prisma.business.create({ data: { ownerId, name: `${RUN} Dental`, type: "dental" } })).id;
    workflowId = (
      await prisma.workflowDefinition.create({
        data: { name: `${RUN} wf`, workflowJson: graph(), architectUserId: ownerId }
      })
    ).id;
    installedAgentId = (
      await prisma.installedAgent.create({ data: { businessId, workflowId, name: `${RUN} agent` } })
    ).id;
    await prisma.businessKnowledgeBase.createMany({
      data: [
        { businessId, title: "Whitening", content: "Teeth whitening costs $200 and takes 45 minutes." },
        { businessId, title: "Parking", content: "Free parking is available behind the building." }
      ]
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await prisma.businessKnowledgeBase.deleteMany({ where: { businessId } });
    await prisma.installedAgent.deleteMany({ where: { businessId } });
    await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("searches the business's real shelf and names what it found", async () => {
    if (!dbAvailable) return;
    const result = await runWorkflowTest({
      userId: ownerId,
      workflowId: `test-run-knowlive-${process.pid}`,
      workflowJson: graph("PRACTICE FACTS THAT MUST NOT BE READ LIVE"),
      input: { email: QUESTION, businessId, installedAgentId } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "lib");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("matching piece");
    const preview = String((log?.output as { preview?: string })?.preview ?? "");
    expect(preview).toContain("whitening costs $200");
    // Live answers come from the LIBRARY — the practice shelf must be ignored.
    expect(preview).not.toContain("PRACTICE FACTS");
  });

  it("is honest when the shelf has nothing on the question", async () => {
    if (!dbAvailable) return;
    const result = await runWorkflowTest({
      userId: ownerId,
      workflowId: `test-run-knowmiss-${process.pid}`,
      workflowJson: graph(),
      input: {
        email: { from: "ana@customer.com", subject: "?", body: "Do you sell helicopters?" },
        businessId,
        installedAgentId
      } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "lib");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("nothing matching");
    expect(log?.message).toContain("rather than invent");
  });
});
