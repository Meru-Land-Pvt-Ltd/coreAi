import { Hono } from "hono";
import { z } from "zod";
import { normalizeTimeZone } from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  issueEmailVerificationCode,
  isOtpError,
  verifyEmailVerificationCode
} from "../../lib/email-otp";
import { createAuthToken, verifyAuthToken, type JwtUserRole } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";

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
  teamPhone: z.string().trim().optional().or(z.literal("")),
  bookingUrl: z.string().trim().url().optional().or(z.literal("")),
  timeZone: z.string().trim().optional(),
  businessAddress: z.string().trim().optional().or(z.literal(""))
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
  return prisma.business.findFirst({
    where: businessId ? { id: businessId, ownerId: userId } : { ownerId: userId },
    orderBy: { createdAt: "desc" },
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
    teamPhone: business.profile?.teamPhone ?? "",
    bookingUrl: business.profile?.bookingUrl ?? "",
    timeZone: business.profile?.timeZone ?? "America/Los_Angeles",
    businessAddress: business.billingAddress ?? ""
  };
}

businessSettingsRoutes.get("/profile", async (c) => {
  try {
    const authUser = c.get("authUser");
    const business = await loadOwnedBusiness(authUser.id);

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

businessSettingsRoutes.put("/profile", async (c) => {
  try {
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

    const timeZone = input.timeZone ? normalizeTimeZone(input.timeZone) : undefined;

    const updatedBusiness = await prisma.business.update({
      where: { id: business.id },
      data: {
        name: input.businessName ?? undefined,
        type: input.businessType ?? undefined,
        billingAddress: input.businessAddress || null
      },
      include: { profile: true }
    });

    if (business.profile) {
      await prisma.businessProfile.update({
        where: { businessId: business.id },
        data: {
          teamPhone: input.teamPhone || null,
          bookingUrl: input.bookingUrl || null,
          ...(timeZone ? { timeZone } : {})
        }
      });
    } else if (input.teamPhone || input.bookingUrl || timeZone) {
      await prisma.businessProfile.create({
        data: {
          businessId: business.id,
          teamPhone: input.teamPhone || null,
          bookingUrl: input.bookingUrl || null,
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
      refreshedBusiness ?? updatedBusiness
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid profile", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not save profile", 500, "PROFILE_SAVE_FAILED");
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
