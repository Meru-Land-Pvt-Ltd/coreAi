/**
 * Real-database integration tests for Smart Memory (pgvector required).
 * These run against DATABASE_URL — they create their own fixtures under
 * unique test emails and clean up after themselves. Skipped automatically
 * when no database is reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import {
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
const pgvectorAvailable = dbAvailable
  ? await prisma.$queryRaw`SELECT 1 FROM pg_extension WHERE extname = 'vector'`.then(
      (rows) => Array.isArray(rows) && rows.length > 0,
      () => false
    )
  : false;

const d = describe.runIf(dbAvailable && pgvectorAvailable);

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
  if (!dbAvailable || !pgvectorAvailable) return;
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
});

d("real pgvector storage", () => {
  test("stores full original records + chunks with tenant identity, dedupes on rerun", async () => {
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

    const records = await prisma.memoryRecord.findMany({ where: { scopeKey: first.scopeKey } });
    expect(records.length).toBe(first.storedRecords);
    const notes = records.find((r) => r.sourceType === "notes");
    expect(notes?.content).toBe("Mention the free first consult.");
    expect(notes?.businessId).toBe(ids.bizA);
    expect(notes?.installedAgentId).toBe(ids.agentA);
    expect(notes?.embeddingStatus).toBe("pending");

    const chunks = await prisma.memoryChunk.findMany({ where: { scopeKey: first.scopeKey } });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.recordId)).toBe(true);

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

    const crossRows = await prisma.memoryRecord.count({ where: { scopeKey: a.scopeKey, businessId: ids.bizB } });
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

  test("no-key embedding backfill reports pending honestly and search refuses", async () => {
    const scope = { businessId: ids.bizA, workflowId: ids.workflowId, nodeId: "m2", threadId: "itest-embed-1" };
    await buildSmartMemory({
      executedNodes: [{ nodeId: "n1", label: "Step", status: "success", output: { text: "Needs embedding." } }],
      scope
    });
    const scopeKey = buildScopeKey(scope);

    const progress = await defaultSmartMemoryDeps.embedPendingChunks(scopeKey, 10);
    expect(progress.embedded).toBe(0);
    expect(progress.pending).toBeGreaterThan(0);

    await expect(defaultSmartMemoryDeps.searchChunks(scopeKey, "anything", 20)).rejects.toThrow(
      /similarity retrieval unavailable/
    );
  });

  test("synthetic vectors: cosine ordering works and resolveForQuery returns real vector mode", async () => {
    const scope = { businessId: ids.bizA, workflowId: ids.workflowId, nodeId: "m3", threadId: "itest-vec-1" };
    const scopeKey = buildScopeKey(scope);
    await buildSmartMemory({
      executedNodes: [
        { nodeId: "n1", label: "Pricing", status: "success", output: { text: "Implants start at $1,900." } },
        { nodeId: "n2", label: "Recovery", status: "success", output: { text: "Recovery takes 3 to 5 days." } },
        { nodeId: "n3", label: "Hours", status: "success", output: { text: "Open 9am to 5pm weekdays." } }
      ],
      scope
    });

    const chunks = await prisma.memoryChunk.findMany({ where: { scopeKey }, orderBy: { createdAt: "asc" } });
    expect(chunks.length).toBe(3);
    for (let i = 0; i < chunks.length; i += 1) {
      const vec = Array.from({ length: 1536 }, (_, dim) => (dim === i ? 1 : 0.001));
      await prisma.$executeRaw`
        UPDATE "MemoryChunk" SET "embedding" = ${`[${vec.join(",")}]`}::vector, "embeddingModel" = 'synthetic'
        WHERE "id" = ${chunks[i].id}
      `;
    }

    // Direct cosine ordering: query nearest to chunk index 1 ("Recovery").
    const queryVec = Array.from({ length: 1536 }, (_, dim) => (dim === 1 ? 1 : 0.001));
    const ordered = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "MemoryChunk"
      WHERE "scopeKey" = ${scopeKey} AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${`[${queryVec.join(",")}]`}::vector
      LIMIT 20
    `;
    expect(ordered[0].id).toBe(chunks[1].id);

    // Full resolve path over threshold with a stubbed query-embedder.
    const builder = createSmartMemoryBuilder({
      ...defaultSmartMemoryDeps,
      async sumStoredTokens() {
        return env.MEMORY_VECTOR_THRESHOLD_TOKENS + 1;
      },
      async embedPendingChunks() {
        return { embedded: 0, pending: 0 };
      },
      async searchChunks(key, _query, topK) {
        return prisma.$queryRaw`
          SELECT "id", "content", "sourceType", "sourceLabel", "chunkIndex", "createdAt"
          FROM "MemoryChunk"
          WHERE "scopeKey" = ${key} AND "embedding" IS NOT NULL
          ORDER BY "embedding" <=> ${`[${queryVec.join(",")}]`}::vector
          LIMIT ${topK}
        ` as never;
      }
    });
    const resolved = await builder.resolveForQuery({ scopeKey, query: "how long is recovery", rawMemory: "raw" });
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

  test("retention: tenant token cap and TTL delete oldest records (chunks cascade)", async () => {
    const scopeKey = "itest-retention-scope";
    await prisma.memoryRecord.deleteMany({ where: { businessId: ids.bizB } });
    const old = await prisma.memoryRecord.create({
      data: {
        scopeKey,
        businessId: ids.bizB,
        sourceType: "notes",
        content: "very old note",
        tokenCount: 400,
        contentHash: "itest-ret-old",
        createdAt: new Date("2020-01-01T00:00:00Z")
      }
    });
    await prisma.memoryChunk.create({
      data: { recordId: old.id, scopeKey, sourceType: "notes", content: "very old note", tokenCount: 400, contentHash: "itest-ret-old" }
    });
    await prisma.memoryRecord.create({
      data: { scopeKey, businessId: ids.bizB, sourceType: "notes", content: "recent note", tokenCount: 400, contentHash: "itest-ret-new" }
    });

    const originalCap = env.MEMORY_MAX_TOKENS_PER_TENANT;
    try {
      (env as { MEMORY_MAX_TOKENS_PER_TENANT: number }).MEMORY_MAX_TOKENS_PER_TENANT = 500;
      await defaultSmartMemoryDeps.enforceRetention({ businessId: ids.bizB });
    } finally {
      (env as { MEMORY_MAX_TOKENS_PER_TENANT: number }).MEMORY_MAX_TOKENS_PER_TENANT = originalCap;
    }

    const remaining = await prisma.memoryRecord.findMany({ where: { businessId: ids.bizB } });
    // The 2020 record dies to BOTH the TTL and the cap; the recent one survives.
    expect(remaining.map((r) => r.contentHash)).toEqual(["itest-ret-new"]);
    expect(await prisma.memoryChunk.count({ where: { recordId: old.id } })).toBe(0);
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
    expect(await prisma.memoryChunk.count({ where: { scopeKey: stored.scopeKey } })).toBe(0);
  });

  test("pruneScope keeps only the newest chunks in a scope", async () => {
    const scopeKey = "itest-prune-scope";
    await prisma.memoryChunk.deleteMany({ where: { scopeKey } });
    for (let i = 0; i < 5; i += 1) {
      await prisma.memoryChunk.create({
        data: {
          scopeKey,
          sourceType: "notes",
          content: `prune ${i}`,
          tokenCount: 2,
          contentHash: `itest-prune-${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1 + i))
        }
      });
    }
    await defaultSmartMemoryDeps.pruneScope(scopeKey, 2);
    const rows = await prisma.memoryChunk.findMany({ where: { scopeKey }, orderBy: { createdAt: "desc" } });
    expect(rows.map((r) => r.content)).toEqual(["prune 4", "prune 3"]);
    await prisma.memoryChunk.deleteMany({ where: { scopeKey } });
  });
});
