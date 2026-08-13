import { resolveConfiguredLlmProvider } from "../../ai-provider-engine/llm-credentials";
import { getProviderEngine } from "../../ai-provider-engine/provider-engine";
import type { AnalyticsOverview } from "./service";

/**
 * AI read of an agent's performance for the selected period.
 *
 * The model NEVER sees raw transcripts or customer phone numbers — only the
 * aggregate counts this page already displays, plus redacted per-call summaries
 * the runtime itself generated. That keeps a reporting feature from becoming a
 * new path for customer data to leave the system.
 *
 * Honest degradation (see llm-credentials): with no provider key configured the
 * endpoint returns `available: false` and a reason. The page then shows the
 * computed metrics alone rather than inventing a narrative.
 */

export interface AgentAiInsight {
  headline: string;
  observations: string[];
  recommendations: string[];
  /** Provider actually used, for support/debugging. */
  provider: string;
}

export type AgentAiInsightResult =
  | { available: true; insight: AgentAiInsight }
  | { available: false; reason: string };

export interface InsightInput {
  businessName: string;
  businessType: string | null;
  overview: AnalyticsOverview;
  agentName: string | null;
  /** Redacted per-call summaries the agent runtime already wrote. */
  recentSummaries: string[];
}

const MAX_SUMMARIES = 12;
const MAX_SUMMARY_CHARS = 240;

export async function generateAgentAiInsight(
  input: InsightInput
): Promise<AgentAiInsightResult> {
  if (input.overview.kpi.totalCalls === 0) {
    return {
      available: false,
      reason: "No live calls in this period yet — insights appear once the agent handles calls."
    };
  }

  const resolved = resolveConfiguredLlmProvider("openai");
  if (!resolved) {
    return {
      available: false,
      reason: "AI insights need an LLM provider key configured on the server."
    };
  }

  const systemPrompt = [
    "You are an operations analyst for a business that runs AI phone agents.",
    "You are given aggregate performance metrics and short call summaries for one reporting period.",
    "Write a brief, concrete performance read for the business owner.",
    "",
    "Hard rules:",
    "- Use ONLY the numbers and summaries provided. Never invent metrics, causes, or trends you cannot see.",
    "- If the sample is small (under ~10 calls), say so instead of drawing strong conclusions.",
    "- Be specific and quantitative: cite the actual counts and rates.",
    "- Recommendations must be actions this owner can take (knowledge gaps to fill, hours to change, follow-up to enable), not generic advice.",
    "- Never mention customers by name or number.",
    "",
    "Respond with STRICT JSON, no markdown fences:",
    '{"headline": string, "observations": string[], "recommendations": string[]}',
    "headline: one sentence, max 120 characters.",
    "observations: 2-4 items, each one sentence.",
    "recommendations: 2-3 items, each one sentence."
  ].join("\n");

  const userPrompt = buildMetricsPrompt(input);

  let response;
  try {
    response = await getProviderEngine().executeWithProvider(resolved.providerId, {
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
      maxTokens: 600,
      outputFormat: "text"
    });
  } catch (error) {
    console.error("[analytics] ai insight call threw", error);
    return { available: false, reason: "AI insights are temporarily unavailable." };
  }

  if (response.status === "error" || !response.text?.trim()) {
    console.error("[analytics] ai insight failed", {
      provider: resolved.providerId,
      error: response.status === "error" ? response.error : "empty"
    });
    return { available: false, reason: "AI insights are temporarily unavailable." };
  }

  const parsed = parseInsightJson(response.text);
  if (!parsed) {
    return { available: false, reason: "AI insights returned an unreadable response." };
  }

  return { available: true, insight: { ...parsed, provider: resolved.providerId } };
}

function buildMetricsPrompt(input: InsightInput): string {
  const { overview } = input;
  const { kpi, insights } = overview;

  const scope = input.agentName
    ? `Agent under review: "${input.agentName}"`
    : `All AI agents for this business (${overview.agents.length} installed)`;

  const lines = [
    `Business: ${input.businessName}${input.businessType ? ` (${input.businessType})` : ""}`,
    scope,
    `Period: ${overview.period.from.slice(0, 10)} to ${overview.period.to.slice(0, 10)}`,
    "",
    "Call volume:",
    `- Total calls: ${kpi.totalCalls}`,
    `- Completed (caller engaged): ${kpi.completedCalls}`,
    `- Missed (caller never engaged): ${kpi.missedCalls}`,
    `- Failed (technical): ${kpi.failedCalls}`,
    `- Transferred to a human: ${kpi.handoffs}`,
    "",
    "Outcomes:",
    `- Appointments booked: ${kpi.bookings}`,
    `- Appointments cancelled: ${kpi.cancellations}`,
    // Omitted entirely in the agent-focused view — a business-wide lead count
    // alongside agent-scoped numbers would invite a wrong conclusion.
    ...(kpi.newLeads === null ? [] : [`- New leads captured: ${kpi.newLeads}`]),
    `- Follow-up texts sent: ${kpi.smsSent}`,
    "",
    "Quality signals:",
    `- Answer rate: ${insights.answerRate === null ? "n/a" : `${insights.answerRate}%`}`,
    `- Booking rate: ${insights.bookingRate === null ? "n/a" : `${insights.bookingRate}%`}`,
    `- Average call length: ${
      insights.avgDurationSeconds === null ? "n/a" : `${insights.avgDurationSeconds}s`
    }`,
    `- Busiest window: ${insights.peakHourRange ?? "n/a"}`,
    `- Outcome mix: ${
      insights.outcomeBreakdown.map((entry) => `${entry.label} ${entry.count}`).join(", ") || "n/a"
    }`,
    `- Caller sentiment mix: ${
      insights.sentimentBreakdown.map((entry) => `${entry.label} ${entry.count}`).join(", ") || "n/a"
    }`
  ];

  if (!input.agentName && overview.agents.length > 1) {
    lines.push(
      "",
      "Per agent:",
      ...overview.agents
        .slice(0, 8)
        .map(
          (agent) =>
            `- ${agent.name} (${agent.status}): ${agent.calls} calls, ${agent.bookings} bookings, ` +
            `${agent.answerRate === null ? "n/a" : `${agent.answerRate}%`} answer rate`
        )
    );
  }

  if (input.recentSummaries.length) {
    lines.push(
      "",
      "Recent call summaries (already written by the agent, redacted):",
      ...input.recentSummaries
        .slice(0, MAX_SUMMARIES)
        .map((summary, index) => `${index + 1}. ${summary.slice(0, MAX_SUMMARY_CHARS)}`)
    );
  }

  return lines.join("\n");
}

/** Tolerates models that wrap JSON in prose or code fences. */
function parseInsightJson(
  raw: string
): { headline: string; observations: string[]; recommendations: string[] } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;

  const headline = typeof value.headline === "string" ? value.headline.trim() : "";
  if (!headline) return null;

  return {
    headline: headline.slice(0, 200),
    observations: stringList(value.observations),
    recommendations: stringList(value.recommendations)
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 300))
    .slice(0, 5);
}
