import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  issueEmailVerificationCode,
  isOtpError,
  verifyEmailVerificationCode
} from "../../lib/email-otp";
import { prisma } from "../../lib/prisma";
import { createAuthToken, verifyAuthToken, type JwtUserRole } from "../../lib/jwt";
import {
  serializeActiveSession,
  serializeLoginHistory
} from "../../lib/user-session";
import {
  getArchitectLiveRefundObligations,
  hasPaidRefundSettlement
} from "./danger-obligations";
import { computeArchitectPayoutSummary } from "./settings-payout-summary";

export const architectSettingsRoutes = new Hono();

const DEFAULT_NOTIFICATION_PREFS = {
  newSale: { email: true, push: true },
  newReview: { email: true, push: true },
  buyerMessages: { email: true, push: true },
  agentSubmissionUpdates: { email: true, push: true },
  payoutProcessed: { email: true, push: false },
  performanceAlerts: { email: true, push: true },
  marketplaceInsights: { email: false, push: false },
  platformUpdates: { email: true, push: false },
  securityAlerts: { email: true, push: true, locked: true }
};

const DEFAULT_PRIVACY_PREFS = {
  showProfileOnMarketplace: true,
  showSalesCount: true,
  showRating: true,
  allowBuyerMessages: true,
  analyticsCookies: true,
  marketingCookies: false
};

const profileSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional().or(z.literal("")),
  location: z.string().trim().optional().or(z.literal("")),
  timezone: z.string().trim().optional().or(z.literal(""))
});

const profilePhotoSchema = z.object({
  photoDataUrl: z.string().trim().min(1, "Profile photo is required")
});

const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function parseProfilePhotoDataUrl(photoDataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png));base64,([a-zA-Z0-9+/=\s]+)$/.exec(photoDataUrl.trim());
  if (!match) {
    throw new Error("Upload a JPG or PNG image");
  }

  const mimeType = match[1]!;
  const base64 = match[2]!.replace(/\s/g, "");
  const bytes = Buffer.byteLength(base64, "base64");

  if (bytes <= 0 || bytes > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error("Profile photo must be 2MB or smaller");
  }

  return photoDataUrl.trim();
}

const storefrontSchema = z.object({
  displayName: z.string().trim().min(2).optional().or(z.literal("")),
  tagline: z.string().trim().max(80).optional().or(z.literal("")),
  bio: z.string().trim().max(500).optional().or(z.literal("")),
  portfolioUrl: z.string().trim().url().optional().or(z.literal("")),
  githubUrl: z.string().trim().url().optional().or(z.literal("")),
  linkedinUrl: z.string().trim().url().optional().or(z.literal("")),
  twitterHandle: z.string().trim().max(80).optional().or(z.literal("")),
  experienceBand: z.string().trim().optional().or(z.literal("")),
  skills: z.array(z.string().trim().min(1)).max(5).default([])
});

const notificationPrefsSchema = z.record(
  z.string(),
  z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    locked: z.boolean().optional()
  })
);

const privacyPrefsSchema = z.record(z.string(), z.boolean());

const dangerPaySchema = z.object({
  action: z.enum(["PAUSE_ALL_AGENTS", "DELETE_ACCOUNT"])
});

const dangerDeleteSchema = z.object({
  confirmation: z.literal("DELETE")
});

const emailChangeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required")
});

const emailChangeVerifySchema = emailChangeRequestSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code")
});

/** Binds an in-flight email-change OTP to the authenticated architect. */
const emailChangeBindings = new Map<string, string>();

function emailChangeBindingKey(userId: string, email: string) {
  return `${userId}:${email}`;
}

async function getCurrentSid(c: { req: { header: (name: string) => string | undefined } }) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return undefined;

  try {
    const payload = await verifyAuthToken(authHeader.replace("Bearer ", ""));
    return payload.sid;
  } catch {
    return undefined;
  }
}

function mergePrefs<T extends Record<string, unknown>>(defaults: T, stored: unknown) {
  if (!stored || typeof stored !== "object") return defaults;
  return { ...defaults, ...(stored as Record<string, unknown>) } as T;
}

async function loadSettingsPayload(userId: string, currentSid?: string) {
  const [user, profile, loginHistory, sessions, payoutSummary] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        location: true,
        timezone: true,
        profilePhotoUrl: true,
        createdAt: true
      }
    }),
    prisma.architectProfile.findUnique({ where: { userId } }),
    prisma.userLoginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.userActiveSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { lastActiveAt: "desc" }
    }),
    computeArchitectPayoutSummary(userId)
  ]);

  if (!user) {
    throw new Error("User not found");
  }

  const obligations = await getArchitectLiveRefundObligations(userId);
  const listings = await prisma.agentListing.findMany({
    where: { architectUserId: userId },
    select: { status: true }
  });
  const hasPausableAgents = listings.some(
    (listing) => listing.status === "APPROVED" || listing.status === "PENDING_REVIEW"
  );
  const allAgentsPaused =
    listings.length > 0 && listings.every((listing) => listing.status === "PAUSED");

  return {
    profile: {
      fullName: user.fullName ?? "",
      email: user.email,
      phone: user.phone ?? "",
      location: user.location ?? "",
      timezone: user.timezone ?? "America/Los_Angeles",
      profilePhotoUrl: user.profilePhotoUrl ?? null
    },
    storefront: {
      displayName: profile?.displayName ?? user.fullName ?? "",
      tagline: profile?.tagline ?? profile?.title ?? "",
      bio: profile?.bio ?? "",
      portfolioUrl: profile?.portfolioUrl ?? "",
      githubUrl: profile?.githubUrl ?? "",
      linkedinUrl: profile?.linkedinUrl ?? "",
      twitterHandle: profile?.twitterHandle ?? "",
      experienceBand: profile?.experienceBand ?? "5-10",
      skills: profile?.skills ?? [],
      approvalStatus: profile?.approvalStatus ?? "PENDING",
      rating: profile?.rating ?? 0,
      completedJobs: profile?.completedJobs ?? 0,
      agentsPaused: profile?.agentsPaused ?? false
    },
    notifications: mergePrefs(DEFAULT_NOTIFICATION_PREFS, profile?.notificationPrefs),
    privacy: mergePrefs(DEFAULT_PRIVACY_PREFS, profile?.privacyPrefs),
    security: {
      sessions: sessions.map((session) => serializeActiveSession(session, currentSid)),
      loginHistory: loginHistory.map(serializeLoginHistory)
    },
    payouts: payoutSummary,
    danger: {
      obligations,
      agentsPaused: profile?.agentsPaused ?? false,
      allAgentsPaused,
      hasPausableAgents
    }
  };
}

architectSettingsRoutes.get("/", async (c) => {
  try {
    const authUser = c.get("authUser");
    const currentSid = await getCurrentSid(c);
    const settings = await loadSettingsPayload(authUser.id, currentSid);

    return successResponse(c, {
      ...settings,
      profile: {
        ...settings.profile,
        fullName: settings.profile.fullName || authUser.fullName || "",
        email: settings.profile.email || authUser.email
      },
      storefront: {
        ...settings.storefront,
        displayName:
          settings.storefront.displayName ||
          settings.profile.fullName ||
          authUser.fullName ||
          authUser.email.split("@")[0] ||
          ""
      }
    }, "Settings loaded");
  } catch {
    return errorResponse(c, "Could not load settings", 500, "SETTINGS_LOAD_FAILED");
  }
});

architectSettingsRoutes.put("/profile", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = profileSchema.parse(await c.req.json());

    const user = await prisma.user.update({
      where: { id: authUser.id },
      data: {
        fullName: input.fullName ?? undefined,
        phone: input.phone || null,
        location: input.location || null,
        timezone: input.timezone || null
      },
      select: {
        fullName: true,
        email: true,
        phone: true,
        location: true,
        timezone: true,
        profilePhotoUrl: true
      }
    });

    return successResponse(c, { profile: user }, "Profile saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid profile", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save profile", 500, "PROFILE_SAVE_FAILED");
  }
});

architectSettingsRoutes.put("/profile/photo", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = profilePhotoSchema.parse(await c.req.json());
    const photoDataUrl = parseProfilePhotoDataUrl(input.photoDataUrl);

    const user = await prisma.user.update({
      where: { id: authUser.id },
      data: { profilePhotoUrl: photoDataUrl },
      select: {
        fullName: true,
        email: true,
        phone: true,
        location: true,
        timezone: true,
        profilePhotoUrl: true
      }
    });

    return successResponse(c, { profile: user }, "Profile photo saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid profile photo", 422, "VALIDATION_ERROR");
    }

    if (error instanceof Error && error.message) {
      return errorResponse(c, error.message, 422, "INVALID_PROFILE_PHOTO");
    }

    return errorResponse(c, "Could not save profile photo", 500, "PROFILE_PHOTO_SAVE_FAILED");
  }
});

architectSettingsRoutes.post("/profile/email/request", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = emailChangeRequestSchema.parse(await c.req.json());
    const currentEmail = authUser.email.toLowerCase();

    if (input.email === currentEmail) {
      return errorResponse(c, "Enter a different email address", 422, "EMAIL_UNCHANGED");
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: "ARCHITECT",
        id: { not: authUser.id }
      },
      select: { id: true }
    });

    if (existingUser) {
      return errorResponse(c, "This email is already used by another architect account", 409, "EMAIL_ALREADY_IN_USE");
    }

    await issueEmailVerificationCode(input.email, "ARCHITECT", "email_update");
    emailChangeBindings.set(emailChangeBindingKey(authUser.id, input.email), input.email);

    return successResponse(c, { email: input.email, sent: true }, "Verification code sent");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid email", 422, "VALIDATION_ERROR");
    }

    if (isOtpError(error) && error.code === "OTP_COOLDOWN") {
      return errorResponse(c, error.message, 422, "OTP_COOLDOWN");
    }

    console.error("Architect email change request failed", error);
    return errorResponse(c, "Failed to send verification code", 500, "SEND_EMAIL_CHANGE_CODE_FAILED");
  }
});

architectSettingsRoutes.post("/profile/email/verify", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = emailChangeVerifySchema.parse(await c.req.json());
    const bindingKey = emailChangeBindingKey(authUser.id, input.email);
    const boundEmail = emailChangeBindings.get(bindingKey);

    if (!boundEmail || boundEmail !== input.email) {
      return errorResponse(
        c,
        "Please request a new verification code for this email",
        400,
        "EMAIL_CHANGE_REQUEST_REQUIRED"
      );
    }

    const verification = await verifyEmailVerificationCode(input.email, "ARCHITECT", input.code);
    if (!verification.ok) {
      return errorResponse(c, verification.message, verification.status, verification.code);
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: "ARCHITECT",
        id: { not: authUser.id }
      },
      select: { id: true }
    });

    if (existingUser) {
      emailChangeBindings.delete(bindingKey);
      return errorResponse(c, "This email is already used by another architect account", 409, "EMAIL_ALREADY_IN_USE");
    }

    const updatedUser = await prisma.user.update({
      where: { id: authUser.id },
      data: { email: input.email },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        profilePhotoUrl: true
      }
    });

    for (const [key] of emailChangeBindings.entries()) {
      if (key.startsWith(`${authUser.id}:`)) {
        emailChangeBindings.delete(key);
      }
    }

    const currentSid = await getCurrentSid(c);
    const token = await createAuthToken(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role as JwtUserRole
      },
      currentSid
    );

    return successResponse(
      c,
      {
        email: updatedUser.email,
        token,
        user: {
          id: updatedUser.id,
          fullName: updatedUser.fullName,
          email: updatedUser.email,
          role: updatedUser.role
        }
      },
      "Email address changed"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid verification code", 422, "VALIDATION_ERROR");
    }

    console.error("Architect email change verify failed", error);
    return errorResponse(c, "Could not change email address", 500, "EMAIL_CHANGE_FAILED");
  }
});

architectSettingsRoutes.put("/storefront", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = storefrontSchema.parse(await c.req.json());

    const profile = await prisma.architectProfile.upsert({
      where: { userId: authUser.id },
      update: {
        displayName: input.displayName || null,
        tagline: input.tagline || null,
        title: input.tagline || null,
        bio: input.bio || null,
        portfolioUrl: input.portfolioUrl || null,
        githubUrl: input.githubUrl || null,
        linkedinUrl: input.linkedinUrl || null,
        twitterHandle: input.twitterHandle || null,
        experienceBand: input.experienceBand || null,
        skills: input.skills
      },
      create: {
        userId: authUser.id,
        displayName: input.displayName || null,
        tagline: input.tagline || null,
        title: input.tagline || null,
        bio: input.bio || null,
        portfolioUrl: input.portfolioUrl || null,
        githubUrl: input.githubUrl || null,
        linkedinUrl: input.linkedinUrl || null,
        twitterHandle: input.twitterHandle || null,
        experienceBand: input.experienceBand || null,
        skills: input.skills
      }
    });

    return successResponse(c, { storefront: profile }, "Storefront saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid storefront", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save storefront", 500, "STOREFRONT_SAVE_FAILED");
  }
});

architectSettingsRoutes.put("/notifications", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = notificationPrefsSchema.parse(await c.req.json());
    const merged = mergePrefs(DEFAULT_NOTIFICATION_PREFS, input);

    const profile = await prisma.architectProfile.upsert({
      where: { userId: authUser.id },
      update: { notificationPrefs: merged },
      create: { userId: authUser.id, notificationPrefs: merged }
    });

    return successResponse(c, { notifications: profile.notificationPrefs }, "Notification preferences saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid notifications", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save notifications", 500, "NOTIFICATIONS_SAVE_FAILED");
  }
});

architectSettingsRoutes.put("/privacy", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = privacyPrefsSchema.parse(await c.req.json());
    const merged = mergePrefs(DEFAULT_PRIVACY_PREFS, input);

    const profile = await prisma.architectProfile.upsert({
      where: { userId: authUser.id },
      update: { privacyPrefs: merged },
      create: { userId: authUser.id, privacyPrefs: merged }
    });

    return successResponse(c, { privacy: profile.privacyPrefs }, "Privacy settings saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid privacy settings", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save privacy settings", 500, "PRIVACY_SAVE_FAILED");
  }
});

architectSettingsRoutes.get("/login-history", async (c) => {
  const authUser = c.get("authUser");
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const perPage = Math.min(50, Math.max(1, Number(c.req.query("perPage") ?? "20") || 20));

  const [items, total] = await Promise.all([
    prisma.userLoginHistory.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage
    }),
    prisma.userLoginHistory.count({ where: { userId: authUser.id } })
  ]);

  return successResponse(c, {
    loginHistory: items.map(serializeLoginHistory),
    pagination: {
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage))
    }
  });
});

architectSettingsRoutes.get("/sessions", async (c) => {
  const authUser = c.get("authUser");
  const currentSid = await getCurrentSid(c);

  const sessions = await prisma.userActiveSession.findMany({
    where: {
      userId: authUser.id,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { lastActiveAt: "desc" }
  });

  return successResponse(c, {
    sessions: sessions.map((session) => serializeActiveSession(session, currentSid))
  });
});

architectSettingsRoutes.delete("/sessions/:sessionId", async (c) => {
  const authUser = c.get("authUser");
  const sessionId = c.req.param("sessionId");
  const currentSid = await getCurrentSid(c);

  const session = await prisma.userActiveSession.findFirst({
    where: { id: sessionId, userId: authUser.id, revokedAt: null }
  });

  if (!session) {
    return errorResponse(c, "Session not found", 404, "SESSION_NOT_FOUND");
  }

  if (currentSid && session.tokenSid === currentSid) {
    return errorResponse(c, "Cannot revoke your current session", 422, "CANNOT_REVOKE_CURRENT_SESSION");
  }

  await prisma.userActiveSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() }
  });

  return successResponse(c, { revoked: true }, "Session revoked");
});

architectSettingsRoutes.delete("/sessions", async (c) => {
  const authUser = c.get("authUser");
  const currentSid = await getCurrentSid(c);

  await prisma.userActiveSession.updateMany({
    where: {
      userId: authUser.id,
      revokedAt: null,
      ...(currentSid ? { tokenSid: { not: currentSid } } : {})
    },
    data: { revokedAt: new Date() }
  });

  return successResponse(c, { revoked: true }, "Other sessions revoked");
});

architectSettingsRoutes.get("/danger/obligations", async (c) => {
  const authUser = c.get("authUser");
  const obligations = await getArchitectLiveRefundObligations(authUser.id);
  return successResponse(c, obligations);
});

architectSettingsRoutes.post("/danger/pay-obligations", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = dangerPaySchema.parse(await c.req.json());
    const obligations = await getArchitectLiveRefundObligations(authUser.id);

    if (!obligations.requiresPayment) {
      return successResponse(c, { paid: true, amountCents: 0 }, "No buyer refunds required");
    }

    const settlement = await prisma.architectRefundSettlement.create({
      data: {
        architectUserId: authUser.id,
        action: input.action,
        amountCents: obligations.totalRefundCents,
        status: "PAID",
        breakdown: obligations.agents
      }
    });

    return successResponse(
      c,
      {
        paid: true,
        settlementId: settlement.id,
        amountCents: settlement.amountCents,
        agents: obligations.agents
      },
      "Buyer refund obligation recorded as paid"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid payment request", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not process refund payment", 500, "REFUND_PAYMENT_FAILED");
  }
});

architectSettingsRoutes.post("/danger/pause-agents", async (c) => {
  try {
    const authUser = c.get("authUser");

    await prisma.$transaction([
      prisma.agentListing.updateMany({
        where: {
          architectUserId: authUser.id,
          status: { in: ["APPROVED", "PENDING_REVIEW"] }
        },
        data: { status: "PAUSED" }
      }),
      prisma.architectProfile.upsert({
        where: { userId: authUser.id },
        update: { agentsPaused: true },
        create: { userId: authUser.id, agentsPaused: true }
      })
    ]);

    return successResponse(c, { paused: true }, "All agents paused");
  } catch {
    return errorResponse(c, "Could not pause agents", 500, "PAUSE_AGENTS_FAILED");
  }
});

architectSettingsRoutes.post("/danger/reactivate-agents", async (c) => {
  try {
    const authUser = c.get("authUser");

    const reactivated = await prisma.$transaction(async (tx) => {
      const result = await tx.agentListing.updateMany({
        where: {
          architectUserId: authUser.id,
          status: "PAUSED"
        },
        data: { status: "APPROVED" }
      });

      await tx.architectProfile.upsert({
        where: { userId: authUser.id },
        update: { agentsPaused: false },
        create: { userId: authUser.id, agentsPaused: false }
      });

      return result.count;
    });

    return successResponse(c, { reactivated: reactivated > 0 }, "All agents are live again");
  } catch {
    return errorResponse(c, "Could not reactivate agents", 500, "REACTIVATE_AGENTS_FAILED");
  }
});

architectSettingsRoutes.post("/danger/delete-account", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = dangerDeleteSchema.parse(await c.req.json());
    const obligations = await getArchitectLiveRefundObligations(authUser.id);

    if (obligations.requiresPayment) {
      const settled = await hasPaidRefundSettlement(authUser.id, "DELETE_ACCOUNT");
      if (!settled) {
        return successResponse(c, {
          deleted: false,
          requiresPayment: true,
          obligations
        }, "Buyer refund payment required before deleting account");
      }
    }

    if (input.confirmation !== "DELETE") {
      return errorResponse(c, "Confirmation required", 422, "CONFIRMATION_REQUIRED");
    }

    await prisma.user.delete({ where: { id: authUser.id } });

    return successResponse(c, { deleted: true }, "Account deleted");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid delete request", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not delete account", 500, "DELETE_ACCOUNT_FAILED");
  }
});
