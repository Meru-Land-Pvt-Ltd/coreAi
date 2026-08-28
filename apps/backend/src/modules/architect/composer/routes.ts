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
import { checkAgentGraph } from "../agent-check";
import { planToCanvas } from "./to-canvas";
import { repairCanvas } from "./repair";

export const composerRoutes = new Hono();

const askSchema = z.object({
  want: z.string().min(8, "Tell it a little more about what you want.").max(4000),
  /* THE BUILDER MUST NOT HAND OVER WORK IT HAS NEVER WATCHED RUN.
     The canvas the Builder is composing into. With it, the Builder runs what
     it just built and judges the answer before saying a word. Without it, it
     says plainly that it could not check itself — never silence, and never a
     claim it did not earn. */
  workflowId: z.string().trim().min(1).max(64).optional(),
  /* The Builder's questions and the architect's answers — a reply completes
     the build instead of restarting it. */
  conversation: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(10)
    .optional(),
  /* The seventh organ: the canvas as it stands, for edit asks. */
  existingPlan: z
    .object({
      nodes: z.array(z.object({ id: z.string(), type: z.string(), title: z.string().optional(), config: z.record(z.string(), z.unknown()).optional() })).max(60),
      edges: z.array(z.object({ from: z.string(), to: z.string(), when: z.string().optional() })).max(120)
    })
    .optional()
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
        ...(parsed.data.conversation ? { conversation: parsed.data.conversation } : {}),
        ...(parsed.data.existingPlan ? { existingPlan: parsed.data.existingPlan } : {}),
        hiddenNodeTypes: hidden,
        onProgress: (progress) => {
          void send("progress", progress);
        }
      });

      if (!result.ok) {
        /* THE THIRD ANSWER: the Builder is asking, proposal in hand. The
           panel shows it as a message; the architect's reply returns here
           with the conversation and completes the build. */
        if ("ask" in result) {
          await send("ask", result.ask);
          return;
        }
        await send("failed", { message: result.message, problems: result.problems ?? [] });
        return;
      }

      const canvas = planToCanvas(result.plan);

      /* THE BUILDER LOOKS AT THE AGENT IT BUILT (the founder's law).
         It already looks at the page it designs — runs it in a real browser,
         reads the picture, fixes, looks again. The agent itself was handed
         over blind: composed, wired, and never once run. So the first eyes on
         a built agent were always the architect's, which is the exact
         half-finish the looking loop exists to prevent.

         The same check the "Check my agent" button runs — the wires, then
         real test messages invented from the architect's own words, put
         through the real engine and judged against the purpose. What it finds
         rides back with the plan, and what it could NOT check it says out
         loud rather than passing in silence. */
      let checked: { lines: unknown[]; passed: number; failed: number; ran: boolean } | null = null;
      let couldNotCheck: string | null = null;

      if (parsed.data.workflowId) {
        void send("progress", { step: "Running what I just built, to see it work" });
        try {
          const report = await checkAgentGraph({
            userId: authUser.id,
            workflowId: parsed.data.workflowId,
            workflowJson: { nodes: canvas.nodes, edges: canvas.edges },
            purpose: parsed.data.want,
            name: result.plan.summary,
            /* THE FOUNDER'S MONEY RULE. The wires are checked for free on
               every build. Actually running the agent costs AI calls on his
               credit, so it happens only when an architect deliberately
               presses "Check my agent" — never automatically. */
            runTheAgent: false
          });
          /* IT MUST NEVER SAY IT RAN SOMETHING IT DID NOT RUN. Running the
             agent spends the founder's own credit, so an automatic check
             reads the wires only — and the panel was still printing "I ran
             it and 2 things are not right yet". The platform's first law,
             broken in the sentence I wrote for it. Whether it actually ran
             travels with the result now, so the words can be true. */
          checked = { lines: report.lines, passed: report.passed, failed: report.failed, ran: false };
        } catch (error) {
          console.error("[composer] could not run what it built", error);
          couldNotCheck = "I built it, but I could not run it to check my own work.";
        }
      } else {
        couldNotCheck = "I built it, but I could not run it here to check my own work.";
      }

      await send("done", {
        summary: result.plan.summary,
        asksTheBusiness: result.plan.asksTheBusiness ?? [],
        attempts: result.attempts,
        nodes: canvas.nodes,
        edges: canvas.edges,
        checked,
        couldNotCheck
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
