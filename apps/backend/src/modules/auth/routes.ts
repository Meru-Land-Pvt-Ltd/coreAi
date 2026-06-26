import { randomInt } from "crypto";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createAuthToken, type JwtUserRole } from "../../lib/jwt";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth } from "../../middleware/auth";
import { sendVerificationEmail } from "../../lib/mailer";
import { getFirebaseAdminAuth } from "../../lib/firebase-admin";
import {
  loginSchema,
  sendVerificationCodeSchema,
  verifyCodeSchema,
  firebaseLoginSchema
} from "./schemas";

export const authRoutes = new Hono();

const OTP_EXPIRES_IN_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

function getNameFromEmail(email: string) {
  const name = email.split("@")[0] ?? "User";

  const formattedName = name
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return formattedName || "User";
}

function toSafeUser(user: {
  id: string;
  fullName: string | null;
  email: string;
  role: unknown;
  isSuspended: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    isSuspended: user.isSuspended,
    createdAt: user.createdAt
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

    const cooldownDate = new Date(
      Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000
    );

    const recentCode = await prisma.emailVerificationCode.findFirst({
      where: {
        email: input.email,
        role: input.role,
        consumedAt: null,
        createdAt: {
          gte: cooldownDate
        }
      },
      select: {
        id: true
      }
    });

    if (recentCode) {
      return errorResponse(
        c,
        "Please wait before requesting another code",
        422,
        "OTP_COOLDOWN"
      );
    }

    await prisma.emailVerificationCode.updateMany({
      where: {
        email: input.email,
        role: input.role,
        consumedAt: null
      },
      data: {
        consumedAt: new Date()
      }
    });

    const code = String(randomInt(100000, 1000000));

    await prisma.emailVerificationCode.create({
      data: {
        email: input.email,
        role: input.role,
        codeHash: hashPassword(code),
        expiresAt: new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000)
      }
    });

    await sendVerificationEmail({
      to: input.email,
      code,
      role: input.role
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

    const verificationCode = await prisma.emailVerificationCode.findFirst({
      where: {
        email: input.email,
        role: input.role,
        consumedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!verificationCode) {
      return errorResponse(
        c,
        "Verification code is invalid or expired",
        401,
        "OTP_INVALID_OR_EXPIRED"
      );
    }

    if (verificationCode.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.emailVerificationCode.update({
        where: {
          id: verificationCode.id
        },
        data: {
          consumedAt: new Date()
        }
      });

      return errorResponse(
        c,
        "Too many incorrect attempts. Please request a new code",
        422,
        "OTP_TOO_MANY_ATTEMPTS"
      );
    }

    const isCodeValid = verifyPassword(input.code, verificationCode.codeHash);

    if (!isCodeValid) {
      await prisma.emailVerificationCode.update({
        where: {
          id: verificationCode.id
        },
        data: {
          attempts: {
            increment: 1
          }
        }
      });

      return errorResponse(
        c,
        "Invalid verification code",
        401,
        "INVALID_OTP"
      );
    }

    await prisma.emailVerificationCode.update({
      where: {
        id: verificationCode.id
      },
      data: {
        consumedAt: new Date()
      }
    });

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

    const safeUser = {
      ...toSafeUser(user),
      architectProfile: user.architectProfile
    };

    const token = await createAuthToken({
      id: user.id,
      email: user.email,
      role: user.role as JwtUserRole
    });

    return successResponse(
      c,
      {
        token,
        user: safeUser
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

    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(input.idToken);

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

    let user = await prisma.user.findFirst({
      where: {
        email,
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

    if (!user) {
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

    const safeUser = {
      ...toSafeUser(user),
      architectProfile: user.architectProfile
    };

    const token = await createAuthToken({
      id: user.id,
      email: user.email,
      role: user.role as JwtUserRole
    });

    return successResponse(
      c,
      {
        token,
        user: safeUser
      },
      "Google login successful"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid Google login input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Google login failed", 500, "GOOGLE_LOGIN_FAILED");
  }
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

    const token = await createAuthToken({
      id: user.id,
      email: user.email,
      role: user.role as JwtUserRole
    });

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