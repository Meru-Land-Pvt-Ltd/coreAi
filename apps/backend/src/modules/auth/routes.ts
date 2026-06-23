import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createAuthToken, type JwtUserRole } from "../../lib/jwt";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth } from "../../middleware/auth";
import { loginSchema, signupSchema } from "./schemas";

export const authRoutes = new Hono();

authRoutes.post("/signup", async (c) => {
  try {
    const input = signupSchema.parse(await c.req.json());

    const existingUser = await prisma.user.findUnique({
      where: {
        email: input.email
      },
      select: {
        id: true
      }
    });

    if (existingUser) {
      return errorResponse(
        c,
        "User already exists with this email",
        409,
        "USER_ALREADY_EXISTS"
      );
    }

    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        passwordHash: hashPassword(input.password),
        role: input.role
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isSuspended: true,
        createdAt: true
      }
    });

    const token = await createAuthToken({
      id: user.id,
      email: user.email,
      role: user.role as JwtUserRole
    });

    return successResponse(
      c,
      {
        token,
        user
      },
      "Account created successfully",
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid signup input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Signup failed", 500, "SIGNUP_FAILED");
  }
});

authRoutes.post("/login", async (c) => {
  try {
    const input = loginSchema.parse(await c.req.json());

    const user = await prisma.user.findUnique({
      where: {
        email: input.email
      }
    });

    if (!user) {
      return errorResponse(
        c,
        "Invalid email or password",
        401,
        "INVALID_CREDENTIALS"
      );
    }

    if (user.role !== input.role) {
      return errorResponse(
        c,
        `This email is not registered as ${input.role}`,
        403,
        "ROLE_MISMATCH"
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
        "Password login is not enabled for this account",
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
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isSuspended: user.isSuspended,
      createdAt: user.createdAt
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