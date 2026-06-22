import { Hono } from "hono";

export const approvalRoutes = new Hono()
  .get("/pending", (c) => c.json({ approvals: [] }))
  .post("/:id/approve", (c) => c.json({ message: "approved" }))
  .post("/:id/reject", (c) => c.json({ message: "rejected" }));
