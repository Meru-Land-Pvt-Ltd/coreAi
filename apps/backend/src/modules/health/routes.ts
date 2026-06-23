import { Hono } from "hono";
import { successResponse } from "../../lib/api-response";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => {
  return successResponse(c, {
    status: "ok",
    service: "coreai-backend",
    timestamp: new Date().toISOString()
  });
});