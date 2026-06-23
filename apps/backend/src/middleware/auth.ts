import type { Context, Next } from "hono";
import { prisma } from "../lib/prisma";
import { verifyAuthToken, type JwtUserRole } from "../lib/jwt";
import { errorResponse } from "../lib/api-response";

export type AuthUser = {
  id: string;
  email: string;
  role: JwtUserRole;
  fullName: string | null;
};

declare module "hono" {
  interface ContextVariableMap {
    authUser: AuthUser;
    requestId: string;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(c, "Unauthorized", 401, "UNAUTHORIZED");
  }

  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = await verifyAuthToken(token);

    const user = await prisma.user.findUnique({
      where: {
        id: payload.sub
      },
      select: {
        id: true,
        email: true,
        role: true,
        fullName: true,
        isSuspended: true
      }
    });

    if (!user) {
      return errorResponse(c, "User not found", 401, "USER_NOT_FOUND");
    }

    if (user.isSuspended) {
      return errorResponse(c, "Account suspended", 403, "ACCOUNT_SUSPENDED");
    }

    c.set("authUser", {
      id: user.id,
      email: user.email,
      role: user.role as JwtUserRole,
      fullName: user.fullName
    });

    await next();
  } catch {
    return errorResponse(c, "Invalid or expired token", 401, "INVALID_TOKEN");
  }
}

export function requireRole(roles: JwtUserRole[]) {
  return async (c: Context, next: Next) => {
    const authUser = c.get("authUser");

    if (!authUser) {
      return errorResponse(c, "Unauthorized", 401, "UNAUTHORIZED");
    }

    if (!roles.includes(authUser.role)) {
      return errorResponse(c, "Forbidden", 403, "FORBIDDEN");
    }

    await next();
  };
}