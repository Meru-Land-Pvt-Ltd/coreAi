import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { adminRoutes } from "./modules/admin/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { marketplaceRoutes } from "./modules/marketplace/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { workflowRoutes } from "./modules/workflows/routes.js";
import { connectorRoutes } from "./modules/connectors/routes.js";
import { llmRoutes } from "./modules/llm/routes.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { approvalRoutes } from "./modules/approvals/routes.js";
import { logRoutes } from "./modules/logs/routes.js";
import { userRoutes } from "./modules/users/routes.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "coreai-backend" }));

app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/marketplace", marketplaceRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/workflows", workflowRoutes);
app.route("/api/connectors", connectorRoutes);
app.route("/api/llm", llmRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/approvals", approvalRoutes);
app.route("/api/logs", logRoutes);
