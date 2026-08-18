import { prisma } from "../../../lib/prisma";

/**
 * Unanswered-question capture (plan Part 3, "knowledge gaps").
 *
 * When lookup_knowledge finds nothing for a caller's question, the question is
 * recorded here so the buyer sees WHAT their knowledge base fails to answer
 * and can upload a document that covers it. Repeats of the same question
 * (normalized) count up on one row instead of piling duplicates.
 */

export class UnansweredQuestionError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 422,
    public readonly code: string
  ) {
    super(message);
    this.name = "UnansweredQuestionError";
  }
}

const MAX_QUESTION_CHARS = 500;

/** Lowercase, punctuation stripped, spaces collapsed, first 120 chars. */
export function normalizeQuestionKey(question: string): string {
  return String(question ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
}

export type UnansweredQuestionRow = {
  id: string;
  businessId: string;
  installedAgentId: string | null;
  channel: string;
  question: string;
  normalizedKey: string;
  count: number;
  lastAskedAt: Date;
  status: string;
  resolvedByFileId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Record (or count up) an unanswered question.
 *
 * Reopen-on-repeat — documented choice: if the row was RESOLVED but a caller
 * asks the same question again, the knowledge that "resolved" it apparently
 * still doesn't cover it. The row flips back to OPEN and the stale resolution
 * (resolvedByFileId/resolvedAt) is cleared, so the gap resurfaces on the
 * dashboard instead of silently counting up under a "resolved" label.
 *
 * The original question phrasing is kept on repeats (normalizedKey already
 * dedupes wording variants). Best-effort: this hooks into live call paths, so
 * a database failure logs and returns null — it never breaks the tool call.
 */
export async function recordUnansweredQuestion(params: {
  businessId: string;
  installedAgentId?: string | null;
  channel: string;
  question: string;
}): Promise<UnansweredQuestionRow | null> {
  const normalizedKey = normalizeQuestionKey(params.question);
  if (!normalizedKey) return null;

  try {
    return (await prisma.unansweredQuestion.upsert({
      where: {
        businessId_normalizedKey: { businessId: params.businessId, normalizedKey }
      },
      create: {
        businessId: params.businessId,
        installedAgentId: params.installedAgentId ?? null,
        channel: params.channel,
        question: params.question.trim().slice(0, MAX_QUESTION_CHARS),
        normalizedKey
      },
      update: {
        count: { increment: 1 },
        lastAskedAt: new Date(),
        status: "OPEN",
        resolvedByFileId: null,
        resolvedAt: null
      }
    })) as UnansweredQuestionRow;
  } catch (error) {
    console.error("[unanswered-questions] record failed (tool call unaffected)", {
      businessId: params.businessId,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export async function resolveQuestion(params: {
  businessId: string;
  id: string;
  resolvedByFileId?: string | null;
  /** Kept for API symmetry/audit callers; no activity action exists for gaps yet. */
  actorUserId?: string | null;
}): Promise<UnansweredQuestionRow> {
  const row = await prisma.unansweredQuestion.findFirst({
    where: { id: params.id, businessId: params.businessId },
    select: { id: true }
  });
  if (!row) {
    throw new UnansweredQuestionError("Question not found.", 404, "UNANSWERED_QUESTION_NOT_FOUND");
  }

  const resolvedByFileId = params.resolvedByFileId ?? null;
  if (resolvedByFileId) {
    // Tenant guard: the resolving document must belong to the same business.
    const file = await prisma.businessKnowledgeFile.findFirst({
      where: { id: resolvedByFileId, businessId: params.businessId },
      select: { id: true }
    });
    if (!file) {
      throw new UnansweredQuestionError("Document not found.", 404, "KNOWLEDGE_FILE_NOT_FOUND");
    }
  }

  return (await prisma.unansweredQuestion.update({
    where: { id: row.id },
    data: { status: "RESOLVED", resolvedByFileId, resolvedAt: new Date() }
  })) as UnansweredQuestionRow;
}

export async function listQuestions(params: {
  businessId: string;
  status?: "OPEN" | "RESOLVED";
}): Promise<UnansweredQuestionRow[]> {
  return (await prisma.unansweredQuestion.findMany({
    where: {
      businessId: params.businessId,
      ...(params.status ? { status: params.status } : {})
    },
    orderBy: [{ count: "desc" }, { lastAskedAt: "desc" }]
  })) as UnansweredQuestionRow[];
}
