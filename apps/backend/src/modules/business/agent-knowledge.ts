import { prisma } from "../../lib/prisma";
import { detectFactIntents } from "./business-facts";

export type KnowledgeEntryRow = {
  title?: string | null;
  content?: string | null;
  sourceFileId?: string | null;
  chunkIndex?: number | null;
  createdAt?: Date | null;
};

/** Deterministic order: manual entries first (by age), then document chunks in chunk order. */
function sortKnowledgeRows<T extends KnowledgeEntryRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aFile = a.sourceFileId ?? "";
    const bFile = b.sourceFileId ?? "";
    if (aFile !== bFile) {
      if (!aFile) return -1;
      if (!bFile) return 1;
      return aFile.localeCompare(bFile);
    }
    const aChunk = a.chunkIndex ?? 0;
    const bChunk = b.chunkIndex ?? 0;
    if (aChunk !== bChunk) return aChunk - bChunk;
    return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  });
}

/** Shared "Title: content" formatting — identical across every agent runtime. */
export function formatKnowledgeEntries(rows: KnowledgeEntryRow[]): string[] {
  return sortKnowledgeRows(rows)
    .map((row) => {
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const content = typeof row.content === "string" ? row.content.trim() : "";
      if (!content) return "";
      return title ? `${title}: ${content}` : content;
    })
    .filter(Boolean);
}

export type BusinessAgentKnowledge = {
  /** Prompt-ready entries (manual + document chunks, shared format/order). */
  knowledge: string[];
  /** Successfully processed documents contributing knowledge. */
  documents: Array<{ id: string; filename: string; chunkCount: number }>;
  /** Total knowledge sections available to the agent. */
  sectionCount: number;
  /** Sections entered manually (not derived from a document). */
  manualCount: number;
};

export const KNOWLEDGE_PROMPT_BUDGET_CHARS = 12_000;

/** Manual entries first, then document chunks, until the budget is spent. */
function budgetKnowledgeForPrompt(entries: string[], budgetChars: number): string[] {
  const included: string[] = [];
  let used = 0;

  for (const entry of entries) {
    if (used + entry.length > budgetChars) {
      included.push(
        "Additional business documents are available — use the lookup_knowledge tool (or ask a more specific question) to retrieve them."
      );
      break;
    }
    included.push(entry);
    used += entry.length;
  }

  return included;
}

/**
 * Agent-scope filter: an installed agent sees business-wide rows (manual
 * entries, legacy chunks with no attribution) plus ONLY its own document
 * chunks — never another agent's. Omit installedAgentId for business-wide
 * loading (single-agent live paths resolve their agent where known).
 */
function agentScopeFilter(installedAgentId?: string | null) {
  if (installedAgentId === undefined) return {};
  return { OR: [{ installedAgentId: null }, { installedAgentId }] };
}

export async function loadBusinessAgentKnowledge(params: {
  businessId: string;
  installedAgentId?: string | null;
  /** Prompt budget in characters; pass Infinity to disable budgeting. */
  promptBudgetChars?: number;
}): Promise<BusinessAgentKnowledge> {
  const [rows, documents] = await Promise.all([
    prisma.businessKnowledgeBase.findMany({
      where: { businessId: params.businessId, ...agentScopeFilter(params.installedAgentId) },
      select: { title: true, content: true, sourceFileId: true, chunkIndex: true, createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.businessKnowledgeFile.findMany({
      where: {
        businessId: params.businessId,
        status: "PROCESSED",
        ...(params.installedAgentId === undefined
          ? {}
          : { OR: [{ installedAgentId: null }, { installedAgentId: params.installedAgentId }] })
      },
      select: { id: true, filename: true, chunkCount: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const budget = params.promptBudgetChars ?? KNOWLEDGE_PROMPT_BUDGET_CHARS;
  const formatted = formatKnowledgeEntries(rows);

  return {
    knowledge: Number.isFinite(budget) ? budgetKnowledgeForPrompt(formatted, budget) : formatted,
    documents,
    sectionCount: rows.length,
    manualCount: rows.filter((row) => !row.sourceFileId).length
  };
}

/* ------------------------------- retrieval -------------------------------- */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "do", "does",
  "did", "have", "has", "had", "what", "when", "where", "which", "who", "how",
  "why", "can", "could", "would", "should", "will", "you", "your", "yours", "i",
  "me", "my", "we", "our", "they", "them", "their", "it", "its", "of", "to",
  "in", "on", "for", "with", "at", "by", "from", "about", "as", "into", "that",
  "this", "these", "those", "there", "be", "been", "am", "not", "no", "yes",
  "please", "tell", "know", "want", "need", "like", "get", "got", "ok", "okay"
]);

const SYNONYM_GROUPS: string[][] = [
  ["address", "location", "located", "situated", "directions", "landmark", "map", "maps", "street", "arrive", "reach", "visit", "find"],
  ["hours", "open", "opening", "closing", "close", "timing", "timings", "schedule"],
  ["price", "prices", "pricing", "cost", "costs", "fee", "fees", "charge", "charges", "rate", "rates"],
  ["parking", "park", "garage", "valet"],
  ["insurance", "insurances", "coverage", "insurer", "plan", "plans", "ppo", "hmo"],
  ["cancel", "cancellation", "reschedule", "rescheduling", "policy"],
  ["doctor", "doctors", "dentist", "dentists", "physician", "physicians", "specialist", "specialists", "specialty", "specialties", "team", "staff", "provider", "providers", "practitioner", "practitioners", "surgeon", "surgeons", "orthodontist", "orthodontists", "hygienist", "hygienists", "consultant", "consultants", "clinician", "clinicians"],
  ["emergency", "urgent", "same-day", "immediately", "pain"],
  ["phone", "telephone", "call", "contact", "number"],
  ["email", "mail", "e-mail"],
  ["appointment", "appointments", "booking", "bookings", "visit", "slot"]
];

function expandTerms(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(term)) {
        for (const synonym of group) expanded.add(synonym);
      }
    }
  }
  return [...expanded];
}

const CONTACT_HEADING = /(^|\n)\s*(address|contact|location|visit us|find us|reach us|clinic information|office information|get in touch)\b/i;

const ENUMERATION_QUERY =
  /\b(all|every|each|list|which|who|whom|names|named|complete|entire|full|any other|others|else|total|how many)\b/i;

/**
 * Never smaller than the ingest chunker's ceiling (knowledge-files.ts
 * CHUNK_MAX_CHARS = 2500). The previous 1600 silently sliced 400–900 characters
 * off the end of every retrieved chunk, so whatever a document listed last in a
 * section — the tail of a doctor roster, a price, a closing note — was invisible
 * to the agent even when retrieval had picked exactly the right chunk.
 */
const MAX_SECTION_CHARS = 2_500;

/** Total characters one retrieval may return. Whole sections are dropped to fit — never cut. */
const RETRIEVAL_CHAR_BUDGET = 8_000;

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    )
  ];
}

export type RetrievedKnowledgeSection = {
  title: string;
  content: string;
  sourceFilename: string | null;
  score: number;
};

export async function retrieveRelevantKnowledge(params: {
  businessId: string;
  installedAgentId?: string | null;
  query: string;
  limit?: number;
  maxSectionChars?: number;
}): Promise<RetrievedKnowledgeSection[]> {
  const baseTerms = queryTerms(params.query ?? "");
  // Intent detection rescues questions whose meaning lives in stop-words
  // ("Where should I come?") — the location anchor terms are injected even
  // when no lexical term survives filtering.
  const intents = detectFactIntents(params.query ?? "");
  const intentTerms = intents.includes("address")
    ? ["address", "location", "directions", "street", "landmark"]
    : [];
  if (baseTerms.length === 0 && intentTerms.length === 0) return [];
  const terms = expandTerms([...new Set([...baseTerms, ...intentTerms])]);
  const locationIntent = terms.includes("address") || terms.includes("location");

  const rows = await prisma.businessKnowledgeBase.findMany({
    where: { businessId: params.businessId, ...agentScopeFilter(params.installedAgentId) },
    select: {
      title: true,
      content: true,
      sourceFileId: true,
      chunkIndex: true,
      createdAt: true,
      sourceFile: { select: { filename: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  const enumeration = ENUMERATION_QUERY.test(params.query ?? "");
  const limit = params.limit ?? (enumeration ? 10 : 4);
  const maxSectionChars = params.maxSectionChars ?? MAX_SECTION_CHARS;

  const scored = rows
    .map((row) => {
      const haystack = `${row.title ?? ""}\n${row.content ?? ""}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!haystack.includes(term)) continue;
        // Direct caller terms outweigh expanded synonyms; title hits beat body.
        const weight = baseTerms.includes(term) || intentTerms.includes(term) ? 1 : 0.5;
        score += ((row.title ?? "").toLowerCase().includes(term) ? 3 : 2) * weight;
        const repeats = haystack.split(term).length - 1;
        score += Math.min(repeats - 1, 3) * 0.5 * weight;
      }
      if (score > 0 && locationIntent && CONTACT_HEADING.test(`${row.title ?? ""}\n${row.content ?? ""}`)) {
        score += 6;
      }
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.row.sourceFileId ?? "").localeCompare(b.row.sourceFileId ?? "") ||
        (a.row.chunkIndex ?? 0) - (b.row.chunkIndex ?? 0)
    )
    .slice(0, limit);

  if (enumeration && scored.length > 0) {
    const chosen = new Set(scored.map(({ row }) => `${row.sourceFileId ?? ""}#${row.chunkIndex ?? 0}`));
    let budget =
      RETRIEVAL_CHAR_BUDGET - scored.reduce((sum, { row }) => sum + (row.content ?? "").length, 0);

    for (const { row, score } of [...scored]) {
      if (!row.sourceFileId || budget <= 0) continue;
      const index = row.chunkIndex ?? 0;
      for (const neighbourIndex of [index - 1, index + 1]) {
        const key = `${row.sourceFileId}#${neighbourIndex}`;
        if (chosen.has(key)) continue;
        const neighbour = rows.find(
          (candidate) =>
            candidate.sourceFileId === row.sourceFileId && (candidate.chunkIndex ?? 0) === neighbourIndex
        );
        if (!neighbour) continue;
        const length = (neighbour.content ?? "").length;
        if (length > budget) continue;
        chosen.add(key);
        budget -= length;
        // Neighbours rank just below their anchor and never displace a real hit.
        scored.push({ row: neighbour, score: score - 0.01 });
      }
    }

    scored.sort(
      (a, b) =>
        (a.row.sourceFileId ?? "").localeCompare(b.row.sourceFileId ?? "") ||
        (a.row.chunkIndex ?? 0) - (b.row.chunkIndex ?? 0)
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[knowledge-retrieval]", {
      businessId: params.businessId,
      installedAgentId: params.installedAgentId ?? null,
      query: params.query.slice(0, 120),
      baseTerms,
      expandedCount: terms.length,
      results: scored.slice(0, 3).map(({ row, score }) => ({
        score: Number(score.toFixed(1)),
        file: row.sourceFile?.filename ?? "manual",
        chunk: row.chunkIndex
      }))
    });
  }

  /* Fit the budget by dropping the weakest sections whole. Trimming each
     section instead is what hid the tail of a matched chunk from the agent. */
  const kept = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .reduce<{ total: number; keys: string[] }>(
        (acc, { row }, index) => {
          const length = Math.min((row.content ?? "").length, maxSectionChars);
          // The single best section is always kept, however long it is.
          if (index > 0 && acc.total + length > RETRIEVAL_CHAR_BUDGET) return acc;
          acc.total += length;
          acc.keys.push(`${row.sourceFileId ?? ""}#${row.chunkIndex ?? 0}`);
          return acc;
        },
        { total: 0, keys: [] }
      ).keys
  );

  return scored
    .filter(({ row }) => kept.has(`${row.sourceFileId ?? ""}#${row.chunkIndex ?? 0}`))
    .map(({ row, score }) => ({
      title: (row.title ?? "").trim() || "Business knowledge",
      content: (row.content ?? "").slice(0, maxSectionChars),
      sourceFilename: row.sourceFile?.filename ?? null,
      score
    }));
}
