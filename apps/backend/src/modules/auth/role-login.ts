import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { grantRole } from "../../lib/roles";
import type { JwtUserRole } from "../../lib/jwt";

const loginUserInclude = {
  architectProfile: true,
  roleMemberships: { select: { role: true } }
} satisfies Prisma.UserInclude;

export type LoginUser = Prisma.UserGetPayload<{ include: typeof loginUserInclude }>;

/**
 * Resolve the account for a login attempt on a role's workspace WITHOUT ever
 * duplicating an email across User rows.
 *
 * Selection order:
 *  1. a row whose legacy `role` matches (existing dual-row accounts keep
 *     logging into the exact rows they always used);
 *  2. a row holding a membership for the requested role;
 *  3. any existing row for the email — the requested role is granted to it as
 *     a membership (an ARCHITECT intentionally signing in to the Business
 *     workspace becomes ARCHITECT + BUSINESS on the same account);
 *  4. no row at all — a new user is created when `allowCreate` is set.
 */
export async function resolveLoginUser(opts: {
  email: string;
  role: JwtUserRole;
  fallbackFullName: string;
  allowCreate: boolean;
}): Promise<{ user: LoginUser | null; isNewUser: boolean }> {
  const candidates = await prisma.user.findMany({
    where: { email: opts.email },
    include: loginUserInclude,
    orderBy: { createdAt: "asc" }
  });

  let user =
    candidates.find((candidate) => candidate.role === opts.role) ??
    candidates.find((candidate) =>
      candidate.roleMemberships.some((membership) => membership.role === opts.role)
    ) ??
    candidates[0] ??
    null;

  if (!user) {
    if (!opts.allowCreate) return { user: null, isNewUser: false };

    user = await prisma.user.create({
      data: {
        email: opts.email,
        role: opts.role,
        passwordHash: null,
        fullName: opts.fallbackFullName,
        roleMemberships: { create: { role: opts.role } },
        architectProfile: opts.role === "ARCHITECT" ? { create: {} } : undefined
      },
      include: loginUserInclude
    });

    return { user, isNewUser: true };
  }

  // Suspended accounts get no new capabilities; the caller rejects the login.
  if (user.isSuspended) return { user, isNewUser: false };

  // Never block on a missing membership row — grant it (idempotent) so the
  // account gains the requested capability instead of a duplicate User row.
  await grantRole(user.id, opts.role);

  const needsArchitectProfile = opts.role === "ARCHITECT" && !user.architectProfile;
  const needsFullName = !user.fullName;

  if (needsArchitectProfile || needsFullName) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(needsFullName ? { fullName: opts.fallbackFullName } : {}),
        ...(needsArchitectProfile ? { architectProfile: { create: {} } } : {})
      },
      include: loginUserInclude
    });
  } else {
    // Refresh memberships so the just-granted role is present on the result.
    const refreshed = await prisma.user.findUnique({
      where: { id: user.id },
      include: loginUserInclude
    });
    if (refreshed) user = refreshed;
  }

  return { user, isNewUser: false };
}
