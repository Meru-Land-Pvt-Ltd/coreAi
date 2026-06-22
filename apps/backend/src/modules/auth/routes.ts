import { Hono } from "hono";

export const authRoutes = new Hono()
  .post("/register", (c) => c.json({ message: "register placeholder" }))
  .post("/login", (c) => c.json({ message: "login placeholder" }))
  .post("/logout", (c) => c.json({ message: "logout placeholder" }));
