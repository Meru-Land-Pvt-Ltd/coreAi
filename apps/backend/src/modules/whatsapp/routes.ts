import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { apiErrorStatus } from "../../lib/error-utils";
import { WhatsAppService } from "./service";
import { WhatsAppServiceError } from "./types";
import {
  connectWhatsAppSchema,
  renameWhatsAppConnectionSchema,
  sendWhatsAppMediaSchema,
  sendWhatsAppTemplateSchema,
  sendWhatsAppTextSchema
} from "./validators";

export const whatsappRoutes = new Hono();

function handleServiceError(c: Parameters<typeof errorResponse>[0], error: unknown) {
  if (error instanceof WhatsAppServiceError) {
    return errorResponse(c, error.message, apiErrorStatus(error.status, 500), error.errorCode);
  }
  if (error instanceof z.ZodError) {
    return errorResponse(c, error.issues[0]?.message ?? "Validation failed", 422, "VALIDATION_ERROR");
  }
  console.error("[whatsapp] route error", error);
  return errorResponse(c, "WhatsApp request failed", 500, "WHATSAPP_FAILED");
}

whatsappRoutes.get("/connections", async (c) => {
  const authUser = c.get("authUser");
  const view = c.req.query("view");
  try {
    if (view === "owner") {
      const connections = await WhatsAppService.listConnectionsOwnerView(authUser.id);
      return successResponse(c, { connections });
    }
    const connections = await WhatsAppService.listConnections(authUser.id);
    return successResponse(c, { connections });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/connections", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = connectWhatsAppSchema.parse(await c.req.json().catch(() => ({})));
    const connection = await WhatsAppService.connect(authUser.id, body);
    return successResponse(c, { connection }, "WhatsApp connected");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.get("/connections/:id", async (c) => {
  const authUser = c.get("authUser");
  try {
    const connection = await WhatsAppService.getConnection(authUser.id, c.req.param("id"));
    return successResponse(c, { connection });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.patch("/connections/:id", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = renameWhatsAppConnectionSchema.parse(await c.req.json().catch(() => ({})));
    const connection = await WhatsAppService.rename(authUser.id, c.req.param("id"), body.displayName);
    return successResponse(c, { connection }, "Connection renamed");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.delete("/connections/:id", async (c) => {
  const authUser = c.get("authUser");
  try {
    await WhatsAppService.remove(authUser.id, c.req.param("id"));
    return successResponse(c, { deleted: true }, "WhatsApp disconnected");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/connections/:id/test", async (c) => {
  const authUser = c.get("authUser");
  try {
    const result = await WhatsAppService.testConnection(authUser.id, c.req.param("id"));
    return successResponse(c, { result }, "Connection OK");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/connections/:id/refresh", async (c) => {
  const authUser = c.get("authUser");
  try {
    const connection = await WhatsAppService.refreshConnection(authUser.id, c.req.param("id"));
    return successResponse(c, { connection }, "Connection refreshed");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/connections/:id/disconnect", async (c) => {
  const authUser = c.get("authUser");
  try {
    const connection = await WhatsAppService.disconnect(authUser.id, c.req.param("id"));
    return successResponse(c, { connection }, "WhatsApp disconnected");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/messages/send", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = sendWhatsAppTextSchema.parse(await c.req.json().catch(() => ({})));
    const result = await WhatsAppService.sendText({ ...body, architectUserId: authUser.id });
    return successResponse(c, { result }, "Message sent");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/messages/media", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = sendWhatsAppMediaSchema.parse(await c.req.json().catch(() => ({})));
    const result = await WhatsAppService.sendMedia({ ...body, architectUserId: authUser.id });
    return successResponse(c, { result }, "Media message sent");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

whatsappRoutes.post("/messages/template", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = sendWhatsAppTemplateSchema.parse(await c.req.json().catch(() => ({})));
    const result = await WhatsAppService.sendTemplate({ ...body, architectUserId: authUser.id });
    return successResponse(c, { result }, "Template message sent");
  } catch (error) {
    return handleServiceError(c, error);
  }
});
