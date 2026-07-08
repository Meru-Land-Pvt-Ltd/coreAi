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
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    isSuspended: user.isSuspended,
    createdAt: user.createdAt,
    profilePhotoUrl: user.profilePhotoUrl ?? null
  };
}

authRoutes.post("/send-verification-code", async (c) => {
  try {
    const input = sendVerificationCodeSchema.parse(await c.req.json());

    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: input.role
      },
      select: {
        id: true,
        role: true,
        isSuspended: true
      }
    });

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

    let user = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: input.role
      },
      include: {
        architectProfile: true
      }
    });
    if (user?.isSuspended) {
      return errorResponse(
        c,
        "Your account is suspended",
        403,
        "ACCOUNT_SUSPENDED"
      );
    }

    const isNewUser = !user;

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: input.email,
          role: input.role,
          passwordHash: null,
          fullName: getNameFromEmail(input.email),
          architectProfile:
            input.role === "ARCHITECT"
              ? {
                create: {}
              }
              : undefined
        },
        include: {
          architectProfile: true
        }
      });
    } else if (!user.fullName) {
      user = await prisma.user.update({
        where: {
          id: user.id
        },
        data: {
          fullName: getNameFromEmail(user.email)
        },
        include: {
          architectProfile: true
        }
      });
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

    let user = await prisma.user.findFirst({
      where: {
        email,
        role: input.role
      },
      include: {
        architectProfile: true
      }
    });

    console.log("User lookup result:", {
      found: Boolean(user),
      userId: user?.id,
      role: user?.role
    });

    if (user?.isSuspended) {
      return errorResponse(
        c,
        "Your account is suspended",
        403,
        "ACCOUNT_SUSPENDED"
      );
    }

    const isNewUser = !user;

    if (!user) {
      console.log("Creating user:", {
        email,
        role: input.role
      });

      user = await prisma.user.create({
        data: {
          email,
          role: input.role,
          passwordHash: null,
          fullName: googleName,
          architectProfile:
            input.role === "ARCHITECT"
              ? {
                  create: {}
                }
              : undefined
        },
        include: {
          architectProfile: true
        }
      });

      console.log("User created:", {
        userId: user.id,
        email: user.email,
        role: user.role
      });
    } else if (!user.fullName) {
      user = await prisma.user.update({
        where: {
          id: user.id
        },
        data: {
          fullName: googleName
        },
        include: {
          architectProfile: true
        }
      });
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

    const user = await prisma.user.findFirst({
      where: {
        email: input.email,
        role: input.role
      },
      include: {
        architectProfile: true
      }
    });

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