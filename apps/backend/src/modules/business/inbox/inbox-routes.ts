import { Hono } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import { requireBusinessPermission } from "../team/membership";
import {
  claimConversation,
  closeConversation,
  InboxError,
  releaseConversationToAi,
  sendHumanReply
} from "./inbox-service";

/** Buyer shared inbox (plan Part 1D). Mounted at /business/inbox. */
export const inboxRoutes = new Hono();

function handleInboxError(c: Parameters<typeof errorResponse>[0], error: unknown) {
  if (error instanceof InboxError) {
    return errorResponse(c, error.message, error.httpStatus as 400, error.code);
  }
  console.error("[inbox-routes] unexpected error", error);
  return errorResponse(c, "Something went wrong", 500, "INBOX_ERROR");
}

inboxRoutes.get("/", requireBusinessPermission("view_calls"), async (c) => {
  const membership = c.get("businessMembership");
  const state = c.req.query("state");
  const channel = c.req.query("channel");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));

  const conversations = await prisma.conversation.findMany({
    where: {
      businessId: membership.businessId,
      ...(state ? { aiState: state } : { aiState: { not: "CLOSED" } }),
      ...(channel ? { channel } : {})
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      channel: true,
      customerPhone: true,
      customerId: true,
      aiState: true,
      assignedTeamMemberId: true,
      waitingSince: true,
      humanSince: true,
      slaEscalatedAt: true,
      outcome: true,
      sentiment: true,
      summary: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      updatedAt: true
    }
  });

  const waitingCount = await prisma.conversation.count({
    where: { businessId: membership.businessId, aiState: "WAITING_FOR_HUMAN" }
  });

  return successResponse(c, { conversations, waitingCount });
});

inboxRoutes.get("/:conversationId", requireBusinessPermission("view_calls"), async (c) => {
  const membership = c.get("businessMembership");
  const conversation = await prisma.conversation.findFirst({
    where: { id: c.req.param("conversationId") ?? "", businessId: membership.businessId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 200 }
    }
  });
  if (!conversation) return errorResponse(c, "Conversation not found", 404, "CONVERSATION_NOT_FOUND");
  return successResponse(c, { conversation });
});

inboxRoutes.post("/:conversationId/claim", requireBusinessPermission("take_handoff"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  try {
    const conversation = await claimConversation({
      businessId: membership.businessId,
      conversationId: c.req.param("conversationId") ?? "",
      teamMemberId: membership.teamMemberId,
      actorUserId: authUser.id,
      actorLabel: authUser.fullName ?? authUser.email
    });
    return successResponse(c, { conversation });
  } catch (error) {
    return handleInboxError(c, error);
  }
});

inboxRoutes.post("/:conversationId/release", requireBusinessPermission("take_handoff"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  try {
    const conversation = await releaseConversationToAi({
      businessId: membership.businessId,
      conversationId: c.req.param("conversationId") ?? "",
      actorUserId: authUser.id
    });
    return successResponse(c, { conversation });
  } catch (error) {
    return handleInboxError(c, error);
  }
});

inboxRoutes.post("/:conversationId/close", requireBusinessPermission("take_handoff"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  try {
    const conversation = await closeConversation({
      businessId: membership.businessId,
      conversationId: c.req.param("conversationId") ?? "",
      actorUserId: authUser.id
    });
    return successResponse(c, { conversation });
  } catch (error) {
    return handleInboxError(c, error);
  }
});

inboxRoutes.post("/:conversationId/reply", requireBusinessPermission("take_handoff"), async (c) => {
  const membership = c.get("businessMembership");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await sendHumanReply({
      businessId: membership.businessId,
      conversationId: c.req.param("conversationId") ?? "",
      teamMemberId: membership.teamMemberId,
      body: typeof body.body === "string" ? body.body : ""
    });
    return successResponse(c, result);
  } catch (error) {
    return handleInboxError(c, error);
  }
});
