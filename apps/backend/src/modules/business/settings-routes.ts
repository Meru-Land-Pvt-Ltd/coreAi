import { Hono, type Context } from "hono";
import { z } from "zod";
import { deleteUserWorkspace } from "../auth/workspace-deletion";
import { normalizeTimeZone } from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  issueEmailVerificationCode,
  isOtpError,
  verifyEmailVerificationCode
} from "../../lib/email-otp";
import { createAuthToken, verifyAuthToken, type JwtUserRole } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { resolvePrimaryBusinessId } from "./primary-business";
import { getStripe, isBillingEnabled } from "../../lib/stripe";
import { serializeActiveSession, serializeLoginHistory } from "../../lib/user-session";
import { buildBusinessDataExportZip } from "./data-export";
import { pseudonymizeDisclosureConsentsForUser } from "../compliance/disclosure-consent";

export const businessSettingsRoutes = new Hono();

const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const EMAIL_VERIFY_TTL_MS = 30 * 60 * 1000;

const profilePhotoSchema = z.object({
  photoDataUrl: z.string().trim().min(1, "Profile photo is required")
});

const emailChangeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email is required")
});

const emailChangeVerifySchema = emailChangeRequestSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code")
});

const businessProfileSchema = z.object({
  businessId: z.string().trim().min(1, "Business ID is required"),
  fullName: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email().optional(),
  businessName: z.string().trim().min(2).optional(),
  businessType: z.string().trim().min(2).optional(),
  businessSize: z.string().trim().optional().or(z.literal("")),
  teamPhone: z.string().trim().optional().or(z.literal("")),
  bookingUrl: z.string().trim().optional().or(z.literal("")),
  timeZone: z.string().trim().optional(),
  businessAddress: z.string().trim().optional().or(z.literal(""))
});

const billingAddressSchema = z.object({
  businessId: z.string().trim().min(1, "Business ID is required"),
  address: z.string().trim().min(3, "Address is required").max(500, "Address is too long"),
  pincode: z
    .string()
    .trim()
    .min(3, "Pincode is required")
    .max(20, "Pincode is too long")
    .regex(/^[a-zA-Z0-9 -]+$/, "Enter a valid pincode")
});

type EmailChangeBinding = {
  email: string;
  verified: boolean;
  verifiedAt?: number;
};

const businessEmailChangeBindings = new Map<string, EmailChangeBinding>();

function emailChangeBindingKey(userId: string, email: string) {
  return `${userId}:${email}`;
}

function normalizeSettingsTimeZone(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iana = trimmed.split("(")[0]?.trim() || trimmed;
  return normalizeTimeZone(iana);
}

function normalizeOptionalBookingUrl(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function parseProfilePhotoDataUrl(photoDataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png));base64,([a-zA-Z0-9+/=\s]+)$/.exec(photoDataUrl.trim());
  if (!match) {
    throw new Error("Upload a JPG or PNG image");
  }

  const base64 = match[2]!.replace(/\s/g, "");
  const bytes = Buffer.byteLength(base64, "base64");

  if (bytes <= 0 || bytes > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error("Profile photo must be 2MB or smaller");
  }

  return photoDataUrl.trim();
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

async function loadOwnedBusiness(userId: string, businessId?: string) {
  if (businessId) {
    return prisma.business.findFirst({
      where: { id: businessId, ownerId: userId },
      include: { profile: true }
    });
  }
  const primaryId = await resolvePrimaryBusinessId(userId);
  return prisma.business.findFirst({
    where: { id: primaryId ?? "" },
    include: { profile: true }
  });
}

function serializeBusinessProfile(
  user: {
    fullName: string | null;
    email: string;
    phone: string | null;
    profilePhotoUrl: string | null;
  },
  business: {
    id: string;
    name: string;
    type: string;
    billingAddress: string | null;
    profile: {
      teamPhone: string | null;
      bookingUrl: string | null;
      timeZone: string;
      businessSize: string | null;
    } | null;
  }
) {
  return {
    businessId: business.id,
    fullName: user.fullName ?? "",
    email: user.email,
    phone: user.phone ?? business.profile?.teamPhone ?? "",
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    businessName: business.name,
    businessType: business.type,
    businessSize: business.profile?.businessSize ?? "",
    teamPhone: business.profile?.teamPhone ?? "",
    bookingUrl: business.profile?.bookingUrl ?? "",
    timeZone: business.profile?.timeZone ?? "America/Los_Angeles",
    businessAddress: business.billingAddress ?? ""
  };
}

businessSettingsRoutes.get("/profile", async (c) => {
  try {
    const authUser = c.get("authUser");
    const requestedBusinessId = c.req.query("businessId")?.trim();
    const business = await loadOwnedBusiness(authUser.id, requestedBusinessId || undefined);

    if (!business) {
      return successResponse(c, {
        profile: {
          businessId: "",
          fullName: authUser.fullName ?? "",
          email: authUser.email,
          phone: "",
          profilePhotoUrl: null,
          businessName: "",
          businessType: "",
          businessSize: "",
          teamPhone: "",
          bookingUrl: "",
          timeZone: "America/Los_Angeles",
          businessAddress: ""
        }
      }, "Profile loaded");
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        fullName: true,
        email: true,
        phone: true,
        profilePhotoUrl: true
      }
    });

    if (!user) {
      return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
    }

    return successResponse(c, {
      profile: serializeBusinessProfile(user, business)
    }, "Profile loaded");
  } catch {
    return errorResponse(c, "Could not load profile", 500, "PROFILE_LOAD_FAILED");
  }
});

async function saveBusinessSettingsProfile(c: Context) {
  const authUser = c.get("authUser");
  const input = businessProfileSchema.parse(await c.req.json());
  const business = await loadOwnedBusiness(authUser.id, input.businessId);

  if (!business) {
    return errorResponse(c, "Business not found", 404, "BUSINESS_NOT_FOUND");
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { email: true, fullName: true, role: true, profilePhotoUrl: true }
  });

  if (!currentUser) {
    return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
  }

  let nextEmail = currentUser.email;
  let emailChanged = false;

  if (input.email && input.email !== currentUser.email.toLowerCase()) {
    const bindingKey = emailChangeBindingKey(authUser.id, input.email);
    const binding = businessEmailChangeBindings.get(bindingKey);

    if (!binding?.verified || binding.email !== input.email) {
      return errorResponse(
        c,
        "Verify the new email address before saving",
        422,
        "EMAIL_NOT_VERIFIED"
      );
    }

    if (!binding.verifiedAt || Date.now() - binding.verifiedAt > EMAIL_VERIFY_TTL_MS) {
      businessEmailChangeBindings.delete(bindingKey);
      return errorResponse(
        c,
        "Email verification expired. Request a new code.",
        422,
        "EMAIL_VERIFICATION_EXPIRED"
      );
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: "BUSINESS",
        id: { not: authUser.id }
      },
      select: { id: true }
    });

    if (existingUser) {
      businessEmailChangeBindings.delete(bindingKey);
      return errorResponse(c, "This email is already used by another business account", 409, "EMAIL_ALREADY_IN_USE");
    }

    nextEmail = input.email;
    emailChanged = true;
  }

  const timeZone = normalizeSettingsTimeZone(input.timeZone);
  const bookingUrl = normalizeOptionalBookingUrl(input.bookingUrl);

  const updatedUser = await prisma.user.update({
    where: { id: authUser.id },
    data: {
      fullName: input.fullName ?? undefined,
      phone: input.phone || null,
      email: emailChanged ? nextEmail : undefined
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      profilePhotoUrl: true
    }
  });

  await prisma.business.update({
    where: { id: business.id },
    data: {
      name: input.businessName ?? undefined,
      type: input.businessType ?? undefined,
      billingAddress: input.businessAddress || null
    }
  });

  const profileData = {
    teamPhone: input.teamPhone || null,
    bookingUrl: bookingUrl || null,
    businessSize: input.businessSize || null,
    ...(timeZone ? { timeZone } : {})
  };

  if (business.profile) {
    await prisma.businessProfile.update({
      where: { businessId: business.id },
      data: profileData
    });
  } else {
    await prisma.businessProfile.create({
      data: {
        businessId: business.id,
        ...profileData,
        timeZone: timeZone ?? "America/Los_Angeles"
      }
    });
  }

  if (emailChanged) {
    for (const [key] of businessEmailChangeBindings.entries()) {
      if (key.startsWith(`${authUser.id}:`)) {
        businessEmailChangeBindings.delete(key);
      }
    }
  }

  const refreshedBusiness = await loadOwnedBusiness(authUser.id, business.id);
  const profile = serializeBusinessProfile(
    updatedUser,
    refreshedBusiness ?? {
      ...business,
      name: input.businessName ?? business.name,
      type: input.businessType ?? business.type,
      billingAddress: input.businessAddress ?? business.billingAddress,
      profile: business.profile
        ? {
            ...business.profile,
            teamPhone: input.teamPhone || null,
            bookingUrl: bookingUrl || null,
            businessSize: input.businessSize || null,
            timeZone: timeZone ?? business.profile.timeZone
          }
        : null
    }
  );

  const currentSid = await getCurrentSid(c);
  const responseBody: {
    profile: typeof profile;
    token?: string;
    user?: {
      id: string;
      fullName: string | null;
      email: string;
      role: string;
      profilePhotoUrl: string | null;
    };
  } = { profile };

  if (emailChanged) {
    const token = await createAuthToken(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role as JwtUserRole
      },
      currentSid
    );

    responseBody.token = token;
    responseBody.user = {
      id: updatedUser.id,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      role: updatedUser.role,
      profilePhotoUrl: updatedUser.profilePhotoUrl
    };
  }

  return successResponse(c, responseBody, "Profile saved");
}

businessSettingsRoutes.post("/profile", async (c) => {
  try {
    return await saveBusinessSettingsProfile(c);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid profile", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save profile", 500, "PROFILE_SAVE_FAILED");
  }
});

businessSettingsRoutes.put("/profile", async (c) => {
  try {
    return await saveBusinessSettingsProfile(c);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid profile", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save profile", 500, "PROFILE_SAVE_FAILED");
  }
});

businessSettingsRoutes.put("/billing-address", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = billingAddressSchema.parse(await c.req.json());
    const business = await loadOwnedBusiness(authUser.id, input.businessId);

    if (!business) {
      return errorResponse(c, "Business not found", 404, "BUSINESS_NOT_FOUND");
    }

    const updated = await prisma.business.update({
      where: { id: business.id },
      data: {
        billingAddress: input.address,
        billingPostalCode: input.pincode
      },
      select: {
        billingAddress: true,
        billingPostalCode: true
      }
    });

    return successResponse(
      c,
      {
        billingAddress: {
          address: updated.billingAddress ?? "",
          pincode: updated.billingPostalCode ?? ""
        }
      },
      "Billing address saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid billing address", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save billing address", 500, "BILLING_ADDRESS_SAVE_FAILED");
  }
});

businessSettingsRoutes.put("/profile/photo", async (c) => {
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

businessSettingsRoutes.post("/profile/email/request", async (c) => {
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
        role: "BUSINESS",
        id: { not: authUser.id }
      },
      select: { id: true }
    });

    if (existingUser) {
      return errorResponse(c, "This email is already used by another business account", 409, "EMAIL_ALREADY_IN_USE");
    }

    await issueEmailVerificationCode(input.email, "BUSINESS", "email_update");
    businessEmailChangeBindings.set(emailChangeBindingKey(authUser.id, input.email), {
      email: input.email,
      verified: false
    });

    return successResponse(c, { email: input.email, sent: true }, "Verification code sent");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid email", 422, "VALIDATION_ERROR");
    }

    if (isOtpError(error) && error.code === "OTP_COOLDOWN") {
      return errorResponse(c, error.message, 422, "OTP_COOLDOWN");
    }

    console.error("Business email change request failed", error);
    return errorResponse(c, "Failed to send verification code", 500, "SEND_EMAIL_CHANGE_CODE_FAILED");
  }
});

businessSettingsRoutes.post("/profile/email/verify", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = emailChangeVerifySchema.parse(await c.req.json());
    const bindingKey = emailChangeBindingKey(authUser.id, input.email);
    const binding = businessEmailChangeBindings.get(bindingKey);

    if (!binding || binding.email !== input.email) {
      return errorResponse(
        c,
        "Please request a new verification code for this email",
        400,
        "EMAIL_CHANGE_REQUEST_REQUIRED"
      );
    }

    const verification = await verifyEmailVerificationCode(input.email, "BUSINESS", input.code);
    if (!verification.ok) {
      return errorResponse(c, verification.message, verification.status, verification.code);
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: "BUSINESS",
        id: { not: authUser.id }
      },
      select: { id: true }
    });

    if (existingUser) {
      businessEmailChangeBindings.delete(bindingKey);
      return errorResponse(c, "This email is already used by another business account", 409, "EMAIL_ALREADY_IN_USE");
    }

    businessEmailChangeBindings.set(bindingKey, {
      email: input.email,
      verified: true,
      verifiedAt: Date.now()
    });

    return successResponse(
      c,
      { email: input.email, verified: true },
      "Email verified. Click Save changes to update your account."
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid verification code", 422, "VALIDATION_ERROR");
    }

    console.error("Business email change verify failed", error);
    return errorResponse(c, "Could not verify email address", 500, "EMAIL_VERIFY_FAILED");
  }
});

businessSettingsRoutes.get("/sessions", async (c) => {
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

businessSettingsRoutes.delete("/sessions/:sessionId", async (c) => {
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

businessSettingsRoutes.delete("/sessions", async (c) => {
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

businessSettingsRoutes.get("/data-export", async (c) => {
  try {
    const authUser = c.get("authUser");
    const requestedBusinessId = c.req.query("businessId")?.trim();
    const { filename, zip } = await buildBusinessDataExportZip(authUser.id, requestedBusinessId);

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(zip);
  } catch (error) {
    console.error("Business data export failed", error);
    return errorResponse(c, "Could not export your data", 500, "DATA_EXPORT_FAILED");
  }
});

businessSettingsRoutes.get("/login-history", async (c) => {
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
const deleteAccountSchema = z.object({
  confirmation: z.string().trim()
});

businessSettingsRoutes.post("/danger/delete-account", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = deleteAccountSchema.parse(await c.req.json().catch(() => ({})));

    if (input.confirmation !== "DELETE") {
      return errorResponse(c, "Type DELETE to confirm.", 422, "CONFIRMATION_REQUIRED");
    }

    const businesses = await prisma.business.findMany({
      where: { ownerId: authUser.id },
      select: { id: true, stripeSubscriptionId: true }
    });
    const businessIds = businesses.map((business) => business.id);

    // Cancel live Stripe subscriptions so the buyer is never billed again.
    // Best-effort: a Stripe hiccup must not leave the account undeletable.
    for (const business of businesses) {
      if (!business.stripeSubscriptionId) continue;
      try {
        if (isBillingEnabled()) {
          await getStripe().subscriptions.cancel(business.stripeSubscriptionId);
        }
      } catch (error) {
        console.error("[delete-account] Stripe cancel failed (continuing)", {
          businessId: business.id,
          error: error instanceof Error ? error.message : error
        });
      }
    }

    // Release the buyer's dedicated numbers back to inventory. The reserved
    // shared SMS sender can never be assigned, so it is never touched here.
    await prisma.platformPhoneNumber.updateMany({
      where: {
        status: "ASSIGNED",
        OR: [
          ...(businessIds.length ? [{ businessId: { in: businessIds } }] : []),
          { buyerUserId: authUser.id }
        ]
      },
      data: {
        status: "AVAILABLE",
        businessId: null,
        buyerUserId: null,
        installedAgentId: null,
        assignedAt: null,
        feeBilledAt: null
      }
    });

    // Disclosure-consent rows have no FK by design — pseudonymize them so the
    // compliance evidence survives without identifying the deleted person.
    await pseudonymizeDisclosureConsentsForUser(authUser.id).catch((error) =>
      console.error("[delete-account] consent pseudonymization failed (non-fatal)", error)
    );

    /* Workspace-scoped: an account that is ALSO an architect keeps its User
       row, its listings/workflows and its session — only the buyer side goes. */
    const result = await deleteUserWorkspace(authUser.id, "BUSINESS");

    console.log("[delete-account] business workspace deleted", {
      userId: authUser.id,
      businesses: businessIds.length,
      accountRemoved: result.accountRemoved,
      remainingRoles: result.remainingRoles
    });

    return successResponse(
      c,
      {
        deleted: true,
        accountRemoved: result.accountRemoved,
        remainingRoles: result.remainingRoles
      },
      result.accountRemoved ? "Account deleted" : "Business workspace deleted"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
    }
    console.error("[delete-account] failed", error);
    return errorResponse(c, "Could not delete account", 500, "DELETE_ACCOUNT_FAILED");
  }
});
