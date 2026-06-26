import { Hono } from "hono";
import { cors } from "hono/cors";
import { env, isProduction } from "./config/env";
import { AppError } from "./lib/app-error";
import { errorResponse } from "./lib/api-response";
import { requestIdMiddleware } from "./middleware/request-id";
import { authRoutes } from "./modules/auth/routes";
import { healthRoutes } from "./modules/health/routes";
import { architectRoutes } from "./modules/architect/routes";
import { businessRoutes } from "./modules/business/routes";
import { mailRoutes } from "./modules/mails/routes";

export const app = new Hono();

app.use("*", requestIdMiddleware);

app.use(
  "*",
  cors({
    origin: env.FRONTEND_URL,
    allowHeaders: ["Content-Type", "Authorization", "x-request-id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  })
);

app.route("/health", healthRoutes);
app.route("/auth", authRoutes);
app.route("/architect", architectRoutes);
app.route("/business", businessRoutes);
app.route("/mail",mailRoutes);

app.notFound((c) => {
  return errorResponse(c, "Route not found", 404, "ROUTE_NOT_FOUND");
});

app.onError((error, c) => {
  const requestId = c.get("requestId");

  console.error({
    requestId,
    error: error.message,
    stack: isProduction ? undefined : error.stack
  });

  if (error instanceof AppError) {
    return errorResponse(
      c,
      error.message,
      error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500,
      error.code
    );
  }

  return errorResponse(c, "Internal server error", 500, "INTERNAL_SERVER_ERROR");
});