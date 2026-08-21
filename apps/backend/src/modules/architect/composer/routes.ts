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
import { errorResponse } from "../../../lib/api-response";
import { defaultHiddenArchitectNodeTypes, hiddenArchitectNodeTypes } from "@coreai/shared";
import { prisma } from "../../../lib/prisma";
import { composeOrchestration } from "./compose";
import { planToCanvas } from "./to-canvas";

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
    return hiddenArchitectNodeTypes(
      rows.map((row) => ({
        type: row.nodeType,
        visible: row.visible,
        label: row.label,
        group: row.group
      })) as never
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
