/**
 * Canonical execution ledger + usage idempotency + pause behavior.
 *
 * Real local DB (skips when unreachable); global fetch is stubbed so no Vapi
 * request leaves the process. Covers: the countable rule (LIVE only, distinct
 * by callId, test modes excluded), record-once usage (retries and concurrent
 * deliveries never duplicate cost or move billingMonth), architect metrics
 * (active excludes paused installs; ownership isolation), and pause semantics
 * (blocked new attempts create nothing; in-flight calls settle; CAS
 * pause/resume with pausedAt; historical rows survive).
 */

import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { createAuthToken } from "../../lib/jwt";
import { businessRoutes } from "./routes";
import { recordVapiCallUsage } from "./usage-billing";
import { buildArchitectExecutionMetrics, countDistinctExecutions, executionTotalsByInstalledAgent } from "./execution-ledger";
import { handleVapiWebhook } from "../architect/twilio-business-routing";

const RUN = `ledger-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let architectAId = "";
let architectBId = "";
let buyerId = "";
let buyerToken = "";
let businessId = "";
let otherBusinessId = "";
let listingAId = "";
let listingBId = "";
let workflowAId = "";
let workflowBId = "";
let agentActiveId = "";
let agentPausedId = "";
let agentOtherArchitectId = "";
let serviceCode = "";

function webhookApp() {
  const instance = new Hono();
  instance.post("/architect/connectors/vapi/webhook", handleVapiWebhook);
  return instance;
}

function businessApp() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

function endOfCallBody(callId: string, opts?: { durationSeconds?: number }) {
  return {
    message: {
      type: "end-of-call-report",
      durationSeconds: opts?.durationSeconds ?? 120,
      call: { id: callId, type: "inboundPhoneCall", customer: { number: "+15555550188" } }
    },
    metadata: { businessId, installedAgentId: agentActiveId }
  };
}

async function postWebhook(body: Record<string, unknown>) {
  const response = await webhookApp().request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown> & { results?: Array<{ result: string }> };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[execution-ledger.test] database unreachable — suite skipped");
    return;
  }

  const [architectA, architectB, buyer] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-archa@test.local`, role: "ARCHITECT" } }),
    prisma.user.create({ data: { email: `${RUN}-archb@test.local`, role: "ARCHITECT" } }),
    prisma.user.create({
      data: { email: `${RUN}-buyer@test.local`, role: "BUSINESS", roleMemberships: { create: { role: "BUSINESS" } } }
    })
  ]);
  architectAId = architectA.id;
  architectBId = architectB.id;
  buyerId = buyer.id;
  buyerToken = await createAuthToken({ id: buyer.id, email: buyer.email, role: "BUSINESS" });

  businessId = (await prisma.business.create({ data: { ownerId: buyerId, name: `${RUN} Biz`, type: "dental" } })).id;
  otherBusinessId = (
    await prisma.business.create({ data: { ownerId: buyerId, name: `${RUN} Biz2`, type: "salon" } })
  ).id;
  await prisma.businessProfile.create({ data: { businessId, timeZone: "America/Los_Angeles" } });

  workflowAId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wfA`, workflowJson: { nodes: [], edges: [] }, architectUserId: architectAId }
    })
  ).id;
  workflowBId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wfB`, workflowJson: { nodes: [], edges: [] }, architectUserId: architectBId }
    })
  ).id;

  listingAId = (
    await prisma.agentListing.create({
      data: {
        name: `${RUN} Listing A`,
        shortDescription: "free agent",
        priceCents: 0,
        pricingModel: "FREE",
        status: "APPROVED",
        architectUserId: architectAId,
        workflowId: workflowAId
      }
    })
  ).id;
  listingBId = (
    await prisma.agentListing.create({
      data: {
        name: `${RUN} Listing B`,
        shortDescription: "other architect",
        priceCents: 500,
        status: "APPROVED",
        architectUserId: architectBId,
        workflowId: workflowBId
      }
    })
  ).id;

  agentActiveId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId: workflowAId, listingId: listingAId, name: `${RUN} active`, status: "ACTIVE" }
    })
  ).id;
  agentPausedId = (
    await prisma.installedAgent.create({
      data: {
        businessId: otherBusinessId,
        workflowId: workflowAId,
        listingId: listingAId,
        name: `${RUN} paused`,
        status: "PAUSED",
        pausedAt: new Date()
      }
    })
  ).id;
  agentOtherArchitectId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId: workflowBId, listingId: listingBId, name: `${RUN} other`, status: "ACTIVE" }
    })
  ).id;

  // One active PER_MINUTE rate row: buyer price $0.10/min, platform cost $0.06/min.
  serviceCode = `${RUN}-per-minute`;
  await prisma.platformUsageService.create({
    data: {
      code: serviceCode,
      name: `${RUN} Voice minutes`,
      role: "Voice platform",
      unit: "PER_MINUTE",
      actualCostMicroUsd: 60_000,
      updatedCostMicroUsd: 100_000,
      isActive: true
    }
  });

  // Ledger fixtures: LIVE + test-mode calls for the active install, LIVE calls
  // for the paused install (history) and the other architect's install.
  await prisma.vapiCall.createMany({
    data: [
      { businessId, installedAgentId: agentActiveId, callId: `${RUN}-live-1`, customerPhone: "x", executionMode: "LIVE", billedCostMicroUsd: 100_000 },
      { businessId, installedAgentId: agentActiveId, callId: `${RUN}-live-2`, customerPhone: "x", executionMode: "LIVE", billedCostMicroUsd: 200_000 },
      { businessId, installedAgentId: agentActiveId, callId: `${RUN}-test-1`, customerPhone: "x", executionMode: "BUSINESS_TEST" },
      { businessId, installedAgentId: agentActiveId, callId: `${RUN}-dry-1`, customerPhone: "x", executionMode: "ARCHITECT_DRY_RUN" },
      { businessId: otherBusinessId, installedAgentId: agentPausedId, callId: `${RUN}-paused-hist-1`, customerPhone: "x", executionMode: "LIVE", billedCostMicroUsd: 300_000 },
      { businessId, installedAgentId: agentOtherArchitectId, callId: `${RUN}-other-arch-1`, customerPhone: "x", executionMode: "LIVE" }
    ]
  });

  // A missed-call lead must never count as a canonical execution.
  await prisma.lead.create({
    data: { businessId, phoneNumber: "+15555550190", source: "TWILIO_MISSED_CALL", status: "CAPTURED" }
  });
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.vapiCall.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.workflowRun.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.lead.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.platformUsageService.deleteMany({ where: { code: serviceCode } });
  await prisma.installedAgent.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.agentListing.deleteMany({ where: { id: { in: [listingAId, listingBId] } } });
  await prisma.workflowDefinition.deleteMany({ where: { id: { in: [workflowAId, workflowBId] } } });
  await prisma.businessProfile.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [architectAId, architectBId, buyerId] } } });
  await prisma.$disconnect();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response)
  );
}

describe("countable rule", () => {
  it("counts distinct LIVE provider executions only — test modes and leads excluded, several usage components still one execution", async () => {
    if (!dbAvailable) return;
    const activeCount = await countDistinctExecutions({ installedAgentIds: [agentActiveId] });
    expect(activeCount).toBe(2); // live-1 + live-2; BUSINESS_TEST/ARCHITECT_DRY_RUN/lead excluded

    const totals = await executionTotalsByInstalledAgent({ installedAgentIds: [agentActiveId] });
    // Cost sums across usage components while the execution count stays per call.
    expect(totals.get(agentActiveId)).toEqual({ executions: 2, billedCostMicroUsd: 300_000 });
  });
});

describe("architect metrics", () => {
  it("active metric excludes paused installs; lifetime keeps their history; ownership never leaks", async () => {
    if (!dbAvailable) return;
    const metricsA = await buildArchitectExecutionMetrics({ architectUserId: architectAId });
    // Lifetime: live-1, live-2 (active install) + paused-hist-1 (paused install history).
    expect(metricsA.lifetimeExecutionCount).toBe(3);
    // Period (this month): all three fixtures were created now.
    expect(metricsA.periodExecutionCount).toBe(3);
    // Active metric: paused install excluded → only the active install's 2.
    expect(metricsA.activeExecutionCount).toBe(2);
    expect(metricsA.excludedPausedInstallationCount).toBe(1);

    const metricsB = await buildArchitectExecutionMetrics({ architectUserId: architectBId });
    expect(metricsB.lifetimeExecutionCount).toBe(1); // only other-arch-1
    expect(metricsB.activeExecutionCount).toBe(1);
    expect(metricsB.excludedPausedInstallationCount).toBe(0);
  });
});

describe("idempotent usage recording", () => {
  it("records once; a retried end-of-call re-delivery never duplicates cost or moves billingMonth", async () => {
    if (!dbAvailable) return;
    stubFetchOffline();
    const callId = `${RUN}-usage-1`;
    const body = endOfCallBody(callId, { durationSeconds: 120 });

    await postWebhook(body);
    // recordVapiCallUsage is fire-and-forget from the webhook — call directly
    // to settle deterministically (the direct call is itself idempotent).
    await recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId, webhookBody: body });

    const first = await prisma.vapiCall.findUnique({ where: { callId } });
    expect(first?.executionMode).toBe("LIVE");
    // The dev DB may carry additional admin rate rows — assert real metered
    // cost was recorded (at least this test's 2 min × $0.10/min buyer rate).
    expect(first?.billedCostMicroUsd ?? 0).toBeGreaterThanOrEqual(200_000);
    expect(first?.billingRecordedAt).not.toBeNull();

    // Mutate the pricing row, then re-deliver: a frozen row must not change.
    await prisma.platformUsageService.update({
      where: { code: serviceCode },
      data: { updatedCostMicroUsd: 999_000 }
    });
    await postWebhook(body);
    await recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId, webhookBody: body });
    await prisma.platformUsageService.update({
      where: { code: serviceCode },
      data: { updatedCostMicroUsd: 100_000 }
    });

    const rows = await prisma.vapiCall.findMany({ where: { callId } });
    expect(rows).toHaveLength(1); // one canonical execution, ever
    expect(rows[0]?.billedCostMicroUsd).toBe(first?.billedCostMicroUsd); // rate snapshot preserved
    expect(rows[0]?.billingMonth).toBe(first?.billingMonth);
    expect(rows[0]?.billingRecordedAt?.toISOString()).toBe(first?.billingRecordedAt?.toISOString());
  });

  it("concurrent duplicate deliveries stay idempotent (one row, single-call cost)", async () => {
    if (!dbAvailable) return;
    stubFetchOffline();

    // Baseline: an identical call settled serially, once.
    const serialCallId = `${RUN}-usage-serial`;
    const serialBody = endOfCallBody(serialCallId, { durationSeconds: 60 });
    await postWebhook(serialBody);
    await recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId: serialCallId, webhookBody: serialBody });
    const serialRow = await prisma.vapiCall.findUnique({ where: { callId: serialCallId } });

    const callId = `${RUN}-usage-2`;
    const body = endOfCallBody(callId, { durationSeconds: 60 });
    await postWebhook(body);

    await Promise.all([
      recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId, webhookBody: body }),
      recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId, webhookBody: body })
    ]);

    const rows = await prisma.vapiCall.findMany({ where: { callId } });
    expect(rows).toHaveLength(1);
    // Same cost as the serially-settled identical call — never doubled.
    expect(rows[0]?.billedCostMicroUsd).toBe(serialRow?.billedCostMicroUsd);
  });

  it("failed executions with real metered usage store the actual usage; test modes never bill", async () => {
    if (!dbAvailable) return;
    stubFetchOffline();
    const callId = `${RUN}-usage-failed`;
    await prisma.vapiCall.create({
      data: { businessId, installedAgentId: agentActiveId, callId, customerPhone: "x", executionMode: "LIVE", status: "failed" }
    });
    const body = endOfCallBody(callId, { durationSeconds: 90 });
    await recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId, webhookBody: body });
    const failedRow = await prisma.vapiCall.findUnique({ where: { callId } });
    // 1.5 min of real metered usage stored despite the failed final status.
    expect(failedRow?.billedCostMicroUsd ?? 0).toBeGreaterThanOrEqual(150_000);
    expect(failedRow?.billingRecordedAt).not.toBeNull();

    const testCallId = `${RUN}-test-nobill`;
    await prisma.vapiCall.create({
      data: { businessId, installedAgentId: agentActiveId, callId: testCallId, customerPhone: "x", executionMode: "BUSINESS_TEST" }
    });
    await recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId: testCallId, webhookBody: endOfCallBody(testCallId) });
    const testRow = await prisma.vapiCall.findUnique({ where: { callId: testCallId } });
    expect(testRow?.billingRecordedAt).toBeNull();
    expect(testRow?.billedCostMicroUsd).toBeNull();
  });
});

describe("pause semantics", () => {
  it("a NEW attempt against a paused agent creates no execution row, no usage, no count — and returns AGENT_PAUSED", async () => {
    if (!dbAvailable) return;
    stubFetchOffline();
    await prisma.installedAgent.update({
      where: { id: agentActiveId },
      data: { status: "PAUSED", pausedAt: new Date() }
    });

    try {
      const before = await countDistinctExecutions({ installedAgentIds: [agentActiveId] });

      const blockedTool = await postWebhook({
        message: {
          type: "tool-calls",
          toolCalls: [{ id: "tc1", function: { name: "book_appointment", arguments: "{}" } }],
          call: { id: `${RUN}-paused-new`, type: "inboundPhoneCall" }
        },
        metadata: { businessId, installedAgentId: agentActiveId }
      });
      const result = JSON.parse(blockedTool.results?.[0]?.result ?? "{}") as Record<string, unknown>;
      expect(result.code).toBe("AGENT_PAUSED");

      await postWebhook(endOfCallBody(`${RUN}-paused-new`));

      expect(await prisma.vapiCall.findUnique({ where: { callId: `${RUN}-paused-new` } })).toBeNull();
      expect(await countDistinctExecutions({ installedAgentIds: [agentActiveId] })).toBe(before);
    } finally {
      await prisma.installedAgent.update({
        where: { id: agentActiveId },
        data: { status: "ACTIVE", pausedAt: null }
      });
    }
  });

  it("an execution started BEFORE pause settles its actual metered usage; history survives pause", async () => {
    if (!dbAvailable) return;
    stubFetchOffline();
    const callId = `${RUN}-inflight-1`;
    await prisma.vapiCall.create({
      data: { businessId, installedAgentId: agentActiveId, callId, customerPhone: "x", executionMode: "LIVE" }
    });
    await prisma.installedAgent.update({
      where: { id: agentActiveId },
      data: { status: "PAUSED", pausedAt: new Date() }
    });

    try {
      const settle = await postWebhook(endOfCallBody(callId, { durationSeconds: 120 }));
      expect(settle.paused).toBe(true);
      await recordVapiCallUsage({ businessId, installedAgentId: agentActiveId, callId, webhookBody: endOfCallBody(callId, { durationSeconds: 120 }) });
      const row = await prisma.vapiCall.findUnique({ where: { callId } });
      expect(row?.billedCostMicroUsd ?? 0).toBeGreaterThanOrEqual(200_000);

      // Historical rows remain visible while paused.
      expect(await countDistinctExecutions({ installedAgentIds: [agentActiveId] })).toBeGreaterThan(0);
    } finally {
      await prisma.installedAgent.update({
        where: { id: agentActiveId },
        data: { status: "ACTIVE", pausedAt: null }
      });
    }
  });

  it("pause/resume endpoints: CAS transitions with pausedAt, idempotent replays, resume restores execution", async () => {
    if (!dbAvailable) return;
    const app = businessApp();
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${buyerToken}` };

    const pause = await app.request(`/business/agents/${agentActiveId}/pause`, { method: "POST", headers });
    expect(pause.status).toBe(200);
    const paused = await prisma.installedAgent.findUnique({ where: { id: agentActiveId } });
    expect(paused?.status).toBe("PAUSED");
    expect(paused?.pausedAt).not.toBeNull();

    // Replayed pause is idempotent (no error, state unchanged).
    const pauseAgain = await app.request(`/business/agents/${agentActiveId}/pause`, { method: "POST", headers });
    expect(pauseAgain.status).toBe(200);

    const resume = await app.request(`/business/agents/${agentActiveId}/resume`, { method: "POST", headers });
    expect(resume.status).toBe(200);
    const resumed = await prisma.installedAgent.findUnique({ where: { id: agentActiveId } });
    expect(resumed?.status).toBe("ACTIVE");
    expect(resumed?.pausedAt).toBeNull();

    // Resume did not duplicate or erase any historical execution rows.
    const rows = await prisma.vapiCall.findMany({
      where: { installedAgentId: agentActiveId, callId: { in: [`${RUN}-live-1`, `${RUN}-live-2`] } }
    });
    expect(rows).toHaveLength(2);
  });
});
