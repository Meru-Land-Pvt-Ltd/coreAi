import { Hono } from "hono";
import { requireRole } from "../../common/middleware/auth.js";

export const userRoutes = new Hono()
  .get("/me", (c) => c.json({ message: "current user placeholder" }))
  .get("/", requireRole(["ADMIN"]), (c) => c.json({ users: [] }));
