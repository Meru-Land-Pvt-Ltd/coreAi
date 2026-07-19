import { prisma } from "../../lib/prisma";

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

export async function loadBusinessAgentKnowledge(params: {
  businessId: string;
  /** Prompt budget in characters; pass Infinity to disable budgeting. */
  promptBudgetChars?: number;
}): Promise<BusinessAgentKnowledge> {
  const [rows, documents] = await Promise.all([
    prisma.businessKnowledgeBase.findMany({
      where: { businessId: params.businessId },
      select: { title: true, content: true, sourceFileId: true, chunkIndex: true, createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.businessKnowledgeFile.findMany({
      where: { businessId: params.businessId, status: "PROCESSED" },
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
  query: string;
  limit?: number;
  maxSectionChars?: number;
}): Promise<RetrievedKnowledgeSection[]> {
  const terms = queryTerms(params.query ?? "");
  if (terms.length === 0) return [];

  const rows = await prisma.businessKnowledgeBase.findMany({
    where: { businessId: params.businessId },
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

  const limit = params.limit ?? 4;
  const maxSectionChars = params.maxSectionChars ?? 1600;

  const scored = rows
    .map((row) => {
      const haystack = `${row.title ?? ""}\n${row.content ?? ""}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!haystack.includes(term)) continue;
        // Title hits weigh more than body hits; repeated terms add a little.
        score += (row.title ?? "").toLowerCase().includes(term) ? 3 : 2;
        const repeats = haystack.split(term).length - 1;
        score += Math.min(repeats - 1, 3) * 0.5;
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

  return scored.map(({ row, score }) => ({
    title: (row.title ?? "").trim() || "Business knowledge",
    content: (row.content ?? "").slice(0, maxSectionChars),
    sourceFilename: row.sourceFile?.filename ?? null,
    score
  }));
}
