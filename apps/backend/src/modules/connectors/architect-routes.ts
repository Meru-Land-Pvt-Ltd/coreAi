/**
 * THE NODE FRAME, FROM THE ARCHITECT'S SIDE.
 *
 * Four things an architect can do with a frame they are building: see what they
 * have, save a description and be told what is still wrong with it, try it
 * against the real service before anyone depends on it, and throw it away.
 *
 * Saving is deliberately never refused. A half-finished description is stored
 * as a draft with its problems attached, so the architect keeps their work and
 * sees a list of what is left — rather than losing twenty minutes of typing to
 * a validation error.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { NodeFrameDeclaration } from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import { runConnector } from "./engine";
import { selfBuildFrame } from "./self-build";
import {
  architectFrameById,
  deleteArchitectFrame,
  frameFromDeclaration,
  listArchitectFrames,
  problemsWith,
  saveArchitectFrame
} from "./architect-frames";

export const architectFrameRoutes = new Hono();

/**
 * The shape is checked loosely on purpose.
 *
 * Everything that actually matters — a reachable address, a key it is allowed
 * to read, an output it cannot lie about — is checked by `problemsWith`, in
 * words the architect can act on. A strict schema here would reject the same
 * things with a message about a missing property, which helps nobody.
 */
const saveSchema = z.object({
  declaration: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.string()).optional()
});

architectFrameRoutes.get("/", async (c) => {
  const authUser = c.get("authUser");
  return successResponse(c, { frames: await listArchitectFrames(authUser.id) });
});

architectFrameRoutes.post("/", async (c) => {
  const authUser = c.get("authUser");
  const parsed = saveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, "Nothing was sent to save.", 422, "VALIDATION_ERROR");
  }

  const declaration = parsed.data.declaration as unknown as NodeFrameDeclaration;
  if (!declaration.id || typeof declaration.id !== "string") {
    return errorResponse(
      c,
      "Give this connection a short id, like \"acme.find_things\".",
      422,
      "VALIDATION_ERROR"
    );
  }

  const saved = await saveArchitectFrame({
    architectUserId: authUser.id,
    declaration,
    secrets: parsed.data.secrets
  });

  return successResponse(
    c,
    saved,
    saved.status === "READY"
      ? "Saved. It is in your toolkit now."
      : `Saved as a draft — ${saved.problems.length} thing${saved.problems.length === 1 ? "" : "s"} still to sort out.`
  );
});

/**
 * Check a description without saving it.
 *
 * What the form calls as the architect types, so the list of problems shrinks
 * in front of them instead of appearing all at once when they press save.
 */
architectFrameRoutes.post("/check", async (c) => {
  const parsed = saveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c, "Nothing was sent to check.", 422, "VALIDATION_ERROR");

  const declaration = parsed.data.declaration as unknown as NodeFrameDeclaration;
  const problems = declaration?.id ? problemsWith(declaration) : ["Give this connection a short id first."];
  return successResponse(c, { problems, ready: problems.length === 0 });
});

/**
 * Try it for real, once, against the actual service.
 *
 * This is the moment a description stops being a guess. It runs through the
 * same engine as everything else, so the answer the architect sees is the
 * answer a business would get — including the engine refusing it for a reason
 * they can read.
 */
/**
 * THE SELF-BUILDING FRAME. Name + goal + key → the platform Brain drafts the
 * declaration, the validator judges it, problems loop back, and a READ-only
 * draft with a key gets one honest rehearsal. The founder's fantasy, as a
 * route.
 */
architectFrameRoutes.post("/self-build", async (c) => {
  const authUser = c.get("authUser");
  const body = z
    .object({
      serviceName: z.string().trim().min(2).max(80),
      goal: z.string().trim().min(5).max(500),
      docsUrl: z.string().trim().url().max(400).optional(),
      apiKey: z.string().trim().min(1).max(500).optional()
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return errorResponse(c, "Say the service's name and what it should do.", 422, "VALIDATION_ERROR");
  }
  try {
    const result = await selfBuildFrame({ architectUserId: authUser.id, ...body.data });
    return successResponse(c, result, result.message);
  } catch (error) {
    console.error("[frames] self-build failed", error);
    return errorResponse(c, "The builder could not draft this service just now. Try once more.", 500, "SELF_BUILD_FAILED");
  }
});

architectFrameRoutes.post("/:frameId/try", async (c) => {
  const authUser = c.get("authUser");
  const frameId = c.req.param("frameId");

  const owned = (await listArchitectFrames(authUser.id)).find((entry) => entry.frameId === frameId);
  if (!owned?.declaration) return errorResponse(c, "No such connection.", 404, "NOT_FOUND");
  if (owned.status !== "READY") {
    return errorResponse(
      c,
      "Sort out the problems listed above before trying it — a run now would only repeat them.",
      409,
      "NOT_READY"
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const config = (body as { config?: Record<string, unknown> })?.config ?? {};

  const stored = await architectFrameById(frameId);
  const result = await runConnector({
    contract: stored?.frame ?? frameFromDeclaration(owned.declaration),
    businessId: `architect:${authUser.id}`,
    config: { ...(stored?.secrets ?? {}), ...config }
  });

  return successResponse(c, {
    ok: result.ok,
    code: result.code,
    message: result.message,
    outputs: result.outputs,
    logs: result.logs
  });
});

architectFrameRoutes.delete("/:frameId", async (c) => {
  const authUser = c.get("authUser");
  await deleteArchitectFrame(authUser.id, c.req.param("frameId"));
  return successResponse(c, { deleted: true }, "Removed from your toolkit.");
});
