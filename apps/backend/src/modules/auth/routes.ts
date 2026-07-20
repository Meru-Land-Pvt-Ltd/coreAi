import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import { createAuthToken, type JwtUserRole } from "../../lib/jwt";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth } from "../../middleware/auth";
import {
  issueEmailVerificationCode,
  isOtpError,
  verifyEmailVerificationCode
} from "../../lib/email-otp";
import { sendBuyerWelcomeEmail } from "../../lib/mailer";
import { getFirebaseAdminAuth } from "../../lib/firebase-admin";
import { issueAuthSession } from "../../lib/user-session";
import {
  loginSchema,
  sendVerificationCodeSchema,
  verifyCodeSchema,
  firebaseLoginSchema
} from "./schemas";
import { resolveLoginUser, type LoginUser } from "./role-login";
import { getUserRoles, grantRole, mergeRoles } from "../../lib/roles";

export const authRoutes = new Hono();

function getNameFromEmail(email: string) {
  const name = email.split("@")[0] ?? "User";

  const formattedName = name
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return formattedName || "User";
}

// Fire-and-forget welcome email for a buyer's very first login. Failures are
// logged but never block the auth response.
function sendWelcomeEmailIfNewBuyer(
  user: { email: string; fullName: string | null; role: unknown },
  isNewUser: boolean
) {
  if (!isNewUser || user.role !== "BUSINESS") return;

  void sendBuyerWelcomeEmail({
    to: user.email,
    buyerName: user.fullName
  }).catch((error) => {
    console.error("Failed to send buyer welcome email:", error);
  });
}

function toSafeUser(user: {
  id: string;
  fullName: string | null;
  email: string;
  role: unknown;
  isSuspended: boolean;
  createdAt: Date;
  profilePhotoUrl?: string | null;
  roleMemberships?: Array<{ role: unknown }>;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    roles: mergeRoles(
      String(user.role),
      (user.roleMemberships ?? []).map((membership) => ({ role: String(membership.role) }))
    ),
    isSuspended: user.isSuspended,
    createdAt: user.createdAt,
    profilePhotoUrl: user.profilePhotoUrl ?? null
  };
}

authRoutes.post("/send-verification-code", async (c) => {
  try {
    const input = sendVerificationCodeSchema.parse(await c.req.json());

    // Email-first: the code may log the caller into an existing account of a
    // different legacy role, so the suspension precheck mirrors the account
    // resolution order used at verification time (exact role → membership →
    // oldest row) instead of the exact (email, role) pair.
    const candidates = await prisma.user.findMany({
      where: { email: input.email },
      select: {
        id: true,
        role: true,
        isSuspended: true,
        roleMemberships: { select: { role: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    const existingUser =
      candidates.find((candidate) => candidate.role === input.role) ??
      candidates.find((candidate) =>
        candidate.roleMemberships.some((membership) => membership.role === input.role)
      ) ??
      candidates[0] ??
      null;

    if (existingUser?.isSuspended) {
      return errorResponse(
        c,
        "Your account is suspended",
        403,
        "ACCOUNT_SUSPENDED"
      );
    }

    await issueEmailVerificationCode(input.email, input.role);

    return successResponse(
      c,
      {
        email: input.email,
        role: input.role
      },
      "Verification code sent"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid input",
        422,
        "VALIDATION_ERROR"
      );
    }

    if (isOtpError(error) && error.code === "OTP_COOLDOWN") {
      return errorResponse(c, error.message, 422, "OTP_COOLDOWN");
    }

    console.error("Send verification code failed", error);
    return errorResponse(
      c,
      "Failed to send verification code",
      500,
      "SEND_VERIFICATION_CODE_FAILED"
    );
  }
});

authRoutes.post("/verify-code", async (c) => {
  try {
    const input = verifyCodeSchema.parse(await c.req.json());

    const verification = await verifyEmailVerificationCode(input.email, input.role, input.code);
    if (!verification.ok) {
      return errorResponse(c, verification.message, verification.status, verification.code);
    }

    // Email-first resolution: an existing account (any role) is reused and
    // granted the requested role as a membership — the same email is never
    // duplicated into a second User row.
    const { user, isNewUser } = await resolveLoginUser({
      email: input.email,
      role: input.role,
      fallbackFullName: getNameFromEmail(input.email),
      allowCreate: true
    });

    if (!user) {
      return errorResponse(c, "Verification failed", 500, "VERIFY_CODE_FAILED");
    }

    if (user.isSuspended) {
      return errorResponse(
        c,
        "Your account is suspended",
        403,
        "ACCOUNT_SUSPENDED"
      );
    }

    sendWelcomeEmailIfNewBuyer(user, isNewUser);

    const safeUser = {
      ...toSafeUser(user),
      architectProfile: user.architectProfile
    };

    const { tokenSid } = await issueAuthSession(user.id, c);
    const token = await createAuthToken(
      {
        id: user.id,
        email: user.email,
        role: user.role as JwtUserRole
      },
      tokenSid
    );

    return successResponse(
      c,
      {
        token,
        user: safeUser,
        isNewUser
      },
      "Email verified successfully"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid verification input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Verification failed", 500, "VERIFY_CODE_FAILED");
  }
});

authRoutes.post("/firebase-login", async (c) => {
  try {
    const input = firebaseLoginSchema.parse(await c.req.json());

    console.log("Firebase login request:", {
      role: input.role,
      tokenLength: input.idToken.length
    });

    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(input.idToken);

    console.log("Firebase token verified:", {
      email: decodedToken.email,
      uid: decodedToken.uid,
      aud: decodedToken.aud,
      iss: decodedToken.iss,
      role: input.role
    });

    if (!decodedToken.email) {
      return errorResponse(
        c,
        "Google account email not found",
        401,
        "GOOGLE_EMAIL_NOT_FOUND"
      );
    }

    const email = decodedToken.email.toLowerCase();

    const googleName =
      typeof decodedToken.name === "string" && decodedToken.name.trim()
        ? decodedToken.name.trim()
        : getNameFromEmail(email);

    console.log("Finding user:", {
      email,
      role: input.role
    });

    // Email-first resolution: reuse any existing account for this email and
    // grant the requested role membership instead of creating a duplicate row.
    const { user, isNewUser } = await resolveLoginUser({
      email,
      role: input.role,
      fallbackFullName: googleName,
      allowCreate: true
    });

    console.log("User lookup result:", {
      found: Boolean(user),
      userId: user?.id,
      role: user?.role,
      isNewUser
    });

    if (!user) {
      return errorResponse(c, "Google login failed", 500, "GOOGLE_LOGIN_FAILED");
    }

    if (user.isSuspended) {
      return errorResponse(
        c,
        "Your account is suspended",
        403,
        "ACCOUNT_SUSPENDED"
      );
    }

    console.log("Creating auth token:", {
      userId: user.id,
      email: user.email,
      role: user.role
    });

    sendWelcomeEmailIfNewBuyer(user, isNewUser);

    const safeUser = {
      ...toSafeUser(user),
      architectProfile: user.architectProfile
    };

    const { tokenSid } = await issueAuthSession(user.id, c);
    const token = await createAuthToken(
      {
        id: user.id,
        email: user.email,
        role: user.role as JwtUserRole
      },
      tokenSid
    );

    console.log("Firebase login success:", {
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return successResponse(
      c,
      {
        token,
        user: safeUser,
        isNewUser
      },
      "Google login successful"
    );
  } catch (error) {
    console.error("Firebase login failed:", {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid Google login input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(
      c,
      error instanceof Error ? error.message : "Google login failed",
      500,
      "GOOGLE_LOGIN_FAILED"
    );
  }
});

authRoutes.post("/signup", async (c) => {
  const rawBody = (await c.req.json().catch(() => ({}))) as { role?: unknown };

  if (rawBody.role === "ADMIN") {
    return errorResponse(
      c,
      "Admin accounts can only be created by the seed script.",
      403,
      "ADMIN_SIGNUP_DISABLED"
    );
  }

  return errorResponse(
    c,
    "Public signup is not available. Please use email OTP or Google login.",
    404,
    "NOT_IMPLEMENTED"
  );
});

authRoutes.post("/login", async (c) => {
  try {
    const input = loginSchema.parse(await c.req.json());

    // Email-first: prefer the row matching the requested role, then a row
    // holding it as a membership, then any account for the email. The role
    // membership is only granted AFTER the password is verified.
    const candidates = await prisma.user.findMany({
      where: { email: input.email },
      include: {
        architectProfile: true,
        roleMemberships: { select: { role: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    const user: LoginUser | null =
      candidates.find((candidate) => candidate.role === input.role) ??
      candidates.find((candidate) =>
        candidate.roleMemberships.some((membership) => membership.role === input.role)
      ) ??
      candidates[0] ??
      null;

    if (!user) {
      return errorResponse(
        c,
        `This email is not registered as ${input.role}`,
        401,
        "INVALID_CREDENTIALS"
      );
    }

    if (user.isSuspended) {
      return errorResponse(
        c,
        "Your account is suspended",
        403,
        "ACCOUNT_SUSPENDED"
      );
    }

    if (!user.passwordHash) {
      return errorResponse(
        c,
        "Password login is not enabled for this account. Please use email OTP or Google login.",
        401,
        "PASSWORD_LOGIN_DISABLED"
      );
    }

    const isPasswordValid = verifyPassword(input.password, user.passwordHash);

    if (!isPasswordValid) {
      return errorResponse(
        c,
        "Invalid email or password",
        401,
        "INVALID_CREDENTIALS"
      );
    }

    // Authenticated entry into this role's workspace — grant the capability
    // (idempotent) instead of requiring a separate User row per role.
    await grantRole(user.id, input.role);
    if (!user.roleMemberships.some((membership) => membership.role === input.role)) {
      user.roleMemberships = [...user.roleMemberships, { role: input.role }];
    }
    if (input.role === "ARCHITECT" && !user.architectProfile) {
      user.architectProfile = await prisma.architectProfile.create({
        data: { userId: user.id }
      });
    }

    const safeUser = {
      ...toSafeUser(user),
      architectProfile: user.architectProfile
    };

    const { tokenSid } = await issueAuthSession(user.id, c);
    const token = await createAuthToken(
      {
        id: user.id,
        email: user.email,
        role: user.role as JwtUserRole
      },
      tokenSid
    );

    return successResponse(
      c,
      {
        token,
        user: safeUser
      },
      "Logged in successfully"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid login input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Login failed", 500, "LOGIN_FAILED");
  }
});

authRoutes.get("/me", requireAuth, async (c) => {
  const authUser = c.get("authUser");

  return successResponse(c, {
    user: authUser
  });
});

/**
 * Intentional entry into the Business (buyer) workspace. Grants the BUSINESS
 * role membership to the current account — an ARCHITECT keeps architect
 * access and additionally becomes a buyer on the same User row. Idempotent.
 */
authRoutes.post("/business-workspace/activate", requireAuth, async (c) => {
  const authUser = c.get("authUser");

  try {
    await grantRole(authUser.id, "BUSINESS");
    const roles = await getUserRoles(authUser.id);

    return successResponse(
      c,
      {
        userId: authUser.id,
        roles,
        activeWorkspace: "BUSINESS"
      },
      "Business workspace activated"
    );
  } catch (error) {
    console.error("Business workspace activation failed", error);
    return errorResponse(
      c,
      "Failed to activate the Business workspace",
      500,
      "BUSINESS_WORKSPACE_ACTIVATION_FAILED"
    );
  }
});