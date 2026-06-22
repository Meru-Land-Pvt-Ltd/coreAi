import { Hono } from "hono";

export const paymentRoutes = new Hono()
  .get("/plans", (c) => c.json({ plans: [] }))
  .post("/checkout", (c) => c.json({ message: "checkout placeholder" }));
