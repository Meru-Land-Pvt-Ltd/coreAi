import { Hono } from "hono";
import { whatsappIntegrationRoutes } from "./whatsapp/routes";

export const integrationsRoutes = new Hono();

integrationsRoutes.route("/whatsapp", whatsappIntegrationRoutes);

