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
// [DISABLED] import { crmRoutes } from "./modules/crm/routes";
// [DISABLED] import { handleHubSpotWebhookPost } from "./modules/crm/hubspot/webhook";
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
import { agentPagesRoutes } from "./modules/agent-pages/routes";
import { chatbotRoutes } from "./modules/chatbot/routes";
import { supportRoutes } from "./modules/support/routes";
import { integrationsRoutes } from "./modules/integrations/routes";
import {
  handleWhatsAppWebhookPost,
  verifyWhatsAppWebhookChallenge
} from "./modules/whatsapp/webhook";
import { handleCalendlyOAuthMisdirectGet, handleCalendlyWebhookPost } from "./modules/calendly/webhook";

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
app.route("/api/health", healthRoutes);
app.route("/auth", authRoutes);
app.route("/api/auth", authRoutes);
app.route("/architect", architectRoutes);
app.route("/api/architect", architectRoutes);
app.route("/business", businessRoutes);
app.route("/api/business", businessRoutes);
// [DISABLED] HubSpot CRM routes
// app.route("/crm", crmRoutes);
// app.route("/api/crm", crmRoutes);
app.route("/integrations", integrationsRoutes);
app.route("/api/integrations", integrationsRoutes);
app.route("/mail", mailRoutes);
app.route("/api/mail", mailRoutes);
app.route("/admin", adminRoutes);
app.route("/api/admin", adminRoutes);
app.route("/payments", paymentRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/setup", setupRoutes);
app.route("/api/setup", setupRoutes);
app.route("/contact", contactRoutes);
app.route("/api/contact", contactRoutes);
// Public "Need Help" support submissions from the landing page (no session).
app.route("/support", supportRoutes);
app.route("/api/support", supportRoutes);
app.route("/countries", countryRoutes);
app.route("/api/countries", countryRoutes);
app.route("/memory", memoryRoutes);
app.route("/api/memory", memoryRoutes);
// SES/SNS webhooks — public by design (no session), guarded by topic ARN match.
app.route("/email", emailRoutes);
app.route("/api/email", emailRoutes);
app.route("/legal", legalRoutes);
app.route("/api/legal", legalRoutes);
// Public customer-facing booking/service-request endpoints (slug-addressed).
app.route("/public", publicBookingRoutes);
app.route("/api/public", publicBookingRoutes);
// Published agent pages (triven.ai/a/<slug>) — public by design; /manage/* guarded per-route.
app.route("/agent-pages", agentPagesRoutes);
app.route("/api/agent-pages", agentPagesRoutes);
app.route("/chatbot", chatbotRoutes);
app.route("/api/chatbot", chatbotRoutes);

// Meta WhatsApp Cloud API — public webhook (verify challenge + inbound events).
// Meta dashboard Callback URL: https://triven.ai/api/webhook/meta/whatsapp
app.get("/webhook/meta/whatsapp", verifyWhatsAppWebhookChallenge);
app.post("/webhook/meta/whatsapp", handleWhatsAppWebhookPost);
app.get("/api/webhook/meta/whatsapp", verifyWhatsAppWebhookChallenge);
app.post("/api/webhook/meta/whatsapp", handleWhatsAppWebhookPost);

// Calendly — public webhook (signature verified with per-connection signing key).
// OAuth redirect URI must be /architect/connectors/calendly/callback (NOT this path).
// Production webhook: https://triven.ai/api/webhook/calendly
app.get("/webhook/calendly", handleCalendlyOAuthMisdirectGet);
app.post("/webhook/calendly", handleCalendlyWebhookPost);
// Local/dev safety: same handlers if someone registered an /api-prefixed URL.
app.get("/api/webhook/calendly", handleCalendlyOAuthMisdirectGet);
app.post("/api/webhook/calendly", handleCalendlyWebhookPost);

// [DISABLED] HubSpot CRM public webhook.
// app.post("/webhook/hubspot", handleHubSpotWebhookPost);
// app.post("/api/webhook/hubspot", handleHubSpotWebhookPost);

app.notFound((c) => {
  console.warn(`[app] Route not found: ${c.req.method} ${c.req.url}`);
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
