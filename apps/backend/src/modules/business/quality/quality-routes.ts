import { Hono } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import { logBusinessActivity } from "../activity-log";
import { requireBusinessPermission } from "../team/membership";
import { computeQualitySummary, effectiveScore, type SummaryEvaluationRow } from "./summary";

/**
 * Conversation quality routes (plan Part 8). Mount under /business/quality.
 * Permission model:
 * - GET  /summary, /evaluations  → view_reports (whole-business reports;
 *   SALES/SUPPORT hold only view_own_reports so the gate 403s them here).
 * - POST /evaluations/:id/dispute → view_calls (any staff member can flag a
 *   score they believe is wrong).
 * - POST /evaluations/:id/review  → manage_team (managers/admins). The
 *   ORIGINAL overallScore/dimensionsJson are never overwritten — adjustments
 *   live in adjustedScore only.
 */
export const qualityRoutes = new Hono();

const SUMMARY_WINDOW_DAYS = 8 * 7;
const LIST_MAX_ROWS = 200;

qualityRoutes.get("/summary", requireBusinessPermission("view_reports"), async (c) => {
  const membership = c.get("businessMembership");
  const since = new Date(Date.now() - SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = (await prisma.conversationEvaluation.findMany({
    where: { businessId: membership.businessId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      vapiCallId: true,
      handledBy: true,
      status: true,
      overallScore: true,
      adjustedScore: true,
      confidence: true,
      dimensionsJson: true,
      missedOpportunitiesJson: true,
      createdAt: true,
    },
  })) as SummaryEvaluationRow[];

  const summary = computeQualitySummary(rows);

  // Attach minimal call info to best/worst so the UI can label them.
  const callIds = [...summary.best, ...summary.worst]
    .map((entry) => entry.vapiCallId)
    .filter((id): id is string => Boolean(id));
  const calls = callIds.length
    ? await prisma.vapiCall.findMany({
        where: { id: { in: callIds } },
        select: {
          id: true,
          customerPhone: true,
          outcome: true,
          durationSeconds: true,
          startedAt: true,
        },
      })
    : [];
  const callById = new Map(calls.map((call) => [call.id, call]));
  const withCall = <T extends { vapiCallId: string | null }>(entry: T) => ({
    ...entry,
    call: entry.vapiCallId ? (callById.get(entry.vapiCallId) ?? null) : null,
  });

  return successResponse(c, {
    ...summary,
    best: summary.best.map(withCall),
    worst: summary.worst.map(withCall),
    windowDays: SUMMARY_WINDOW_DAYS,
  });
});

qualityRoutes.get("/evaluations", requireBusinessPermission("view_reports"), async (c) => {
  const membership = c.get("businessMembership");
  const query = c.req.query();

  const parseScore = (value: string | undefined): number | null => {
    if (value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const parseDate = (value: string | undefined): Date | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const minScore = parseScore(query.minScore);
  const maxScore = parseScore(query.maxScore);
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  const handledBy =
    query.handledBy === "AI" || query.handledBy === "HUMAN" || query.handledBy === "MIXED"
      ? query.handledBy
      : null;

  const rows = await prisma.conversationEvaluation.findMany({
    where: {
      businessId: membership.businessId,
      ...(handledBy ? { handledBy } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIST_MAX_ROWS,
  });

  // Score filters apply to the effective score (adjusted beats original).
  const filtered = rows.filter((row) => {
    const score = effectiveScore(row);
    if (minScore !== null && score < minScore) return false;
    if (maxScore !== null && score > maxScore) return false;
    return true;
  });

  return successResponse(c, {
    evaluations: filtered.map((row) => ({ ...row, effectiveScore: effectiveScore(row) })),
    total: filtered.length,
  });
});

qualityRoutes.post(
  "/evaluations/:id/dispute",
  requireBusinessPermission("view_calls"),
  async (c) => {
    const membership = c.get("businessMembership");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) {
      return errorResponse(c, "A dispute note is required", 422, "DISPUTE_NOTE_REQUIRED");
    }

    const evaluation = await prisma.conversationEvaluation.findFirst({
      where: { id: c.req.param("id") ?? "", businessId: membership.businessId },
      select: { id: true, status: true },
    });
    if (!evaluation) {
      return errorResponse(c, "Evaluation not found", 404, "EVALUATION_NOT_FOUND");
    }

    // Dispute flags the row for a manager. Scores are untouched — only the
    // review endpoint may set an adjusted score.
    const updated = await prisma.conversationEvaluation.update({
      where: { id: evaluation.id },
      data: {
        status: "UNDER_REVIEW",
        reviewNote: `Disputed: ${note}`.slice(0, 1000),
      },
    });

    return successResponse(c, { evaluation: updated });
  }
);

qualityRoutes.post(
  "/evaluations/:id/review",
  requireBusinessPermission("manage_team"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const hasAdjustedScore = body.adjustedScore !== undefined && body.adjustedScore !== null;
    const adjustedScore = hasAdjustedScore ? Number(body.adjustedScore) : null;
    if (hasAdjustedScore && (!Number.isFinite(adjustedScore) || adjustedScore! < 0 || adjustedScore! > 10)) {
      return errorResponse(c, "adjustedScore must be a number from 0 to 10", 422, "ADJUSTED_SCORE_INVALID");
    }
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const evaluation = await prisma.conversationEvaluation.findFirst({
      where: { id: c.req.param("id") ?? "", businessId: membership.businessId },
      select: { id: true, status: true, overallScore: true },
    });
    if (!evaluation) {
      return errorResponse(c, "Evaluation not found", 404, "EVALUATION_NOT_FOUND");
    }

    // ORIGINAL overallScore/dimensionsJson are never overwritten: an adjusted
    // score sets status ADJUSTED; clearing it returns the row to SCORED.
    const updated = await prisma.conversationEvaluation.update({
      where: { id: evaluation.id },
      data: {
        status: hasAdjustedScore ? "ADJUSTED" : "SCORED",
        adjustedScore: hasAdjustedScore ? adjustedScore : null,
        reviewNote: note || null,
        reviewedByUserId: authUser.id,
        reviewedAt: new Date(),
      },
    });

    await logBusinessActivity({
      businessId: membership.businessId,
      action: "EVALUATION_REVIEWED",
      actorUserId: authUser.id,
      targetType: "ConversationEvaluation",
      targetId: evaluation.id,
      detail: {
        previousStatus: evaluation.status,
        newStatus: updated.status,
        originalScore: evaluation.overallScore,
        adjustedScore: hasAdjustedScore ? adjustedScore : null,
      },
    });

    return successResponse(c, { evaluation: updated });
  }
);
