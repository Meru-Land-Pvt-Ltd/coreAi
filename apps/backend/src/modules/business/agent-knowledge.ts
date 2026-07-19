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

export async function loadBusinessAgentKnowledge(params: {
  businessId: string;
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

  return {
    knowledge: formatKnowledgeEntries(rows),
    documents,
    sectionCount: rows.length,
    manualCount: rows.filter((row) => !row.sourceFileId).length
  };
}
