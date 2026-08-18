import { Hono, type Context } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import { requireBusinessPermission } from "../team/membership";
import { generateAgentAiInsight } from "./ai-insights";
import {
  buildAnalyticsOverview,
  listAnalyticsCalls,
  parseAnalyticsPeriod,
  type AnalyticsFilters
} from "./service";
import { fetchVapiAssistant, type VapiAssistantLookup } from "./vapi-details";

/**
 * Buyer agent analytics API.
 *
 * One page, two modes:
 *   no agentId  → every installed agent side by side
 *   agentId     → that agent alone, plus its live voice-provider configuration
 *
 * The agent can arrive as ?agentId= or as an x-agent-id request header; both
 * resolve through the same ownership check, so a caller can never read another
 * business's agent by guessing an id.
 *
 * Authorization: view_reports (business-wide reporting) — the same permission
 * that gates every other cross-agent report in this workspace.
 */
export const analyticsRoutes = new Hono();

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Resolve the requested agent and prove the caller's business owns it.
 * Returns null when no agent was requested (the all-agents view).
 */
async function resolveRequestedAgent(
  businessId: string,
  requested: string | null
): Promise<{ ok: true; agentId: string | null } | { ok: false }> {
  if (!requested) return { ok: true, agentId: null };

  const agent = await prisma.installedAgent.findFirst({
    where: { id: requested, businessId },
    select: { id: true }
  });
  if (!agent) return { ok: false };

  return { ok: true, agentId: agent.id };
}

function readAgentId(c: Context): string | null {
  const fromQuery = c.req.query("agentId");
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();

  const fromHeader = c.req.header("x-agent-id");
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();

  return null;
}

analyticsRoutes.get("/overview", requireBusinessPermission("view_reports"), async (c) => {
  const membership = c.get("businessMembership");
  const period = parseAnalyticsPeriod(c.req.query("from"), c.req.query("to"));

  const requested = await resolveRequestedAgent(membership.businessId, readAgentId(c));
  if (!requested.ok) return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");

  const filters: AnalyticsFilters = {
    businessId: membership.businessId,
    agentId: requested.agentId,
    from: period.from,
    to: period.to
  };

  const overview = await buildAnalyticsOverview(filters);
  return successResponse(c, overview);
});

analyticsRoutes.get("/calls", requireBusinessPermission("view_reports"), async (c) => {
  const membership = c.get("businessMembership");
  const period = parseAnalyticsPeriod(c.req.query("from"), c.req.query("to"));

  const requested = await resolveRequestedAgent(membership.businessId, readAgentId(c));
  if (!requested.ok) return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");

  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query("pageSize")) || DEFAULT_PAGE_SIZE)
  );
  const sortOrder = c.req.query("sortOrder") === "asc" ? "asc" : "desc";

  const result = await listAnalyticsCalls({
    businessId: membership.businessId,
    agentId: requested.agentId,
    from: period.from,
    to: period.to,
    status: c.req.query("status") ?? null,
    outcome: c.req.query("outcome") ?? null,
    page,
    pageSize,
    sortOrder
  });

  return successResponse(c, result);
});

/**
 * Everything known about ONE agent: its local configuration, the phone numbers
 * routed to it, its knowledge, and the live assistant that Vapi is running.
 */
analyticsRoutes.get("/agents/:agentId", requireBusinessPermission("view_reports"), async (c) => {
  const membership = c.get("businessMembership");
  const agentId = c.req.param("agentId");

  const agent = await prisma.installedAgent.findFirst({
    where: { id: agentId, businessId: membership.businessId },
    select: {
      id: true,
      name: true,
      status: true,
      pausedAt: true,
      installSource: true,
      listingId: true,
      executionFeeCents: true,
      trialExecutionLimit: true,
      trialExecutionsUsed: true,
      configJson: true,
      createdAt: true,
      updatedAt: true,
      workflow: { select: { id: true, name: true } },
      listing: { select: { id: true, name: true, category: true } },
      phoneNumbers: {
        where: { isActive: true },
        select: { phoneNumber: true, forwardToPhone: true, createdAt: true }
      }
    }
  });
  if (!agent) return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");

  const config =
    agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
      ? (agent.configJson as Record<string, unknown>)
      : {};
  const vapiAssistantId =
    typeof config.vapiAssistantId === "string" && config.vapiAssistantId.trim()
      ? config.vapiAssistantId.trim()
      : null;

  // The live assistant lookup is best-effort: a provider outage degrades this
  // one card, never the whole page.
  const [assistant, knowledgeFiles, lastCall, activity] = await Promise.all([
    vapiAssistantId
      ? fetchVapiAssistant(vapiAssistantId).catch(
          (): VapiAssistantLookup => ({
            state: "unavailable",
            reason: "Could not reach the voice provider."
          })
        )
      : Promise.resolve<VapiAssistantLookup>({
          state: "unavailable",
          reason: "This agent has not been deployed to the voice provider yet."
        }),
    prisma.businessKnowledgeFile.count({
      where: { businessId: membership.businessId, installedAgentId: agent.id }
    }),
    prisma.vapiCall.findFirst({
      where: {
        businessId: membership.businessId,
        installedAgentId: agent.id,
        executionMode: "LIVE"
      },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, status: true, outcome: true }
    }),
    prisma.businessActivityLog.findMany({
      where: { businessId: membership.businessId, targetId: agent.id },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        action: true,
        actorLabel: true,
        detailJson: true,
        createdAt: true
      }
    })
  ]);

  return successResponse(c, {
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      pausedAt: agent.pausedAt ? agent.pausedAt.toISOString() : null,
      installSource: agent.installSource,
      listingId: agent.listingId,
      listingTitle: agent.listing?.name ?? null,
      listingCategory: agent.listing?.category ?? null,
      workflowName: agent.workflow?.name ?? null,
      executionFeeCents: agent.executionFeeCents,
      trialExecutionLimit: agent.trialExecutionLimit,
      trialExecutionsUsed: agent.trialExecutionsUsed,
      knowledgeFileCount: knowledgeFiles,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
      lastCallAt: lastCall ? lastCall.startedAt.toISOString() : null,
      lastCallStatus: lastCall?.status ?? null,
      lastCallOutcome: lastCall?.outcome ?? null,
      phoneNumbers: agent.phoneNumbers.map((entry) => ({
        phoneNumber: entry.phoneNumber,
        forwardToPhone: entry.forwardToPhone,
        assignedAt: entry.createdAt.toISOString()
      })),
      vapiAssistantId
    },
    voiceAssistant:
      assistant.state === "ok"
        ? { available: true as const, ...assistant.assistant }
        : { available: false as const, reason: assistant.reason },
    activity: activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorLabel: entry.actorLabel,
      detail: entry.detailJson ?? null,
      createdAt: entry.createdAt.toISOString()
    }))
  });
});

/**
 * AI read of the period. Kept on its own endpoint so the page paints instantly
 * from the computed metrics and fills this panel in when the model answers.
 */
analyticsRoutes.get("/ai-insights", requireBusinessPermission("view_reports"), async (c) => {
  const membership = c.get("businessMembership");
  const period = parseAnalyticsPeriod(c.req.query("from"), c.req.query("to"));

  const requested = await resolveRequestedAgent(membership.businessId, readAgentId(c));
  if (!requested.ok) return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");

  const filters: AnalyticsFilters = {
    businessId: membership.businessId,
    agentId: requested.agentId,
    from: period.from,
    to: period.to
  };

  const [overview, business, summaryRows] = await Promise.all([
    buildAnalyticsOverview(filters),
    prisma.business.findUnique({
      where: { id: membership.businessId },
      select: { name: true, type: true }
    }),
    prisma.vapiCall.findMany({
      where: {
        businessId: membership.businessId,
        executionMode: "LIVE",
        startedAt: { gte: period.from, lte: period.to },
        summary: { not: null },
        ...(requested.agentId ? { installedAgentId: requested.agentId } : {})
      },
      orderBy: { startedAt: "desc" },
      take: 12,
      select: { summary: true }
    })
  ]);

  const focusedAgent = requested.agentId
    ? overview.agents.find((agent) => agent.id === requested.agentId) ?? null
    : null;

  const result = await generateAgentAiInsight({
    businessName: business?.name ?? "This business",
    businessType: business?.type ?? null,
    agentName: focusedAgent?.name ?? null,
    overview,
    recentSummaries: summaryRows
      .map((row) => row.summary ?? "")
      .filter((summary) => summary.trim().length > 0)
  });

  return successResponse(c, result);
});
