import type { Context, Next } from "hono";
import { errorResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import { resolvePrimaryBusinessId } from "../primary-business";
import {
  roleHasPermission,
  type BusinessPermission,
  type BusinessRole
} from "./permissions";

/**
 * Workspace membership resolution + per-request authorization.
 *
 * Backward compatibility: the Business.ownerId user is ALWAYS an implicit
 * OWNER, even with zero BusinessTeamMember rows — existing single-login
 * businesses keep working untouched. Members are checked from the database on
 * EVERY request (never cached in the token), so deactivation and role changes
 * revoke access immediately, matching the auth middleware's suspension model.
 */

export interface BusinessMembership {
  businessId: string;
  role: BusinessRole;
  /** BusinessTeamMember.id — null for the implicit owner without a member row. */
  teamMemberId: string | null;
  isImplicitOwner: boolean;
  permissionsJson: unknown;
}

declare module "hono" {
  interface ContextVariableMap {
    businessMembership: BusinessMembership;
  }
}

/**
 * Resolve the caller's membership for a business. Order:
 * 1) Business owner → OWNER (optionally backed by a member row).
 * 2) Active, user-linked BusinessTeamMember → its role.
 * Inactive members resolve to null — access ends the moment active=false.
 */
export async function resolveBusinessMembership(
  userId: string,
  businessId: string
): Promise<BusinessMembership | null> {
  const [business, member] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true } }),
    prisma.businessTeamMember.findFirst({
      where: { businessId, userId },
      select: { id: true, role: true, active: true, permissionsJson: true }
    })
  ]);

  if (!business) return null;

  if (business.ownerId === userId) {
    return {
      businessId,
      role: "OWNER",
      teamMemberId: member?.id ?? null,
      isImplicitOwner: !member,
      permissionsJson: null
    };
  }

  if (!member || !member.active) return null;

  return {
    businessId,
    role: (member.role as BusinessRole) ?? "VIEWER",
    teamMemberId: member.id,
    isImplicitOwner: false,
    permissionsJson: member.permissionsJson
  };
}

/**
 * The business a signed-in user works in: their own primary business first
 * (existing behavior), else the newest business where they are an active team
 * member. This is what lets a receptionist log in without owning a Business.
 */
export async function resolveWorkspaceBusinessId(userId: string): Promise<string | null> {
  const owned = await resolvePrimaryBusinessId(userId);
  if (owned) return owned;

  const membership = await prisma.businessTeamMember.findFirst({
    where: { userId, active: true },
    orderBy: { createdAt: "desc" },
    select: { businessId: true }
  });
  return membership?.businessId ?? null;
}

export function membershipHasPermission(
  membership: BusinessMembership,
  permission: BusinessPermission
): boolean {
  return roleHasPermission(membership.role, permission, membership.permissionsJson);
}

/**
 * Route middleware: resolve membership for the caller's workspace business and
 * require a permission. Sets c.get("businessMembership") for handlers.
 * Server-side on every request — hidden buttons are not a security boundary.
 */
export function requireBusinessPermission(permission: BusinessPermission) {
  return async (c: Context, next: Next) => {
    const authUser = c.get("authUser");
    if (!authUser) {
      return errorResponse(c, "Authentication required", 401, "UNAUTHENTICATED");
    }

    const businessId = await resolveWorkspaceBusinessId(authUser.id);
    if (!businessId) {
      return errorResponse(c, "No business workspace for this account", 404, "BUSINESS_NOT_FOUND");
    }

    const membership = await resolveBusinessMembership(authUser.id, businessId);
    if (!membership) {
      return errorResponse(c, "You are not a member of this business", 403, "NOT_A_MEMBER");
    }

    if (!membershipHasPermission(membership, permission)) {
      return errorResponse(c, "You don't have permission for this action", 403, "PERMISSION_DENIED");
    }

    c.set("businessMembership", membership);

    // Presence bookkeeping, best-effort: keeps "last active" honest for the
    // team screen without ever blocking the request.
    if (membership.teamMemberId) {
      prisma.businessTeamMember
        .update({ where: { id: membership.teamMemberId }, data: { lastActiveAt: new Date() } })
        .catch(() => null);
    }

    await next();
  };
}
