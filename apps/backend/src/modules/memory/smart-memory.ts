import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { embedTexts } from "../ai-provider-engine/embeddings";
import {
  extractDocumentText,
  normalizeExtractedText,
  sniffFileKind
} from "../business/knowledge-files";
import {
  buildCompactMemoryString,
  extractExecutedNodeText,
  extractMemoryVariableLines,
  type ExecutedNodeSummary,
  type MemoryAttachment
} from "./memory-compression";

/* --------------------------------- types ---------------------------------- */

export type SmartMemoryScope = {
  businessId?: string;
  installedAgentId?: string;
  architectUserId?: string;
  workflowId?: string;
  workflowRunId?: string;
  threadId?: string;
  nodeId?: string;
  testSessionId?: string;
  callerKey?: string;
};

export type SmartMemoryInput = {
  executedNodes?: ExecutedNodeSummary[];
  variables?: Record<string, unknown>;
  attachments?: MemoryAttachment[];
  customNotes?: string;
  scope: SmartMemoryScope;
};

export type SmartMemoryStoreResult = {
  /** The classic compact memory string — unchanged pre-vector format. */
  memory: string;
  scopeKey: string;
  overThreshold: boolean;
  corpusTokens: number;
  storedRecords: number;
  storedChunks: number;
};

export type ResolvedSmartMemory = {
  memory: string;
  /** raw = pass-through; vector = real similarity retrieval; raw_fallback = vector path unavailable over threshold. */
  mode: "raw" | "vector" | "raw_fallback";
  retrievedChunks: number;
};

export type MemoryChunkDraft = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  contentHash: string;
};

export type MemoryRecordDraft = {
  scopeKey: string;
  scope: SmartMemoryScope;
  sourceType: "node_output" | "attachment" | "notes" | "variables";
  sourceLabel: string;
  content: string;
  tokenCount: number;
  contentHash: string;
  chunks: MemoryChunkDraft[];
};

export type StoredMemoryChunk = {
  id: string;
  content: string;
  sourceType: string;
  sourceLabel: string | null;
  chunkIndex: number;
  createdAt: Date;
};

export type TimelineRecord = {
  sourceType: string;
  sourceLabel: string | null;
  content: string;
  createdAt: Date;
};

export type SmartMemoryDeps = {
  /** Persist records + their chunks (dedupe on scopeKey+contentHash). */
  storeCorpus(records: MemoryRecordDraft[]): Promise<{ newRecords: number; newChunks: number }>;
  /** Sum of record tokenCount in the scope. */
  sumStoredTokens(scopeKey: string): Promise<number>;
  /** Delete the oldest chunks beyond maxChunks (per-scope backstop). */
  pruneScope(scopeKey: string, maxChunks: number): Promise<void>;
  /**
   * Embed up to `limit` not-yet-embedded chunks in the scope. Returns how many
   * were embedded this call and how many remain (0 embedded with pending > 0
   * means embeddings are unavailable right now).
   */
  embedPendingChunks(scopeKey: string, limit: number): Promise<{ embedded: number; pending: number }>;
  /**
   * Top-K chunks by cosine similarity to the query. MUST throw when similarity
   * retrieval is impossible (no query, embeddings unavailable, nothing
   * embedded) so callers degrade to the raw string — never silently substitute
   * a different ordering.
   */
  searchChunks(scopeKey: string, query: string, topK: number): Promise<StoredMemoryChunk[]>;
  /** Records sampled evenly across the scope's full time range (chronological). */
  sampleRecordsForTimeline(scopeKey: string, limit: number): Promise<TimelineRecord[]>;
  countChunks(scopeKey: string): Promise<number>;
  countRecords(scopeKey: string): Promise<number>;
  /** TTL + per-tenant cap cleanup for the tenant that owns this scope. */
  enforceRetention(scope: SmartMemoryScope): Promise<void>;
};

/* ------------------------------- pure helpers ------------------------------ */

/** Same chars/4 heuristic the provider engine uses for pre-flight cost estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildScopeKey(scope: SmartMemoryScope): string {
  const tenant = scope.businessId
    ? `biz:${scope.businessId}`
    : scope.architectUserId
      ? `arch:${scope.architectUserId}`
      : "anon";
  const agent = scope.installedAgentId ? `agent:${scope.installedAgentId}` : `wf:${scope.workflowId || "none"}`;
  // Conversation continuity: an explicit thread wins; then the test session
  // (canvas/chat tests) or the caller (live calls/SMS), so the same customer's
  // conversation accumulates across runs; a fresh run id is the safe fallback.
  const conversation = scope.threadId
    ? `thread:${scope.threadId}`
    : scope.testSessionId
      ? `session:${scope.testSessionId}`
      : scope.callerKey
        ? `caller:${scope.callerKey}`
        : scope.workflowRunId
          ? `run:${scope.workflowRunId}`
          : "solo";
  return `${tenant}|${agent}|node:${scope.nodeId || "none"}|${conversation}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const CHUNK_TARGET_CHARS = 2000;
const CHUNK_MAX_CHARS = 2500;

/** Deterministic paragraph-first, then sentence-boundary chunking. */
export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= CHUNK_MAX_CHARS) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  const pushPiece = (piece: string) => {
    if (!piece) return;
    if (current && current.length + piece.length + 2 > CHUNK_TARGET_CHARS) flush();
    current = current ? `${current}\n\n${piece}` : piece;
    if (current.length >= CHUNK_TARGET_CHARS) flush();
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length <= CHUNK_MAX_CHARS) {
      pushPiece(paragraph);
      continue;
    }
    // Oversized paragraph: split at sentence-ish boundaries, hard-split as a last resort.
    let rest = paragraph;
    while (rest.length > CHUNK_MAX_CHARS) {
      let cut = rest.lastIndexOf(". ", CHUNK_TARGET_CHARS);
      if (cut < CHUNK_TARGET_CHARS / 2) cut = rest.lastIndexOf(" ", CHUNK_TARGET_CHARS);
      if (cut < CHUNK_TARGET_CHARS / 2) cut = CHUNK_TARGET_CHARS;
      pushPiece(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1);
    }
    pushPiece(rest.trim());
  }
  flush();

  return chunks.filter(Boolean);
}

type DecodedAttachment = {
  bytes: Buffer | null;
  /** Inline (non data-URL) text, already usable as-is. */
  inlineText: string | null;
  mime: string;
  name: string;
};

function decodeAttachment(att: MemoryAttachment): DecodedAttachment {
  const name = att.name || "Attachment";
  const data = att.data || "";
  if (!data) return { bytes: null, inlineText: null, mime: att.mimeType || "", name };

  // data:[<mediatype>][;param=value...][;base64],<payload>
  const dataUrlMatch = data.match(/^data:([^,]*),([\s\S]*)$/);
  if (!dataUrlMatch) {
    return { bytes: null, inlineText: data, mime: att.mimeType || "text/plain", name };
  }

  const metaParts = (dataUrlMatch[1] || "").split(";");
  const mime = (metaParts[0] || att.mimeType || "").toLowerCase();
  const isBase64 = metaParts.some((part) => part.trim().toLowerCase() === "base64");
  const payload = dataUrlMatch[2] || "";

  try {
    const bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return { bytes, inlineText: null, mime, name };
  } catch {
    return { bytes: null, inlineText: null, mime, name };
  }
}

/**
 * Extract real text from an uploaded attachment using the platform's document
 * pipeline (pdf-parse / mammoth / text sniffing). Unsupported or unreadable
 * files return an explicit marker — never a pretend extraction.
 */
export async function extractAttachmentText(att: MemoryAttachment): Promise<string> {
  const decoded = decodeAttachment(att);
  if (decoded.inlineText !== null) return decoded.inlineText.trim();
  if (!decoded.bytes || decoded.bytes.length === 0) {
    return att.data ? `[unreadable attachment: ${decoded.name}]` : "";
  }

  const textualMime =
    decoded.mime.startsWith("text/") ||
    decoded.mime.includes("json") ||
    decoded.mime.includes("xml") ||
    decoded.mime.includes("csv");

  const kind = sniffFileKind(decoded.bytes);

  try {
    if (kind === "pdf" || kind === "docx") {
      const result = await extractDocumentText(kind, decoded.bytes);
      return normalizeExtractedText(result.text);
    }
    if (kind === "txt" || textualMime) {
      return normalizeExtractedText(decoded.bytes.toString("utf8").replace(/^﻿/, ""));
    }
  } catch {
    return `[unreadable attachment: ${decoded.name} (${decoded.mime || "unknown type"}) — extraction failed]`;
  }

  // Images and other binary formats are not processed — say so honestly.
  return `[unsupported attachment: ${decoded.name} (${decoded.mime || "unknown type"}) — content was not extracted]`;
}

type CorpusPiece = {
  sourceType: MemoryRecordDraft["sourceType"];
  sourceLabel: string;
  text: string;
};

/** Full-fidelity corpus (no truncation) — what actually gets stored and embedded. */
export async function buildCorpusPieces(input: SmartMemoryInput): Promise<CorpusPiece[]> {
  const pieces: CorpusPiece[] = [];

  if (input.customNotes?.trim()) {
    pieces.push({ sourceType: "notes", sourceLabel: "Notes", text: input.customNotes.trim() });
  }

  for (const att of input.attachments ?? []) {
    const text = await extractAttachmentText(att);
    if (text.trim()) {
      pieces.push({ sourceType: "attachment", sourceLabel: att.name || "Attachment", text: text.trim() });
    }
  }

  for (const node of input.executedNodes ?? []) {
    const text = extractExecutedNodeText(node);
    if (text) {
      pieces.push({ sourceType: "node_output", sourceLabel: node.label || node.nodeId, text });
    }
  }

  if (input.variables && Object.keys(input.variables).length > 0) {
    const varLines = extractMemoryVariableLines(input.variables, 0);
    if (varLines.length > 0) {
      pieces.push({ sourceType: "variables", sourceLabel: "Key variables", text: varLines.join("\n") });
    }
  }

  return pieces;
}

export function corpusToRecordDrafts(
  pieces: CorpusPiece[],
  scope: SmartMemoryScope,
  scopeKey: string
): MemoryRecordDraft[] {
  return pieces.map((piece) => {
    const chunks = chunkText(piece.text);
    return {
      scopeKey,
      scope,
      sourceType: piece.sourceType,
      sourceLabel: piece.sourceLabel,
      content: piece.text,
      tokenCount: estimateTokens(piece.text),
      contentHash: sha256(piece.text),
      chunks: chunks.map((content, index) => ({
        chunkIndex: index,
        content,
        tokenCount: estimateTokens(content),
        contentHash: sha256(content)
      }))
    };
  });
}

const TIMELINE_MAX_WORDS = 500;
const TIMELINE_SAMPLE_LIMIT = 400;
const TIMELINE_SNIPPET_WORDS = 18;
const EMBED_MAX_ROUNDS = 8;

/**
 * Deterministic chronological digest over records sampled across the WHOLE
 * scope history — never calls an LLM. The 500-word budget includes the header.
 */
export function buildTimelineSummary(records: TimelineRecord[], totalRecords: number): string {
  if (records.length === 0) return "";

  const header =
    totalRecords > records.length
      ? `[TIMELINE SUMMARY] (chronological overview sampled across all ${totalRecords} stored memory records)`
      : "[TIMELINE SUMMARY] (chronological overview of stored memory)";

  const lines: string[] = [];
  let words = header.split(/\s+/).length;
  let previousLabel = "";

  for (const record of records) {
    const label = record.sourceLabel || record.sourceType;
    // Collapse only CONSECUTIVE repeats: recurring sources (the same node
    // label across many runs) still reappear along the timeline instead of
    // being frozen at their earliest snippet.
    if (label === previousLabel) continue;
    previousLabel = label;

    const contentWords = record.content.replace(/\s+/g, " ").trim().split(" ");
    const snippet = contentWords.slice(0, TIMELINE_SNIPPET_WORDS).join(" ");
    const line = `• ${label}: ${snippet}${contentWords.length > TIMELINE_SNIPPET_WORDS ? "…" : ""}`;
    const lineWords = line.split(/\s+/).length;
    if (words + lineWords > TIMELINE_MAX_WORDS) break;
    words += lineWords;
    lines.push(line);
  }

  if (lines.length === 0) return "";
  return `${header}\n${lines.join("\n")}`;
}

export function buildVectorMemoryString(params: {
  retrieved: StoredMemoryChunk[];
  timeline: string;
  totalStoredChunks: number;
}): string {
  const sections: string[] = [];

  if (params.retrieved.length > 0) {
    const chunkBlocks = params.retrieved.map((chunk) => {
      const label = chunk.sourceLabel || chunk.sourceType;
      return `[${label}]\n${chunk.content}`;
    });
    sections.push(
      `[RELEVANT CONTEXT] (${params.retrieved.length} of ${params.totalStoredChunks} stored memory chunks, selected for the current request)\n${chunkBlocks.join("\n\n")}`
    );
  }

  if (params.timeline) {
    sections.push(params.timeline);
  }

  if (sections.length === 0) {
    return "=== MEMORY ===\n(No prior step history or documents stored)";
  }

  return `=== MEMORY ===\n\n${sections.join("\n\n")}`;
}

/* ------------------------------ default deps ------------------------------- */

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function countPendingChunks(scopeKey: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "MemoryChunk"
    WHERE "scopeKey" = ${scopeKey} AND "embedding" IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

export const defaultSmartMemoryDeps: SmartMemoryDeps = {
  async storeCorpus(records) {
    if (records.length === 0) return { newRecords: 0, newChunks: 0 };
    const scopeKey = records[0].scopeKey;
    const existing = await prisma.memoryRecord.findMany({
      where: { scopeKey, contentHash: { in: records.map((r) => r.contentHash) } },
      select: { contentHash: true }
    });
    const existingHashes = new Set(existing.map((row) => row.contentHash));
    const fresh = records.filter((r) => !existingHashes.has(r.contentHash));

    let newRecords = 0;
    let newChunks = 0;
    for (const draft of fresh) {
      try {
        // One transaction per record: a mid-write failure must never leave a
        // record without its searchable chunks.
        const chunkCount = await prisma.$transaction(async (tx) => {
          const record = await tx.memoryRecord.create({
            data: {
              scopeKey: draft.scopeKey,
              businessId: draft.scope.businessId ?? null,
              installedAgentId: draft.scope.installedAgentId ?? null,
              architectUserId: draft.scope.architectUserId ?? null,
              workflowId: draft.scope.workflowId ?? null,
              workflowRunId: draft.scope.workflowRunId ?? null,
              threadId: draft.scope.threadId ?? null,
              nodeId: draft.scope.nodeId ?? null,
              testSessionId: draft.scope.testSessionId ?? null,
              callerKey: draft.scope.callerKey ?? null,
              sourceType: draft.sourceType,
              sourceLabel: draft.sourceLabel,
              content: draft.content,
              tokenCount: draft.tokenCount,
              contentHash: draft.contentHash
            }
          });
          const result = await tx.memoryChunk.createMany({
            data: draft.chunks.map((chunk) => ({
              recordId: record.id,
              scopeKey: draft.scopeKey,
              workflowRunId: draft.scope.workflowRunId ?? null,
              threadId: draft.scope.threadId ?? null,
              workflowId: draft.scope.workflowId ?? null,
              nodeId: draft.scope.nodeId ?? null,
              sourceType: draft.sourceType,
              sourceLabel:
                draft.chunks.length > 1
                  ? `${draft.sourceLabel} (part ${chunk.chunkIndex + 1}/${draft.chunks.length})`
                  : draft.sourceLabel,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              contentHash: chunk.contentHash
            })),
            skipDuplicates: true
          });
          return result.count;
        });
        newRecords += 1;
        newChunks += chunkCount;
      } catch (error) {
        // Concurrent duplicate insert (unique scopeKey+contentHash) — already stored.
        if ((error as { code?: string }).code === "P2002") continue;
        throw error;
      }
    }
    return { newRecords, newChunks };
  },

  async sumStoredTokens(scopeKey) {
    const aggregate = await prisma.memoryRecord.aggregate({
      where: { scopeKey },
      _sum: { tokenCount: true }
    });
    return aggregate._sum.tokenCount ?? 0;
  },

  async pruneScope(scopeKey, maxChunks) {
    await prisma.$executeRaw`
      DELETE FROM "MemoryChunk"
      WHERE "id" IN (
        SELECT "id" FROM "MemoryChunk"
        WHERE "scopeKey" = ${scopeKey}
        ORDER BY "createdAt" DESC, "chunkIndex" ASC
        OFFSET ${maxChunks}
      )
    `;
  },

  async embedPendingChunks(scopeKey, limit) {
    const pending = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT "id", "content" FROM "MemoryChunk"
      WHERE "scopeKey" = ${scopeKey} AND "embedding" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
    `;
    if (pending.length === 0) return { embedded: 0, pending: 0 };

    const vectors = await embedTexts(pending.map((row) => row.content));
    if (!vectors) {
      // No key / provider failure — chunks stay embeddable later.
      return { embedded: 0, pending: await countPendingChunks(scopeKey) };
    }

    for (let i = 0; i < pending.length; i += 1) {
      await prisma.$executeRaw`
        UPDATE "MemoryChunk"
        SET "embedding" = ${toVectorLiteral(vectors[i])}::vector,
            "embeddingModel" = ${env.MEMORY_EMBEDDING_MODEL},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${pending[i].id}
      `;
    }

    // Mark records whose sections are all embedded.
    await prisma.$executeRaw`
      UPDATE "MemoryRecord" r
      SET "embeddingStatus" = 'complete', "updatedAt" = CURRENT_TIMESTAMP
      WHERE r."scopeKey" = ${scopeKey} AND r."embeddingStatus" = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM "MemoryChunk" c WHERE c."recordId" = r."id" AND c."embedding" IS NULL
        )
    `;

    return { embedded: pending.length, pending: await countPendingChunks(scopeKey) };
  },

  async searchChunks(scopeKey, query, topK) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("similarity retrieval unavailable: no query text for this request");
    }

    const queryVectors = await embedTexts([trimmedQuery.slice(0, 8000)]);
    if (!queryVectors || queryVectors.length !== 1) {
      throw new Error("similarity retrieval unavailable: embeddings not configured (set OPENAI_API_KEY)");
    }

    const rows = await prisma.$queryRaw<StoredMemoryChunk[]>`
      SELECT "id", "content", "sourceType", "sourceLabel", "chunkIndex", "createdAt"
      FROM "MemoryChunk"
      WHERE "scopeKey" = ${scopeKey} AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${toVectorLiteral(queryVectors[0])}::vector
      LIMIT ${topK}
    `;
    if (rows.length === 0) {
      throw new Error("similarity retrieval unavailable: no embedded chunks in this scope yet");
    }
    return rows;
  },

  async sampleRecordsForTimeline(scopeKey, limit) {
    // Even sampling across the whole time range so the timeline represents ALL
    // remaining memory, not only the newest slice.
    return prisma.$queryRaw<TimelineRecord[]>`
      SELECT "sourceType", "sourceLabel", "content", "createdAt" FROM (
        SELECT "sourceType", "sourceLabel", "content", "createdAt",
               row_number() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn,
               count(*) OVER () AS total
        FROM "MemoryRecord"
        WHERE "scopeKey" = ${scopeKey}
      ) sampled
      WHERE (rn - 1) % GREATEST(1, CEIL(total::numeric / ${limit})::int) = 0
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
    `;
  },

  async countChunks(scopeKey) {
    return prisma.memoryChunk.count({ where: { scopeKey } });
  },

  async countRecords(scopeKey) {
    return prisma.memoryRecord.count({ where: { scopeKey } });
  },

  async enforceRetention(scope) {
    const now = new Date();
    const tenantWhere = scope.businessId
      ? { businessId: scope.businessId }
      : scope.architectUserId
        ? { architectUserId: scope.architectUserId }
        : null;
    if (!tenantWhere) return;

    // Age-based cleanup for this tenant.
    if (env.MEMORY_RETENTION_DAYS > 0) {
      const cutoff = new Date(now.getTime() - env.MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.memoryRecord.deleteMany({ where: { ...tenantWhere, createdAt: { lt: cutoff } } });
    }

    // Shorter retention for test-session memory.
    if (env.MEMORY_TEST_RETENTION_DAYS > 0) {
      const testCutoff = new Date(now.getTime() - env.MEMORY_TEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.memoryRecord.deleteMany({
        where: { ...tenantWhere, testSessionId: { not: null }, createdAt: { lt: testCutoff } }
      });
    }

    // Per-tenant token cap: delete oldest records until the tenant is under it.
    const aggregate = await prisma.memoryRecord.aggregate({ where: tenantWhere, _sum: { tokenCount: true } });
    let excess = (aggregate._sum.tokenCount ?? 0) - env.MEMORY_MAX_TOKENS_PER_TENANT;
    while (excess > 0) {
      const oldest = await prisma.memoryRecord.findMany({
        where: tenantWhere,
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { id: true, tokenCount: true }
      });
      if (oldest.length === 0) break;
      const toDelete: string[] = [];
      for (const record of oldest) {
        if (excess <= 0) break;
        toDelete.push(record.id);
        excess -= record.tokenCount;
      }
      if (toDelete.length === 0) break;
      await prisma.memoryRecord.deleteMany({ where: { id: { in: toDelete } } });
    }
  }
};

/* -------------------------------- main entry ------------------------------- */

/** Unit tests must never write to a real database through the default deps. */
function vectorStoreDisabledForTests(): boolean {
  return Boolean(process.env.VITEST) && !process.env.MEMORY_VECTOR_TEST_DB;
}

export function createSmartMemoryBuilder(deps: SmartMemoryDeps) {
  async function store(input: SmartMemoryInput): Promise<SmartMemoryStoreResult> {
    // The raw string is the contract: computed first so any failure below can return it untouched.
    const rawMemory = buildCompactMemoryString({
      executedNodes: input.executedNodes,
      variables: input.variables,
      attachments: input.attachments,
      customNotes: input.customNotes
    });
    const scopeKey = buildScopeKey(input.scope);

    let corpusTokens = 0;
    let storedRecords = 0;
    let storedChunks = 0;
    let storedTokens = 0;

    try {
      const pieces = await buildCorpusPieces(input);
      const drafts = corpusToRecordDrafts(pieces, input.scope, scopeKey);
      corpusTokens = drafts.reduce((sum, draft) => sum + draft.tokenCount, 0);

      const stored = await deps.storeCorpus(drafts);
      storedRecords = stored.newRecords;
      storedChunks = stored.newChunks;
      if (storedChunks > 0) {
        await deps.pruneScope(scopeKey, env.MEMORY_MAX_CHUNKS_PER_SCOPE);
        // Prepare embeddings + apply retention in the background — never block the run.
        void deps.embedPendingChunks(scopeKey, env.MEMORY_EMBED_MAX_PER_CALL).catch(() => undefined);
        void deps.enforceRetention(input.scope).catch(() => undefined);
      }
      storedTokens = await deps.sumStoredTokens(scopeKey);
    } catch (error) {
      console.warn(
        "[smart-memory] vector store unavailable, memory continues with raw string:",
        error instanceof Error ? error.message : "unknown error"
      );
      return { memory: rawMemory, scopeKey, overThreshold: false, corpusTokens, storedRecords: 0, storedChunks: 0 };
    }

    const overThreshold = Math.max(corpusTokens, storedTokens) > env.MEMORY_VECTOR_THRESHOLD_TOKENS;
    return { memory: rawMemory, scopeKey, overThreshold, corpusTokens, storedRecords, storedChunks };
  }

  async function resolveForQuery(params: {
    scopeKey: string;
    query: string;
    rawMemory: string;
  }): Promise<ResolvedSmartMemory> {
    let storedTokens = 0;
    try {
      storedTokens = await deps.sumStoredTokens(params.scopeKey);
    } catch {
      return { memory: params.rawMemory, mode: "raw", retrievedChunks: 0 };
    }

    if (storedTokens <= env.MEMORY_VECTOR_THRESHOLD_TOKENS) {
      return { memory: params.rawMemory, mode: "raw", retrievedChunks: 0 };
    }

    try {
      // Vector mode requires the FULL scope to be embedded — a partial search
      // must never be reported as a full one.
      let pending = Number.MAX_SAFE_INTEGER;
      for (let round = 0; round < EMBED_MAX_ROUNDS && pending > 0; round += 1) {
        const progress = await deps.embedPendingChunks(params.scopeKey, env.MEMORY_EMBED_MAX_PER_CALL);
        pending = progress.pending;
        if (pending > 0 && progress.embedded === 0) {
          throw new Error(
            "similarity retrieval unavailable: scope not fully embedded (embeddings not configured or failing)"
          );
        }
      }
      if (pending > 0) {
        throw new Error("similarity retrieval unavailable: scope not fully embedded yet");
      }

      const [retrieved, timelineRecords, totalChunks, totalRecords] = await Promise.all([
        deps.searchChunks(params.scopeKey, params.query, env.MEMORY_VECTOR_TOP_K),
        deps.sampleRecordsForTimeline(params.scopeKey, TIMELINE_SAMPLE_LIMIT),
        deps.countChunks(params.scopeKey).catch(() => 0),
        deps.countRecords(params.scopeKey).catch(() => 0)
      ]);

      const timeline = buildTimelineSummary(timelineRecords, totalRecords);
      return {
        memory: buildVectorMemoryString({ retrieved, timeline, totalStoredChunks: totalChunks }),
        mode: "vector",
        retrievedChunks: retrieved.length
      };
    } catch (error) {
      console.warn(
        "[smart-memory] similarity retrieval unavailable, using raw memory string:",
        error instanceof Error ? error.message : "unknown error"
      );
      // Keep chipping at the embedding backlog off the request path so a cold
      // scope (key added after storage) converges to vector mode over calls.
      void deps.embedPendingChunks(params.scopeKey, env.MEMORY_EMBED_MAX_PER_CALL).catch(() => undefined);
      return { memory: params.rawMemory, mode: "raw_fallback", retrievedChunks: 0 };
    }
  }

  return { store, resolveForQuery };
}

const productionSmartMemory = createSmartMemoryBuilder(defaultSmartMemoryDeps);

/** Memory Node execution: persist the corpus, return the classic raw string. */
export async function buildSmartMemory(input: SmartMemoryInput): Promise<SmartMemoryStoreResult> {
  if (vectorStoreDisabledForTests()) {
    return {
      memory: buildCompactMemoryString({
        executedNodes: input.executedNodes,
        variables: input.variables,
        attachments: input.attachments,
        customNotes: input.customNotes
      }),
      scopeKey: buildScopeKey(input.scope),
      overThreshold: false,
      corpusTokens: 0,
      storedRecords: 0,
      storedChunks: 0
    };
  }
  return productionSmartMemory.store(input);
}

export async function resolveSmartMemoryForQuery(params: {
  scopeKey: string;
  query: string;
  rawMemory: string;
}): Promise<ResolvedSmartMemory> {
  if (vectorStoreDisabledForTests()) {
    return { memory: params.rawMemory, mode: "raw", retrievedChunks: 0 };
  }
  return productionSmartMemory.resolveForQuery(params);
}

export function mergeMemoryIntoPrompt(prompt: string, resolvedMemory: string, rawMemory: string): string {
  if (!resolvedMemory.trim()) return prompt;
  if (rawMemory && prompt.includes(rawMemory)) {
    return rawMemory === resolvedMemory ? prompt : prompt.split(rawMemory).join(resolvedMemory);
  }
  if (prompt.includes(resolvedMemory)) return prompt;
  const section = `Memory from earlier workflow steps, documents, and notes (provided automatically):\n${resolvedMemory}`;
  return prompt.trim() ? `${prompt}\n\n${section}` : section;
}
