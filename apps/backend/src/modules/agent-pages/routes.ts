import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { runArchitectConversationTest } from "../architect/workflow-conversation-test";
import { runWorkflowTest } from "../architect/workflow-runner";
import { MarketplaceDemoError, startPublicMarketplaceDemoCall } from "../business/marketplace-demo";
import { deriveFaceBlueprint } from "./blueprint";
import { resolveDesign } from "./design";
import { registerAgentPageManageRoutes } from "./manage-routes";
import { agentPageRemainingToday, consumeAgentPageLimit, refundAgentPageUse } from "./rate-limit";
import { extractRunOutput } from "./run-output";
import type { AgentPageTemplate } from "./slug";

/**
 * Published agent pages (triven.ai/a/<slug>): the public hosted page for a
 * published agent plus the architect's manage endpoints.
 *
 * Public routes are registered first — no auth. The /manage/* routes are
 * guarded per-route with requireAuth + requireRole(["ARCHITECT"]).
 */
export const agentPagesRoutes = new Hono();

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

const PAGE_NOT_FOUND_MESSAGE = "This agent page is not available.";
const LIMIT_REACHED_MESSAGE = "This agent's free preview is done for today";
const CHAT_FAILED_MESSAGE = "This agent had trouble replying. Please try again.";
const RUN_FAILED_MESSAGE = "This agent had trouble responding. Please try again.";

const AGENT_PAGE_TEMPLATES: readonly AgentPageTemplate[] = ["chat", "voice", "media", "form"];

function normalizeTemplate(template: string): AgentPageTemplate {
  return (AGENT_PAGE_TEMPLATES as readonly string[]).includes(template)
    ? (template as AgentPageTemplate)
    : "chat";
}

/**
 * Client IP for rate limiting. Only proxy-set headers are trusted:
 * cf-connecting-ip (set by Cloudflare, never client-forwardable through it)
 * first, then the RIGHTMOST x-forwarded-for hop — the one appended by our own
 * proxy. The leftmost entries are client-controlled and would let a caller
 * rotate identities per request, so they are deliberately ignored here even
 * though older routes read them.
 */
function getClientIp(c: Context): string {
  const cloudflare = c.req.header("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  const forwarded = c.req.header("x-forwarded-for");
  const lastHop = forwarded?.split(",").at(-1)?.trim();
  return lastHop || c.req.header("x-real-ip")?.trim() || "127.0.0.1";
}

/** Public POST bodies are small JSON — reject anything oversized before parsing. */
const publicBodyLimit = bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) => errorResponse(c, "Request is too large.", 413, "PAYLOAD_TOO_LARGE")
});

const LIVE_PAGE_LISTING_SELECT = {
  id: true,
  name: true,
  tagline: true,
  shortDescription: true,
  iconUrl: true,
  category: true,
  pricingModel: true,
  priceCents: true,
  freeTrialEnabled: true,
  trialDays: true,
  status: true,
  architect: {
    select: {
      fullName: true,
      architectProfile: { select: { displayName: true, marketplacePhotoUrl: true } }
    }
  }
} as const;

/**
 * The page row + listing for a public slug, or null unless the page is LIVE
 * and its listing is APPROVED — every public endpoint 404s otherwise so
 * unpublished/suspended agents are indistinguishable from missing ones.
 */
async function findLiveAgentPage(slug: string) {
  const page = await prisma.publishedAgentPage.findUnique({
    where: { slug },
    include: { listing: { select: LIVE_PAGE_LISTING_SELECT } }
  });

  if (!page || page.status !== "LIVE" || page.listing?.status !== "APPROVED") return null;
  return page;
}

async function loadWorkflowJson(workflowId: string): Promise<unknown | null> {
  const workflow = await prisma.workflowDefinition.findUnique({
    where: { id: workflowId },
    select: { workflowJson: true }
  });
  return workflow ? workflow.workflowJson : null;
}

type LiveAgentPage = NonNullable<Awaited<ReturnType<typeof findLiveAgentPage>>>;

function toPublicPagePayload(page: LiveAgentPage) {
  return {
    slug: page.slug,
    template: normalizeTemplate(page.template),
    headline: page.headline,
    welcomeMessage: page.welcomeMessage,
    suggestedPrompts: page.suggestedPrompts,
    accentColor: page.accentColor,
    status: "LIVE" as const
  };
}

function toPublicArchitectPayload(
  architect: LiveAgentPage["listing"]["architect"] | null | undefined
): { displayName: string; photoUrl: string | null } | null {
  const displayName =
    architect?.architectProfile?.displayName?.trim() || architect?.fullName?.trim() || null;
  if (!displayName) return null;
  return { displayName, photoUrl: architect?.architectProfile?.marketplacePhotoUrl ?? null };
}

/**
 * Visitor session ids are always UUIDs (server-generated or echoed back) and
 * are namespaced per page before they reach the engine, so a visitor can never
 * collide with another page's sessions or with the architect's own builder
 * test sessions.
 */
function engineSessionId(slug: string, sessionId: string): string {
  return `page:${slug}:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Public — no auth (rate-limited where noted).
// ---------------------------------------------------------------------------

/** Public page payload: page config + listing + architect + limits. */
agentPagesRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  const page = await findLiveAgentPage(slug);
  if (!page) {
    return errorResponse(c, PAGE_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
  }

  const { listing } = page;
  // Read-only: viewing the page never consumes a demo allowance.
  const remainingToday = await agentPageRemainingToday(getClientIp(c), slug);

  // Non-null only when the graph contains product blocks — the page then
  // assembles its interface from those blocks instead of the default Face.
  // A missing workflow row degrades to null (default Face), never a 404:
  // the page itself is still live.
  const blueprint = deriveFaceBlueprint(await loadWorkflowJson(page.workflowId));

  return successResponse(c, {
    page: toPublicPagePayload(page),
    listing: {
      id: listing.id,
      name: listing.name,
      tagline: listing.tagline,
      shortDescription: listing.shortDescription,
      iconUrl: listing.iconUrl,
      category: listing.category,
      pricingModel: listing.pricingModel,
      priceCents: listing.priceCents,
      freeTrialEnabled: listing.freeTrialEnabled,
      trialDays: listing.trialDays
    },
    architect: toPublicArchitectPayload(listing.architect),
    limits: { remainingToday },
    blueprint,
    // Full Design Brain config (defaults filled in) — additive field, the
    // page shell renders every dial from it.
    design: resolveDesign(page.designJson)
  });
});

const chatBodySchema = z.object({
  message: z
    .string({ message: "Message is required" })
    .trim()
    .min(1, "Message is required")
    .max(2000, "Message is too long (2000 characters max)"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000, "History messages are limited to 4000 characters")
      })
    )
    .max(20, "History is limited to the last 20 messages")
    .optional(),
  sessionId: z.string().uuid("Session id must be a UUID").optional()
});

/** One sandboxed chat turn (rate-limited). */
agentPagesRoutes.post("/:slug/chat", publicBodyLimit, async (c) => {
  const slug = c.req.param("slug");

  const parsed = chatBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Invalid request",
      422,
      "VALIDATION_ERROR"
    );
  }

  const page = await findLiveAgentPage(slug);
  if (!page) {
    return errorResponse(c, PAGE_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
  }

  // Load the workflow BEFORE consuming — a broken page must not burn quota.
  const workflowJson = await loadWorkflowJson(page.workflowId);
  if (workflowJson === null) {
    return errorResponse(c, PAGE_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
  }

  const clientIp = getClientIp(c);
  const decision = await consumeAgentPageLimit(clientIp, slug);
  if (!decision.allowed) {
    return errorResponse(c, LIMIT_REACHED_MESSAGE, 429, "PAGE_LIMIT_REACHED");
  }

  const sessionId = parsed.data.sessionId?.trim() || randomUUID();

  try {
    // Always the sandboxed dry-run engine with the architect's own identity —
    // public visitors can never trigger LIVE side effects, and availability is
    // pinned to test slots so the architect's real calendar is never read for
    // anonymous traffic. UTC keeps the dry-run timezone gate satisfied without
    // exposing a timezone picker. The listing's public name stands in for the
    // business, so saved text like {{business.name}} resolves to the agent's
    // name instead of leaking a raw placeholder to the visitor.
    const result = await runArchitectConversationTest({
      userId: page.architectUserId,
      workflowId: page.workflowId,
      workflowJson,
      message: parsed.data.message,
      history: parsed.data.history,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: engineSessionId(page.slug, sessionId),
      forceTestAvailability: true,
      testContext: { timeZone: "UTC", businessName: page.listing.name }
    });

    if (result.configError) {
      // Config errors carry architect-facing remediation text — never shown
      // to visitors. The visitor gets their use back: we delivered nothing.
      console.error("[agent-pages] chat config error", slug, result.configError.code);
      await refundAgentPageUse(clientIp, slug);
      return errorResponse(c, CHAT_FAILED_MESSAGE, 500, "AGENT_PAGE_CHAT_FAILED");
    }

    return successResponse(c, {
      reply: result.reply,
      sessionId,
      remainingToday: decision.remainingToday
    });
  } catch (error) {
    console.error("[agent-pages] chat turn failed", slug, error);
    await refundAgentPageUse(clientIp, slug);
    return errorResponse(c, CHAT_FAILED_MESSAGE, 500, "AGENT_PAGE_CHAT_FAILED");
  }
});

/** Start a sandboxed voice demo session. */
agentPagesRoutes.post("/:slug/voice-session", async (c) => {
  const slug = c.req.param("slug");

  const page = await findLiveAgentPage(slug);
  if (!page) {
    return errorResponse(c, PAGE_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
  }

  try {
    const session = await startPublicMarketplaceDemoCall(getClientIp(c), page.listing.id);
    return successResponse(c, { session }, "Voice session ready");
  } catch (error) {
    if (error instanceof MarketplaceDemoError) {
      return errorResponse(c, error.message, error.status, error.code);
    }
    console.error("[agent-pages] voice session failed", slug, error);
    return errorResponse(c, "Could not start the voice session.", 500, "AGENT_PAGE_VOICE_FAILED");
  }
});

const runBodySchema = z.object({
  prompt: z
    .string({ message: "Prompt is required" })
    .trim()
    .min(1, "Prompt is required")
    .max(4000, "Prompt is too long (4000 characters max)"),
  sessionId: z.string().uuid("Session id must be a UUID").optional()
});

/** One sandboxed one-shot run for media/form templates (rate-limited). */
agentPagesRoutes.post("/:slug/run", publicBodyLimit, async (c) => {
  const slug = c.req.param("slug");

  const parsed = runBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Invalid request",
      422,
      "VALIDATION_ERROR"
    );
  }

  const page = await findLiveAgentPage(slug);
  if (!page) {
    return errorResponse(c, PAGE_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
  }

  // Load the workflow BEFORE consuming — a broken page must not burn quota.
  const workflowJson = await loadWorkflowJson(page.workflowId);
  if (workflowJson === null) {
    return errorResponse(c, PAGE_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
  }

  const clientIp = getClientIp(c);
  const decision = await consumeAgentPageLimit(clientIp, slug);
  if (!decision.allowed) {
    return errorResponse(c, LIMIT_REACHED_MESSAGE, 429, "PAGE_LIMIT_REACHED");
  }

  try {
    // Sandboxed one-shot run under the architect's identity — never LIVE.
    // The listing's public name stands in for the business so saved text like
    // {{business.name}} resolves to the agent's name in visitor-facing output.
    const result = await runWorkflowTest({
      userId: page.architectUserId,
      workflowId: page.workflowId,
      workflowJson,
      input: { message: parsed.data.prompt, businessName: page.listing.name },
      mode: "test"
    });

    return successResponse(c, {
      output: extractRunOutput(result),
      remainingToday: decision.remainingToday
    });
  } catch (error) {
    console.error("[agent-pages] run failed", slug, error);
    await refundAgentPageUse(clientIp, slug);
    return errorResponse(c, RUN_FAILED_MESSAGE, 500, "AGENT_PAGE_RUN_FAILED");
  }
});

// ---------------------------------------------------------------------------
// Architect manage — requireAuth + ARCHITECT role, ownership checked in-handler.
// ---------------------------------------------------------------------------

registerAgentPageManageRoutes(agentPagesRoutes);
