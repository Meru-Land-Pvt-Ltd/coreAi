import { createHash, randomBytes } from "crypto";
import { env } from "../../../config/env";
import { isPlatformMailConfigured, sendPlatformEmail } from "../../../lib/mailer";
import { prisma } from "../../../lib/prisma";
import { normalizePhoneE164 } from "../../architect/twilio-connector";
import { logBusinessActivity } from "../activity-log";
import { isBusinessRole, type BusinessRole } from "./permissions";

/**
 * Team lifecycle (plan Part 6): members, invites, role changes, deactivation,
 * ownership transfer. Every mutation is audited. Invites carry a random token
 * whose sha256 is stored — the raw token only ever exists in the email.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class TeamServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400
  ) {
    super(message);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listTeamMembers(businessId: string) {
  return prisma.businessTeamMember.findMany({
    where: { businessId },
    orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      userId: true,
      displayName: true,
      email: true,
      phone: true,
      role: true,
      department: true,
      active: true,
      handoffEligible: true,
      presence: true,
      priority: true,
      lastActiveAt: true,
      createdAt: true
    }
  });
}

export async function createTeamMember(input: {
  businessId: string;
  actorUserId: string;
  displayName: string;
  role: string;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  handoffEligible?: boolean;
  priority?: number;
}) {
  const displayName = input.displayName.trim();
  if (!displayName) throw new TeamServiceError("INVALID_NAME", "Display name is required");
  if (!isBusinessRole(input.role)) throw new TeamServiceError("INVALID_ROLE", "Unknown role");
  if (input.role === "OWNER") {
    throw new TeamServiceError("OWNER_VIA_TRANSFER_ONLY", "Ownership is granted via transfer, not by adding a member");
  }

  const phone = input.phone ? normalizePhoneE164(input.phone) : null;
  if (input.phone && !phone) {
    throw new TeamServiceError("INVALID_PHONE", "Phone must be a full number with country code");
  }

  const member = await prisma.businessTeamMember.create({
    data: {
      businessId: input.businessId,
      displayName,
      role: input.role,
      email: input.email ? normalizeEmail(input.email) : null,
      phone,
      department: input.department?.trim() || null,
      handoffEligible: input.handoffEligible ?? Boolean(phone),
      priority: Number.isFinite(input.priority) ? Number(input.priority) : 100
    }
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "TEAM_MEMBER_ADDED",
    actorUserId: input.actorUserId,
    targetType: "BusinessTeamMember",
    targetId: member.id,
    detail: { displayName, role: input.role }
  });

  return member;
}

export async function updateTeamMember(input: {
  businessId: string;
  actorUserId: string;
  memberId: string;
  patch: {
    displayName?: string;
    role?: string;
    email?: string | null;
    phone?: string | null;
    department?: string | null;
    active?: boolean;
    handoffEligible?: boolean;
    presence?: string;
    priority?: number;
  };
}) {
  const existing = await prisma.businessTeamMember.findFirst({
    where: { id: input.memberId, businessId: input.businessId }
  });
  if (!existing) throw new TeamServiceError("MEMBER_NOT_FOUND", "Team member not found", 404);

  const { patch } = input;
  if (patch.role !== undefined) {
    if (!isBusinessRole(patch.role)) throw new TeamServiceError("INVALID_ROLE", "Unknown role");
    if (patch.role === "OWNER" || existing.role === "OWNER") {
      throw new TeamServiceError("OWNER_VIA_TRANSFER_ONLY", "Ownership changes go through ownership transfer");
    }
  }
  let phone = existing.phone;
  if (patch.phone !== undefined) {
    phone = patch.phone ? normalizePhoneE164(patch.phone) : null;
    if (patch.phone && !phone) {
      throw new TeamServiceError("INVALID_PHONE", "Phone must be a full number with country code");
    }
  }
  if (patch.presence !== undefined && !["AVAILABLE", "BUSY", "OFFLINE"].includes(patch.presence)) {
    throw new TeamServiceError("INVALID_PRESENCE", "Presence must be AVAILABLE, BUSY, or OFFLINE");
  }

  const updated = await prisma.businessTeamMember.update({
    where: { id: existing.id },
    data: {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() || existing.displayName } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.email !== undefined ? { email: patch.email ? normalizeEmail(patch.email) : null } : {}),
      ...(patch.phone !== undefined ? { phone } : {}),
      ...(patch.department !== undefined ? { department: patch.department?.trim() || null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.handoffEligible !== undefined ? { handoffEligible: patch.handoffEligible } : {}),
      ...(patch.presence !== undefined ? { presence: patch.presence } : {}),
      ...(patch.priority !== undefined && Number.isFinite(patch.priority) ? { priority: Number(patch.priority) } : {})
    }
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: patch.active === false ? "TEAM_MEMBER_DEACTIVATED" : "TEAM_MEMBER_UPDATED",
    actorUserId: input.actorUserId,
    targetType: "BusinessTeamMember",
    targetId: existing.id,
    detail: { changed: Object.keys(patch) }
  });

  return updated;
}

export async function createInvite(input: {
  businessId: string;
  actorUserId: string;
  email: string;
  role: string;
  businessName: string;
}) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TeamServiceError("INVALID_EMAIL", "A valid email is required");
  }
  if (!isBusinessRole(input.role) || input.role === "OWNER") {
    throw new TeamServiceError("INVALID_ROLE", "Invite role must be a non-owner business role");
  }

  const existingMember = await prisma.businessTeamMember.findFirst({
    where: { businessId: input.businessId, email, active: true },
    select: { id: true }
  });
  if (existingMember) {
    throw new TeamServiceError("ALREADY_MEMBER", "That email already belongs to an active team member");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // Re-inviting the same email replaces the previous invite (resend).
  const invite = await prisma.businessMemberInvite.upsert({
    where: { businessId_email: { businessId: input.businessId, email } },
    update: { role: input.role, tokenHash, status: "PENDING", expiresAt, acceptedAt: null, invitedByUserId: input.actorUserId },
    create: {
      businessId: input.businessId,
      email,
      role: input.role,
      invitedByUserId: input.actorUserId,
      tokenHash,
      expiresAt
    }
  });

  const acceptUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/team/accept?token=${token}`;

  if (isPlatformMailConfigured()) {
    try {
      await sendPlatformEmail({
        purpose: "notification",
        to: email,
        subject: `You're invited to join ${input.businessName} on Triven`,
        text: `You've been invited to join ${input.businessName} on Triven as ${input.role}. Accept the invite: ${acceptUrl}\n\nThis link expires in 7 days. If you weren't expecting this, ignore this email.`,
        html: `<p>You've been invited to join <b>${input.businessName}</b> on Triven as <b>${input.role}</b>.</p><p><a href="${acceptUrl}">Accept the invite</a></p><p>This link expires in 7 days. If you weren't expecting this, ignore this email.</p>`
      });
    } catch (error) {
      console.error("[team] invite email failed (invite still created)", {
        inviteId: invite.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await logBusinessActivity({
    businessId: input.businessId,
    action: "TEAM_INVITE_SENT",
    actorUserId: input.actorUserId,
    targetType: "BusinessMemberInvite",
    targetId: invite.id,
    detail: { email, role: input.role }
  });

  return { inviteId: invite.id, expiresAt };
}

export async function revokeInvite(input: { businessId: string; actorUserId: string; inviteId: string }) {
  const invite = await prisma.businessMemberInvite.findFirst({
    where: { id: input.inviteId, businessId: input.businessId, status: "PENDING" }
  });
  if (!invite) throw new TeamServiceError("INVITE_NOT_FOUND", "Pending invite not found", 404);

  await prisma.businessMemberInvite.update({
    where: { id: invite.id },
    data: { status: "REVOKED" }
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "TEAM_INVITE_REVOKED",
    actorUserId: input.actorUserId,
    targetType: "BusinessMemberInvite",
    targetId: invite.id,
    detail: { email: invite.email }
  });
}

/**
 * Accept: the signed-in user redeems the raw token. Verifies hash + expiry +
 * email match against the account email, links/activates the member row, and
 * grants the BUSINESS platform role so business routes admit the account.
 */
export async function acceptInvite(input: { userId: string; userEmail: string; token: string }) {
  const tokenHash = hashToken(input.token.trim());
  const invite = await prisma.businessMemberInvite.findUnique({ where: { tokenHash } });

  if (!invite || invite.status !== "PENDING") {
    throw new TeamServiceError("INVITE_INVALID", "This invite is no longer valid", 410);
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.businessMemberInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    throw new TeamServiceError("INVITE_EXPIRED", "This invite has expired", 410);
  }
  if (normalizeEmail(input.userEmail) !== invite.email) {
    throw new TeamServiceError(
      "EMAIL_MISMATCH",
      "This invite was sent to a different email address. Sign in with the invited email.",
      403
    );
  }

  const member = await prisma.$transaction(async (tx) => {
    const existing = await tx.businessTeamMember.findFirst({
      where: { businessId: invite.businessId, email: invite.email }
    });

    const row = existing
      ? await tx.businessTeamMember.update({
          where: { id: existing.id },
          data: { userId: input.userId, active: true, role: invite.role }
        })
      : await tx.businessTeamMember.create({
          data: {
            businessId: invite.businessId,
            userId: input.userId,
            displayName: invite.email.split("@")[0],
            email: invite.email,
            role: invite.role,
            handoffEligible: false
          }
        });

    await tx.businessMemberInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() }
    });

    await tx.userRoleMembership.upsert({
      where: { userId_role: { userId: input.userId, role: "BUSINESS" } },
      update: {},
      create: { userId: input.userId, role: "BUSINESS" }
    });

    return row;
  });

  await logBusinessActivity({
    businessId: invite.businessId,
    action: "TEAM_INVITE_ACCEPTED",
    actorUserId: input.userId,
    targetType: "BusinessTeamMember",
    targetId: member.id,
    detail: { email: invite.email, role: invite.role }
  });

  return { businessId: invite.businessId, memberId: member.id, role: member.role as BusinessRole };
}

/**
 * Ownership transfer: current owner hands Business.ownerId to another
 * user-linked ACTIVE member. The old owner stays on as ADMIN so the business
 * is never left without experienced hands, and the whole change is audited.
 */
export async function transferOwnership(input: {
  businessId: string;
  currentOwnerUserId: string;
  toMemberId: string;
}) {
  const [business, target] = await Promise.all([
    prisma.business.findUnique({ where: { id: input.businessId }, select: { ownerId: true } }),
    prisma.businessTeamMember.findFirst({
      where: { id: input.toMemberId, businessId: input.businessId, active: true },
      select: { id: true, userId: true, displayName: true }
    })
  ]);

  if (!business || business.ownerId !== input.currentOwnerUserId) {
    throw new TeamServiceError("NOT_OWNER", "Only the current owner can transfer ownership", 403);
  }
  if (!target?.userId) {
    throw new TeamServiceError(
      "TARGET_NOT_LINKED",
      "The new owner must be an active team member with a linked login (accepted invite)",
      422
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: input.businessId }, data: { ownerId: target.userId! } });
    await tx.businessTeamMember.update({ where: { id: target.id }, data: { role: "OWNER" } });
    // Old owner becomes an ADMIN member (created if they had no member row).
    const oldOwnerMember = await tx.businessTeamMember.findFirst({
      where: { businessId: input.businessId, userId: input.currentOwnerUserId }
    });
    if (oldOwnerMember) {
      await tx.businessTeamMember.update({ where: { id: oldOwnerMember.id }, data: { role: "ADMIN" } });
    } else {
      const oldOwner = await tx.user.findUnique({
        where: { id: input.currentOwnerUserId },
        select: { email: true, fullName: true }
      });
      await tx.businessTeamMember.create({
        data: {
          businessId: input.businessId,
          userId: input.currentOwnerUserId,
          displayName: oldOwner?.fullName || oldOwner?.email || "Previous owner",
          email: oldOwner?.email ?? null,
          role: "ADMIN",
          handoffEligible: false
        }
      });
    }
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "OWNERSHIP_TRANSFERRED",
    actorUserId: input.currentOwnerUserId,
    targetType: "BusinessTeamMember",
    targetId: target.id,
    detail: { newOwnerMember: target.displayName }
  });
}
