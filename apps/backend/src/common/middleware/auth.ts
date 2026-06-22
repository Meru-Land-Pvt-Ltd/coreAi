import type { Context, Next } from "hono";

export type UserRole = "ADMIN" | "BUSINESS" | "ARCHITECT";

export const requireRole = (roles: UserRole[]) => async (c: Context, next: Next) => {
  const role = c.req.header("x-role") as UserRole | undefined;

  if (!role || !roles.includes(role)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
};
