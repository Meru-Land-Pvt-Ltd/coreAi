import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vapiCallFindFirst: vi.fn(),
  vapiCallFindMany: vi.fn(),
  handoffFindFirst: vi.fn(),
  businessFindUnique: vi.fn(),
  ruleFindMany: vi.fn(),
  evalFindUnique: vi.fn(),
  evalFindFirst: vi.fn(),
  evalFindMany: vi.fn(),
  evalUpsert: vi.fn(),
  evalUpdate: vi.fn(),
  execute: vi.fn(),
  resolveProvider: vi.fn(),
  logActivity: vi.fn(),
  permissionsRequested: [] as string[],
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    vapiCall: { findFirst: mocks.vapiCallFindFirst, findMany: mocks.vapiCallFindMany },
    handoffEvent: { findFirst: mocks.handoffFindFirst },
    business: { findUnique: mocks.businessFindUnique },
    businessAgentRule: { findMany: mocks.ruleFindMany },
    conversationEvaluation: {
      findUnique: mocks.evalFindUnique,
      findFirst: mocks.evalFindFirst,
      findMany: mocks.evalFindMany,
      upsert: mocks.evalUpsert,
      update: mocks.evalUpdate,
    },
  },
}));

vi.mock("../../ai-provider-engine/llm-credentials", () => ({
  resolveConfiguredLlmProvider: mocks.resolveProvider,
  MISSING_LLM_CREDENTIALS_MESSAGE: "no llm configured",
}));

vi.mock("../../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: mocks.execute }),
}));

vi.mock("../activity-log", () => ({
  logBusinessActivity: mocks.logActivity,
}));

vi.mock("../team/membership", () => ({
  requireBusinessPermission: (permission: string) => {
    mocks.permissionsRequested.push(permission);
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>
    ) => {
      c.set("businessMembership", {
        businessId: "biz-1",
        role: "OWNER",
        teamMemberId: null,
        isImplicitOwner: true,
        permissionsJson: null,
      });
      c.set("authUser", { id: "user-1", email: "owner@example.com" });
      await next();
    };
  },
}));

import { FAIRNESS_CONSTRAINT } from "./rubric";
import { evaluateCall, evaluateRecentCalls, parseEvaluationJson } from "./evaluate";
import { computeQualitySummary, type SummaryEvaluationRow } from "./summary";
import { qualityRoutes } from "./quality-routes";

const TRANSCRIPT = [
  "AI: Thank you for calling Bright Smiles, how can I help you today?",
  "User: Hi, I would like to book a cleaning appointment for next week please.",
  "AI: Of course, we have Tuesday at 10am or Thursday at 2pm available for cleanings.",
  "User: Thursday at 2pm works great for me, thank you so much for the help.",
  "AI: Wonderful, you are booked for Thursday at 2pm. Anything else I can do for you?",
].join("\n");

const SCORABLE_CALL = {
  id: "call-1",
  callId: "vapi-abc",
  businessId: "biz-1",
  installedAgentId: "ia-1",
  conversationId: "conv-1",
  transcript: TRANSCRIPT,
  summary: null,
  durationSeconds: 90,
  outcome: "BOOKED",
  sentiment: "POSITIVE",
};

const VALID_DIMENSIONS = {
  greeting: 8,
  accuracy: 7,
  professionalism: 9,
  empathy: 6,
  sales_handling: 7,
  rule_compliance: 8,
  knowledge_usage: 7,
  resolution: 9,
  outcome_success: 9,
  satisfaction_proxy: 8,
};

const VALID_JSON = JSON.stringify({
  dimensions: VALID_DIMENSIONS,
  overall: 7.8,
  confidence: 0.85,
  coaching: ["Confirm the callback number earlier"],
  missedOpportunities: ["Did not mention the new-patient special"],
});

function llmSuccess(text: string) {
  return {
    status: "success",
    text,
    providerId: "openai",
    modelName: "gpt-4o-mini",
    error: null,
  };
}

beforeEach(() => {
  mocks.vapiCallFindFirst.mockReset().mockResolvedValue(SCORABLE_CALL);
  mocks.vapiCallFindMany.mockReset().mockResolvedValue([]);
  mocks.handoffFindFirst.mockReset().mockResolvedValue(null);
  mocks.businessFindUnique.mockReset().mockResolvedValue({ name: "Bright Smiles", type: "dental" });
  mocks.ruleFindMany.mockReset().mockResolvedValue([]);
  mocks.evalFindUnique.mockReset().mockResolvedValue(null);
  mocks.evalFindFirst.mockReset().mockResolvedValue(null);
  mocks.evalFindMany.mockReset().mockResolvedValue([]);
  mocks.evalUpsert.mockReset().mockResolvedValue({ id: "eval-1" });
  mocks.evalUpdate
    .mockReset()
    .mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "eval-1",
      ...args.data,
    }));
  mocks.execute.mockReset().mockResolvedValue(llmSuccess(VALID_JSON));
  mocks.resolveProvider.mockReset().mockReturnValue({ providerId: "openai" });
  mocks.logActivity.mockReset().mockResolvedValue(undefined);
});

describe("evaluateCall", () => {
  it("scores a valid call and upserts the parsed dimensions", async () => {
    const result = await evaluateCall({ vapiCallId: "call-1" });

    expect(result).toEqual({ evaluationId: "eval-1", status: "SCORED", overallScore: 7.8 });
    expect(mocks.evalUpsert).toHaveBeenCalledTimes(1);
    const args = mocks.evalUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ vapiCallId: "call-1" });
    expect(args.create.status).toBe("SCORED");
    expect(args.create.rubricVersion).toBe("v1");
    expect(args.create.dimensionsJson).toEqual(VALID_DIMENSIONS);
    expect(args.create.overallScore).toBe(7.8);
    expect(args.create.confidence).toBe(0.85);
    expect(args.create.evaluator).toBe("openai/gpt-4o-mini");
    expect(args.create.handledBy).toBe("AI");
  });

  it("includes the fairness sentence and outcome facts in the prompt", async () => {
    await evaluateCall({ vapiCallId: "call-1" });

    const request = mocks.execute.mock.calls[0][1];
    expect(request.systemPrompt).toContain(FAIRNESS_CONSTRAINT);
    expect(request.systemPrompt).toContain("resolution and outcome_success");
    const userContent = request.messages[0].content;
    expect(userContent).toContain("recorded outcome: BOOKED");
    expect(userContent).toContain("appointment booked: yes");
    expect(userContent).toContain("Bright Smiles");
  });

  it("marks the call MIXED when a handoff CONNECTED", async () => {
    mocks.handoffFindFirst.mockResolvedValue({ id: "handoff-1" });

    await evaluateCall({ vapiCallId: "call-1" });

    expect(mocks.evalUpsert.mock.calls[0][0].create.handledBy).toBe("MIXED");
    const handoffWhere = mocks.handoffFindFirst.mock.calls[0][0].where;
    expect(handoffWhere.status).toBe("CONNECTED");
    expect(handoffWhere.vapiCallId.in).toContain("vapi-abc");
  });

  it("retries once on invalid JSON, then skips with NO_PARSE and writes no row", async () => {
    mocks.execute.mockResolvedValue(llmSuccess("I think the call went pretty well overall!"));

    const result = await evaluateCall({ vapiCallId: "call-1" });

    expect(result).toEqual({ skipped: "NO_PARSE" });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[1][1].messages[0].content).toContain("Return ONLY the JSON");
    expect(mocks.evalUpsert).not.toHaveBeenCalled();
  });

  it("skips honestly with NO_LLM when no provider resolves — no fake scores", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const result = await evaluateCall({ vapiCallId: "call-1" });

    expect(result).toEqual({ skipped: "NO_LLM" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.evalUpsert).not.toHaveBeenCalled();
  });

  it("writes an EXCLUDED row for an unscorable short call without calling the LLM", async () => {
    mocks.vapiCallFindFirst.mockResolvedValue({
      ...SCORABLE_CALL,
      transcript: "AI: Hello?\nUser: Wrong number, sorry.",
      durationSeconds: 6,
    });

    const result = await evaluateCall({ vapiCallId: "call-1" });

    expect(result).toEqual({ evaluationId: "eval-1", status: "EXCLUDED", overallScore: 0 });
    expect(mocks.execute).not.toHaveBeenCalled();
    const args = mocks.evalUpsert.mock.calls[0][0];
    expect(args.create.status).toBe("EXCLUDED");
    expect(args.create.overallScore).toBe(0);
    expect(args.create.confidence).toBe(0);
    expect(args.create.dimensionsJson).toEqual({ excludedReason: "DURATION_TOO_SHORT" });
  });

  it("preserves ADJUSTED status and review fields on idempotent re-evaluation", async () => {
    mocks.evalFindUnique.mockResolvedValue({ id: "eval-1", status: "ADJUSTED" });

    await evaluateCall({ vapiCallId: "call-1" });

    const args = mocks.evalUpsert.mock.calls[0][0];
    expect(args.update.status).toBe("ADJUSTED");
    expect(args.update).not.toHaveProperty("adjustedScore");
    expect(args.update).not.toHaveProperty("reviewNote");
    expect(args.update).not.toHaveProperty("reviewedByUserId");
  });

  it("returns NOT_FOUND when the call does not exist", async () => {
    mocks.vapiCallFindFirst.mockResolvedValue(null);
    expect(await evaluateCall({ vapiCallId: "missing" })).toEqual({ skipped: "NOT_FOUND" });
  });
});

describe("parseEvaluationJson", () => {
  it("extracts JSON wrapped in prose or markdown fences", () => {
    const parsed = parseEvaluationJson("Here you go:\n```json\n" + VALID_JSON + "\n```");
    expect(parsed?.overall).toBe(7.8);
    expect(parsed?.dimensions.resolution).toBe(9);
  });

  it("clamps out-of-range values and rejects payloads missing dimensions", () => {
    const clamped = parseEvaluationJson(
      JSON.stringify({ dimensions: { ...VALID_DIMENSIONS, greeting: 42 }, overall: 15, confidence: 3 })
    );
    expect(clamped?.dimensions.greeting).toBe(10);
    expect(clamped?.overall).toBe(10);
    expect(clamped?.confidence).toBe(1);

    expect(parseEvaluationJson(JSON.stringify({ overall: 8 }))).toBeNull();
    expect(
      parseEvaluationJson(JSON.stringify({ dimensions: { greeting: 8 }, overall: 8 }))
    ).toBeNull();
  });
});

describe("evaluateRecentCalls", () => {
  it("skips already-evaluated calls and honors the limit", async () => {
    mocks.vapiCallFindMany.mockResolvedValue([{ id: "call-1" }, { id: "call-2" }, { id: "call-3" }]);
    mocks.evalFindMany.mockResolvedValue([{ vapiCallId: "call-2" }]);
    mocks.vapiCallFindFirst.mockImplementation(async (args: { where: { OR: Array<{ id?: string }> } }) => ({
      ...SCORABLE_CALL,
      id: args.where.OR[0].id,
      callId: `vapi-${args.where.OR[0].id}`,
      transcript: "AI: Hello?\nUser: Bye.",
      durationSeconds: 5,
    }));

    const result = await evaluateRecentCalls({ limit: 10 });

    expect(result).toEqual({
      considered: 2,
      scored: 0,
      excluded: 2,
      skipped: 0,
      abortedNoLlm: false,
    });
    const evaluatedIds = mocks.vapiCallFindFirst.mock.calls.map((call) => call[0].where.OR[0].id);
    expect(evaluatedIds).toEqual(["call-1", "call-3"]);
  });

  it("aborts the batch on the first NO_LLM skip", async () => {
    mocks.vapiCallFindMany.mockResolvedValue([{ id: "call-1" }, { id: "call-3" }]);
    mocks.evalFindMany.mockResolvedValue([]);
    mocks.resolveProvider.mockReturnValue(null);

    const result = await evaluateRecentCalls({ limit: 10 });

    expect(result.abortedNoLlm).toBe(true);
    expect(result.skipped).toBe(1);
    expect(mocks.vapiCallFindFirst).toHaveBeenCalledTimes(1);
  });
});

describe("computeQualitySummary", () => {
  const row = (overrides: Partial<SummaryEvaluationRow>): SummaryEvaluationRow => ({
    id: "e",
    vapiCallId: "c",
    handledBy: "AI",
    status: "SCORED",
    overallScore: 5,
    adjustedScore: null,
    confidence: 0.8,
    dimensionsJson: { greeting: 5, resolution: 5 },
    missedOpportunitiesJson: [],
    createdAt: new Date(),
    ...overrides,
  });

  it("uses COALESCE(adjustedScore, overallScore) and excludes EXCLUDED rows", () => {
    const summary = computeQualitySummary([
      row({ id: "e1", overallScore: 8 }),
      row({ id: "e2", overallScore: 2, adjustedScore: 9, status: "ADJUSTED" }),
      row({ id: "e3", overallScore: 0, status: "EXCLUDED", dimensionsJson: { excludedReason: "NO_TRANSCRIPT" } }),
    ]);

    expect(summary.totalEvaluations).toBe(2);
    expect(summary.excludedCount).toBe(1);
    expect(summary.averageScore).toBe(8.5); // (8 + 9) / 2 — adjusted wins, EXCLUDED out
    expect(summary.best[0].id).toBe("e2");
    expect(summary.best[0].score).toBe(9);
    expect(summary.best.map((entry) => entry.id)).not.toContain("e3");
  });

  it("averages dimensions, counts missed opportunities, and builds 8 weekly buckets", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const lastWeek = new Date("2026-08-04T12:00:00Z");
    const summary = computeQualitySummary(
      [
        row({
          id: "e1",
          overallScore: 8,
          createdAt: now,
          dimensionsJson: { greeting: 8, resolution: 6 },
          missedOpportunitiesJson: ["a", "b"],
        }),
        row({
          id: "e2",
          overallScore: 4,
          createdAt: lastWeek,
          dimensionsJson: { greeting: 4, resolution: 2 },
          missedOpportunitiesJson: ["c"],
        }),
      ],
      { now }
    );

    expect(summary.dimensionAverages.greeting).toBe(6);
    expect(summary.dimensionAverages.resolution).toBe(4);
    expect(summary.dimensionAverages.empathy).toBeNull();
    expect(summary.missedOpportunityCount).toBe(3);
    expect(summary.trend).toHaveLength(8);
    expect(summary.trend[7]).toEqual({ weekStart: "2026-08-10", count: 1, averageScore: 8 });
    expect(summary.trend[6]).toEqual({ weekStart: "2026-08-03", count: 1, averageScore: 4 });
    expect(summary.trend[0].count).toBe(0);
  });
});

describe("quality routes", () => {
  const jsonPost = (path: string, body: unknown) =>
    qualityRoutes.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("registers the intended permission gates", () => {
    expect(mocks.permissionsRequested).toEqual([
      "view_reports",
      "view_reports",
      "view_calls",
      "manage_team",
    ]);
  });

  it("GET /summary aggregates with adjusted scores and attaches call info", async () => {
    mocks.evalFindMany.mockResolvedValue([
      {
        id: "e1",
        vapiCallId: "call-1",
        handledBy: "AI",
        status: "SCORED",
        overallScore: 8,
        adjustedScore: null,
        confidence: 0.9,
        dimensionsJson: { greeting: 8 },
        missedOpportunitiesJson: ["x"],
        createdAt: new Date(),
      },
      {
        id: "e2",
        vapiCallId: "call-2",
        handledBy: "MIXED",
        status: "ADJUSTED",
        overallScore: 3,
        adjustedScore: 6,
        confidence: 0.7,
        dimensionsJson: { greeting: 6 },
        missedOpportunitiesJson: [],
        createdAt: new Date(),
      },
      {
        id: "e3",
        vapiCallId: "call-3",
        handledBy: "AI",
        status: "EXCLUDED",
        overallScore: 0,
        adjustedScore: null,
        confidence: 0,
        dimensionsJson: { excludedReason: "NO_TRANSCRIPT" },
        missedOpportunitiesJson: null,
        createdAt: new Date(),
      },
    ]);
    mocks.vapiCallFindMany.mockResolvedValue([
      { id: "call-1", customerPhone: "+15550001111", outcome: "BOOKED", durationSeconds: 90, startedAt: new Date() },
      { id: "call-2", customerPhone: "+15550002222", outcome: "LEAD", durationSeconds: 60, startedAt: new Date() },
    ]);

    const res = await qualityRoutes.request("/summary");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.totalEvaluations).toBe(2);
    expect(body.data.excludedCount).toBe(1);
    expect(body.data.averageScore).toBe(7); // (8 + 6) / 2
    expect(body.data.missedOpportunityCount).toBe(1);
    expect(body.data.best[0].id).toBe("e1");
    expect(body.data.best[0].call.customerPhone).toBe("+15550001111");
  });

  it("GET /evaluations filters minScore against the effective (adjusted) score", async () => {
    mocks.evalFindMany.mockResolvedValue([
      { id: "e1", overallScore: 8, adjustedScore: null, status: "SCORED", handledBy: "AI", createdAt: new Date() },
      { id: "e2", overallScore: 2, adjustedScore: 9, status: "ADJUSTED", handledBy: "AI", createdAt: new Date() },
      { id: "e3", overallScore: 3, adjustedScore: null, status: "SCORED", handledBy: "AI", createdAt: new Date() },
    ]);

    const res = await qualityRoutes.request("/evaluations?minScore=7");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.evaluations.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"]);
    expect(body.data.evaluations[1].effectiveScore).toBe(9);
  });

  it("POST dispute sets UNDER_REVIEW without touching any score", async () => {
    mocks.evalFindFirst.mockResolvedValue({ id: "ev-1", status: "SCORED" });

    const res = await jsonPost("/evaluations/ev-1/dispute", { note: "Caller was actually happy" });
    expect(res.status).toBe(200);

    const update = mocks.evalUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: "ev-1" });
    expect(update.data.status).toBe("UNDER_REVIEW");
    expect(update.data.reviewNote).toContain("Caller was actually happy");
    expect(update.data).not.toHaveProperty("overallScore");
    expect(update.data).not.toHaveProperty("adjustedScore");
    expect(update.data).not.toHaveProperty("dimensionsJson");
  });

  it("POST dispute requires a note", async () => {
    const res = await jsonPost("/evaluations/ev-1/dispute", {});
    expect(res.status).toBe(422);
    expect(mocks.evalUpdate).not.toHaveBeenCalled();
  });

  it("POST review adjusts the score while preserving the original, and logs activity", async () => {
    mocks.evalFindFirst.mockResolvedValue({ id: "ev-1", status: "UNDER_REVIEW", overallScore: 4.5 });

    const res = await jsonPost("/evaluations/ev-1/review", { adjustedScore: 8, note: "Model was too harsh" });
    expect(res.status).toBe(200);

    const update = mocks.evalUpdate.mock.calls[0][0];
    expect(update.data.status).toBe("ADJUSTED");
    expect(update.data.adjustedScore).toBe(8);
    expect(update.data.reviewNote).toBe("Model was too harsh");
    expect(update.data.reviewedByUserId).toBe("user-1");
    expect(update.data.reviewedAt).toBeInstanceOf(Date);
    expect(update.data).not.toHaveProperty("overallScore");
    expect(update.data).not.toHaveProperty("dimensionsJson");

    expect(mocks.logActivity).toHaveBeenCalledTimes(1);
    expect(mocks.logActivity.mock.calls[0][0]).toMatchObject({
      businessId: "biz-1",
      action: "EVALUATION_REVIEWED",
      actorUserId: "user-1",
      targetId: "ev-1",
    });
  });

  it("POST review without adjustedScore returns the row to SCORED", async () => {
    mocks.evalFindFirst.mockResolvedValue({ id: "ev-1", status: "UNDER_REVIEW", overallScore: 4.5 });

    const res = await jsonPost("/evaluations/ev-1/review", { note: "Score stands" });
    expect(res.status).toBe(200);

    const update = mocks.evalUpdate.mock.calls[0][0];
    expect(update.data.status).toBe("SCORED");
    expect(update.data.adjustedScore).toBeNull();
  });

  it("POST review rejects an out-of-range adjustedScore", async () => {
    const res = await jsonPost("/evaluations/ev-1/review", { adjustedScore: 11 });
    expect(res.status).toBe(422);
    expect(mocks.evalUpdate).not.toHaveBeenCalled();
  });
});
