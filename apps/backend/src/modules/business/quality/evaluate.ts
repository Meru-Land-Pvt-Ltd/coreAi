import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { resolveConfiguredLlmProvider } from "../../ai-provider-engine/llm-credentials";
import { getProviderEngine } from "../../ai-provider-engine/provider-engine";
import type { AIExecuteRequest } from "../../ai-provider-engine/types";
import {
  FAIRNESS_CONSTRAINT,
  RUBRIC_DIMENSIONS,
  RUBRIC_DIMENSION_KEYS,
  RUBRIC_VERSION,
  isScorable,
} from "./rubric";

/**
 * Conversation quality evaluation (plan Part 8). Scores finished calls
 * against the v1 rubric with the platform LLM. Honest by construction:
 * - No configured LLM provider → skip with a log; NEVER fabricate scores.
 * - Unscorable calls (too short / no transcript) → EXCLUDED row so they are
 *   visibly excluded from averages instead of silently missing.
 * - Unparseable model output after one retry → no row at all (NO_PARSE).
 */

const TRANSCRIPT_MAX_CHARS = 8000;
const MAX_COACHING_ITEMS = 3;
const MAX_MISSED_OPPORTUNITIES = 10;
/** How many of the 10 dimensions must come back numeric for a valid parse. */
const MIN_PARSED_DIMENSIONS = 7;
/** Evaluator label for rows written by the scorability gate (no LLM ran). */
const GATE_EVALUATOR = "scorability-gate";
/** Provider preference — resolveConfiguredLlmProvider falls back from here. */
const PREFERRED_PROVIDER = "openai";

export type EvaluationSkipReason = "NOT_FOUND" | "NO_LLM" | "NO_PARSE" | "LLM_ERROR";

export type EvaluateCallResult =
  | { skipped: EvaluationSkipReason }
  | { evaluationId: string; status: "SCORED" | "EXCLUDED"; overallScore: number };

type ParsedEvaluation = {
  dimensions: Record<string, number>;
  overall: number;
  confidence: number;
  coaching: string[];
  missedOpportunities: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Extract the first balanced {...} block from model output — tolerates prose
 * or markdown fences around the JSON.
 */
export function extractJsonBlock(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Defensive parse of the model reply into a validated evaluation. */
export function parseEvaluationJson(text: string | null | undefined): ParsedEvaluation | null {
  if (!text) return null;
  const block = extractJsonBlock(text);
  if (!block) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const rawDims = record.dimensions;
  if (!rawDims || typeof rawDims !== "object" || Array.isArray(rawDims)) return null;
  const dimRecord = rawDims as Record<string, unknown>;

  const dimensions: Record<string, number> = {};
  for (const key of RUBRIC_DIMENSION_KEYS) {
    const value = Number(dimRecord[key]);
    if (Number.isFinite(value)) dimensions[key] = clamp(value, 0, 10);
  }
  if (Object.keys(dimensions).length < MIN_PARSED_DIMENSIONS) return null;

  const overall = Number(record.overall);
  if (!Number.isFinite(overall)) return null;

  const confidenceRaw = Number(record.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? clamp(confidenceRaw, 0, 1) : 0.5;

  const strings = (value: unknown, max: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 500))
          .slice(0, max)
      : [];

  return {
    dimensions,
    overall: clamp(overall, 0, 10),
    confidence,
    coaching: strings(record.coaching, MAX_COACHING_ITEMS),
    missedOpportunities: strings(record.missedOpportunities, MAX_MISSED_OPPORTUNITIES),
  };
}

type CallFacts = {
  businessName: string;
  businessType: string;
  outcome: string;
  sentiment: string;
  durationSeconds: number;
  handledBy: string;
  rulesSummary: string[];
};

export function buildEvaluationPrompt(
  transcript: string,
  facts: CallFacts
): { systemPrompt: string; userPrompt: string } {
  const dimensionLines = RUBRIC_DIMENSION_KEYS.map(
    (key) => `- ${key}: ${RUBRIC_DIMENSIONS[key]}`
  ).join("\n");

  const systemPrompt = [
    "You are a strict, fair quality evaluator for customer-service phone conversations.",
    `Rubric ${RUBRIC_VERSION} — score each dimension 0-10:`,
    dimensionLines,
    "",
    `FAIRNESS (binding): ${FAIRNESS_CONSTRAINT}`,
    "",
    "Gaming resistance (binding): polite or 'nice' phrases without actually solving the",
    "caller's problem must score LOW on resolution and outcome_success. Score those two",
    "dimensions against the outcome facts provided, not against pleasant wording.",
    "",
    "Return STRICT JSON only, exactly this shape, no prose:",
    '{"dimensions":{"greeting":0,"accuracy":0,"professionalism":0,"empathy":0,"sales_handling":0,"rule_compliance":0,"knowledge_usage":0,"resolution":0,"outcome_success":0,"satisfaction_proxy":0},"overall":0,"confidence":0.0,"coaching":["up to 3 short coaching notes"],"missedOpportunities":["missed chances, may be empty"]}',
    "All dimension scores and overall are 0-10; confidence is 0-1.",
  ].join("\n");

  const truncated = transcript.length > TRANSCRIPT_MAX_CHARS;
  const transcriptBlock = truncated
    ? `${transcript.slice(0, TRANSCRIPT_MAX_CHARS)}\n[transcript truncated]`
    : transcript;

  const userPrompt = [
    `Business: ${facts.businessName} (type: ${facts.businessType})`,
    "Outcome facts (ground truth — resolution/outcome_success must reflect these):",
    `- recorded outcome: ${facts.outcome}`,
    `- appointment booked: ${facts.outcome === "BOOKED" || facts.outcome === "RESCHEDULED" ? "yes" : "no"}`,
    `- support resolved: ${facts.outcome === "SUPPORT_RESOLVED" ? "yes" : "no"}`,
    `- caller sentiment signal: ${facts.sentiment}`,
    `- call duration: ${facts.durationSeconds}s`,
    `- handled by: ${facts.handledBy}`,
    ...(facts.rulesSummary.length > 0
      ? ["Business rules in force (for rule_compliance):", ...facts.rulesSummary.map((r) => `- ${r}`)]
      : []),
    "",
    "Transcript:",
    transcriptBlock,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function loadRulesSummary(
  businessId: string,
  installedAgentId: string | null
): Promise<string[]> {
  try {
    const rules = await prisma.businessAgentRule.findMany({
      where: {
        businessId,
        active: true,
        ...(installedAgentId ? { OR: [{ installedAgentId }, { installedAgentId: null }] } : {}),
      },
      orderBy: { priority: "asc" },
      take: 10,
      select: { title: true, category: true },
    });
    return rules.map((rule) => `[${rule.category}] ${rule.title}`.slice(0, 200));
  } catch (error) {
    // Rules context is optional — evaluation proceeds without it.
    console.warn("[quality] rules summary unavailable, continuing without it", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function resolveHandledBy(call: { id: string; callId: string }): Promise<"AI" | "MIXED"> {
  try {
    const connected = await prisma.handoffEvent.findFirst({
      // HandoffEvent.vapiCallId stores the provider call id (ctx.callId) —
      // check both forms defensively.
      where: { vapiCallId: { in: [call.callId, call.id] }, status: "CONNECTED" },
      select: { id: true },
    });
    return connected ? "MIXED" : "AI";
  } catch {
    return "AI";
  }
}

/**
 * Idempotent write keyed on vapiCallId (VapiCall.id). Re-evaluation refreshes
 * the scored fields but NEVER clobbers a human review: UNDER_REVIEW/ADJUSTED
 * status, adjustedScore, and review fields survive a re-run.
 */
async function upsertEvaluation(input: {
  call: {
    id: string;
    businessId: string;
    installedAgentId: string | null;
    conversationId: string | null;
  };
  handledBy: string;
  status: "SCORED" | "EXCLUDED";
  overallScore: number;
  confidence: number;
  dimensionsJson: Prisma.InputJsonValue;
  coachingJson?: Prisma.InputJsonValue;
  missedOpportunitiesJson?: Prisma.InputJsonValue;
  evaluator: string;
}): Promise<{ id: string }> {
  const existing = await prisma.conversationEvaluation.findUnique({
    where: { vapiCallId: input.call.id },
    select: { id: true, status: true },
  });

  const reviewInProgress = existing?.status === "UNDER_REVIEW" || existing?.status === "ADJUSTED";
  const nextStatus = reviewInProgress ? existing.status : input.status;

  const scoredFields = {
    handledBy: input.handledBy,
    rubricVersion: RUBRIC_VERSION,
    overallScore: input.overallScore,
    confidence: input.confidence,
    dimensionsJson: input.dimensionsJson,
    coachingJson: input.coachingJson,
    missedOpportunitiesJson: input.missedOpportunitiesJson,
    evaluator: input.evaluator,
  };

  const row = await prisma.conversationEvaluation.upsert({
    where: { vapiCallId: input.call.id },
    create: {
      businessId: input.call.businessId,
      installedAgentId: input.call.installedAgentId,
      vapiCallId: input.call.id,
      conversationId: input.call.conversationId,
      status: input.status,
      ...scoredFields,
    },
    update: {
      status: nextStatus,
      ...scoredFields,
    },
    select: { id: true },
  });
  return row;
}

/**
 * Evaluate one call. `vapiCallId` accepts either the VapiCall primary key or
 * the provider callId (both are unique).
 */
export async function evaluateCall(input: { vapiCallId: string }): Promise<EvaluateCallResult> {
  const call = await prisma.vapiCall.findFirst({
    where: { OR: [{ id: input.vapiCallId }, { callId: input.vapiCallId }] },
    select: {
      id: true,
      callId: true,
      businessId: true,
      installedAgentId: true,
      conversationId: true,
      transcript: true,
      summary: true,
      durationSeconds: true,
      outcome: true,
      sentiment: true,
    },
  });

  if (!call) {
    console.warn("[quality] evaluateCall: call not found", { vapiCallId: input.vapiCallId });
    return { skipped: "NOT_FOUND" };
  }

  const handledBy = await resolveHandledBy(call);
  const verdict = isScorable({
    durationSeconds: call.durationSeconds,
    transcript: call.transcript,
  });

  if (!verdict.scorable) {
    // Plan Part 8: unscorable calls are excluded from averages, visibly.
    const row = await upsertEvaluation({
      call,
      handledBy,
      status: "EXCLUDED",
      overallScore: 0,
      confidence: 0,
      dimensionsJson: { excludedReason: verdict.reason ?? "NOT_SCORABLE" },
      evaluator: GATE_EVALUATOR,
    });
    return { evaluationId: row.id, status: "EXCLUDED", overallScore: 0 };
  }

  // Honest degradation: with no LLM key configured we score nothing.
  const resolved = resolveConfiguredLlmProvider(PREFERRED_PROVIDER);
  if (!resolved) {
    console.warn("[quality] evaluateCall skipped: no LLM provider configured", {
      vapiCallId: call.id,
    });
    return { skipped: "NO_LLM" };
  }

  const business = await prisma.business.findUnique({
    where: { id: call.businessId },
    select: { name: true, type: true },
  });
  const rulesSummary = await loadRulesSummary(call.businessId, call.installedAgentId);

  const { systemPrompt, userPrompt } = buildEvaluationPrompt(call.transcript ?? "", {
    businessName: business?.name ?? "Unknown business",
    businessType: business?.type ?? "service business",
    outcome: call.outcome ?? "UNKNOWN",
    sentiment: call.sentiment ?? "UNKNOWN",
    durationSeconds: call.durationSeconds ?? 0,
    handledBy,
    rulesSummary,
  });

  const runCompletion = async (retryNudge: boolean) => {
    const request: AIExecuteRequest = {
      capability: "llm",
      systemPrompt,
      messages: [
        {
          role: "user",
          content: retryNudge
            ? `${userPrompt}\n\nReturn ONLY the JSON object — no prose, no markdown.`
            : userPrompt,
        },
      ],
      temperature: 0,
      maxTokens: 1024,
      outputFormat: "json",
      task: "conversation-quality-evaluation",
    };
    return getProviderEngine().executeWithProvider(resolved.providerId, request);
  };

  let evaluatorLabel = resolved.providerId;
  let parsed: ParsedEvaluation | null = null;

  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    let response;
    try {
      response = await runCompletion(attempt > 0);
    } catch (error) {
      console.error("[quality] evaluateCall LLM call failed", {
        vapiCallId: call.id,
        provider: resolved.providerId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { skipped: "LLM_ERROR" };
    }
    if (response.status === "error") {
      console.error("[quality] evaluateCall LLM returned error", {
        vapiCallId: call.id,
        provider: response.providerId,
        error: response.error,
      });
      return { skipped: "LLM_ERROR" };
    }
    evaluatorLabel = `${response.providerId}/${response.modelName}`;
    parsed = parseEvaluationJson(response.text);
  }

  if (!parsed) {
    console.warn("[quality] evaluateCall skipped: model output unparseable after retry", {
      vapiCallId: call.id,
      evaluator: evaluatorLabel,
    });
    return { skipped: "NO_PARSE" };
  }

  const row = await upsertEvaluation({
    call,
    handledBy,
    status: "SCORED",
    overallScore: parsed.overall,
    confidence: parsed.confidence,
    dimensionsJson: parsed.dimensions,
    coachingJson: parsed.coaching,
    missedOpportunitiesJson: parsed.missedOpportunities,
    evaluator: evaluatorLabel,
  });

  return { evaluationId: row.id, status: "SCORED", overallScore: parsed.overall };
}

export type EvaluateRecentCallsResult = {
  considered: number;
  scored: number;
  excluded: number;
  skipped: number;
  /** Batch aborts early on NO_LLM — nothing else could succeed either. */
  abortedNoLlm: boolean;
};

/**
 * Worker batch helper: score recent LIVE calls that have a transcript, ended
 * within the last 7 days, and have no evaluation row yet.
 */
export async function evaluateRecentCalls(input?: {
  limit?: number;
}): Promise<EvaluateRecentCallsResult> {
  const limit = Math.max(1, Math.min(input?.limit ?? 20, 100));
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // No relation exists between VapiCall and ConversationEvaluation, so fetch
  // a wider candidate window and drop already-evaluated calls in JS.
  const candidates = await prisma.vapiCall.findMany({
    where: {
      executionMode: "LIVE",
      transcript: { not: null },
      endedAt: { gte: cutoff },
    },
    orderBy: { endedAt: "desc" },
    take: limit * 5,
    select: { id: true },
  });

  const evaluatedRows = candidates.length
    ? await prisma.conversationEvaluation.findMany({
        where: { vapiCallId: { in: candidates.map((c) => c.id) } },
        select: { vapiCallId: true },
      })
    : [];
  const evaluatedIds = new Set(evaluatedRows.map((row) => row.vapiCallId));
  const pending = candidates.filter((c) => !evaluatedIds.has(c.id)).slice(0, limit);

  const result: EvaluateRecentCallsResult = {
    considered: pending.length,
    scored: 0,
    excluded: 0,
    skipped: 0,
    abortedNoLlm: false,
  };

  for (const call of pending) {
    const outcome = await evaluateCall({ vapiCallId: call.id });
    if ("skipped" in outcome) {
      result.skipped++;
      if (outcome.skipped === "NO_LLM") {
        // One missing-provider skip means they all would be — stop burning DB reads.
        result.abortedNoLlm = true;
        break;
      }
      continue;
    }
    if (outcome.status === "EXCLUDED") result.excluded++;
    else result.scored++;
  }

  return result;
}
