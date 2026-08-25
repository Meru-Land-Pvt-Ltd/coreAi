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
  cleanMemoryContent,
  MIN_EMBEDDING_CHARS,
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
  searchResults?: StoredMemoryChunk[];
  timelineRecords?: TimelineRecord[];
  totalRecords?: number;
  storeError?: boolean;
  searchError?: boolean;
}) {
  const calls = {
    storedRecords: [] as MemoryRecordDraft[],
    searchQueries: [] as string[],
    searchTopK: [] as number[]
  };

  const deps: SmartMemoryDeps = {
    async storeCorpus(records) {
      if (options.storeError) throw new Error("db down");
      calls.storedRecords.push(...records);
      return { newRecords: records.length, newChunks: records.reduce((sum, r) => sum + r.chunks.length, 0) };
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
    async countRecords() {
      return options.totalRecords ?? 10;
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
      "Service: implant"
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

describe("noise cleaning & embedding threshold", () => {
  test("cleanMemoryContent strips dividers like ---, ===, *** and zero-width chars", () => {
    const raw = "--- \n\uFEFFHello World\n===\n\n\nSome detail\n***";
    const cleaned = cleanMemoryContent(raw);
    expect(cleaned).not.toContain("---");
    expect(cleaned).not.toContain("===");
    expect(cleaned).not.toContain("***");
    expect(cleaned).toContain("Hello World");
    expect(cleaned).toContain("Some detail");
  });

  test("cleanMemoryContent flattens JSON structures and removes bracket noise", () => {
    const rawJson = JSON.stringify({
      Non_Functional_Requirements: [
        { requirement: "Security", description: "HIPAA compliance and encryption." },
        { requirement: "Performance", description: "10k+ concurrent users." }
      ]
    });
    const cleaned = cleanMemoryContent(rawJson);
    expect(cleaned).not.toContain("{");
    expect(cleaned).not.toContain("}");
    expect(cleaned).not.toContain("[");
    expect(cleaned).not.toContain("]");
    expect(cleaned).toContain("Non Functional Requirements:");
    expect(cleaned).toContain("Requirement: Security");
    expect(cleaned).toContain("Description: HIPAA compliance and encryption.");
  });

  test("cleanMemoryContent strips markdown syntax noise like headers, bolding, bullets", () => {
    const rawMarkdown = `#### **5. Monitoring, Logging & Observability**\n* **Metrics & Monitoring:** Prometheus for scraping cluster metrics.\n* **Centralized Logging:** Fluentbit / CloudWatch.`;
    const cleaned = cleanMemoryContent(rawMarkdown);
    expect(cleaned).not.toContain("####");
    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("* ");
    expect(cleaned).toContain("Monitoring, Logging & Observability");
    expect(cleaned).toContain("Metrics & Monitoring: Prometheus for scraping cluster metrics.");
  });

  test("MIN_EMBEDDING_CHARS threshold is set to 400", () => {
    expect(MIN_EMBEDDING_CHARS).toBe(400);
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
    const { deps, calls } = makeFakeDeps({});
    const builder = createSmartMemoryBuilder(deps);

    const result = await builder.store(BASE_INPUT);

    const expected = buildCompactMemoryString({
      executedNodes: BASE_INPUT.executedNodes,
      variables: BASE_INPUT.variables,
      attachments: BASE_INPUT.attachments,
      customNotes: BASE_INPUT.customNotes
    });
    expect(result.memory).toBe(expected);
    expect(calls.storedRecords.length).toBeGreaterThan(0);
  });

  test("duplicate content is deduped at the record level by hash", async () => {
    const pieces = await buildCorpusPieces(BASE_INPUT);
    const drafts = corpusToRecordDrafts(pieces, BASE_INPUT.scope, buildScopeKey(BASE_INPUT.scope));
    const again = corpusToRecordDrafts(pieces, BASE_INPUT.scope, buildScopeKey(BASE_INPUT.scope));
    expect(drafts.map((d) => d.contentHash)).toEqual(again.map((d) => d.contentHash));
  });

  test("empty or blank input returns zero stored records cleanly", async () => {
    const { deps, calls } = makeFakeDeps({});
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.store({
      scope: { businessId: "biz_1", workflowId: "wf_1", nodeId: "n1" }
    });
    expect(result.storedRecords).toBe(0);
    expect(calls.storedRecords.length).toBe(0);
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

  test("uses the AI node's instruction as the search query", async () => {
    const { deps, calls } = makeFakeDeps({
      searchResults: [makeChunk({ id: "h1", content: "Implants start at $1,900 with financing." })],
      timelineRecords: [makeTimelineRecord()],
      totalRecords: 800
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
  });

  test("a failed similarity search does not take the timeline down with it", async () => {
    /*
     * These used to be one Promise.all, so Pinecone being unset threw away the
     * timeline as well — and the timeline is nothing but a database read of
     * what this conversation already said. The agent forgot everything because
     * the clever half of remembering was unavailable.
     */
    const { deps } = makeFakeDeps({
      searchError: true,
      timelineRecords: [makeTimelineRecord({ sourceLabel: "Intake form", content: "Ana wants Tuesday at 3pm" })]
    });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.retrievedChunks).toBe(0);
    expect(result.memory).toContain("Ana wants Tuesday at 3pm");
  });

  test("with neither search nor timeline, the run's own memory is kept", async () => {
    // An empty "(no prior history)" would be worse than what we already hold.
    const { deps } = makeFakeDeps({ searchError: true, timelineRecords: [] });
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.memory).toBe(RAW);
  });

  test("a database failure still falls back to the raw string", async () => {
    const { deps } = makeFakeDeps({ searchError: true });
    deps.sampleRecordsForTimeline = async () => {
      throw new Error("db down");
    };
    const builder = createSmartMemoryBuilder(deps);
    const result = await builder.resolveForQuery({ scopeKey: "s", query: "q", rawMemory: RAW });
    expect(result.mode).toBe("raw_fallback");
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

describe("the timeline keeps every turn", () => {
  test("two turns with the same label both survive", () => {
    /*
     * The old rule skipped any record whose label matched the one before it. In
     * a conversation every record is labelled "Key variables", so the customer's
     * first line survived and everything they said afterwards silently vanished
     * — which reads exactly like memory working until somebody tests it.
     */
    const timeline = buildTimelineSummary(
      [
        makeTimelineRecord({ sourceLabel: "Key variables", content: "latestMessage: My name is Ana, Tuesday at 3pm" }),
        makeTimelineRecord({ sourceLabel: "Key variables", content: "latestMessage: actually make it Wednesday" })
      ],
      2
    );
    expect(timeline).toContain("Ana");
    expect(timeline).toContain("Wednesday");
  });

  test("the same line twice is still only said once", () => {
    const line = { sourceLabel: "Key variables", content: "latestMessage: hello" };
    const timeline = buildTimelineSummary([makeTimelineRecord(line), makeTimelineRecord(line)], 2);
    expect(timeline.match(/hello/g)?.length).toBe(1);
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
