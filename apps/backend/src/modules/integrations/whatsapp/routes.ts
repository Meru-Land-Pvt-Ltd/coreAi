import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../../config/env";
import { requireAuth } from "../../../middleware/auth";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { apiErrorStatus } from "../../../lib/error-utils";
import { resolvePrimaryBusinessId } from "../../business/primary-business";
import { normalizeWhatsAppRecipient } from "../../whatsapp/utils";
import {
  buildWhatsAppEmbeddedSignupLaunchUrl,
  exchangeWhatsAppEmbeddedSignupCodeForToken
} from "../../whatsapp/oauth";
import { WhatsAppService } from "../../whatsapp/service";
import type { WhatsAppServiceError } from "../../whatsapp/types";
import { renameWhatsAppConnectionSchema } from "../../whatsapp/validators";

export const whatsappIntegrationRoutes = new Hono();

const startSchema = z.object({
  phoneNumber: z.string().min(1)
    .regex(/^\+[1-9]\d{1,14}$/, "INVALID_PHONE_NUMBER")
});

const callbackSchema = z.object({
  code: z.string().min(1, "AUTH_CODE_REQUIRED"),
  phoneNumberId: z.string().min(1, "PHONE_NUMBER_ID_REQUIRED"),
  wabaId: z.string().min(1, "WABA_ID_REQUIRED"),
  phoneNumber: z.string().min(1, "PHONE_NUMBER_REQUIRED")
});

function handleWhatsAppError(c: Parameters<typeof errorResponse>[0], error: unknown, fallbackCode: string) {
  if (error instanceof z.ZodError) {
    return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION_ERROR");
  }
  const maybeWhatsAppError = error as WhatsAppServiceError & { status?: number; errorCode?: string };
  if (maybeWhatsAppError && typeof maybeWhatsAppError === "object" && "errorCode" in maybeWhatsAppError) {
    return errorResponse(
      c,
      maybeWhatsAppError.message ?? "WhatsApp request failed",
      apiErrorStatus(maybeWhatsAppError.status ?? 500),
      maybeWhatsAppError.errorCode ?? fallbackCode
    );
  }
  return errorResponse(c, error instanceof Error ? error.message : "WhatsApp request failed", 500, fallbackCode);
}

whatsappIntegrationRoutes.post("/start", requireAuth, async (c) => {
  const authUser = c.get("authUser") as { id: string };
  try {
    const body = startSchema.parse(await c.req.json().catch(() => ({})));
    const normalized = normalizeWhatsAppRecipient(body.phoneNumber);
    const state = `${authUser.id}:${normalized}:${Date.now()}`;
    const redirectUrl = buildWhatsAppEmbeddedSignupLaunchUrl({
      phoneNumber: normalized,
      state
    });
    return successResponse(c, { redirectUrl }, "Embedded signup started");
  } catch (error) {
    const zodError = error instanceof z.ZodError ? error : null;
    if (zodError) {
      return errorResponse(c, zodError.issues[0]?.message ?? "Invalid input", 422, "INVALID_PHONE_NUMBER");
    }
    return errorResponse(c, error instanceof Error ? error.message : "Failed to start WhatsApp signup", 500, "WHATSAPP_START_FAILED");
  }
});

whatsappIntegrationRoutes.get("/callback", requireAuth, async (c) => {
  const authUser = c.get("authUser") as { id: string };
  try {
    const params = new URL(c.req.url).searchParams;
    const parsed = callbackSchema.parse({
      code: params.get("code") ?? "",
      phoneNumberId: params.get("phoneNumberId") ?? "",
      wabaId: params.get("wabaId") ?? "",
      phoneNumber: params.get("phoneNumber") ?? ""
    });

    if (!env.META_WHATSAPP_APP_ID || !env.META_WHATSAPP_APP_SECRET) {
      return errorResponse(c, "Meta credentials are not configured.", 500, "MISSING_META_CREDENTIALS");
    }

    const accessToken = await exchangeWhatsAppEmbeddedSignupCodeForToken(parsed.code);
    const businessId = await resolvePrimaryBusinessId(authUser.id).catch(() => null);

    const connection = await WhatsAppService.connect(authUser.id, {
      accessToken,
      phoneNumberId: parsed.phoneNumberId,
      phoneNumber: parsed.phoneNumber,
      businessAccountId: parsed.wabaId,
      displayName: "Sales WhatsApp",
      webhookVerifyToken: env.META_WHATSAPP_VERIFY_TOKEN ?? undefined,
      businessId
    });

    return successResponse(c, { connection }, "WhatsApp connected");
  } catch (error) {
    return handleWhatsAppError(c, error, "WHATSAPP_ONBOARDING_FAILED");
  }
});

/** Shared rename — works for Architect and Business owners (auth user owns the connection). */
whatsappIntegrationRoutes.patch("/connections/:id", requireAuth, async (c) => {
  const authUser = c.get("authUser") as { id: string };
  const connectionId = c.req.param("id");
  if (!connectionId) {
    return errorResponse(c, "Connection id is required", 400, "CONNECTION_ID_REQUIRED");
  }
  try {
    const body = renameWhatsAppConnectionSchema.parse(await c.req.json().catch(() => ({})));
    const connection = await WhatsAppService.rename(authUser.id, connectionId, body.displayName);
    return successResponse(c, { connection }, "Connection renamed");
  } catch (error) {
    return handleWhatsAppError(c, error, "WHATSAPP_RENAME_FAILED");
  }
});
