import { Hono, type Context } from "hono";
import { z } from "zod";
import { calendarEventTitleForMode, normalizeAgentConfigure, requiredConnectorKeys } from "@coreai/shared";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createGmailOAuthUrl,
  disconnectGmail,
  getGmailConnectionStatus,
  getGmailOAuthRedirectPath,
  handleGmailOAuthCallback
} from "./gmail-connector";
import { GOOGLE_CALENDAR_INTEGRATION } from "@coreai/shared";
import {
  DisclosureConsentError,
  hasFreshDisclosureConsent,
  recordDisclosureConsent
} from "../compliance/disclosure-consent";
import {
  handleTwilioInboundSms,
  handleTwilioMessageStatus,
  handleTwilioMissedCall,
  handleTwilioVoice,
  handleTwilioVoiceAction,
  handleVapiWebhook
} from "./twilio-business-routing";
import {
  getWorkflowConfigure,
  getWorkflowMarketplacePreview,
  patchWorkflowConfigure,
  publishWorkflowListing,
  saveWorkflowConfigureDraft,
  submitWorkflowForReview
} from "./configure";
import { deployDentalWorkflow } from "./dental-deploy";
import {
  getPhoneRoutingStatus,
  setPhoneRoutingMode,
  setupPhoneRouting,
  testPhoneRouting
} from "./phone-routing";
import {
  cloneTemplateWorkflow,
  getTemplateBySlug,
  listTemplateCards
} from "./templates";
import {
  cloneSavedTemplateWorkflow,
  getSavedTemplateBySlug,
  listSavedTemplateCards
} from "./saved-templates";
import {
  loadArchitectEarnings,
  countSalesByListingIds,
  effectiveEarningStatus,
  sumApprovedEarningsCents
} from "./payout-earnings";
import {
  getArchitectTestDeploymentStatus,
  startArchitectTestDeployment,
  stopArchitectTestDeployment,
  TestDeploymentError
} from "./test-deployment";
import { getVoiceAnswerStatus } from "./vapi-connector";
import { generateVoicePreview, listVoicePresets, voicePreviewDiagnostics, VoicePreviewError } from "./voice-presets";
import { runWorkflowTest } from "./workflow-runner";
import { getArchitectVapiBrowserTestCallEndReason, startArchitectVapiBrowserTest } from "./vapi-browser-test";
import { runArchitectConversationTest } from "./workflow-conversation-test";
import { deleteTestCalendarEvent } from "./test-calendar-events";
import { architectPayoutRoutes, handleStripeConnectWebhook } from "./payout-routes";
import { architectSettingsRoutes } from "./settings-routes";
import { getProviderRegistry } from "../ai-provider-engine/provider-engine";
import { buildInstalledAgentRunStats } from "../business/installed-agent-run-stats";
import { loadArchitectDashboardActivity } from "./dashboard-activity";
import {
  buildArchitectAgentAnalyticsCsv,
  loadArchitectAgentAnalytics,
  parseArchitectAnalyticsRange
} from "./agent-analytics";

const voicePreviewSchema = z.object({
  presetId: z.string().trim().optional(),
  voiceId: z.string().trim().optional(),
  text: z.string().trim().max(300).optional()
});

export const architectRoutes = new Hono();

architectRoutes.get("/connectors/gmail/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const oauthError = c.req.query("error");

    if (!code || !state || oauthError) {
      let target = "/architect/profile";

      if (state) {
        try {
          target = getGmailOAuthRedirectPath(state) ?? target;
        } catch {
          // Forged/undecodable state: fall back to the architect profile.
        }
      }

      // "denied" = the user rejected the Google consent screen; everything
      // else (missing code/state, provider error) reads as a plain failure.
      const result = oauthError === "access_denied" ? "denied" : "failed";
      const separator = target.includes("?") ? "&" : "?";
      return c.redirect(`${env.FRONTEND_URL}${target}${separator}gmail=${result}`);
    }

    const { redirectPath } = await handleGmailOAuthCallback({
      code,
      state
    });

    const target = redirectPath ?? "/architect/profile";
    const separator = target.includes("?") ? "&" : "?";

    return c.redirect(`${env.FRONTEND_URL}${target}${separator}gmail=connected`);
  } catch (error) {
    console.error(error);
    const state = c.req.query("state");
    let target = "/architect/profile";

    if (state) {
      try {
        target = getGmailOAuthRedirectPath(state) ?? target;
      } catch {
        // Invalid or expired state: fall back to the architect profile.
      }
    }

    const separator = target.includes("?") ? "&" : "?";
    return c.redirect(`${env.FRONTEND_URL}${target}${separator}gmail=failed`);
  }
});

architectRoutes.post("/connectors/twilio/voice", handleTwilioVoice);
architectRoutes.post("/connectors/twilio/voice/:workflowId", handleTwilioVoice);
architectRoutes.post("/connectors/twilio/voice-action", handleTwilioVoiceAction);
architectRoutes.post("/connectors/twilio/voice-action/:workflowId", handleTwilioVoiceAction);
architectRoutes.post("/connectors/twilio/inbound-sms", handleTwilioInboundSms);
architectRoutes.post("/connectors/twilio/inbound-sms/:workflowId", handleTwilioInboundSms);
// SMS delivery-status callback (https://triven.ai/api/architect/connectors/twilio/message-status).
architectRoutes.post("/connectors/twilio/message-status", handleTwilioMessageStatus);
architectRoutes.post("/connectors/twilio/missed-call/:workflowId", handleTwilioMissedCall);
architectRoutes.post("/connectors/vapi/webhook", handleVapiWebhook);
// Stripe signs this public Connect webhook; it must be registered before auth.
architectRoutes.post("/payouts/stripe/webhook", handleStripeConnectWebhook);
// Public GET probe: Vapi only POSTs here; this keeps curl diagnostics honest.
architectRoutes.get("/connectors/vapi/webhook", (c) =>
  successResponse(c, { ok: true, note: "Vapi webhook is up. Tool calls arrive via POST." })
);

architectRoutes.get("/connectors/voice/status", (c) => successResponse(c, getVoiceAnswerStatus()));

async function listPublicMarketplaceListings(c: Context) {
  const allListings = await prisma.agentListing.findMany({
    where: {
      status: "APPROVED"
    },
    include: {
      workflow: true,
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      },
      _count: {
        select: { installedAgents: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const seenWorkflowIds = new Set<string>();
  const filtered = allListings.filter((listing) => {
    if (!listing.workflowId) return true;
    if (seenWorkflowIds.has(listing.workflowId)) return false;
    seenWorkflowIds.add(listing.workflowId);
    return true;
  });
  const installCountByListing = await countSalesByListingIds(filtered.map((listing) => listing.id));
  const listings = filtered.map(({ _count, ...listing }) => ({
    ...listing,
    installCount: installCountByListing.get(listing.id) ?? 0
  }));

  return successResponse(c, { listings });
}

async function getPublicMarketplaceListingById(c: Context) {
  const id = c.req.param("id");

  if (!id) {
    return errorResponse(c, "Listing id is required", 400);
  }

  const listing = await prisma.agentListing.findFirst({
    where: {
      id,
      status: "APPROVED"
    },
    include: {
      workflow: true,
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              bio: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      },
      _count: {
        select: { installedAgents: true }
      }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404);
  }

  const { _count, ...rest } = listing;
  const installCountByListing = await countSalesByListingIds([listing.id]);

  return successResponse(c, {
    listing: {
      ...rest,
      installCount: installCountByListing.get(listing.id) ?? 0
    }
  });
}

async function listCompletedMarketplaceListings(c: Context) {
  const allListings = await prisma.agentListing.findMany({
    where: {
      status: {
        in: ["APPROVED", "PENDING_REVIEW"]
      }
    },
    include: {
      workflow: true,
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      },
      _count: {
        select: { installedAgents: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const seenWorkflowIds = new Set<string>();
  const filtered = allListings.filter((listing) => {
    if (!listing.workflowId) return true;
    if (seenWorkflowIds.has(listing.workflowId)) return false;
    seenWorkflowIds.add(listing.workflowId);
    return true;
  });
  const installCountByListing = await countSalesByListingIds(filtered.map((listing) => listing.id));
  const listings = filtered.map(({ _count, ...listing }) => ({
    ...listing,
    installCount: installCountByListing.get(listing.id) ?? 0
  }));

  return successResponse(c, { listings });
}

architectRoutes.get("/listings/public", listPublicMarketplaceListings);
architectRoutes.get("/listings/public/:id", getPublicMarketplaceListingById);
architectRoutes.get("/listings/completed", requireAuth, listCompletedMarketplaceListings);

architectRoutes.get("/listings/public/:id/similar", async (c) => {
  const id = c.req.param("id");
  const limitParam = Number(c.req.query("limit") ?? "4");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 8) : 4;

  if (!id) {
    return errorResponse(c, "Listing id is required", 400);
  }

  // Load the target listing to get its category/tags for matching.
  const targetListing = await prisma.agentListing.findFirst({
    where: { id, status: "APPROVED" },
    select: { id: true, category: true, tags: true, industryTags: true }
  });

  if (!targetListing) {
    return successResponse(c, { listings: [] });
  }

  // Build similarity filter: match on category or any shared tag/industryTag.
  const categoryFilter = targetListing.category?.trim()
    ? [{ category: { equals: targetListing.category.trim(), mode: "insensitive" as const } }]
    : [];

  const tagFilters = [
    ...targetListing.tags.slice(0, 5).map((tag) => ({ tags: { has: tag } })),
    ...targetListing.industryTags.slice(0, 5).map((tag) => ({ industryTags: { has: tag } }))
  ];

  const orConditions = [...categoryFilter, ...tagFilters];

  const similarListings = await prisma.agentListing.findMany({
    where: {
      status: "APPROVED",
      id: { not: id },
      ...(orConditions.length > 0 ? { OR: orConditions } : {})
    },
    include: {
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  const installCountByListing = await countSalesByListingIds(
    similarListings.map((listing) => listing.id)
  );

  const listings = similarListings.map((listing) => ({
    id: listing.id,
    name: listing.name,
    shortDescription: listing.shortDescription,
    priceCents: listing.priceCents,
    pricingModel: listing.pricingModel,
    category: listing.category,
    tags: listing.tags,
    industryTags: listing.industryTags,
    iconUrl: listing.iconUrl,
    freeTrialEnabled: listing.freeTrialEnabled,
    trialDays: listing.trialDays,
    installCount: installCountByListing.get(listing.id) ?? 0,
    architect: listing.architect
  }));

  return successResponse(c, { listings });
});

architectRoutes.get("/voices", requireAuth, (c) => successResponse(c, listVoicePresets()));
architectRoutes.get("/voices/debug", requireAuth, (c) => successResponse(c, voicePreviewDiagnostics()));
architectRoutes.post("/voices/preview", requireAuth, async (c) => {
  try {
    const input = voicePreviewSchema.parse(await c.req.json().catch(() => ({})));
    const result = await generateVoicePreview(input);
    return successResponse(c, result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid preview input", 422, "VALIDATION_ERROR");
    }
    const status = error instanceof VoicePreviewError ? error.status : 503;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Voice preview failed",
      status,
      "VOICE_PREVIEW_FAILED"
    );
  }
});

architectRoutes.use("*", requireAuth);
architectRoutes.use(
  "*",
  requireRole(["ARCHITECT"], {
    message: "Architect access is required.",
    code: "ARCHITECT_ACCESS_REQUIRED"
  })
);

architectRoutes.get("/ai/providers", async (c) => {
  const registry = getProviderRegistry();
  const adapters = registry.all();
  const providers = adapters.map((adapter) => ({
    id: adapter.providerId,
    displayName: adapter.displayName,
    models: adapter.models
  }));
  return successResponse(c, { providers });
});

architectRoutes.route("/payouts", architectPayoutRoutes);
architectRoutes.route("/settings", architectSettingsRoutes);

architectRoutes.get("/dashboard/activity", async (c) => {
  try {
    const authUser = c.get("authUser");
    const requestedLimit = Number(c.req.query("limit") ?? "10");
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 10;
    const activities = await loadArchitectDashboardActivity(authUser.id, limit);

    return successResponse(c, {
      activities,
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Architect dashboard activity failed", error);
    return errorResponse(c, "Could not load dashboard activity", 500, "DASHBOARD_ACTIVITY_FAILED");
  }
});

architectRoutes.get("/agents/:listingId/analytics", async (c) => {
  try {
    const authUser = c.get("authUser");
    const listingId = c.req.param("listingId").trim();
    const range = parseArchitectAnalyticsRange(c.req.query("range"));
    const analytics = await loadArchitectAgentAnalytics({
      architectUserId: authUser.id,
      listingId,
      range
    });

    if (!analytics) {
      return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");
    }

    return successResponse(c, analytics, "Agent analytics loaded");
  } catch (error) {
    console.error("Architect agent analytics failed", error);
    return errorResponse(c, "Could not load agent analytics", 500, "AGENT_ANALYTICS_FAILED");
  }
});

architectRoutes.get("/agents/:listingId/analytics/export", async (c) => {
  try {
    const authUser = c.get("authUser");
    const listingId = c.req.param("listingId").trim();
    const range = parseArchitectAnalyticsRange(c.req.query("range"));
    const report = await buildArchitectAgentAnalyticsCsv({
      architectUserId: authUser.id,
      listingId,
      range
    });

    if (!report) {
      return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");
    }

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${report.filename}"`);
    return c.body(report.csv);
  } catch (error) {
    console.error("Architect agent analytics export failed", error);
    return errorResponse(c, "Could not export agent analytics", 500, "AGENT_ANALYTICS_EXPORT_FAILED");
  }
});

/** My Agents dashboard stats — live counts, buyer executions, and approved total earnings. */
architectRoutes.get("/agents/stats", async (c) => {
  try {
    const authUser = c.get("authUser");
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff30 = new Date(now.getTime() - 30 * dayMs);
    const cutoff60 = new Date(now.getTime() - 60 * dayMs);

    const [listings, workflows, sales, architectInstalledAgentRows] =
      await Promise.all([
        prisma.agentListing.findMany({
          where: { architectUserId: authUser.id },
          select: { id: true, workflowId: true, status: true, createdAt: true }
        }),
        prisma.workflowDefinition.findMany({
          where: { architectUserId: authUser.id },
          select: { id: true, createdAt: true }
        }),
        loadArchitectEarnings(authUser.id),
        prisma.installedAgent.findMany({
          where: {
            listing: { architectUserId: authUser.id }
          },
          select: { id: true, listingId: true, businessId: true, configJson: true }
        })
      ]);

    // Do this check in application code. A Prisma JSON-path `NOT` filter can also
    // exclude SQL NULL/missing paths, which hid ordinary marketplace installs.
    const architectInstalledAgents = architectInstalledAgentRows.filter((agent) => {
      const config = agent.configJson;
      if (!config || typeof config !== "object" || Array.isArray(config)) return true;
      return (config as Record<string, unknown>).purpose !== "ARCHITECT_TEST";
    });

    // Reuse the exact execution calculation shown to buyers in Business → My Agents,
    // then sum every installed copy of this architect's listings across businesses.
    const architectAgentIds = new Set(architectInstalledAgents.map((agent) => agent.id));
    const businessIds = [...new Set(architectInstalledAgents.map((agent) => agent.businessId))];
    const allBusinessAgents = businessIds.length
      ? await prisma.installedAgent.findMany({
          where: { businessId: { in: businessIds } },
          select: { id: true, listingId: true, businessId: true }
        })
      : [];
    const agentsByBusiness = new Map<string, Array<{ id: string; listingId: string | null }>>();
    for (const agent of allBusinessAgents) {
      const agents = agentsByBusiness.get(agent.businessId) ?? [];
      agents.push({ id: agent.id, listingId: agent.listingId });
      agentsByBusiness.set(agent.businessId, agents);
    }

    const executionTotals = await Promise.all(
      businessIds.map(async (businessId) => {
        const installedAgents = agentsByBusiness.get(businessId) ?? [];
        const [allTime, currentMonth, previousMonth] = await Promise.all([
          buildInstalledAgentRunStats(businessId, installedAgents),
          buildInstalledAgentRunStats(businessId, installedAgents, { start: monthStart }),
          buildInstalledAgentRunStats(businessId, installedAgents, {
            start: prevMonthStart,
            end: monthStart
          })
        ]);
        const sumArchitectRuns = (stats: Map<string, { runs: number }>) =>
          [...stats.entries()].reduce(
            (sum, [agentId, value]) => sum + (architectAgentIds.has(agentId) ? value.runs : 0),
            0
          );
        return {
          total: sumArchitectRuns(allTime),
          current: sumArchitectRuns(currentMonth),
          previous: sumArchitectRuns(previousMonth)
        };
      })
    );
    const executionsTotal = executionTotals.reduce((sum, value) => sum + value.total, 0);
    const executionsThisMonth = executionTotals.reduce((sum, value) => sum + value.current, 0);
    const executionsPrevMonth = executionTotals.reduce((sum, value) => sum + value.previous, 0);

    // Match GET /architect/listings agent uniqueness (one card per workflow + orphan drafts).
    const seenWorkflowIds = new Set<string>();
    const uniqueListings = listings.filter((listing) => {
      if (!listing.workflowId) return true;
      if (seenWorkflowIds.has(listing.workflowId)) return false;
      seenWorkflowIds.add(listing.workflowId);
      return true;
    });
    const draftWorkflows = workflows.filter((workflow) => !seenWorkflowIds.has(workflow.id));

    const totalAgents = uniqueListings.length + draftWorkflows.length;
    const liveAndEarning = uniqueListings.filter((listing) => listing.status === "APPROVED").length;
    const liveSharePercent = totalAgents > 0 ? Math.round((liveAndEarning / totalAgents) * 1000) / 10 : 0;

    const agentsCreatedThisMonth =
      uniqueListings.filter((listing) => listing.createdAt >= monthStart).length +
      draftWorkflows.filter((workflow) => workflow.createdAt >= monthStart).length;

    // Revenue (30d) = architect share of all non-rejected purchase earnings in the last 30 days.
    const revenue30dCents = sales
      .filter((sale) => sale.createdAt >= cutoff30 && effectiveEarningStatus(sale) !== "REJECTED")
      .reduce((sum, sale) => sum + sale.earningsCents, 0);

    const revenuePrev30dCents = sales
      .filter(
        (sale) =>
          sale.createdAt >= cutoff60 &&
          sale.createdAt < cutoff30 &&
          effectiveEarningStatus(sale) !== "REJECTED"
      )
      .reduce((sum, sale) => sum + sale.earningsCents, 0);
    const totalEarningsCents = sumApprovedEarningsCents(sales);

    function percentChange(current: number, previous: number): number | null {
      if (previous <= 0) return current > 0 ? 100 : null;
      return Math.round(((current - previous) / previous) * 100);
    }

    return successResponse(c, {
      totalAgents,
      agentsAddedThisMonth: agentsCreatedThisMonth,
      liveAndEarning,
      liveSharePercent,
      totalExecutions: executionsTotal,
      executionsThisMonth,
      executionsPrevMonth,
      executionsChangePercent: percentChange(executionsThisMonth, executionsPrevMonth),
      totalEarningsCents,
      revenue30dCents,
      revenuePrev30dCents,
      revenueChangePercent: percentChange(revenue30dCents, revenuePrev30dCents)
    });
  } catch (error) {
    console.error("[architect/agents/stats] failed", error);
    return errorResponse(c, "Could not load agent stats", 500, "AGENT_STATS_FAILED");
  }
});

const profileSchema = z.object({
  title: z.string().trim().min(2).optional().or(z.literal("")),
  bio: z.string().trim().min(10).optional().or(z.literal("")),
  portfolioUrl: z.string().trim().url().optional().or(z.literal("")),
  skills: z.array(z.string().trim().min(1)).default([]),
  hourlyRateCents: z.number().int().nonnegative().optional()
});

const workflowSchema = z.object({
  name: z.string().trim().min(2, "Agent name is required"),
  description: z.string().trim().optional().or(z.literal("")),
  isTemplate: z.boolean().default(false),
  workflowJson: z.object({
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([])
  })
});

const workflowUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional().or(z.literal("")),
  isTemplate: z.boolean().optional(),
  workflowJson: z
    .object({
      nodes: z.array(z.any()).default([]),
      edges: z.array(z.any()).default([])
    })
    .optional()
});

const listingSchema = z.object({
  workflowId: z.string().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Agent name is required"),
  shortDescription: z.string().trim().min(10, "Short description is required"),
  description: z.string().trim().optional().or(z.literal("")),
  priceCents: z.number().int().nonnegative().default(0),
  tags: z.array(z.string().trim().min(1)).default([]),
  requiredConnectors: z.array(z.string().trim().min(1)).default([]),
  supportedLlms: z.array(z.string().trim().min(1)).default([])
});

const templateRequestSchema = z.object({
  industry: z.string().trim().min(1, "Industry is required"),
  description: z.string().trim().min(10, "Please describe what you need (at least 10 characters)").max(5000)
});

const proposalSchema = z.object({
  coverLetter: z.string().trim().min(20, "Cover letter must be at least 20 characters"),
  bidAmountCents: z.number().int().nonnegative().optional(),
  etaDays: z.number().int().positive().optional()
});

const workflowRunInputSchema = z.object({
  callerNumber: z.string().trim().optional(),
  callerName: z.string().trim().optional(),
  businessId: z.string().trim().optional(),
  businessOwnerId: z.string().trim().optional(),
  businessName: z.string().trim().optional(),
  businessType: z.string().trim().optional(),
  businessPhoneNumber: z.string().trim().optional(),
  calendarId: z.string().trim().optional(),
  timeZone: z.string().trim().optional(),
  vapiAssistantId: z.string().trim().optional(),
  vapiPhoneNumberId: z.string().trim().optional(),
  callStatus: z.string().trim().optional(),
  callTimestamp: z.string().trim().optional(),
  missedCallReason: z.string().trim().optional(),
  bookingUrl: z.string().trim().optional(),
  teamPhone: z.string().trim().optional(),
  services: z.array(z.string().trim()).optional(),
  faqs: z.array(z.string().trim()).optional(),
  tone: z.string().trim().optional(),
  escalationRules: z.string().trim().optional(),
  knowledge: z.array(z.string().trim()).optional(),
  inboundSmsBody: z.string().trim().optional(),
  appointmentStartAt: z.string().trim().optional(),
  appointmentEndAt: z.string().trim().optional(),
  appointmentService: z.string().trim().optional(),
  testEmail: z.string().trim().email("Enter a valid test email address").optional(),
  useTestCalendar: z.boolean().optional(),
  testSessionId: z.string().trim().max(64).optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.string(),
        data: z.string()
      })
    )
    .optional()
});

const workflowRunTestSchema = z.object({
  input: workflowRunInputSchema.optional()
});

const architectConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
  createdAt: z.string().trim().optional()
});

const vapiBrowserTestSchema = z.object({
  testContext: z
    .object({
      businessName: z.string().trim().optional(),
      businessType: z.string().trim().optional(),
      assistantName: z.string().trim().optional(),
      callerName: z.string().trim().optional(),
      callerPhone: z.string().trim().optional(),
      calendarId: z.string().trim().optional(),
      timeZone: z.string().trim().optional(),
      appointmentService: z.string().trim().optional(),
      services: z.array(z.string().trim()).optional(),
      faqs: z.array(z.string().trim()).optional(),
      /** Create real [TRIVEN ARCHITECT TEST] events in the architect's own calendar. */
      useTestCalendar: z.boolean().optional(),
      /** Groups this browser test's records (test calendar events). */
      testSessionId: z.string().trim().max(64).optional()
    })
    .default({})
});

const architectConversationTestSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(4000),
  history: z.array(architectConversationMessageSchema).max(30).default([]),
  /** Groups this dry run's records (test calendar events). */
  testSessionId: z.string().trim().max(64).optional(),
  /** Create real events in the architect's OWN connected test calendar. */
  useTestCalendar: z.boolean().optional(),
  testContext: z
    .object({
      businessName: z.string().trim().optional(),
      businessType: z.string().trim().optional(),
      assistantName: z.string().trim().optional(),
      callerName: z.string().trim().optional(),
      callerPhone: z.string().trim().optional(),
      calendarId: z.string().trim().optional(),
      timeZone: z.string().trim().optional(),
      appointmentService: z.string().trim().optional(),
      requestedDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
      requestedTime: z.string().trim().regex(/^\d{1,2}:\d{2}$/).optional().or(z.literal("")),
      services: z.array(z.string().trim()).optional(),
      faqs: z.array(z.string().trim()).optional()
    })
    .default({})
});

const businessInstallationSchema = z.object({
  workflowId: z.string().trim().min(1),
  listingId: z.string().trim().optional().or(z.literal("")),
  businessName: z.string().trim().min(2),
  businessType: z.string().trim().min(2),
  twilioPhoneNumber: z.string().trim().min(5),
  twilioPhoneNumberSid: z.string().trim().optional().or(z.literal("")),
  forwardToPhone: z.string().trim().optional().or(z.literal("")),
  bookingUrl: z.string().trim().url().optional().or(z.literal("")),
  teamPhone: z.string().trim().optional().or(z.literal("")),
  calendarId: z.string().trim().optional().or(z.literal("")),
  timeZone: z.string().trim().default("America/New_York"),
  vapiAssistantId: z.string().trim().optional().or(z.literal("")),
  vapiPhoneNumberId: z.string().trim().optional().or(z.literal("")),
  services: z.array(z.string().trim().min(1)).default([]),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1)
      })
    )
    .default([]),
  knowledge: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        content: z.string().trim().min(1)
      })
    )
    .default([]),
  tone: z.string().trim().default("friendly"),
  escalationRules: z.string().trim().optional().or(z.literal(""))
});

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

architectRoutes.get("/summary", async (c) => {
  const authUser = c.get("authUser");

  const [
    profile,
    workflows,
    listings,
    proposals,
    workflowCount,
    listingCount,
    proposalCount,
    openProjectsCount
  ] = await Promise.all([
    prisma.architectProfile.findUnique({
      where: {
        userId: authUser.id
      }
    }),

    prisma.workflowDefinition.findMany({
      where: {
        architectUserId: authUser.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5
    }),

    prisma.agentListing.findMany({
      where: {
        architectUserId: authUser.id
      },
      include: {
        workflow: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5
    }),

    prisma.projectProposal.findMany({
      where: {
        architectUserId: authUser.id
      },
      include: {
        project: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5
    }),

    prisma.workflowDefinition.count({
      where: {
        architectUserId: authUser.id
      }
    }),

    prisma.agentListing.count({
      where: {
        architectUserId: authUser.id
      }
    }),

    prisma.projectProposal.count({
      where: {
        architectUserId: authUser.id
      }
    }),

    prisma.project.count({
      where: {
        status: "OPEN"
      }
    })
  ]);

  return successResponse(c, {
    user: authUser,
    profile,
    stats: {
      workflows: workflowCount,
      listings: listingCount,
      proposals: proposalCount,
      openProjects: openProjectsCount
    },
    recent: {
      workflows,
      listings,
      proposals
    }
  });
});

architectRoutes.get("/profile", async (c) => {
  const authUser = c.get("authUser");

  const profile = await prisma.architectProfile.findUnique({
    where: {
      userId: authUser.id
    }
  });

  return successResponse(c, {
    profile
  });
});

architectRoutes.put("/profile", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = profileSchema.parse(await c.req.json());

    const profile = await prisma.architectProfile.upsert({
      where: {
        userId: authUser.id
      },
      update: {
        title: input.title || null,
        bio: input.bio || null,
        portfolioUrl: input.portfolioUrl || null,
        skills: input.skills,
        hourlyRateCents: input.hourlyRateCents
      },
      create: {
        userId: authUser.id,
        title: input.title || null,
        bio: input.bio || null,
        portfolioUrl: input.portfolioUrl || null,
        skills: input.skills,
        hourlyRateCents: input.hourlyRateCents
      }
    });

    return successResponse(c, { profile }, "Architect profile saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid profile input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not save profile", 500, "PROFILE_SAVE_FAILED");
  }
});

architectRoutes.get("/connectors/gmail/status", async (c) => {
  const authUser = c.get("authUser");
  const status = await getGmailConnectionStatus(authUser.id);

  return successResponse(c, status);
});

architectRoutes.post("/connectors/gmail/disclosure-consent", async (c) => {
  try {
    const authUser = c.get("authUser");
    const body = await c.req.json().catch(() => ({}));
    const record = await recordDisclosureConsent({
      userId: authUser.id,
      integration: GOOGLE_CALENDAR_INTEGRATION,
      disclosureVersion: typeof body?.disclosureVersion === "string" ? body.disclosureVersion : "",
      action: typeof body?.action === "string" ? body.action : ""
    });
    return successResponse(c, { disclosureVersion: record.disclosureVersion });
  } catch (error) {
    if (error instanceof DisclosureConsentError) {
      return errorResponse(c, error.message, error.status, error.code);
    }
    return errorResponse(c, "Could not record the disclosure agreement", 500, "DISCLOSURE_CONSENT_FAILED");
  }
});

architectRoutes.get("/connectors/gmail/oauth-url", async (c) => {
  try {
    const authUser = c.get("authUser");

    // OAuth may begin only after an explicit, recorded agreement to the
    // CURRENT disclosure version — enforced here, not just in the UI.
    const consented = await hasFreshDisclosureConsent({
      userId: authUser.id,
      integration: GOOGLE_CALENDAR_INTEGRATION
    });
    if (!consented) {
      return errorResponse(
        c,
        "Review and agree to the Google data disclosure before connecting.",
        428,
        "DISCLOSURE_CONSENT_REQUIRED"
      );
    }

    // Same-app path only — the callback prefixes FRONTEND_URL, so a full URL
    // or protocol-relative value can never leave the app.
    const redirect = c.req.query("redirect");
    const redirectPath = redirect && redirect.startsWith("/") ? redirect : undefined;
    const url = createGmailOAuthUrl(authUser.id, redirectPath);

    return successResponse(c, {
      url
    });
  } catch (error) {
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not create Gmail OAuth URL",
      500,
      "GMAIL_OAUTH_URL_FAILED"
    );
  }
});

architectRoutes.delete("/connectors/gmail", async (c) => {
  const authUser = c.get("authUser");

  await disconnectGmail(authUser.id);

  return successResponse(c, null, "Gmail disconnected");
});

architectRoutes.post("/connectors/twilio/business-installations", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = businessInstallationSchema.parse(await c.req.json());

    const workflow = await prisma.workflowDefinition.findFirst({
      where: {
        id: input.workflowId,
        architectUserId: authUser.id
      }
    });

    if (!workflow) {
      return errorResponse(c, "Agent workflow not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const business = await prisma.business.create({
      data: {
        ownerId: authUser.id,
        name: input.businessName,
        type: input.businessType,
        profile: {
          create: {
            bookingUrl: input.bookingUrl || null,
            teamPhone: input.teamPhone || null,
            calendarId: input.calendarId || "primary",
            timeZone: input.timeZone,
            vapiAssistantId: input.vapiAssistantId || null,
            vapiPhoneNumberId: input.vapiPhoneNumberId || null,
            services: input.services,
            faqsJson: input.faqs as never,
            tone: input.tone,
            escalationRules: input.escalationRules || null
          }
        },
        knowledgeBases: {
          create: input.knowledge.map((item) => ({
            title: item.title,
            content: item.content
          }))
        }
      },
      include: {
        profile: true,
        knowledgeBases: true
      }
    });

    const installedAgent = await prisma.installedAgent.create({
      data: {
        businessId: business.id,
        workflowId: workflow.id,
        listingId: input.listingId || undefined,
        name: workflow.name,
        status: "ACTIVE",
        configJson: {
          connectors: ["TWILIO", "VAPI", "GOOGLE_CALENDAR"],
          vapiAssistantId: input.vapiAssistantId || null,
          vapiPhoneNumberId: input.vapiPhoneNumberId || null,
          calendarId: input.calendarId || "primary"
        }
      }
    });

    const phoneNumber = await prisma.businessPhoneNumber.create({
      data: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        phoneNumber: input.twilioPhoneNumber.replace(/[^+\d]/g, ""),
        twilioPhoneNumberSid: input.twilioPhoneNumberSid || null,
        forwardToPhone: input.forwardToPhone || null,
        isActive: true
      }
    });

    return successResponse(
      c,
      {
        business,
        installedAgent,
        phoneNumber,
        webhooks: {
          voice: `${env.BACKEND_URL}/architect/connectors/twilio/voice`,
          sms: `${env.BACKEND_URL}/architect/connectors/twilio/inbound-sms`,
          vapi: `${env.BACKEND_URL}/architect/connectors/vapi/webhook`
        }
      },
      "Business installation created"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid business installation input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, error instanceof Error ? error.message : "Could not create business installation", 500, "BUSINESS_INSTALLATION_FAILED");
  }
});

architectRoutes.get("/workflows", async (c) => {
  const authUser = c.get("authUser");

  const workflows = await prisma.workflowDefinition.findMany({
    where: {
      architectUserId: authUser.id
    },
    include: {
      listings: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    workflows
  });
});

const PLACEHOLDER_WORKFLOW_NAMES = new Set([
  "",
  "untitled",
  "untitled agent",
  "new agent",
  "missed call text-back"
]);

architectRoutes.post("/workflows", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = workflowSchema.parse(await c.req.json());

    const nodeCount = Array.isArray(input.workflowJson.nodes) ? input.workflowJson.nodes.length : 0;
    if (nodeCount === 0 && PLACEHOLDER_WORKFLOW_NAMES.has(input.name.trim().toLowerCase())) {
      return errorResponse(c, "Cannot create empty workflow draft.", 422, "EMPTY_WORKFLOW_DRAFT");
    }

    const workflow = await prisma.workflowDefinition.create({
      data: {
        architectUserId: authUser.id,
        name: input.name,
        description: input.description || null,
        isTemplate: input.isTemplate,
        workflowJson: input.workflowJson as never
      }
    });

    return successResponse(c, { workflow }, "Agent created", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not create agent", 500, "WORKFLOW_CREATE_FAILED");
  }
});

architectRoutes.get("/workflows/:workflowId", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  const workflow = await prisma.workflowDefinition.findFirst({
    where: {
      id: workflowId,
      architectUserId: authUser.id
    },
    include: {
      listings: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true
        }
      }
    }
  });

  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  return successResponse(c, {
    workflow
  });
});

architectRoutes.put("/workflows/:workflowId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const workflowId = c.req.param("workflowId");
    const input = workflowUpdateSchema.parse(await c.req.json());

    const existingWorkflow = await prisma.workflowDefinition.findFirst({
      where: {
        id: workflowId,
        architectUserId: authUser.id
      }
    });

    if (!existingWorkflow) {
      return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const workflow = await prisma.workflowDefinition.update({
      where: {
        id: workflowId
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description || null }
          : {}),
        ...(input.isTemplate !== undefined ? { isTemplate: input.isTemplate } : {}),
        ...(input.workflowJson !== undefined
          ? { workflowJson: input.workflowJson as never }
          : {})
      }
    });

    return successResponse(c, { workflow }, "Agent saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not save agent", 500, "WORKFLOW_UPDATE_FAILED");
  }
});

architectRoutes.delete("/workflows/:workflowId", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  const existingWorkflow = await prisma.workflowDefinition.findFirst({
    where: {
      id: workflowId,
      architectUserId: authUser.id
    }
  });

  if (!existingWorkflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  // Safety: only a true draft can be deleted. Never delete a workflow that has a
  // listing (submitted/published) or is deployed as a live agent (installed).
  const listing = await prisma.agentListing.findFirst({ where: { workflowId } });
  if (listing) {
    return errorResponse(
      c,
      "This workflow has been submitted/published and cannot be deleted as a draft.",
      409,
      "WORKFLOW_HAS_LISTING"
    );
  }
  const installed = await prisma.installedAgent.findFirst({ where: { workflowId } });
  if (installed) {
    return errorResponse(
      c,
      "This workflow is deployed as a live agent and cannot be deleted as a draft.",
      409,
      "WORKFLOW_DEPLOYED"
    );
  }

  await prisma.workflowDefinition.delete({
    where: {
      id: workflowId
    }
  });

  return successResponse(c, { workflowId }, "Agent deleted");
});

// Bulk draft cleanup: deletes ONLY the architect's draft workflows that have no
// AgentListing and are not deployed (no InstalledAgent). Never touches
// submitted/published listings or live agents.
architectRoutes.post("/workflows/cleanup-drafts", async (c) => {
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as {
    deleteUntitled?: unknown;
    deleteDuplicateTemplates?: unknown;
  };
  const deleteUntitled = body.deleteUntitled !== false;
  const deleteDuplicateTemplates = body.deleteDuplicateTemplates !== false;

  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: authUser.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true }
  });

  const listedIds = new Set(
    (
      await prisma.agentListing.findMany({
        where: { architectUserId: authUser.id, workflowId: { not: null } },
        select: { workflowId: true }
      })
    )
      .map((listing) => listing.workflowId)
      .filter((id): id is string => Boolean(id))
  );
  const deployedIds = new Set(
    (
      await prisma.installedAgent.findMany({
        where: { workflowId: { in: workflows.map((workflow) => workflow.id) } },
        select: { workflowId: true }
      })
    ).map((agent) => agent.workflowId)
  );

  // Only undeployed, unlisted workflows are eligible for cleanup.
  const candidates = workflows.filter((workflow) => !listedIds.has(workflow.id) && !deployedIds.has(workflow.id));

  const isUntitled = (name: string) => {
    const normalized = (name ?? "").trim().toLowerCase();
    return !normalized || normalized === "untitled" || normalized === "untitled agent" || normalized === "new agent";
  };

  const toDelete = new Map<string, string>();
  if (deleteUntitled) {
    for (const workflow of candidates) {
      if (isUntitled(workflow.name)) toDelete.set(workflow.id, workflow.name);
    }
  }
  if (deleteDuplicateTemplates) {
    // candidates are newest-first; keep the first per name, delete later duplicates.
    const seenNames = new Set<string>();
    for (const workflow of candidates) {
      const key = (workflow.name ?? "").trim().toLowerCase();
      if (seenNames.has(key)) toDelete.set(workflow.id, workflow.name);
      else seenNames.add(key);
    }
  }

  const ids = Array.from(toDelete.keys());
  if (ids.length > 0) {
    await prisma.workflowDefinition.deleteMany({
      where: { id: { in: ids }, architectUserId: authUser.id }
    });
  }

  return successResponse(
    c,
    { deletedCount: ids.length, deletedNames: Array.from(toDelete.values()) },
    "Draft clutter cleared"
  );
});

/**
 * DEV/DEMO-ONLY — NOT normal architect product behavior. The architect UI no
 * longer calls this; architects only design + publish. Real buyer/business
 * deployment happens through POST /business/setup. Kept solely for local
 * demo/self-test of the live voice path.
 *
 * Deploy the builder's 6-node Dental AI Receptionist as a live voice agent.
 * Full provision: builds the Vapi assistant from the AI Conversation node,
 * provisions Business + InstalledAgent + BusinessProfile, assigns a Twilio
 * number, and binds it so inbound calls are answered by the deployed assistant.
 */
architectRoutes.post("/workflows/:workflowId/deploy", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  try {
    const deployment = await deployDentalWorkflow({
      architectUserId: authUser.id,
      workflowId
    });
    return successResponse(c, { deployment }, "Agent deployed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deployment failed";
    return errorResponse(c, message, 503, "DEPLOY_FAILED");
  }
});

/* ---- Phone routing (generic per-business forwarding setup) ---- */

architectRoutes.get("/phone-routing/status", async (c) => {
  const authUser = c.get("authUser");
  return successResponse(c, await getPhoneRoutingStatus(authUser.id));
});

architectRoutes.post("/phone-routing/setup", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await setupPhoneRouting(authUser.id, body);
    return successResponse(c, result, "Phone routing saved");
  } catch (error) {
    return errorResponse(c, error instanceof Error ? error.message : "Setup failed", 400, "PHONE_ROUTING_SETUP_FAILED");
  }
});

architectRoutes.patch("/phone-routing/mode", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown };
    const result = await setPhoneRoutingMode(authUser.id, body.mode);
    return successResponse(c, result, "Routing mode updated");
  } catch (error) {
    return errorResponse(c, error instanceof Error ? error.message : "Update failed", 400, "PHONE_ROUTING_MODE_FAILED");
  }
});

architectRoutes.post("/phone-routing/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { called?: unknown; from?: unknown };
  return successResponse(c, await testPhoneRouting(body));
});

/* ---- Template gallery (static seed + architect-saved workflows) ---- */

architectRoutes.get("/templates", async (c) => {
  const saved = await listSavedTemplateCards();
  const seed = listTemplateCards();
  return successResponse(c, { templates: [...saved, ...seed] });
});

architectRoutes.get("/templates/:slug", async (c) => {
  const slug = c.req.param("slug");
  const saved = await getSavedTemplateBySlug(slug);
  if (saved) {
    return successResponse(c, { template: saved });
  }

  const template = getTemplateBySlug(slug);
  if (!template) {
    return errorResponse(c, "Template not found", 404, "TEMPLATE_NOT_FOUND");
  }
  return successResponse(c, { template });
});

/**
 * Import a template: clone its workflowJson into a workflow for this architect —
 * the existing one when `workflowId` is supplied, otherwise a new one. Returns the
 * workflowId + workflowJson. Pure data import: no template flags are persisted.
 */
architectRoutes.post("/templates/:slug/use", async (c) => {
  const authUser = c.get("authUser");
  const slug = c.req.param("slug");

  const saved = await getSavedTemplateBySlug(slug);
  if (saved) {
    const body = (await c.req.json().catch(() => ({}))) as { workflowId?: unknown };
    const targetWorkflowId = typeof body.workflowId === "string" ? body.workflowId : undefined;
    const workflowJson = cloneSavedTemplateWorkflow(saved);

    let workflow = null;
    if (targetWorkflowId) {
      const existing = await prisma.workflowDefinition.findFirst({
        where: { id: targetWorkflowId, architectUserId: authUser.id }
      });
      if (existing) {
        workflow = await prisma.workflowDefinition.update({
          where: { id: existing.id },
          data: {
            name: saved.title,
            description: saved.description,
            workflowJson: workflowJson as never
          }
        });
      }
    }

    if (!workflow) {
      workflow = await prisma.workflowDefinition.create({
        data: {
          architectUserId: authUser.id,
          name: saved.title,
          description: saved.description,
          workflowJson: workflowJson as never
        }
      });
    }

    return successResponse(
      c,
      {
        workflowId: workflow.id,
        name: workflow.name,
        description: workflow.description,
        workflowJson
      },
      "Template imported"
    );
  }

  const template = getTemplateBySlug(slug);
  if (!template) {
    return errorResponse(c, "Template not found", 404, "TEMPLATE_NOT_FOUND");
  }

  const body = (await c.req.json().catch(() => ({}))) as { workflowId?: unknown };
  const targetWorkflowId = typeof body.workflowId === "string" ? body.workflowId : undefined;
  const workflowJson = cloneTemplateWorkflow(template);

  let workflow = null;
  if (targetWorkflowId) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { id: targetWorkflowId, architectUserId: authUser.id }
    });
    if (existing) {
      workflow = await prisma.workflowDefinition.update({
        where: { id: existing.id },
        data: {
          name: template.title,
          description: template.description,
          workflowJson: workflowJson as never
        }
      });
    }
  }

  if (!workflow) {
    workflow = await prisma.workflowDefinition.create({
      data: {
        architectUserId: authUser.id,
        name: template.title,
        description: template.description,
        workflowJson: workflowJson as never
      }
    });
  }

  return successResponse(
    c,
    {
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      workflowJson
    },
    "Template imported"
  );
});

architectRoutes.post("/template-requests", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = templateRequestSchema.parse(await c.req.json());

    const request = await prisma.templateRequest.create({
      data: {
        architectUserId: authUser.id,
        industry: input.industry,
        description: input.description
      },
      select: {
        id: true,
        industry: true,
        description: true,
        createdAt: true
      }
    });

    return successResponse(c, { request }, "Template request submitted", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid template request",
        422,
        "VALIDATION_ERROR"
      );
    }
    return errorResponse(c, "Could not submit template request", 500, "TEMPLATE_REQUEST_FAILED");
  }
});

async function runOwnedWorkflow({
  c,
  mode
}: {
  c: Context;
  mode: "test" | "live";
}) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  const body = await c.req.json().catch(() => ({}));
  const input = workflowRunTestSchema.parse(body);

  const workflow = await prisma.workflowDefinition.findFirst({
    where: {
      id: workflowId,
      architectUserId: authUser.id
    }
  });

  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  if (mode === "live" && !input.input?.callerNumber?.trim()) {
    return errorResponse(
      c,
      "Caller number is required before sending with Twilio",
      422,
      "CALLER_NUMBER_REQUIRED"
    );
  }

  const run = await runWorkflowTest({
    userId: authUser.id,
    workflowId,
    workflowJson: workflow.workflowJson,
    input: input.input,
    mode
  });

  return successResponse(
    c,
    { run },
    mode === "live" ? "Twilio workflow run completed" : "Workflow test completed"
  );
}

/* ---- Architect SANDBOX test deployment (pre-publish live testing) ----
 * Test/sandbox-only: creates an architect-owned sandbox Business + InstalledAgent
 * (configJson.purpose = "ARCHITECT_TEST") and reserves an AVAILABLE platform
 * number. Never touches buyer installs and never publishes anything. */

const testDeploymentSchema = z.object({
  businessName: z.string().trim().max(120).optional(),
  businessType: z.string().trim().max(80).optional(),
  calendarId: z.string().trim().max(200).optional(),
  timeZone: z.string().trim().max(80).optional(),
  services: z.array(z.string().trim().min(1)).max(50).optional(),
  faqs: z.array(z.string().trim().min(1)).max(50).optional(),
  knowledge: z.array(z.string().trim().min(1)).max(50).optional()
});

function handleTestDeploymentError(c: Context, error: unknown) {
  if (error instanceof TestDeploymentError) {
    return errorResponse(c, error.message, error.status, error.code);
  }
  console.error("[test-deployment] failed", error);
  return errorResponse(
    c,
    error instanceof Error ? error.message : "Test deployment failed",
    503,
    "TEST_DEPLOYMENT_FAILED"
  );
}

architectRoutes.get("/workflows/:workflowId/test-deployment", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");
  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  try {
    const testDeployment = await getArchitectTestDeploymentStatus(authUser.id, workflowId);
    return successResponse(c, { testDeployment });
  } catch (error) {
    return handleTestDeploymentError(c, error);
  }
});

architectRoutes.post("/workflows/:workflowId/test-deployment", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");
  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  try {
    const input = testDeploymentSchema.parse(await c.req.json().catch(() => ({})));
    const testDeployment = await startArchitectTestDeployment(authUser.id, workflowId, input);
    return successResponse(c, { testDeployment }, "Live sandbox ready");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid test input", 422, "VALIDATION_ERROR");
    }
    return handleTestDeploymentError(c, error);
  }
});

architectRoutes.delete("/workflows/:workflowId/test-deployment", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");
  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  try {
    const testDeployment = await stopArchitectTestDeployment(authUser.id, workflowId);
    return successResponse(c, { testDeployment }, "Sandbox test stopped");
  } catch (error) {
    return handleTestDeploymentError(c, error);
  }
});

architectRoutes.post("/workflows/:workflowId/vapi-browser-test/start", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  try {
    const input = vapiBrowserTestSchema.parse(await c.req.json().catch(() => ({})));
    const session = await startArchitectVapiBrowserTest(authUser.id, workflowId, input.testContext);
    return successResponse(c, { session }, "Vapi browser test ready");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid test input", 422, "VALIDATION_ERROR");
    }
    return handleTestDeploymentError(c, error);
  }
});

architectRoutes.get("/vapi-browser-test/calls/:callId/end-reason", async (c) => {
  const authUser = c.get("authUser");
  const callId = c.req.param("callId");

  if (!callId) {
    return errorResponse(c, "Call id is required", 422, "CALL_ID_REQUIRED");
  }

  try {
    const endReason = await getArchitectVapiBrowserTestCallEndReason(authUser.id, callId);
    return successResponse(c, { endReason }, "Call end reason");
  } catch (error) {
    return handleTestDeploymentError(c, error);
  }
});

architectRoutes.post("/workflows/:workflowId/conversation-test", async (c) => {
  try {
    const authUser = c.get("authUser");
    const workflowId = c.req.param("workflowId");

    if (!workflowId) {
      return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
    }

    const input = architectConversationTestSchema.parse(
      await c.req.json().catch(() => ({}))
    );

    const workflow = await prisma.workflowDefinition.findFirst({
      where: {
        id: workflowId,
        architectUserId: authUser.id
      }
    });

    if (!workflow) {
      return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const result = await runArchitectConversationTest({
      userId: authUser.id,
      workflowId,
      workflowJson: workflow.workflowJson,
      message: input.message,
      history: input.history,
      testContext: input.testContext,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: input.testSessionId,
      useTestCalendar: input.useTestCalendar
    });

    return successResponse(
      c,
      { conversation: result },
      "Browser conversation test completed"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid conversation test input",
        422,
        "VALIDATION_ERROR"
      );
    }

    console.error("[architect-conversation-test] failed", error);

    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not run browser conversation test",
      500,
      "ARCHITECT_CONVERSATION_TEST_FAILED"
    );
  }
});

// Latest test calendar event for this architect (optionally per test session) —
// lets the browser voice call test surface the event booked during the call.
architectRoutes.get("/test-events/latest", async (c) => {
  const authUser = c.get("authUser");
  const testSessionId = c.req.query("testSessionId")?.trim();

  const row = await prisma.testCalendarEvent.findFirst({
    where: {
      ownerUserId: authUser.id,
      executionMode: "ARCHITECT_DRY_RUN",
      status: { not: "DELETED" },
      ...(testSessionId ? { testSessionId } : {})
    },
    orderBy: { createdAt: "desc" }
  });

  if (!row) return successResponse(c, { event: null });

  return successResponse(c, {
    event: {
      testEventId: row.id,
      title: calendarEventTitleForMode("ARCHITECT_DRY_RUN", row.serviceName),
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      timeZone: row.timeZone,
      htmlLink: row.htmlLink,
      status: row.status === "CREATED" ? "CREATED" : "SIMULATED"
    }
  });
});

// Delete an Architect test calendar event — ownership-validated and idempotent.
architectRoutes.post("/test-events/:id/delete", async (c) => {
  const authUser = c.get("authUser");
  const testEventId = c.req.param("id");

  const result = await deleteTestCalendarEvent({
    testEventId,
    requesterUserId: authUser.id,
    scope: "ARCHITECT"
  });

  if (result.outcome === "not_found") {
    return errorResponse(c, "Test event not found.", 404, "TEST_EVENT_NOT_FOUND");
  }
  if (result.outcome === "ownership_denied") {
    return errorResponse(c, "This test event does not belong to you.", 403, "TEST_EVENT_OWNERSHIP_DENIED");
  }
  if (result.outcome === "calendar_disconnected" || result.outcome === "provider_failure") {
    const deleteError = result.error;
    return errorResponse(
      c,
      deleteError?.message ?? "The test event could not be deleted.",
      result.outcome === "calendar_disconnected" ? 409 : 503,
      deleteError?.code ?? "CALENDAR_EVENT_DELETE_FAILED"
    );
  }

  return successResponse(c, { outcome: result.outcome });
});

architectRoutes.post("/workflows/:workflowId/run-test", async (c) => {
  try {
    return await runOwnedWorkflow({ c, mode: "test" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid test input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not run workflow test", 500, "WORKFLOW_TEST_FAILED");
  }
});

architectRoutes.post("/workflows/:workflowId/run-live", async (c) => {
  try {
    return await runOwnedWorkflow({ c, mode: "live" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid Twilio test input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not send Twilio SMS",
      500,
      "TWILIO_RUN_FAILED"
    );
  }
});

// ---- Architect Configure flow (marketplace template metadata) ----
// Draft lives on WorkflowDefinition.configureJson; submit-review maps it onto
// the AgentListing the marketplace reads. Architect-only (registered after the
// requireAuth + requireRole("ARCHITECT") guards above).
architectRoutes.get("/workflows/:workflowId/configure", getWorkflowConfigure);
architectRoutes.patch("/workflows/:workflowId/configure", patchWorkflowConfigure);
architectRoutes.post("/workflows/:workflowId/configure/save-draft", saveWorkflowConfigureDraft);
architectRoutes.post("/workflows/:workflowId/submit-review", submitWorkflowForReview);
architectRoutes.post("/workflows/:workflowId/publish", publishWorkflowListing);
architectRoutes.get("/workflows/:workflowId/marketplace-preview", getWorkflowMarketplacePreview);

/** My Agents card fields — prefer Configure draft when present so cards stay real-time. */
function myAgentsCardFieldsFromConfigure(
  configureJson: unknown,
  seed: { name?: string | null; description?: string | null }
) {
  const configure = normalizeAgentConfigure(configureJson, {
    name: seed.name,
    tagline: seed.description,
    description: seed.description
  });
  const includedFeatures = configure.media.includedFeatures.map((feature) => feature.trim()).filter(Boolean);
  const screenshotUrls = configure.media.screenshotUrls.map((url) => url.trim()).filter(Boolean);
  return {
    name: configure.basics.agentName.trim() || seed.name?.trim() || "Untitled Agent",
    shortDescription:
      configure.basics.shortDescription.trim() ||
      configure.basics.tagline.trim() ||
      seed.description?.trim() ||
      "",
    tagline: configure.basics.tagline.trim() || null,
    category: configure.basics.category.trim() || null,
    tags: configure.basics.industryTags,
    industryTags: configure.basics.industryTags,
    iconUrl: configure.basics.iconUrl.trim() || null,
    includedFeatures,
    screenshotUrls,
    coverUrl: screenshotUrls[0] ?? null
  };
}

function plainConfigureText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Seven Configure milestones for draft completion % on My Agents cards. */
function computeDraftProgress(configureJson: unknown, seed: { name?: string | null; description?: string | null }) {
  const configure = normalizeAgentConfigure(configureJson, {
    name: seed.name,
    tagline: seed.description,
    description: seed.description
  });
  const checks = configure.compliance.complianceChecks;
  const steps: Array<{ label: string; done: boolean }> = [
    { label: "Name", done: configure.basics.agentName.trim().length >= 2 },
    { label: "Tagline", done: configure.basics.tagline.trim().length >= 10 },
    { label: "Category", done: Boolean(configure.basics.category.trim()) },
    { label: "Industry", done: configure.basics.industryTags.length > 0 },
    { label: "Description", done: plainConfigureText(configure.media.fullDescription).length >= 100 },
    {
      label: "Pricing",
      done: configure.pricing.pricingModel === "free" || configure.pricing.price > 0
    },
    {
      label: "Compliance",
      done: Boolean(checks.guidelines && checks.tested && checks.accurate && checks.terms)
    }
  ];
  const stepsCompleted = steps.filter((step) => step.done).length;
  const stepsTotal = steps.length;
  return {
    stepsCompleted,
    stepsTotal,
    percent: Math.round((stepsCompleted / stepsTotal) * 100),
    missing: steps.filter((step) => !step.done).map((step) => step.label)
  };
}

function computeReviewProgress(listing: {
  category: string | null;
  priceCents: number;
  pricingModel?: string | null;
  complianceChecks: unknown;
}) {
  const checksRaw =
    listing.complianceChecks && typeof listing.complianceChecks === "object" && !Array.isArray(listing.complianceChecks)
      ? (listing.complianceChecks as Record<string, unknown>)
      : {};
  const complianceDone = Boolean(
    checksRaw.guidelines && checksRaw.tested && checksRaw.accurate && checksRaw.terms
  );
  const pricingDone =
    listing.pricingModel === "FREE" || listing.priceCents > 0 || listing.priceCents === 0;
  const items = [
    { label: "Listing details", done: true },
    { label: "Compliance checks", done: complianceDone },
    { label: "Marketplace ready", done: Boolean(listing.category?.trim()) && pricingDone },
    { label: "Manual review", done: false }
  ];
  const passed = items.filter((item) => item.done).length;
  return {
    percent: Math.round((passed / items.length) * 100),
    passed,
    total: items.length,
    items
  };
}

architectRoutes.get("/listings", async (c) => {
  const authUser = c.get("authUser");
  const statusFilter = c.req.query("status");

  const [allListings, sales, profile, installedAgents] = await Promise.all([
    prisma.agentListing.findMany({
      where: {
        architectUserId: authUser.id,
        // Soft-deleted live listings stay in the DB (earnings history) but
        // disappear from My Agents.
        NOT: { AND: [{ status: "SUSPENDED" }, { rejectionReason: { startsWith: "[deleted by architect]" } }] }
      },
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            description: true,
            configureJson: true,
            updatedAt: true
          }
        },
        _count: {
          select: { installedAgents: true }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    loadArchitectEarnings(authUser.id),
    prisma.architectProfile.findUnique({
      where: { userId: authUser.id },
      select: { rating: true }
    }),
    prisma.installedAgent.findMany({
      where: { listing: { architectUserId: authUser.id } },
      select: { id: true, listingId: true, businessId: true, configJson: true }
    })
  ]);

  const revenueByListing = new Map<string, number>();
  const installCountByListing = new Map<string, number>();
  for (const sale of sales) {
    installCountByListing.set(sale.listingId, (installCountByListing.get(sale.listingId) ?? 0) + 1);
    if (effectiveEarningStatus(sale) === "REJECTED") continue;
    revenueByListing.set(
      sale.listingId,
      (revenueByListing.get(sale.listingId) ?? 0) + sale.earningsCents
    );
  }

  const buyerInstalls = installedAgents.filter((agent) => {
    const config = agent.configJson;
    if (!config || typeof config !== "object" || Array.isArray(config)) return true;
    return (config as Record<string, unknown>).purpose !== "ARCHITECT_TEST";
  });
  const executionByListing = new Map<string, number>();
  const businessIds = [...new Set(buyerInstalls.map((agent) => agent.businessId))];
  const agentsByBusiness = new Map<string, Array<{ id: string; listingId: string | null }>>();
  for (const agent of buyerInstalls) {
    const list = agentsByBusiness.get(agent.businessId) ?? [];
    list.push({ id: agent.id, listingId: agent.listingId });
    agentsByBusiness.set(agent.businessId, list);
  }
  await Promise.all(
    businessIds.map(async (businessId) => {
      const agents = agentsByBusiness.get(businessId) ?? [];
      const stats = await buildInstalledAgentRunStats(businessId, agents);
      for (const agent of agents) {
        if (!agent.listingId) continue;
        const runs = stats.get(agent.id)?.runs ?? 0;
        executionByListing.set(
          agent.listingId,
          (executionByListing.get(agent.listingId) ?? 0) + runs
        );
      }
    })
  );

  const architectRating = typeof profile?.rating === "number" ? profile.rating : null;

  const seenWorkflowIds = new Set<string>();
  const listings = allListings
    .filter((listing) => {
      if (!listing.workflowId) return true;
      if (seenWorkflowIds.has(listing.workflowId)) return false;
      seenWorkflowIds.add(listing.workflowId);
      return true;
    })
    .map(({ _count, workflow, ...listing }) => {
      const configureFields = workflow
        ? myAgentsCardFieldsFromConfigure(workflow.configureJson, {
            name: workflow.name || listing.name,
            description: workflow.description ?? listing.shortDescription
          })
        : null;
      const screenshotUrls =
        listing.screenshotUrls?.length
          ? listing.screenshotUrls
          : configureFields?.screenshotUrls ?? [];
      const tags =
        listing.industryTags?.length
          ? listing.industryTags
          : listing.tags?.length
            ? listing.tags
            : configureFields?.tags ?? [];
      const includedFeatures =
        listing.includedFeatures?.length
          ? listing.includedFeatures
          : configureFields?.includedFeatures ?? [];
      const draftProgress = computeDraftProgress(workflow?.configureJson ?? null, {
        name: workflow?.name || listing.name,
        description: workflow?.description ?? listing.shortDescription
      });
      const reviewProgress = computeReviewProgress(listing);
      return {
        ...listing,
        name: listing.name?.trim() || configureFields?.name || "Untitled Agent",
        shortDescription:
          listing.shortDescription?.trim() ||
          configureFields?.shortDescription ||
          "",
        tagline: listing.tagline ?? configureFields?.tagline ?? null,
        category: listing.category ?? configureFields?.category ?? null,
        tags,
        industryTags: listing.industryTags?.length
          ? listing.industryTags
          : configureFields?.industryTags ?? [],
        iconUrl: listing.iconUrl ?? configureFields?.iconUrl ?? null,
        includedFeatures,
        screenshotUrls,
        coverUrl: screenshotUrls[0] ?? configureFields?.coverUrl ?? null,
        installCount: installCountByListing.get(listing.id) ?? _count.installedAgents ?? 0,
        executionCount: executionByListing.get(listing.id) ?? 0,
        revenueCents: revenueByListing.get(listing.id) ?? 0,
        rating: architectRating,
        draftProgress,
        reviewProgress,
        updatedAt: listing.updatedAt ?? listing.createdAt,
        submittedAt: listing.submittedAt ?? null,
        workflow: workflow
          ? { id: workflow.id, name: workflow.name, description: workflow.description }
          : null
      };
    });

  // Workflows the architect saved or imported (builder/template) but hasn't
  // published yet → their DRAFT agents. Never hidden.
  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      configureJson: true
    }
  });
  const drafts = workflows
    .filter((workflow) => !seenWorkflowIds.has(workflow.id))
    .map((workflow) => {
      const card = myAgentsCardFieldsFromConfigure(workflow.configureJson, {
        name: workflow.name,
        description: workflow.description
      });
      const draftProgress = computeDraftProgress(workflow.configureJson, {
        name: workflow.name,
        description: workflow.description
      });
      return {
        id: `draft-${workflow.id}`,
        workflowId: workflow.id,
        name: card.name,
        shortDescription: card.shortDescription,
        description: workflow.description ?? null,
        tagline: card.tagline,
        category: card.category,
        priceCents: 0,
        status: "DRAFT" as const,
        tags: card.tags,
        industryTags: card.industryTags,
        iconUrl: card.iconUrl,
        includedFeatures: card.includedFeatures,
        screenshotUrls: card.screenshotUrls,
        coverUrl: card.coverUrl,
        requiredConnectors: [] as string[],
        supportedLlms: [] as string[],
        installCount: 0,
        executionCount: 0,
        revenueCents: 0,
        rating: architectRating,
        draftProgress,
        reviewProgress: null,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        submittedAt: null,
        workflow: null
      };
    });

  const combined = [...listings, ...drafts].sort(
    (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
  );
  const result = statusFilter ? combined.filter((agent) => agent.status === statusFilter) : combined;

  return successResponse(c, {
    listings: result
  });
});

architectRoutes.post("/listings", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = listingSchema.parse(await c.req.json());
    const workflowId = input.workflowId || undefined;

    const workflow = workflowId
      ? await prisma.workflowDefinition.findFirst({
        where: {
          id: workflowId,
          architectUserId: authUser.id
        }
      })
      : null;

    if (workflowId && !workflow) {
      return errorResponse(c, "Agent workflow not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const requiredConnectors = Array.from(
      new Set([
        ...input.requiredConnectors,
        ...(workflow ? requiredConnectorKeys(workflow.workflowJson) : [])
      ])
    );

    const existingListing = workflowId
      ? await prisma.agentListing.findFirst({
        where: {
          architectUserId: authUser.id,
          workflowId
        },
        orderBy: {
          createdAt: "desc"
        }
      })
      : null;

    const listingData = {
      name: input.name,
      shortDescription: input.shortDescription,
      description: input.description || null,
      priceCents: input.priceCents,
      tags: input.tags,
      requiredConnectors,
      supportedLlms: input.supportedLlms,
      status: "PENDING_REVIEW" as const
    };

    if (existingListing) {
      const listing = await prisma.agentListing.update({
        where: { id: existingListing.id },
        data: listingData
      });

      return successResponse(c, { listing }, "Agent listing updated and resubmitted for review");
    }

    const listing = await prisma.agentListing.create({
      data: {
        architectUserId: authUser.id,
        workflowId,
        ...listingData
      }
    });

    return successResponse(c, { listing }, "Agent submitted for review", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent listing input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not create agent listing", 500, "LISTING_CREATE_FAILED");
  }
});

const listingStatusUpdateSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "PAUSED"])
});

const architectListingStatusTransitions: Partial<
  Record<
    "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED" | "PAUSED",
    Array<"DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED" | "PAUSED">
  >
> = {
  PENDING_REVIEW: ["DRAFT"],
  REJECTED: ["DRAFT"],
  // Live agents can be paused (removed from the marketplace) and resumed.
  APPROVED: ["PAUSED"],
  PAUSED: ["APPROVED"]
};

const DELETABLE_LISTING_STATUSES = ["DRAFT", "REJECTED", "PENDING_REVIEW", "APPROVED", "PAUSED"] as const;

architectRoutes.delete("/listings/:listingId", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.param("listingId");

  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const deleteReason = typeof body.reason === "string" ? body.reason.trim() : "";

  const listing = await prisma.agentListing.findFirst({
    where: {
      id: listingId,
      architectUserId: authUser.id
    },
    include: {
      _count: {
        select: { installedAgents: true, payments: true }
      }
    }
  });

  if (!listing) {
    return errorResponse(c, "Agent not found", 404, "LISTING_NOT_FOUND");
  }

  if (!DELETABLE_LISTING_STATUSES.includes(listing.status as (typeof DELETABLE_LISTING_STATUSES)[number])) {
    return errorResponse(
      c,
      "This agent cannot be deleted in its current status.",
      409,
      "LISTING_NOT_DELETABLE"
    );
  }

  // Any listing with sales history must be soft-deleted — hard deletion nulls
  // Payment.listingId and erases architect earnings.
  const isLive =
    listing.status === "APPROVED" || listing.status === "PAUSED" || listing._count.payments > 0;

  if (isLive) {
    // Live agents are soft-deleted: hard deletion would null Payment.listingId
    // and erase the architect's earnings history, and would strand buyer
    // installs. Suspending removes it from the marketplace and My Agents
    // while preserving sales records and installed buyer agents.
    if (deleteReason.length < 5) {
      return errorResponse(
        c,
        "A deletion reason is required when removing a live agent.",
        422,
        "DELETE_REASON_REQUIRED"
      );
    }

    await prisma.agentListing.update({
      where: { id: listingId },
      data: {
        status: "SUSPENDED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: `[deleted by architect] ${deleteReason}`
      }
    });

    console.warn("[architect] live listing removed (soft delete)", {
      listingId,
      architectUserId: authUser.id,
      previousStatus: listing.status,
      installs: listing._count.installedAgents,
      reason: deleteReason
    });

    return successResponse(c, { listingId, workflowId: listing.workflowId, softDeleted: true }, "Agent deleted");
  }

  if (listing._count.installedAgents > 0) {
    return errorResponse(
      c,
      "This agent has active installs and cannot be deleted.",
      409,
      "LISTING_HAS_INSTALLS"
    );
  }

  const workflowId = listing.workflowId;

  await prisma.$transaction(async (tx) => {
    await tx.agentListing.delete({ where: { id: listingId } });

    if (workflowId) {
      const otherListing = await tx.agentListing.findFirst({ where: { workflowId } });
      const installed = await tx.installedAgent.findFirst({ where: { workflowId } });
      if (!otherListing && !installed) {
        await tx.workflowDefinition.deleteMany({
          where: {
            id: workflowId,
            architectUserId: authUser.id
          }
        });
      }
    }
  });

  return successResponse(c, { listingId, workflowId }, "Agent deleted");
});

architectRoutes.patch("/listings/:agentId/status", async (c) => {
  try {
    const authUser = c.get("authUser");
    const agentId = c.req.param("agentId");
    const input = listingStatusUpdateSchema.parse(await c.req.json());

    const listing = await prisma.agentListing.findFirst({
      where: {
        id: agentId,
        architectUserId: authUser.id
      }
    });

    if (!listing) {
      return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
    }

    const allowedNextStatuses = architectListingStatusTransitions[listing.status] ?? [];

    if (!allowedNextStatuses.includes(input.status)) {
      return errorResponse(
        c,
        `Cannot change agent status from ${listing.status} to ${input.status}`,
        409,
        "INVALID_STATUS_TRANSITION"
      );
    }

    const updatedListing = await prisma.$transaction(async (tx) => {
      const nextListing = await tx.agentListing.update({
        where: { id: agentId },
        data: { status: input.status }
      });

      if (listing.status === "PAUSED" && input.status === "APPROVED") {
        const remainingPaused = await tx.agentListing.count({
          where: {
            architectUserId: authUser.id,
            status: "PAUSED"
          }
        });

        await tx.architectProfile.upsert({
          where: { userId: authUser.id },
          update: { agentsPaused: remainingPaused > 0 },
          create: { userId: authUser.id, agentsPaused: remainingPaused > 0 }
        });
      }

      return nextListing;
    });

    return successResponse(c, { listing: updatedListing }, "Agent status updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent status input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not update agent status", 500, "LISTING_STATUS_UPDATE_FAILED");
  }
});

architectRoutes.get("/projects", async (c) => {
  const authUser = c.get("authUser");

  const projects = await prisma.project.findMany({
    where: {
      status: "OPEN",
      proposals: {
        none: {
          architectUserId: authUser.id
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    projects
  });
});

architectRoutes.post("/projects/:projectId/proposals", async (c) => {
  try {
    const authUser = c.get("authUser");
    const projectId = c.req.param("projectId");
    const input = proposalSchema.parse(await c.req.json());

    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      }
    });

    if (!project) {
      return errorResponse(c, "Project not found", 404, "PROJECT_NOT_FOUND");
    }

    if (project.status !== "OPEN") {
      return errorResponse(c, "Project is not open for proposals", 409, "PROJECT_NOT_OPEN");
    }

    const proposal = await prisma.projectProposal.create({
      data: {
        projectId,
        architectUserId: authUser.id,
        coverLetter: input.coverLetter,
        bidAmountCents: input.bidAmountCents,
        etaDays: input.etaDays
      },
      include: {
        project: true
      }
    });

    return successResponse(c, { proposal }, "Proposal submitted", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid proposal input",
        422,
        "VALIDATION_ERROR"
      );
    }

    if (isPrismaErrorCode(error, "P2002")) {
      return errorResponse(
        c,
        "You already sent a proposal for this project",
        409,
        "PROPOSAL_EXISTS"
      );
    }

    return errorResponse(c, "Could not submit proposal", 500, "PROPOSAL_CREATE_FAILED");
  }
});

architectRoutes.get("/proposals", async (c) => {
  const authUser = c.get("authUser");

  const proposals = await prisma.projectProposal.findMany({
    where: {
      architectUserId: authUser.id
    },
    include: {
      project: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    proposals
  });
});
