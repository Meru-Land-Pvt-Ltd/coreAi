import { describe, expect, test } from "vitest";
import { buildCompactMemoryString } from "./memory-compression";
import {
  buildScopeKey,
  buildTimelineSummary,
  chunkText,
  corpusToRecordDrafts,
  buildCorpusPieces,
  createSmartMemoryBuilder,
  estimateTokens,
  extractAttachmentText,
  mergeMemoryIntoPrompt,
  type MemoryRecordDraft,
  type SmartMemoryDeps,
  type SmartMemoryInput,
  type StoredMemoryChunk,
  type TimelineRecord
} from "./smart-memory";

function makeChunk(overrides: Partial<StoredMemoryChunk> = {}): StoredMemoryChunk {
  return {
    id: overrides.id ?? "chunk_1",
    content: overrides.content ?? "Patient asked about implant pricing and financing options.",
    sourceType: overrides.sourceType ?? "node_output",
    sourceLabel: overrides.sourceLabel ?? "Research step",
    chunkIndex: overrides.chunkIndex ?? 0,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T10:00:00Z")
  };
}

function makeTimelineRecord(overrides: Partial<TimelineRecord> = {}): TimelineRecord {
  return {
    sourceType: overrides.sourceType ?? "node_output",
    sourceLabel: overrides.sourceLabel ?? "Intake form",
    content: overrides.content ?? "Patient prefers morning appointments.",
    createdAt: overrides.createdAt ?? new Date("2026-07-01T10:00:00Z")
  };
}

function makeFakeDeps(options: {
  storedTokens?: number;
  searchResults?: StoredMemoryChunk[];
  timelineRecords?: TimelineRecord[];
  totalChunks?: number;
  totalRecords?: number;
  storeError?: boolean;
  searchError?: boolean;
  /** Sequence of {embedded, pending} returned by successive embed calls. */
  embedSequence?: Array<{ embedded: number; pending: number }>;
}) {
  const calls = {
    storedRecords: [] as MemoryRecordDraft[],
    searchQueries: [] as string[],
    searchTopK: [] as number[],
    embedCalls: 0,
    pruneCalls: 0,
    retentionCalls: 0
  };
  const embedSequence = options.embedSequence ? [...options.embedSequence] : null;

  const deps: SmartMemoryDeps = {
    async storeCorpus(records) {
      if (options.storeError) throw new Error("db down");
      calls.storedRecords.push(...records);
      return { newRecords: records.length, newChunks: records.reduce((sum, r) => sum + r.chunks.length, 0) };
    },
    async sumStoredTokens() {
      return options.storedTokens ?? 0;
    },
    async pruneScope() {
      calls.pruneCalls += 1;
    },
    async embedPendingChunks() {
      calls.embedCalls += 1;
      if (embedSequence && embedSequence.length > 0) return embedSequence.shift()!;
      return { embedded: 0, pending: 0 };
    },
    async searchChunks(_scopeKey, query, topK) {
      if (options.searchError) throw new Error("similarity retrieval unavailable");
      calls.searchQueries.push(query);
      calls.searchTopK.push(topK);
      return options.searchResults ?? [makeChunk()];
    },
    async sampleRecordsForTimeline() {
      return options.timelineRecords ?? [];
    },
    async countChunks() {
      return options.totalChunks ?? (options.searchResults?.length ?? 1);
    },
    async countRecords() {
      return options.totalRecords ?? 10;
    },
    async enforceRetention() {
      calls.retentionCalls += 1;
    }
  };

  return { deps, calls };
}

const BASE_INPUT: SmartMemoryInput = {
  executedNodes: [
    {
      nodeId: "node_trigger",
      label: "Missed Call Trigger",
      status: "success",
      message: "Missed call from customer",
      output: { text: "Missed call from Jordan Lee at 2:15 PM" }
    }
  ],
  variables: { callerName: "Jordan Lee", service: "implant consult" },
  attachments: [{ name: "pricing.txt", mimeType: "text/plain", data: "Implants start at $1,900." }],
  customNotes: "Always mention the free first consult.",
  scope: { businessId: "biz_1", installedAgentId: "agent_1", workflowId: "wf_1", nodeId: "node_memory", callerKey: "+15550100" }
};

const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("scope isolation", () => {
  test("two businesses using the same workflow never share a scope", () => {
    const a = buildScopeKey({ businessId: "biz_A", workflowId: "wf_shared", nodeId: "n1", callerKey: "+1555" });
    const b = buildScopeKey({ businessId: "biz_B", workflowId: "wf_shared", nodeId: "n1", callerKey: "+1555" });
    expect(a).not.toBe(b);
  });

  test("two installed agents of one business never share a scope", () => {
    const a = buildScopeKey({ businessId: "biz_1", installedAgentId: "agent_A", nodeId: "n1" });
    const b = buildScopeKey({ businessId: "biz_1", installedAgentId: "agent_B", nodeId: "n1" });
    expect(a).not.toBe(b);
  });

  test("two Memory Nodes in one workflow never share a scope", () => {
    const a = buildScopeKey({ businessId: "biz_1", workflowId: "wf_1", nodeId: "memory_A", threadId: "t1" });
    const b = buildScopeKey({ businessId: "biz_1", workflowId: "wf_1", nodeId: "memory_B", threadId: "t1" });
    expect(a).not.toBe(b);
  });

  test("the same caller talking to two businesses stays separated", () => {
    const a = buildScopeKey({ businessId: "biz_A", workflowId: "wf_shared", nodeId: "n1", callerKey: "+1555000" });
    const b = buildScopeKey({ businessId: "biz_B", workflowId: "wf_shared", nodeId: "n1", callerKey: "+1555000" });
    expect(a).not.toBe(b);
  });

  test("anonymous callers in different test sessions never share a scope", () => {
    const a = buildScopeKey({ architectUserId: "u1", workflowId: "wf_1", nodeId: "n1", testSessionId: "sess_A" });
    const b = buildScopeKey({ architectUserId: "u1", workflowId: "wf_1", nodeId: "n1", testSessionId: "sess_B" });
    expect(a).not.toBe(b);
  });

  test("separate conversations (threads) of the same caller stay separated", () => {
    const a = buildScopeKey({ businessId: "b1", nodeId: "n1", threadId: "thread_A", callerKey: "+1555" });
    const b = buildScopeKey({ businessId: "b1", nodeId: "n1", threadId: "thread_B", callerKey: "+1555" });
    expect(a).not.toBe(b);
  });

  test("architect and business tenants never collide", () => {
    const a = buildScopeKey({ architectUserId: "id_1", workflowId: "wf", nodeId: "n1" });
    const b = buildScopeKey({ businessId: "id_1", workflowId: "wf", nodeId: "n1" });
    expect(a).not.toBe(b);
  });
});

describe("attachments", () => {
  test("decodes plain text, data-URL text, and data-URLs with charset parameters", async () => {
    expect(await extractAttachmentText({ name: "inline", data: "plain inline text" })).toBe("plain inline text");
    const encoded = Buffer.from("Implants start at $1,900.", "utf8").toString("base64");
    expect(await extractAttachmentText({ name: "a.txt", data: `data:text/plain;base64,${encoded}` })).toBe(
      "Implants start at $1,900."
    );
    expect(
      await extractAttachmentText({ name: "b.txt", data: `data:text/plain;charset=utf-8;base64,${encoded}` })
    ).toBe("Implants start at $1,900.");
  });

  test("decodes CSV and JSON payloads as real text", async () => {
    const csv = Buffer.from("name,price\nimplant,1900", "utf8").toString("base64");
    expect(await extractAttachmentText({ name: "p.csv", data: `data:text/csv;base64,${csv}` })).toContain("implant,1900");
    const json = Buffer.from('{"service":"implant"}', "utf8").toString("base64");
    expect(await extractAttachmentText({ name: "p.json", data: `data:application/json;base64,${json}` })).toContain(
      '"service"'
    );
  });

  test("marks images and unknown binaries as unsupported instead of pretending", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
    const result = await extractAttachmentText({ name: "scan.png", mimeType: "image/png", data: `data:image/png;base64,${png}` });
    expect(result).toContain("[unsupported attachment: scan.png");
    expect(result).toContain("content was not extracted");
  });

  test("marks corrupt DOCX-like archives as unreadable, never as extracted", async () => {
    const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not a real docx")]).toString("base64");
    const result = await extractAttachmentText({
      name: "notes.docx",
      data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${fakeZip}`
    });
    expect(result).toContain("[unreadable attachment: notes.docx");
  });
});

describe("chunking and drafts", () => {
  test("chunkText keeps small text whole and splits large text under the max size", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
    const bigText = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} ${"detail ".repeat(30)}`).join("\n\n");
    const chunks = chunkText(bigText);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2500);
    expect(chunkText(bigText)).toEqual(chunks);
    expect(chunks.join("\n\n")).toContain("Paragraph 199");
  });

  test("records keep the complete original text alongside their chunks", async () => {
    const bigNote = Array.from({ length: 120 }, (_, i) => `Guideline ${i}: ${"rule ".repeat(40)}`).join("\n\n");
    const input: SmartMemoryInput = { customNotes: bigNote, scope: { businessId: "b", nodeId: "n" } };
    const pieces = await buildCorpusPieces(input);
    const drafts = corpusToRecordDrafts(pieces, input.scope, buildScopeKey(input.scope));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].content).toBe(bigNote.trim());
    expect(drafts[0].chunks.length).toBeGreaterThan(1);
    expect(drafts[0].tokenCount).toBe(estimateTokens(bigNote.trim()));
    for (const chunk of drafts[0].chunks) {
      expect(drafts[0].content).toContain(chunk.content.split("\n\n")[0]);
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("store path", () => {
  test("always returns the byte-for-byte raw compact string", async () => {
    const { deps, calls } = makeFakeDeps({ storedTokens: 100 });
    const builder = createSmartMemoryBuilder(deps);

    const result = await builder.store(BASE_INPUT);
    await flushBackground();

    const expected = buildCompactMemoryString({
      executedNodes: BASE_INPUT.executedNodes,
      variables: BASE_INPUT.variables,
      attachments: BASE_INPUT.attachments,
      customNotes: BASE_INPUT.customNotes
    });
    expect(result.memory).toBe(expected);
    expect(result.overThreshold).toBe(false);
    expect(calls.storedRecords.length).toBeGreaterThan(0);
    // Embedding + retention fire in the background at store time.
    expect(calls.embedCalls).toBe(1);
    expect(calls.retentionCalls).toBe(1);
  });

  test("duplicate content is deduped at the record level by hash", async () => {
    const { calls } = makeFakeDeps({});
    void calls;
    const pieces = await buildCorpusPieces(BASE_INPUT);
    const drafts = corpusToRecordDrafts(pieces, BASE_INPUT.scope, buildScopeKey(BASE_INPUT.scope));
    const again = corpusToRecordDrafts(pieces, BASE_INPUT.scope, buildScopeKey(BASE_INPUT.scope));
    expect(drafts.map((d) => d.contentHash)).toEqual(again.map((d) => d.contentHash));
  });

  test("a broken database never breaks the node — raw string comes back", async () => {
    const { deps } = makeFakeDeps({ storeError: true });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.store(BASE_INPUT);
    expect(result.memory).toContain("=== MEMORY ===");
    expect(result.memory).toContain("Missed call from Jordan Lee");
    expect(result.storedRecords).toBe(0);
  });
});

describe("resolve path (AI consumer)", () => {
  const RAW = "=== MEMORY ===\n\n[PREVIOUS STEPS]\n[Research]\nRaw memory body";

  test("under the threshold returns the raw string untouched", async () => {
    const { deps, calls } = makeFakeDeps({ storedTokens: 500 });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "anything", rawMemory: RAW });
    expect(result).toEqual({ memory: RAW, mode: "raw", retrievedChunks: 0 });
    expect(calls.searchQueries).toHaveLength(0);
    expect(calls.embedCalls).toBe(0);
  });

  test("over the threshold uses the AI node's instruction as the search query, top-20", async () => {
    const { deps, calls } = makeFakeDeps({
      storedTokens: 2_000_000,
      searchResults: [makeChunk({ id: "h1", content: "Implants start at $1,900 with financing." })],
      timelineRecords: [makeTimelineRecord()],
      totalChunks: 3000,
      totalRecords: 800,
      embedSequence: [{ embedded: 0, pending: 0 }]
    });
    const builder = createSmartMemoryBuilder(deps);

    const result = await builder.resolveForQuery({
      scopeKey: "s",
      query: "You are a dental receptionist. Answer pricing questions about implants.",
      rawMemory: RAW
    });

    expect(result.mode).toBe("vector");
    expect(result.memory).toContain("[RELEVANT CONTEXT]");
    expect(result.memory).toContain("Implants start at $1,900 with financing.");
    expect(result.memory).toContain("[TIMELINE SUMMARY]");
    expect(result.memory).toContain("Intake form");
    expect(calls.searchQueries).toEqual(["You are a dental receptionist. Answer pricing questions about implants."]);
    expect(calls.searchTopK).toEqual([20]);
  });

  test("keeps embedding in rounds until a large backlog (>256 chunks) is fully embedded", async () => {
    const { deps, calls } = makeFakeDeps({
      storedTokens: 2_000_000,
      embedSequence: [
        { embedded: 256, pending: 400 },
        { embedded: 256, pending: 144 },
        { embedded: 144, pending: 0 }
      ]
    });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.mode).toBe("vector");
    expect(calls.embedCalls).toBe(3);
  });

  test("never searches a partially-embedded scope — falls back to raw", async () => {
    const { deps, calls } = makeFakeDeps({
      storedTokens: 2_000_000,
      embedSequence: [{ embedded: 0, pending: 950 }]
    });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.mode).toBe("raw_fallback");
    expect(result.memory).toBe(RAW);
    expect(calls.searchQueries).toHaveLength(0);
  });

  test("similarity search failure falls back to the raw string", async () => {
    const { deps } = makeFakeDeps({ storedTokens: 2_000_000, searchError: true });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.mode).toBe("raw_fallback");
    expect(result.memory).toBe(RAW);
  });

  test("database failure falls back to the raw string", async () => {
    const { deps } = makeFakeDeps({});
    deps.sumStoredTokens = async () => {
      throw new Error("db down");
    };
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.mode).toBe("raw");
    expect(result.memory).toBe(RAW);
  });
});

describe("timeline summary", () => {
  test("stays under the 500-word budget including the header and dedupes labels", () => {
    const records = Array.from({ length: 400 }, (_, i) =>
      makeTimelineRecord({
        sourceLabel: `Step ${i % 60}`,
        content: `Step ${i % 60} produced ${"output ".repeat(30)}`,
        createdAt: new Date(Date.UTC(2026, 0, 1 + i))
      })
    );
    const timeline = buildTimelineSummary(records, 5000);
    expect(timeline.split(/\s+/).length).toBeLessThanOrEqual(500);
    expect(timeline).toContain("[TIMELINE SUMMARY]");
    expect(timeline).toContain("sampled across all 5000 stored memory records");
    expect(timeline.match(/Step 0:/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("prompt merging", () => {
  const RAW = "=== MEMORY ===\nraw body";
  const RESOLVED = "=== MEMORY ===\n\n[RELEVANT CONTEXT] retrieved body";

  test("appends memory as its own section when the builder never referenced it", () => {
    const merged = mergeMemoryIntoPrompt("Answer the caller politely.", RESOLVED, RAW);
    expect(merged).toContain("Answer the caller politely.");
    expect(merged).toContain("provided automatically");
    expect(merged).toContain(RESOLVED);
  });

  test("replaces a builder-placed {{memory}} expansion with the resolved version", () => {
    const prompt = `Use this context:\n${RAW}\nAnswer now.`;
    const merged = mergeMemoryIntoPrompt(prompt, RESOLVED, RAW);
    expect(merged).toContain(RESOLVED);
    expect(merged).not.toContain("raw body");
    expect(merged.match(/=== MEMORY ===/g)?.length).toBe(1);
  });

  test("does not duplicate memory that is already present", () => {
    const prompt = `Context:\n${RESOLVED}`;
    expect(mergeMemoryIntoPrompt(prompt, RESOLVED, RAW)).toBe(prompt);
  });
});
