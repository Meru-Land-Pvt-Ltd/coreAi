import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { presentationDoorEnabled } from "@coreai/shared";
import { getClientIp } from "../../lib/client-ip";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { resolveEmbedLive } from "./embed-live";
import { runArchitectConversationTest } from "../architect/workflow-conversation-test";
import { runWorkflowTest } from "../architect/workflow-runner";
import { MarketplaceDemoError, startPublicMarketplaceDemoCall } from "../business/marketplace-demo";
import { deriveFaceBlueprint } from "./blueprint";
import { resolveDesign } from "./design";
import { registerAgentPageManageRoutes } from "./manage-routes";
import { agentPageRemainingToday, consumeAgentPageLimit, refundAgentPageUse } from "./rate-limit";
import { resolveRunOutput } from "./run-output";
import { refuseUploadIfBeyondLimits } from "../architect/upload-limits";
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

// The caller's real address comes from ONE place now (lib/client-ip.ts). The
// version that used to live here trusted `cf-connecting-ip`, and we do not sit
// behind Cloudflare — so anyone could set that header themselves, change it per
// request, and use the free preview forever.

/**
 * A CHAT MESSAGE IS SMALL. A FILE IS NOT.
 *
 * One 256KB limit guarded both routes, while the File Upload card tells the
 * customer they may send up to the admin's ceiling — five megabytes by
 * default — and their browser only refuses at that size. So the customer
 * picked a normal photograph, the page said it was fine, and the server threw
 * it away at about 190KB with "Request is too large", which reads as our
 * fault and is. Two limits: a message is small, a file is as large as the
 * admin allows, with room for the base64 the browser wraps it in.
 */
const CHAT_BODY_LIMIT = 256 * 1024;
const MAX_UPLOAD_MB = 50;
const RUN_BODY_LIMIT = Math.ceil(MAX_UPLOAD_MB * 1024 * 1024 * 1.4);

const publicBodyLimit = bodyLimit({
  maxSize: CHAT_BODY_LIMIT,
  onError: (c) => errorResponse(c, "Request is too large.", 413, "PAYLOAD_TOO_LARGE")
});

/* The run route is the one that carries a file. Its real ceiling is the
   admin's, enforced with the honest message in refuseUploadIfBeyondLimits;
   this only stops something absurd before it is parsed. */
const publicRunBodyLimit = bodyLimit({
  maxSize: RUN_BODY_LIMIT,
  onError: (c) => errorResponse(c, "That file is too large to send.", 413, "PAYLOAD_TOO_LARGE")
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
    // Full AI Builder config (defaults filled in) — additive field, the
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
  sessionId: z.string().uuid("Session id must be a UUID").optional(),
  /* Present only when this page is the widget on a business's own website.
     See the refusal below for why it is read but never obeyed here. */
  installKey: z.string().trim().max(120).optional()
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

  /* A CHAT PAGE ON A BUSINESS'S OWN SITE WAS ANSWERING WITH A REHEARSAL.
     This engine cannot run live — it books into a test calendar and marks
     every lead as a test. The widget still carried the buyer's key, and a
     real customer on the business's own website was told their appointment
     was booked by a run that writes nothing: no calendar entry, no lead, no
     record anybody could find the next morning.

     Only the product page can go live today. Rather than serve a rehearsal
     to a paying business's customer, this says no — the same line the run
     route holds. When a live chat engine exists, this becomes a branch
     instead of a refusal. */
  const chatEmbed = await resolveEmbedLive({
    installKey: parsed.data.installKey,
    workflowId: page.workflowId,
    listingId: page.listing.id
  });
  if (chatEmbed.live) {
    console.warn("[agent-pages] live chat embed refused — this page cannot do real work", { slug });
    return errorResponse(
      c,
      "This agent's chat cannot run live on your site yet. Publish it as a product page to take real work.",
      503,
      "EMBED_CHAT_NOT_LIVE"
    );
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

  /* THE SAME LINE AS THE CHAT ABOVE. What this starts is a marketplace demo
     call — it always was, whoever asked. On a business's own website that
     means their customer spoke to a demonstration and believed they had
     spoken to the business. A demo is honest on the marketplace and a lie on
     their site. */
  const voiceBody = (await c.req.json().catch(() => ({}))) as { installKey?: unknown };
  const voiceEmbed = await resolveEmbedLive({
    installKey: typeof voiceBody?.installKey === "string" ? voiceBody.installKey : null,
    workflowId: page.workflowId,
    listingId: page.listing.id
  });
  if (voiceEmbed.live) {
    console.warn("[agent-pages] live voice embed refused — this page only starts a demo call", { slug });
    return errorResponse(
      c,
      "This agent's voice call cannot run live on your site yet.",
      503,
      "EMBED_VOICE_NOT_LIVE"
    );
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
  /**
   * THE PROMPT BOX'S DOOR OUT — see docs/NODE-SOP.md.
   *
   * `prompt` above is the narrated instruction block: "The customer pressed the
   * button… The customer wrote…". Useful to a brain, useless to anything else,
   * and it is not a value — it is a paragraph.
   *
   * This is the value. Exactly what the customer typed, nothing added, under
   * the name the Prompt Box declares it gives. A later node reads it as
   * {{text}} whatever it calls its own input, instead of the old arrangement
   * where the words arrived only if a node happened to be named one of eight
   * hard-coded words.
   *
   * Optional, because every page published before today sends only `prompt`,
   * and those must keep working exactly as they do.
   */
  text: z.string().trim().max(4000).optional(),
  sessionId: z.string().uuid("Session id must be a UUID").optional(),
  /**
   * The buyer's public widget key, sent by the embed loader. Absent on the
   * marketplace page, which stays a demo exactly as before.
   */
  installKey: z.string().trim().max(120).optional(),
  /* One submit, one id, made by the browser. A network or proxy replay of
     the same request carries the same id and is refused by WorkflowRun's
     unique index; a second click is a genuinely new submit and gets a new
     one. This was a `randomUUID()` invented on the server, which is a fresh
     id every time — so the double-charge guard the comment below describes
     could never once match, and a replayed submit was billed twice. */
  runId: z.string().uuid().optional(),
  /** File Upload's door out — the customer's one file, as a data URL. */
  attachments: z
    .array(
      z.object({
        name: z.string().trim().max(200),
        mimeType: z.string().trim().max(100),
        data: z.string().max(15_000_000)
      })
    )
    .max(1)
    .optional()
});

/** One sandboxed one-shot run for media/form templates (rate-limited). */
agentPagesRoutes.post("/:slug/run", publicRunBodyLimit, async (c) => {
  const slug = c.req.param("slug");

  const parsed = runBodySchema.safeParse(await c.req.json().catch(() => ({})));

  /* The admin's upload dials, enforced at the public door too — the page and
     the preview must never drift apart on what they accept. */
  if (parsed.success && parsed.data.attachments?.length) {
    const refusal = await refuseUploadIfBeyondLimits(parsed.data.attachments[0]);
    if (refusal) return errorResponse(c, refusal, 422, "UPLOAD_REFUSED");
  }
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

  // A widget on a business's own website does REAL work for that business:
  // real calendar, real leads. Everything else — the marketplace demo, an
  // unknown key, a paused agent, a hit ceiling — runs exactly as it always
  // has. A "no" here is never an error; the visitor still gets an answer.
  const embed = await resolveEmbedLive({
    installKey: parsed.data.installKey,
    workflowId: page.workflowId,
    listingId: page.listingId
  }).catch(() => ({ live: false as const, reason: "resolver failed" }));

  /* THE DEMO'S CEILING IS NOT THE BUSINESS'S (found by the platform audit,
     2026-08-27). The free-demo limit was spent BEFORE we knew whether this
     was a business's own paid widget — so a busy shop's customers were
     turned away by the marketplace's demo allowance, on a widget they pay
     for. A paid embed has its own ceiling (embed-live.ts) and must not be
     charged against the demo's. */
  /* A REFUSED PAID WIDGET USED TO ANSWER WITH A REHEARSAL.
     When a valid install key was given but live work was refused — the
     minute's burst limit, the day's, the month's ceiling, or Redis being
     unreachable — the run fell through to the architect's dry run, and a real
     customer on the business's own website was told their booking was
     confirmed by a run that writes nothing: no calendar entry, no lead, no
     record. The marketplace demo is a demo and says so; a business's own
     visitor is owed either the real thing or an honest no. */
  if (parsed.data.installKey && !embed.live) {
    console.warn("[agent-pages] live embed refused — not serving a demo run to a real visitor", {
      slug,
      reason: embed.reason
    });
    return errorResponse(
      c,
      "We can't take that right now — please try again in a few minutes.",
      503,
      "EMBED_NOT_LIVE"
    );
  }

  const clientIp = getClientIp(c);
  let remainingToday: number | null = null;
  if (!embed.live) {
    const decision = await consumeAgentPageLimit(clientIp, slug);
    if (!decision.allowed) {
      return errorResponse(c, LIMIT_REACHED_MESSAGE, 429, "PAGE_LIMIT_REACHED");
    }
    remainingToday = decision.remainingToday;
  }

  try {
    const result = embed.live
      ? await runWorkflowTest({
          userId: embed.install.businessOwnerId,
          workflowId: page.workflowId,
          workflowJson,
          mode: "live",
          executionMode: "LIVE",
          callProvider: "EMBED",
          // One run per submit: a retry of the same submit is refused by
          // WorkflowRun's unique index rather than charged twice.
          externalCallId: `${embed.install.id}:${parsed.data.runId ?? parsed.data.sessionId ?? randomUUID()}`,
          input: {
            businessId: embed.install.businessId,
            businessOwnerId: embed.install.businessOwnerId,
            installedAgentId: embed.install.id,
            listingId: embed.install.listingId ?? undefined,
            businessName: embed.install.businessName,
            businessType: embed.install.businessType ?? undefined,
            businessPhoneNumber: embed.install.businessPhoneNumber,
            bookingUrl: embed.install.bookingUrl,
            teamPhone: embed.install.teamPhone,
            calendarId: embed.install.calendarId,
            timeZone: embed.install.timeZone,
            services: embed.install.services,
            latestMessage: parsed.data.prompt,
            // What the Prompt Box says it gives, actually given — and only when
            // there is something to give. A customer who pressed a button and
            // typed nothing did not write anything, and handing on an empty
            // string would say they did.
            ...(parsed.data.text ? { text: parsed.data.text } : {}),
            ...(parsed.data.attachments?.length ? { attachments: parsed.data.attachments } : {}),
            // Marks the run as coming from a public widget: real calendar and
            // real leads, but no texts, calls, emails or WhatsApp — the page
            // is public and a stranger must never reach outward on this bill.
            embedSource: true
          }
        })
      : // Sandboxed one-shot run under the architect's identity — never LIVE.
        // The listing's public name stands in for the business so saved text
        // like {{business.name}} resolves to the agent's name.
        await runWorkflowTest({
          userId: page.architectUserId,
          workflowId: page.workflowId,
          workflowJson,
          input: {
            message: parsed.data.prompt,
            // See above: only when they actually typed something.
            ...(parsed.data.text ? { text: parsed.data.text } : {}),
            ...(parsed.data.attachments?.length ? { attachments: parsed.data.attachments } : {}),
            businessName: page.listing.name
          },
          mode: "test"
        });

    return successResponse(c, {
      // The Face-out door turns whatever the run produced into cards, a chart
      // or a table. When it can't, this is the same plain text as before.
      output: await resolveRunOutput(result, {
        userMessage: parsed.data.prompt,
        businessName: page.listing.name,
        doorsEnabled: presentationDoorEnabled(workflowJson)
      }),
      /* A paid widget has no demo allowance to report — null, never a
         number that would mislead the business about their own ceiling. */
      remainingToday
    });
  } catch (error) {
    console.error("[agent-pages] run failed", slug, error);
    /* Only refund what was actually taken. A paid embed never spends the demo
       allowance, and refunding one it never spent decremented a counter that
       had never been incremented — leaving it below zero, where it sits until
       the key expires and quietly raises the platform's whole daily ceiling. */
    if (!embed.live) await refundAgentPageUse(clientIp, slug);
    return errorResponse(c, RUN_FAILED_MESSAGE, 500, "AGENT_PAGE_RUN_FAILED");
  }
});

// ---------------------------------------------------------------------------
// Architect manage — requireAuth + ARCHITECT role, ownership checked in-handler.
// ---------------------------------------------------------------------------

registerAgentPageManageRoutes(agentPagesRoutes);
