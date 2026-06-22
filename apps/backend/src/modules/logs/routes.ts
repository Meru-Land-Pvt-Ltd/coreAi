import { Hono } from "hono";

export const logRoutes = new Hono().get("/workflows", (c) =>
  c.json({
    runs: [],
  }),
);
