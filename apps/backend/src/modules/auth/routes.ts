import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import { createAuthToken, type JwtUserRole } from "../../lib/jwt";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth } from "../../middleware/auth";
import {
  consumeMagicLinkCode,
  issueEmailVerificationCode,
  isOtpError,
  resolveMagicLinkToken,
  verifyEmailVerificationCode
} from "../../lib/email-otp";
import { sendBuyerWelcomeEmail } from "../../lib/mailer";
import { getFirebaseAdminAuth } from "../../lib/firebase-admin";
import { issueAuthSession } from "../../lib/user-session";
import {
  loginSchema,
  magicLinkCompleteSchema,
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

/**
 * Does this account already hold ADMIN? An emailed code may let an existing
 * admin in; it may never turn anyone into one.
 */
function holdsAdminRole(
  user: { role: string; roleMemberships: Array<{ role: string }> } | null | undefined
): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || user.roleMemberships.some((m) => m.role === "ADMIN");
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

    // An emailed code can never MAKE an admin. It may only let one in, and
    // only when that account already holds the role — so a stranger typing an
    // address into the admin screen gets nothing, not an account.
    // Across ALL rows for this address, not just the resolved one: user rows
    // are unique per (email, role), so an owner who is both an architect and
    // an admin has two — and the architect row must not hide the admin one.
    if (input.role === "ADMIN" && !candidates.some((candidate) => holdsAdminRole(candidate))) {
      return errorResponse(
        c,
        "This email is not an admin account.",
        403,
        "ADMIN_ACCOUNT_REQUIRED"
      );
    }

    await issueEmailVerificationCode(input.email, input.role, "sign_in", {
      deviceId: input.deviceId
    });

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

type LoginSession = {
  token: string;
  user: ReturnType<typeof toSafeUser> & { architectProfile?: unknown };
  isNewUser: boolean;
};

type LoginOutcome =
  | { ok: true; session: LoginSession }
  | { ok: false; message: string; status: 403 | 500; code: string };

async function establishEmailLogin(
  c: Parameters<typeof issueAuthSession>[1],
  email: string,
  role: "ADMIN" | "BUSINESS" | "ARCHITECT",
  failureCode: string
): Promise<LoginOutcome> {
const { user, isNewUser } = await resolveLoginUser({
    email,
    role,
    fallbackFullName: getNameFromEmail(email),
    // An admin signing in with a code must already exist — a code proves the
    // inbox, never the privilege, so this path may never mint an admin.
    allowCreate: role !== "ADMIN"
  });

  if (!user) {
    return { ok: false, message: "Verification failed", status: 500, code: failureCode };
  }

  if (user.isSuspended) {
    return {
      ok: false,
      message: "Your account is suspended",
      status: 403,
      code: "ACCOUNT_SUSPENDED"
    };
  }

  sendWelcomeEmailIfNewBuyer(user, isNewUser);

  const { tokenSid } = await issueAuthSession(user.id, c);
  const token = await createAuthToken(
    {
      id: user.id,
      email: user.email,
      role: user.role as JwtUserRole
    },
    tokenSid
  );

  return {
    ok: true,
    session: {
      token,
      user: {
        ...toSafeUser(user),
        architectProfile: user.architectProfile
      },
      isNewUser
    }
  };
}

authRoutes.post("/verify-code", async (c) => {
  try {
    const input = verifyCodeSchema.parse(await c.req.json());

    const verification = await verifyEmailVerificationCode(input.email, input.role, input.code);
    if (!verification.ok) {
      return errorResponse(c, verification.message, verification.status, verification.code);
    }

    // The same rule as issuing the code, checked again at the door: a correct
    // code proves the inbox, never the privilege. Only an account that already
    // holds ADMIN may come in this way, and never as a new account.
    if (input.role === "ADMIN") {
      const existing = await prisma.user.findMany({
        where: { email: input.email },
        select: { role: true, roleMemberships: { select: { role: true } } }
      });
      if (!existing.some((row) => holdsAdminRole(row))) {
        return errorResponse(c, "This email is not an admin account.", 403, "ADMIN_ACCOUNT_REQUIRED");
      }
    }

    const outcome = await establishEmailLogin(c, input.email, input.role, "VERIFY_CODE_FAILED");

    if (!outcome.ok) {
      return errorResponse(c, outcome.message, outcome.status, outcome.code);
    }

    return successResponse(c, outcome.session, "Email verified successfully");
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

authRoutes.post("/magic-link/complete", async (c) => {
  try {
    const input = magicLinkCompleteSchema.parse(await c.req.json());

    const resolution = await resolveMagicLinkToken(input.token, input.deviceId);

    if (!resolution.ok) {
      return errorResponse(c, resolution.message, resolution.status, resolution.code);
    }

    if (!resolution.isOriginDevice && !input.signInHere) {
      return successResponse(
        c,
        {
          mode: "show_code" as const,
          email: resolution.email,
          role: resolution.role,
          code: resolution.code,
          expiresAt: resolution.expiresAt.toISOString()
        },
        "Sign-in link verified"
      );
    }

    const consumed = await consumeMagicLinkCode(resolution.id);

    if (!consumed) {
      return errorResponse(
        c,
        "This sign-in link has already been used. Request a new one to sign in.",
        410,
        "MAGIC_LINK_ALREADY_USED"
      );
    }

    const outcome = await establishEmailLogin(
      c,
      resolution.email,
      resolution.role,
      "MAGIC_LINK_SIGN_IN_FAILED"
    );

    if (!outcome.ok) {
      return errorResponse(c, outcome.message, outcome.status, outcome.code);
    }

    /* The role the LINK was minted for. A dual-role account cannot be routed
       from user.role (that column holds whichever role they signed up with
       first), so a business sign-in link would land them on the architect
       side. UserRoleMembership is the capability source; this is the intent. */
    return successResponse(
      c,
      { mode: "signed_in" as const, role: resolution.role, ...outcome.session },
      "Signed in successfully"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        "This sign-in link is invalid. Request a new one to sign in.",
        401,
        "MAGIC_LINK_INVALID"
      );
    }

    console.error("Magic link sign-in failed", error);
    return errorResponse(
      c,
      "We couldn't open this sign-in link. Please try again.",
      500,
      "MAGIC_LINK_SIGN_IN_FAILED"
    );
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

    // A PASSWORD PROVES THE ACCOUNT, NEVER THE PRIVILEGE.
    //
    // This line used to grant whatever role the login form asked for, with no
    // check that the account was entitled to it — so anyone holding a password
    // could post role:"ADMIN", be granted it permanently, and walk into
    // platform pricing, payouts, the number pool, every business record and
    // the power to suspend users. The emailed-code paths have always checked
    // this (see :134 and :259); the password path did not.
    //
    // Checked across ALL rows for this address, because user rows are unique
    // per (email, role): an owner who is both an architect and an admin has
    // two, and the architect row must not hide the admin one.
    if (input.role === "ADMIN" && !candidates.some((candidate) => holdsAdminRole(candidate))) {
      return errorResponse(c, "This email is not an admin account.", 403, "ADMIN_ACCOUNT_REQUIRED");
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