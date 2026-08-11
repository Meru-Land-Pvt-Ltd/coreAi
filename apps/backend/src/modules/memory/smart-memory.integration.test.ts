/**
 * Real-database integration tests for Smart Memory's Postgres record store.
 * Vector retrieval is covered with injected Pinecone-shaped dependencies so
 * the suite remains hermetic and never calls a developer's external index.
 * These run against DATABASE_URL — they create their own fixtures under
 * unique test emails and clean up after themselves. Skipped automatically
 * when no database is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import {
  buildConversationScopeKey,
  buildScopeKey,
  buildSmartMemory,
  createSmartMemoryBuilder,
  defaultSmartMemoryDeps
} from "./smart-memory";

process.env.MEMORY_VECTOR_TEST_DB = "1";

const dbAvailable = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false
);
const d = describe.runIf(dbAvailable);
const originalPineconeApiKey = env.PINECONE_API_KEY;
const originalProcessPineconeApiKey = process.env.PINECONE_API_KEY;

const TEST_EMAIL = "smart-memory-itest@example.test";
const ids = {
  userId: "",
  bizA: "",
  bizB: "",
  workflowId: "",
  agentA: "",
  agentB: ""
};

async function cleanupFixtures() {
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } }).catch(() => undefined);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  env.PINECONE_API_KEY = undefined;
  process.env.PINECONE_API_KEY = "";
  await cleanupFixtures();
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, role: "BUSINESS", fullName: "Smart Memory ITest" }
  });
  ids.userId = user.id;
  const workflow = await prisma.workflowDefinition.create({
    data: { name: "smart-memory-itest wf", workflowJson: { nodes: [], edges: [] }, architectUserId: user.id }
  });
  ids.workflowId = workflow.id;
  const bizA = await prisma.business.create({ data: { ownerId: user.id, name: "ITest Biz A", type: "dental" } });
  const bizB = await prisma.business.create({ data: { ownerId: user.id, name: "ITest Biz B", type: "salon" } });
  ids.bizA = bizA.id;
  ids.bizB = bizB.id;
  const agentA = await prisma.installedAgent.create({
    data: { businessId: bizA.id, workflowId: workflow.id, name: "Agent A" }
  });
  const agentB = await prisma.installedAgent.create({
    data: { businessId: bizA.id, workflowId: workflow.id, name: "Agent B" }
  });
  ids.agentA = agentA.id;
  ids.agentB = agentB.id;
});

afterAll(async () => {
  await cleanupFixtures();
  env.PINECONE_API_KEY = originalPineconeApiKey;
  if (originalProcessPineconeApiKey === undefined) {
    delete process.env.PINECONE_API_KEY;
  } else {
    process.env.PINECONE_API_KEY = originalProcessPineconeApiKey;
  }
});

d("smart-memory storage and retrieval", () => {
  test("stores full original records with tenant identity and dedupes on rerun", async () => {
    const input = {
      executedNodes: [
        { nodeId: "n1", label: "Research", status: "success", output: { text: "Implant pricing starts at $1,900." } }
      ],
      customNotes: "Mention the free first consult.",
      scope: { businessId: ids.bizA, installedAgentId: ids.agentA, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-thread-1" }
    };

    const first = await buildSmartMemory(input);
    expect(first.storedRecords).toBeGreaterThanOrEqual(2);
    expect(first.memory).toContain("=== MEMORY ===");

    const records = await prisma.memoryRecord.findMany({
      where: { scopeKey: buildConversationScopeKey(input.scope) }
    });
    expect(records.length).toBe(first.storedRecords);
    const notes = records.find((r) => r.sourceType === "notes");
    expect(notes?.content).toBe("Mention the free first consult.");
    expect(notes?.businessId).toBe(ids.bizA);
    expect(notes?.installedAgentId).toBe(ids.agentA);
    expect(notes?.embeddingStatus).toBe("bypassed_short");
    expect(first.storedChunks).toBe(0);

    const rerun = await buildSmartMemory(input);
    expect(rerun.storedRecords).toBe(0);
    expect(rerun.storedChunks).toBe(0);
  });

  test("two businesses on the same workflow store into fully separate scopes", async () => {
    const base = {
      executedNodes: [{ nodeId: "n1", label: "Step", status: "success", output: { text: "Shared workflow content." } }]
    };
    const a = await buildSmartMemory({
      ...base,
      scope: { businessId: ids.bizA, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-iso-A" }
    });
    const b = await buildSmartMemory({
      ...base,
      scope: { businessId: ids.bizB, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-iso-B" }
    });
    expect(a.scopeKey).not.toBe(b.scopeKey);

    const crossRows = await prisma.memoryRecord.count({
      where: { scopeKey: buildConversationScopeKey({ businessId: ids.bizA, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-iso-A" }), businessId: ids.bizB }
    });
    expect(crossRows).toBe(0);
  });

  test("two installed agents of one business store into separate scopes", async () => {
    const base = {
      executedNodes: [{ nodeId: "n1", label: "Step", status: "success", output: { text: "Agent-specific content." } }]
    };
    const a = await buildSmartMemory({
      ...base,
      scope: { businessId: ids.bizA, installedAgentId: ids.agentA, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-ag-A" }
    });
    const b = await buildSmartMemory({
      ...base,
      scope: { businessId: ids.bizA, installedAgentId: ids.agentB, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-ag-B" }
    });
    expect(a.scopeKey).not.toBe(b.scopeKey);
  });

  test("search refuses honestly when Pinecone is not configured", async () => {
    const scope = { businessId: ids.bizA, workflowId: ids.workflowId, nodeId: "m2", threadId: "itest-embed-1" };
    const scopeKey = buildScopeKey(scope);

    await expect(defaultSmartMemoryDeps.searchChunks(scopeKey, "anything", 20)).rejects.toThrow(
      /similarity retrieval unavailable/
    );
  });

  test("injected vector results preserve provider relevance ordering", async () => {
    const now = new Date();
    const builder = createSmartMemoryBuilder({
      async storeCorpus() {
        return { newRecords: 0, newChunks: 0 };
      },
      async searchChunks() {
        return [
          { id: "recovery", content: "Recovery takes 3 to 5 days.", sourceType: "node_output", sourceLabel: "Recovery", chunkIndex: 0, createdAt: now },
          { id: "pricing", content: "Implants start at $1,900.", sourceType: "node_output", sourceLabel: "Pricing", chunkIndex: 0, createdAt: now }
        ];
      },
      async sampleRecordsForTimeline() {
        return [];
      },
      async countRecords() {
        return 2;
      }
    });
    const resolved = await builder.resolveForQuery({ scopeKey: "test-scope", query: "how long is recovery", rawMemory: "raw" });
    expect(resolved.mode).toBe("vector");
    expect(resolved.memory).toContain("[RELEVANT CONTEXT]");
    expect(resolved.memory.indexOf("Recovery takes 3 to 5 days.")).toBeGreaterThan(-1);
    expect(resolved.memory.indexOf("Recovery takes 3 to 5 days.")).toBeLessThan(
      resolved.memory.indexOf("Implants start at $1,900.")
    );
  });

  test("timeline sampling spans the whole history, not just the newest slice", async () => {
    const scopeKey = "itest-timeline-scope";
    await prisma.memoryRecord.deleteMany({ where: { scopeKey } });
    // 35 records with limit 10 — deliberately NOT an exact multiple, so any
    // stride truncation bug would drop the newest slice.
    for (let i = 0; i < 35; i += 1) {
      await prisma.memoryRecord.create({
        data: {
          scopeKey,
          businessId: ids.bizA,
          sourceType: "node_output",
          sourceLabel: `Entry ${i}`,
          content: `Entry ${i} content`,
          tokenCount: 5,
          contentHash: `itest-tl-${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1 + i))
        }
      });
    }

    const sampled = await defaultSmartMemoryDeps.sampleRecordsForTimeline(scopeKey, 10);
    expect(sampled.length).toBeLessThanOrEqual(10);
    const labels = sampled.map((r) => r.sourceLabel);
    expect(labels).toContain("Entry 0");
    // The newest end of the history must be represented.
    expect(labels.some((label) => Number(label?.split(" ")[1]) >= 30)).toBe(true);
  });

  test("deleting a business cascades away all its memory", async () => {
    const doomed = await prisma.business.create({ data: { ownerId: ids.userId, name: "ITest Doomed", type: "gym" } });
    const stored = await buildSmartMemory({
      executedNodes: [{ nodeId: "n1", label: "Step", status: "success", output: { text: "Doomed business memory." } }],
      scope: { businessId: doomed.id, workflowId: ids.workflowId, nodeId: "m1", threadId: "itest-doom-1" }
    });
    expect(await prisma.memoryRecord.count({ where: { businessId: doomed.id } })).toBeGreaterThan(0);

    await prisma.business.delete({ where: { id: doomed.id } });

    expect(await prisma.memoryRecord.count({ where: { businessId: doomed.id } })).toBe(0);
    expect(stored.storedRecords).toBeGreaterThan(0);
  });
});
