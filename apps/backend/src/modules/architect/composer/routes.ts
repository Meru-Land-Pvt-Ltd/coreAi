/**
 * BUILD IT FOR ME — the endpoint behind the composer.
 *
 * Streamed rather than answered in one go, because this takes tens of seconds
 * and an architect staring at a spinner assumes it has hung. They see each step
 * as it happens: reading what you asked for, looking at every step available,
 * wiring them together, checking every wire lands.
 *
 * The stream also carries the honest ending. When three attempts still do not
 * produce a plan that holds, the last message says so and the canvas is left
 * exactly as it was — a half-built orchestration is worse than none, because it
 * looks finished.
 */

import { Hono } from "hono";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { defaultHiddenArchitectNodeTypes, hiddenArchitectNodeTypes } from "@coreai/shared";
import { prisma } from "../../../lib/prisma";
import { composeOrchestration } from "./compose";
import { planToCanvas } from "./to-canvas";
import { repairCanvas } from "./repair";

export const composerRoutes = new Hono();

const askSchema = z.object({
  want: z.string().min(8, "Tell it a little more about what you want.").max(4000)
});

/** Nodes an admin has switched off. The composer must not place one. */
async function hiddenTypes(): Promise<string[]> {
  try {
    const rows = await prisma.architectNodeVisibility.findMany({
      select: { nodeType: true, visible: true, label: true, group: true }
    });

    /*
     * A Map, keyed by node type — which is what this function has always taken.
     *
     * It used to be handed an ARRAY, with `as never` to stop the type checker
     * saying so. An array looked up by "action.send_sms" returns nothing, so
     * every admin switch was silently thrown away and the composer built from
     * the catalogue defaults no matter what anybody set on the Nodes page.
     * Proven by A/B: hide a node, and the composer still offered it.
     */
    return hiddenArchitectNodeTypes(
      new Map(
        rows.map((row) => [
          row.nodeType,
          { visible: row.visible, label: row.label, group: row.group }
        ])
      )
    );
  } catch {
    return defaultHiddenArchitectNodeTypes();
  }
}

composerRoutes.post("/", async (c) => {
  const authUser = c.get("authUser");
  const parsed = askSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Tell it what you want to build.",
      422,
      "VALIDATION_ERROR"
    );
  }

  const hidden = await hiddenTypes();

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) });

    try {
      const result = await composeOrchestration({
        architectUserId: authUser.id,
        want: parsed.data.want,
        hiddenNodeTypes: hidden,
        onProgress: (progress) => {
          void send("progress", progress);
        }
      });

      if (!result.ok) {
        await send("failed", { message: result.message, problems: result.problems ?? [] });
        return;
      }

      const canvas = planToCanvas(result.plan);
      await send("done", {
        summary: result.plan.summary,
        asksTheBusiness: result.plan.asksTheBusiness ?? [],
        attempts: result.attempts,
        nodes: canvas.nodes,
        edges: canvas.edges
      });
    } catch (error) {
      console.error("[composer] failed", error);
      await send("failed", {
        message: "Something went wrong while building. Nothing was changed on your canvas.",
        problems: []
      });
    }
  });
});

/**
 * Fix it for me.
 *
 * Answered in one go rather than streamed: a repair is a few seconds, and a
 * progress list for something that finishes before it can be read is noise.
 *
 * The canvas is sent as it stands, unsaved, and comes back changed — nothing is
 * written to the architect's workflow here. What they get is a proposal they
 * can see on their own screen and undo like any other edit.
 */
composerRoutes.post("/repair", async (c) => {
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as {
    nodes?: Array<{ id: string; position?: { x: number; y: number }; data?: Record<string, unknown> }>;
    edges?: Array<{ id?: string; source: string; target: string }>;
  };

  if (!body.nodes?.length) {
    return errorResponse(c, "There is nothing on the canvas to fix.", 422, "VALIDATION_ERROR");
  }

  const result = await repairCanvas({
    architectUserId: authUser.id,
    nodes: body.nodes,
    edges: body.edges ?? [],
    hiddenNodeTypes: await hiddenTypes()
  });

  if (!result.ok) {
    return successResponse(c, { fixed: false, message: result.message, remaining: result.remaining ?? [] });
  }

  return successResponse(c, {
    fixed: true,
    summary: result.summary,
    nodes: result.nodes,
    edges: result.edges,
    fixedProblems: result.fixed,
    remaining: result.remaining
  });
});
