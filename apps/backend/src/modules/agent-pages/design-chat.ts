import type { Hono } from "hono";
import type { Prisma, PublishedAgentPage } from "@prisma/client";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  MISSING_LLM_CREDENTIALS_MESSAGE,
  resolveConfiguredLlmProvider
} from "../ai-provider-engine/llm-credentials";
import {
  recordLlmProviderFailure,
  recordLlmProviderSuccess
} from "../ai-provider-engine/llm-health";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest, AIMessage } from "../ai-provider-engine/types";
import { getDesignBrainRules } from "../admin/design-brain-rules";
import {
  DESIGN_DEFAULTS,
  designConfigSchema,
  resolveDesign,
  type DesignConfig
} from "./design";
import { ensureDraftAgentListingAndPage, type AgentPageTemplate } from "./slug";

/**
 * Design Brain chat: the architect types natural language, the model answers
 * with a strictly-validated DesignPatch. The model can only turn the dials in
 * `designConfigSchema` plus the four content columns — nothing else it says
 * ever reaches the page. Every byte of model output passes through the zod
 * gate below; on invalid output we retry once with the validation error, then
 * fall back to a friendly "couldn't apply" reply with an empty patch.
 *
 * LLM entry: the exact path ai.llm_call uses in the workflow runner —
 * resolveConfiguredLlmProvider (fallback chain) into
 * getProviderEngine().executeWithProvider — reused directly, no new client.
 */

/** Contract default; resolveConfiguredLlmProvider falls back from here. */
export const DESIGN_CHAT_PREFERRED_PROVIDER = "gemini";

/** Graceful reply when the model never produces a valid patch. */
export const DESIGN_CHAT_FALLBACK_REPLY =
  "I couldn't apply that one — try asking for colors, theme, layout, or wording changes.";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * The one gate between the LLM and the page. z.object strips unknown keys, so
 * an inventive model can add whatever it likes — only these fields survive.
 * Invalid values on known keys fail validation (triggering the single retry)
 * rather than being silently coerced.
 */
export const designPatchSchema = z.object({
  reply: z
    .string()
    .trim()
    .min(1, "reply must not be empty")
    .max(200, "reply must be 200 characters or fewer"),
  patch: z.object({
    // The five dials, each optional — same enums as the stored DesignConfig.
    ...designConfigSchema.partial().shape,
    // Content columns (existing PublishedAgentPage fields stay authoritative).
    accentColor: z
      .string()
      .regex(HEX_COLOR, "accentColor must be a hex color like #16a34a")
      .optional(),
    headline: z
      .string()
      .trim()
      .max(120, "headline must be 120 characters or fewer")
      .nullable()
      .transform((value) => (value === "" ? null : value))
      .optional(),
    welcomeMessage: z
      .string()
      .trim()
      .max(500, "welcomeMessage must be 500 characters or fewer")
      .nullable()
      .transform((value) => (value === "" ? null : value))
      .optional(),
    suggestedPrompts: z
      .array(z.string().trim().max(80, "each suggested prompt must be 80 characters or fewer"))
      .max(4, "up to 4 suggested prompts are allowed")
      .transform((prompts) => prompts.filter((prompt) => prompt.length > 0))
      .optional()
  })
});

export type DesignPatch = z.infer<typeof designPatchSchema>;

export const designChatBodySchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1, "Tell me what to change first")
    .max(500, "Instructions must be 500 characters or fewer"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // Bounded so a replayed conversation can never balloon the prompt.
        content: z.string().trim().min(1).max(2000)
      })
    )
    .max(10, "History is capped at the last 10 messages")
    .optional()
});

const DIAL_KEYS = Object.keys(designConfigSchema.shape) as (keyof DesignConfig)[];

/** Same public page shape as the manage routes (kept local to avoid a module cycle). */
function serializeAgentPage(page: PublishedAgentPage) {
  return {
    slug: page.slug,
    template: page.template as AgentPageTemplate,
    headline: page.headline,
    welcomeMessage: page.welcomeMessage,
    suggestedPrompts: page.suggestedPrompts,
    accentColor: page.accentColor,
    status: page.status
  };
}

type PageContent = {
  accentColor: string | null;
  headline: string | null;
  welcomeMessage: string | null;
  suggestedPrompts: string[];
};

export function buildDesignChatSystemPrompt(
  design: DesignConfig,
  content: PageContent,
  houseRules = ""
): string {
  const rules = houseRules.trim();
  return [
    // The admin-editable constitution (Admin → Design Brain rules) leads the
    // prompt so it outranks everything else. Empty rules add nothing.
    ...(rules ? [`HOUSE RULES you must always obey:\n${rules}`, ""] : []),
    "You are the Design Brain for a published AI agent page. An architect chats with you in plain language; you adjust the page's look by outputting a JSON patch. You can ONLY turn the dials listed below — you never write code, CSS, or invent new options.",
    "",
    "DIALS (the only design keys you may set, with every allowed value):",
    `- theme: "light" | "dark" | "warm" (page-wide color mood; default "${DESIGN_DEFAULTS.theme}")`,
    `- composerPosition: "center" | "bottom" ("center" = message box starts centered like ChatGPT and docks after the first message; "bottom" = always pinned at the bottom like Claude; default "${DESIGN_DEFAULTS.composerPosition}")`,
    `- density: "cozy" | "compact" (spacing scale; default "${DESIGN_DEFAULTS.density}")`,
    `- bubbleStyle: "bubbles" | "flat" (chat bubbles vs a flat editorial thread; default "${DESIGN_DEFAULTS.bubbleStyle}")`,
    `- showHistorySidebar: true | false (this-session conversation list on wide screens; default ${DESIGN_DEFAULTS.showHistorySidebar})`,
    "",
    "CONTENT KEYS (also allowed in the patch):",
    '- accentColor: 6-digit hex string like "#16a34a" (translate color names the architect uses into a tasteful hex)',
    "- headline: string, 120 characters max, or null to clear it",
    "- welcomeMessage: string, 500 characters max, or null to clear it",
    "- suggestedPrompts: array of up to 4 strings, each 80 characters max",
    "",
    `CURRENT DESIGN: ${JSON.stringify(design)}`,
    `CURRENT CONTENT: ${JSON.stringify(content)}`,
    "",
    "OUTPUT RULES:",
    '- Output ONLY a single JSON object matching exactly: { "reply": string, "patch": { ...allowed keys only... } }. No markdown, no code fences, no commentary before or after.',
    "- Include in patch only the keys the architect asked to change.",
    "- reply: a short, warm confirmation of what you changed — 200 characters max, plain everyday words, no technical jargon. Reply in the same language the architect wrote in.",
    '- If the request is impossible with these dials, set "patch" to {} and use "reply" to kindly explain what IS possible.',
    "- Never invent keys or values outside the lists above. The page must always stay mobile-friendly — the dials guarantee that, so never try to work around them."
  ].join("\n");
}

/**
 * Model output -> raw JSON object. Tolerates markdown fences and prose around
 * the object (brace-balanced scan, string-aware). Null when no object parses.
 */
export function extractDesignChatJson(text: string | null | undefined): unknown | null {
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type GateResult = { patch: DesignPatch; error: null } | { patch: null; error: string };

/** The zod gate: everything the model says goes through here or nowhere. */
function gateModelOutput(structuredOutput: unknown, text: string | null): GateResult {
  const raw =
    structuredOutput && typeof structuredOutput === "object" && !Array.isArray(structuredOutput)
      ? structuredOutput
      : extractDesignChatJson(text);

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { patch: null, error: 'No JSON object found. Output exactly { "reply": string, "patch": { ... } }.' };
  }

  const check = designPatchSchema.safeParse(raw);
  if (!check.success) {
    const issues = check.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { patch: null, error: issues };
  }
  return { patch: check.data, error: null };
}

export function registerAgentPageDesignChatRoute(routes: Hono) {
  routes.post(
    "/manage/:workflowId/design-chat",
    requireAuth,
    requireRole(["ARCHITECT"]),
    async (c) => {
      const authUser = c.get("authUser");
      const workflowId = c.req.param("workflowId");

      // Ownership: same idiom as the other manage routes. name/workflowJson
      // ride along so a listing-less draft can be bootstrapped below.
      const workflow = await prisma.workflowDefinition.findFirst({
        where: { id: workflowId, architectUserId: authUser.id },
        select: { id: true, name: true, architectUserId: true, workflowJson: true }
      });
      if (!workflow) {
        return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
      }

      let input: z.infer<typeof designChatBodySchema>;
      try {
        input = designChatBodySchema.parse(await c.req.json().catch(() => ({})));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return errorResponse(c, error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
        }
        throw error;
      }

      // Draft workflows are first-class: no page yet means we bootstrap the
      // DRAFT listing + page on the spot, so the architect can style the page
      // long before publishing. Only a missing/unowned workflow 404s above.
      let page = await prisma.publishedAgentPage.findFirst({ where: { workflowId } });
      if (!page) {
        page = await ensureDraftAgentListingAndPage({
          id: workflow.id,
          name: workflow.name,
          architectUserId: workflow.architectUserId,
          workflowJson: workflow.workflowJson
        });
      }

      const currentDesign = resolveDesign(page.designJson);

      const resolved = resolveConfiguredLlmProvider(DESIGN_CHAT_PREFERRED_PROVIDER);
      if (!resolved) {
        return errorResponse(c, MISSING_LLM_CREDENTIALS_MESSAGE, 503, "LLM_NOT_CONFIGURED");
      }

      // Cached ~60s and never throws — an unreachable database means no extra
      // rules, never a failed styling reply.
      const houseRules = await getDesignBrainRules();

      const systemPrompt = buildDesignChatSystemPrompt(
        currentDesign,
        {
          accentColor: page.accentColor,
          headline: page.headline,
          welcomeMessage: page.welcomeMessage,
          suggestedPrompts: page.suggestedPrompts
        },
        houseRules
      );

      const conversationHistory: AIMessage[] = (input.history ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content
      }));

      // Grows only on retry: [instruction] -> [instruction, bad output, feedback].
      const messages: AIMessage[] = [{ role: "user", content: input.instruction }];

      let validated: DesignPatch | null = null;

      for (let attempt = 0; attempt < 2 && !validated; attempt++) {
        const request: AIExecuteRequest = {
          capability: "llm",
          systemPrompt,
          conversationHistory,
          messages: [...messages],
          temperature: 0.2,
          maxTokens: 400,
          outputFormat: "json",
          task: "agent-page-design-chat"
        };

        let response;
        try {
          response = await getProviderEngine().executeWithProvider(resolved.providerId, request);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordLlmProviderFailure(resolved.providerId, message);
          console.error("[design-chat] LLM call failed", { workflowId, provider: resolved.providerId, message });
          break; // A transport/provider failure won't be fixed by JSON feedback.
        }

        if (response.status === "error") {
          recordLlmProviderFailure(resolved.providerId, response.error);
          console.error("[design-chat] LLM returned error", {
            workflowId,
            provider: resolved.providerId,
            error: response.error
          });
          break;
        }
        recordLlmProviderSuccess(resolved.providerId);

        const gate = gateModelOutput(response.structuredOutput, response.text);
        if (gate.patch) {
          validated = gate.patch;
          break;
        }

        // Single retry: feed the exact validation error back to the model.
        messages.push(
          { role: "assistant", content: response.text ?? "" },
          {
            role: "user",
            content: `Your previous output was invalid: ${gate.error} Respond again with ONLY the corrected JSON object — no markdown fences, no extra keys.`
          }
        );
      }

      if (!validated) {
        // Graceful fallback: nothing changes, the architect gets a kind nudge.
        return successResponse(c, {
          reply: DESIGN_CHAT_FALLBACK_REPLY,
          patch: {},
          design: currentDesign,
          page: serializeAgentPage(page)
        });
      }

      const { reply, patch } = validated;

      const designDials: Partial<DesignConfig> = {};
      for (const key of DIAL_KEYS) {
        if (patch[key] !== undefined) {
          (designDials as Record<string, unknown>)[key] = patch[key];
        }
      }

      const columnData: Prisma.PublishedAgentPageUpdateInput = {};
      if (patch.accentColor !== undefined) columnData.accentColor = patch.accentColor;
      if (patch.headline !== undefined) columnData.headline = patch.headline;
      if (patch.welcomeMessage !== undefined) columnData.welcomeMessage = patch.welcomeMessage;
      if (patch.suggestedPrompts !== undefined) columnData.suggestedPrompts = patch.suggestedPrompts;

      const hasDialChange = Object.keys(designDials).length > 0;
      const hasColumnChange = Object.keys(columnData).length > 0;

      let updatedPage = page;
      if (hasDialChange || hasColumnChange) {
        // One atomic update: full merged design + any content columns together.
        const mergedDesign: DesignConfig = { ...currentDesign, ...designDials };
        updatedPage = await prisma.publishedAgentPage.update({
          where: { id: page.id },
          data: {
            ...(hasDialChange ? { designJson: mergedDesign as unknown as Prisma.InputJsonValue } : {}),
            ...columnData
          }
        });
      }

      return successResponse(c, {
        reply,
        patch,
        design: resolveDesign(updatedPage.designJson),
        page: serializeAgentPage(updatedPage)
      });
    }
  );
}
