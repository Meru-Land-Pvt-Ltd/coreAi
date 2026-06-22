import { Hono } from "hono";

export const projectRoutes = new Hono()
  .get("/", (c) => c.json({ projects: [] }))
  .post("/", (c) => c.json({ message: "create project placeholder" }, 201));
