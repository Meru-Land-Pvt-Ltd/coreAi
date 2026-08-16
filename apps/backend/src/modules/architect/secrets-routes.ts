/**
 * "My Keys" — architect-facing routes for the encrypted secret locker.
 *
 * These endpoints are mounted UNDER the architect router's auth guards
 * (`requireAuth` + `requireRole(["ARCHITECT"])`), exactly like the settings
 * sub-router, so every handler can trust `c.get("authUser")` is a signed-in
 * architect. A defensive authUser check stays in each handler as belt-and-braces
 * (and to make the routes testable in isolation).
 *
 * Contract:
 *   GET    /architect/secrets      → list the caller's keys, values MASKED
 *   POST   /architect/secrets      → add-or-replace a key { name, value }
 *   DELETE /architect/secrets/:id  → remove one of the caller's keys
 *
 * Values are NEVER returned, NEVER logged, and NEVER put in the audit trail —
 * the underlying service masks list/create responses and only decrypts at call
 * time inside the API Call node.
 */
import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { apiErrorStatus } from "../../lib/error-utils";
import { AppError } from "../../lib/app-error";
import {
  createArchitectSecret,
  deleteArchitectSecret,
  listArchitectSecrets,
  SECRET_NAME_MAX_LENGTH,
  SECRET_VALUE_MAX_LENGTH
} from "./architect-secrets";

export const architectSecretsRoutes = new Hono();

/**
 * Write a value-free audit line for a locker mutation. We record WHO did WHAT to
 * WHICH key — never the secret value, never the encrypted blob. Best-effort:
 * a logging failure must never break the request.
 */
function auditSecretAction(input: {
  architectUserId: string;
  action: "SECRET_ADDED" | "SECRET_DELETED";
  secretId?: string | null;
  secretName?: string | null;
}): void {
  try {
    console.info("[architect-secrets-audit]", {
      action: input.action,
      architectUserId: input.architectUserId,
      secretId: input.secretId ?? null,
      // The human label is safe to log; the VALUE is not and is never passed in.
      secretName: input.secretName ?? null,
      at: new Date().toISOString()
    });
  } catch {
    /* never let auditing crash a request */
  }
}

const createSecretSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give this key a name so you can reference it later.")
    .max(SECRET_NAME_MAX_LENGTH, `Key names must be ${SECRET_NAME_MAX_LENGTH} characters or fewer.`),
  value: z
    .string()
    .trim()
    .min(1, "Paste the key value before saving.")
    .max(SECRET_VALUE_MAX_LENGTH, "That value is too long to be an API key.")
});

/** List the caller's stored keys — masked, never decrypted. */
architectSecretsRoutes.get("/", async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return errorResponse(c, "Unauthorized", 401, "UNAUTHORIZED");
  }

  try {
    const secrets = await listArchitectSecrets(authUser.id);
    return successResponse(c, { secrets }, "Keys loaded");
  } catch (error) {
    console.error("[architect-secrets] list failed", error);
    return errorResponse(c, "Could not load your keys", 500, "SECRETS_LIST_FAILED");
  }
});

/** Add-or-replace a key. The value is encrypted at rest and never echoed back. */
architectSecretsRoutes.post("/", async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return errorResponse(c, "Unauthorized", 401, "UNAUTHORIZED");
  }

  try {
    const input = createSecretSchema.parse(await c.req.json());
    const secret = await createArchitectSecret(authUser.id, input.name, input.value);

    auditSecretAction({
      architectUserId: authUser.id,
      action: "SECRET_ADDED",
      secretId: secret.id,
      secretName: secret.name
    });

    return successResponse(c, { secret }, "Key saved", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid key", 422, "VALIDATION_ERROR");
    }
    if (error instanceof AppError) {
      return errorResponse(c, error.message, apiErrorStatus(error.statusCode, 422), error.code);
    }
    console.error("[architect-secrets] create failed", error);
    return errorResponse(c, "Could not save that key", 500, "SECRET_SAVE_FAILED");
  }
});

/** Delete one of the caller's keys. Owner-scoped — 404 if it is not theirs. */
architectSecretsRoutes.delete("/:id", async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return errorResponse(c, "Unauthorized", 401, "UNAUTHORIZED");
  }

  const id = c.req.param("id");
  if (!id) {
    return errorResponse(c, "Key id is required", 422, "SECRET_ID_REQUIRED");
  }

  try {
    const deleted = await deleteArchitectSecret(authUser.id, id);
    if (!deleted) {
      return errorResponse(c, "Key not found", 404, "SECRET_NOT_FOUND");
    }

    auditSecretAction({
      architectUserId: authUser.id,
      action: "SECRET_DELETED",
      secretId: id
    });

    return successResponse(c, { deleted: true }, "Key removed");
  } catch (error) {
    console.error("[architect-secrets] delete failed", error);
    return errorResponse(c, "Could not remove that key", 500, "SECRET_DELETE_FAILED");
  }
});
