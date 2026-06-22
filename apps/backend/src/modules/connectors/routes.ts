import { Hono } from "hono";

export const connectorRoutes = new Hono()
  .get("/catalog", (c) =>
    c.json({
      connectors: ["webhook", "http", "gmail", "google_sheets", "slack"],
    }),
  )
  .post("/install", (c) => c.json({ message: "install connector placeholder" }));
