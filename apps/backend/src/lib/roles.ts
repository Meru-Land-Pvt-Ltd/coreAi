import type { UserRole } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Role membership (capability) helpers. A user can hold several roles at once
 * (e.g. ARCHITECT + BUSINESS); `User.role` remains only as the legacy/primary
 * role. Authorization must go through these helpers, never `user.role === X`.
 */

export function mergeRoles(
  legacyRole: UserRole | string,
  memberships: Array<{ role: UserRole | string }>
): UserRole[] {
  const roles = new Set<string>([String(legacyRole)]);
  for (const membership of memberships) roles.add(String(membership.role));
  return [...roles] as UserRole[];
}

export async function getUserRoles(userId: string): Promise<UserRole[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, roleMemberships: { select: { role: true } } }
  });

  if (!user) return [];
  return mergeRoles(user.role, user.roleMemberships);
}

export async function hasRole(userId: string, role: UserRole): Promise<boolean> {
  const roles = await getUserRoles(userId);
  return roles.includes(role);
}

/** Idempotently grant a role membership. Safe under concurrent requests. */
export async function grantRole(userId: string, role: UserRole): Promise<void> {
  const existing = await prisma.userRoleMembership.findFirst({
    where: { userId, role },
    select: { id: true }
  });
  if (existing) return;

  try {
    await prisma.userRoleMembership.create({ data: { userId, role } });
  } catch (error) {
    // unique(userId, role) — a concurrent request already granted it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

/**
 * Pure capability check used where a user row (with memberships) is already
 * loaded — e.g. the Twilio number-assignment script.
 */
export function userHasBusinessCapability(owner: {
  role: UserRole | string;
  roleMemberships?: Array<{ role: UserRole | string }> | null;
}): boolean {
  return mergeRoles(owner.role, owner.roleMemberships ?? []).includes("BUSINESS" as UserRole);
}
