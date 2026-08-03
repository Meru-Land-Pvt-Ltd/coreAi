import { Hono } from "hono";
import { cors } from "hono/cors";
import { env, isProduction } from "./config/env";
import { AppError } from "./lib/app-error";
import { errorResponse } from "./lib/api-response";
import { errorMessage, errorStack } from "./lib/error-utils";
import { requestIdMiddleware } from "./middleware/request-id";
import { authRoutes } from "./modules/auth/routes";
import { healthRoutes } from "./modules/health/routes";
import { architectRoutes } from "./modules/architect/routes";
import { businessRoutes } from "./modules/business/routes";
import { mailRoutes } from "./modules/mails/routes";
import { adminRoutes } from "./modules/admin/routes";
import { paymentRoutes } from "./modules/payments/routes";
import { setupRoutes } from "./modules/setup/routes";
import { contactRoutes } from "./modules/contact/routes";
import { countryRoutes } from "./modules/countries/routes";
import { memoryRoutes } from "./modules/memory/routes";
import { emailRoutes } from "./modules/email/routes";
import { legalRoutes } from "./modules/legal/routes";
import { publicBookingRoutes } from "./modules/public/booking-routes";
import { chatbotRoutes } from "./modules/chatbot/routes";
import { supportRoutes } from "./modules/support/routes";
import { integrationsRoutes } from "./modules/integrations/routes";
import {
  handleWhatsAppWebhookPost,
  verifyWhatsAppWebhookChallenge
} from "./modules/whatsapp/webhook";

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
app.route("/integrations", integrationsRoutes);
app.route("/mail", mailRoutes);
app.route("/admin", adminRoutes);
app.route("/payments", paymentRoutes);
app.route("/setup", setupRoutes);
app.route("/contact", contactRoutes);
// Public "Need Help" support submissions from the landing page (no session).
app.route("/support", supportRoutes);
app.route("/countries", countryRoutes);
app.route("/memory", memoryRoutes);
// SES/SNS webhooks — public by design (no session), guarded by topic ARN match.
app.route("/email", emailRoutes);
app.route("/legal", legalRoutes);
// Public customer-facing booking/service-request endpoints (slug-addressed).
app.route("/public", publicBookingRoutes);
app.route("/chatbot", chatbotRoutes);

// Meta WhatsApp Cloud API — public webhook (verify challenge + inbound events).
// Meta dashboard Callback URL: https://triven.ai/api/webhook/meta/whatsapp
app.get("/webhook/meta/whatsapp", verifyWhatsAppWebhookChallenge);
app.post("/webhook/meta/whatsapp", handleWhatsAppWebhookPost);

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
