import { Hono } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import { requireBusinessPermission } from "./membership";
import {
  createInvite,
  createTeamMember,
  listTeamMembers,
  revokeInvite,
  TeamServiceError,
  transferOwnership,
  updateTeamMember
} from "./team-service";

/**
 * Buyer team management routes (plan Part 6). Mounted under /business/team.
 * Every route authorizes server-side through requireBusinessPermission —
 * membership and permission are checked per request, so deactivation and role
 * downgrades take effect immediately.
 */
export const teamRoutes = new Hono();

function handleServiceError(c: Parameters<typeof errorResponse>[0], error: unknown) {
  if (error instanceof TeamServiceError) {
    return errorResponse(c, error.message, error.httpStatus as 400, error.code);
  }
  console.error("[team-routes] unexpected error", error);
  return errorResponse(c, "Something went wrong", 500, "TEAM_ERROR");
}

teamRoutes.get("/", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const [members, invites] = await Promise.all([
    listTeamMembers(membership.businessId),
    prisma.businessMemberInvite.findMany({
      where: { businessId: membership.businessId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }
    })
  ]);
  return successResponse(c, { members, invites, viewerRole: membership.role });
});

teamRoutes.post("/members", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const member = await createTeamMember({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      role: typeof body.role === "string" ? body.role : "RECEPTIONIST",
      email: typeof body.email === "string" ? body.email : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      department: typeof body.department === "string" ? body.department : null,
      handoffEligible: typeof body.handoffEligible === "boolean" ? body.handoffEligible : undefined,
      priority: typeof body.priority === "number" ? body.priority : undefined
    });
    return successResponse(c, { member });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

teamRoutes.patch("/members/:memberId", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const member = await updateTeamMember({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      memberId: c.req.param("memberId") ?? "",
      patch: {
        ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
        ...(typeof body.role === "string" ? { role: body.role } : {}),
        ...(body.email === null || typeof body.email === "string" ? { email: body.email as string | null } : {}),
        ...(body.phone === null || typeof body.phone === "string" ? { phone: body.phone as string | null } : {}),
        ...(body.department === null || typeof body.department === "string"
          ? { department: body.department as string | null }
          : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
        ...(typeof body.handoffEligible === "boolean" ? { handoffEligible: body.handoffEligible } : {}),
        ...(typeof body.presence === "string" ? { presence: body.presence } : {}),
        ...(typeof body.priority === "number" ? { priority: body.priority } : {})
      }
    });
    return successResponse(c, { member });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

/** Self-service presence: any handoff-capable member can set their own state. */
teamRoutes.patch("/presence", requireBusinessPermission("take_handoff"), async (c) => {
  const membership = c.get("businessMembership");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const presence = typeof body.presence === "string" ? body.presence : "";
  if (!["AVAILABLE", "BUSY", "OFFLINE"].includes(presence)) {
    return errorResponse(c, "Presence must be AVAILABLE, BUSY, or OFFLINE", 422, "INVALID_PRESENCE");
  }
  if (!membership.teamMemberId) {
    return errorResponse(c, "The business owner has no member profile to set presence on", 422, "NO_MEMBER_PROFILE");
  }
  await prisma.businessTeamMember.update({
    where: { id: membership.teamMemberId },
    data: { presence }
  });
  return successResponse(c, { presence });
});

teamRoutes.post("/invites", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const business = await prisma.business.findUnique({
      where: { id: membership.businessId },
      select: { name: true }
    });
    const result = await createInvite({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      email: typeof body.email === "string" ? body.email : "",
      role: typeof body.role === "string" ? body.role : "RECEPTIONIST",
      businessName: business?.name ?? "a business"
    });
    return successResponse(c, result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

teamRoutes.post("/invites/:inviteId/revoke", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  try {
    await revokeInvite({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      inviteId: c.req.param("inviteId") ?? ""
    });
    return successResponse(c, { revoked: true });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

teamRoutes.post("/ownership-transfer", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  if (membership.role !== "OWNER") {
    return errorResponse(c, "Only the owner can transfer ownership", 403, "NOT_OWNER");
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await transferOwnership({
      businessId: membership.businessId,
      currentOwnerUserId: authUser.id,
      toMemberId: typeof body.toMemberId === "string" ? body.toMemberId : ""
    });
    return successResponse(c, { transferred: true });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

teamRoutes.get("/activity", requireBusinessPermission("manage_team"), async (c) => {
  const membership = c.get("businessMembership");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  const entries = await prisma.businessActivityLog.findMany({
    where: { businessId: membership.businessId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      actorUserId: true,
      actorLabel: true,
      targetType: true,
      targetId: true,
      detailJson: true,
      createdAt: true
    }
  });
  return successResponse(c, { entries });
});
