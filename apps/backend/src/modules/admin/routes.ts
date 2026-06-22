import { Hono } from "hono";
import { requireRole } from "../../common/middleware/auth.js";

export const adminRoutes = new Hono()
  .use("*", requireRole(["ADMIN"]))
  .get("/stats", (c) =>
    c.json({
      users: 0,
      revenue: 0,
      workflowsToday: 0,
      disputesOpen: 0,
    }),
  );
