import { Hono } from "hono";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireBusinessPermission } from "./team/membership";

/**
 * Buyer calls & transcripts API (plan Part 2A): recording player, transcript,
 * summary, outcome, sentiment, and handoff status — all tenant-scoped, all
 * behind view_calls. Transcripts are stored pre-redacted (card/SSN/CVV never
 * persist), so this read path adds no redaction of its own.
 */
export const callsRoutes = new Hono();

callsRoutes.get("/", requireBusinessPermission("view_calls"), async (c) => {
  const membership = c.get("businessMembership");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));
  const outcome = c.req.query("outcome");

  const calls = await prisma.vapiCall.findMany({
    where: {
      businessId: membership.businessId,
      executionMode: "LIVE",
      ...(outcome ? { outcome } : {})
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      callId: true,
      customerPhone: true,
      customerId: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      status: true,
      outcome: true,
      sentiment: true,
      recordingUrl: true
    }
  });

  // Latest handoff status per call, one query.
  const callIds = calls.map((call) => call.callId);
  const handoffs = callIds.length
    ? await prisma.handoffEvent.findMany({
        where: { businessId: membership.businessId, vapiCallId: { in: callIds } },
        orderBy: { createdAt: "desc" },
        select: { vapiCallId: true, status: true }
      })
    : [];
  const handoffByCall = new Map<string, string>();
  for (const handoff of handoffs) {
    if (handoff.vapiCallId && !handoffByCall.has(handoff.vapiCallId)) {
      handoffByCall.set(handoff.vapiCallId, handoff.status);
    }
  }

  return successResponse(c, {
    calls: calls.map((call) => ({
      ...call,
      handoffStatus: handoffByCall.get(call.callId) ?? null
    }))
  });
});

callsRoutes.get("/:id", requireBusinessPermission("view_calls"), async (c) => {
  const membership = c.get("businessMembership");
  const id = c.req.param("id") ?? "";

  // Accept either the row id or the provider callId.
  const call = await prisma.vapiCall.findFirst({
    where: {
      businessId: membership.businessId,
      OR: [{ id }, { callId: id }]
    },
    select: {
      id: true,
      callId: true,
      customerPhone: true,
      customerId: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      status: true,
      outcome: true,
      sentiment: true,
      recordingUrl: true,
      transcript: true,
      summary: true,
      installedAgentId: true
    }
  });
  if (!call) return errorResponse(c, "Call not found", 404, "CALL_NOT_FOUND");

  const handoffs = await prisma.handoffEvent.findMany({
    where: { businessId: membership.businessId, vapiCallId: call.callId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      reason: true,
      destination: true,
      assignedTeamMemberId: true,
      attemptsCount: true,
      waitSeconds: true,
      connectedAt: true,
      createdAt: true,
      resolvedAt: true,
      attempts: {
        orderBy: { attemptOrder: "asc" },
        select: {
          attemptOrder: true,
          teamMemberId: true,
          destination: true,
          startedAt: true,
          connectedAt: true,
          endedAt: true,
          outcome: true
        }
      }
    }
  });

  return successResponse(c, { call, handoffs });
});
