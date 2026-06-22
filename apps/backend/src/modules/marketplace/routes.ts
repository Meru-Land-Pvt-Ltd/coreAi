import { Hono } from "hono";

export const marketplaceRoutes = new Hono()
  .get("/agents", (c) => c.json({ agents: [] }))
  .post("/agents", (c) => c.json({ message: "create listing placeholder" }, 201));
