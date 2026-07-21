import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { createAuthToken } from "../../lib/jwt";
import { businessRoutes } from "./routes";
import { resolvePrimaryBusinessId } from "./primary-business";

const RUN = `primarybiz-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let token = "";
let phoneBusinessId = "";
let strayBusinessId = "";
let workflowId = "";
let agentId = "";

function app() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[primary-business.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({
    data: {
      email: `${RUN}@test.local`,
      role: "BUSINESS",
      roleMemberships: { create: { role: "BUSINESS" } }
    }
  });
  ownerId = owner.id;
  token = await createAuthToken({ id: owner.id, email: owner.email, role: "BUSINESS" });

  // Older business: owns the active number, the agent, and all live traffic.
  const phoneBusiness = await prisma.business.create({
    data: { ownerId, name: `${RUN} live biz`, type: "salon", createdAt: new Date(Date.now() - 60_000) }
  });
  phoneBusinessId = phoneBusiness.id;

  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;

  agentId = (
    await prisma.installedAgent.create({
      data: { businessId: phoneBusinessId, workflowId, name: `${RUN} agent` }
    })
  ).id;

  await prisma.businessPhoneNumber.create({
    data: {
      businessId: phoneBusinessId,
      installedAgentId: agentId,
      phoneNumber: `+1555${String(Date.now()).slice(-7)}`,
      isActive: true
    }
  });

  await prisma.vapiCall.create({
    data: {
      businessId: phoneBusinessId,
      installedAgentId: agentId,
      callId: `${RUN}-live-1`,
      customerPhone: "+15550140001",
      executionMode: "LIVE",
      status: "ENDED",
      recordingUrl: "https://recordings.test.local/live-1.wav"
    }
  });

  await prisma.lead.create({
    data: {
      businessId: phoneBusinessId,
      phoneNumber: "+15550140002",
      source: "MISSED_CALL_TEXT_BACK"
    }
  });

  await prisma.workflowRun.create({
    data: {
      workflowId,
      installedAgentId: agentId,
      businessId: phoneBusinessId,
      mode: "LIVE",
      status: "COMPLETED",
      callProvider: "VAPI",
      externalCallId: `${RUN}-live-1`,
      finishedAt: new Date()
    }
  });

  // Newer stray business row for the SAME owner — must never win.
  const stray = await prisma.business.create({
    data: { ownerId, name: `${RUN} stray biz`, type: "salon" }
  });
  strayBusinessId = stray.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.workflowRun.deleteMany({ where: { businessId: phoneBusinessId } });
  await prisma.vapiCall.deleteMany({ where: { businessId: phoneBusinessId } });
  await prisma.lead.deleteMany({ where: { businessId: phoneBusinessId } });
  await prisma.businessPhoneNumber.deleteMany({ where: { businessId: phoneBusinessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId: phoneBusinessId } });
  await prisma.business.deleteMany({ where: { id: { in: [phoneBusinessId, strayBusinessId] } } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("resolvePrimaryBusinessId", () => {
  it("prefers the business with the active phone number over a newer stray row", async () => {
    if (!dbAvailable) return;
    expect(await resolvePrimaryBusinessId(ownerId)).toBe(phoneBusinessId);
  });

  it("falls back to the business carrying a buyer agent when no active number exists", async () => {
    if (!dbAvailable) return;
    await prisma.businessPhoneNumber.updateMany({
      where: { businessId: phoneBusinessId },
      data: { isActive: false }
    });
    try {
      expect(await resolvePrimaryBusinessId(ownerId)).toBe(phoneBusinessId);
    } finally {
      await prisma.businessPhoneNumber.updateMany({
        where: { businessId: phoneBusinessId },
        data: { isActive: true }
      });
    }
  });
});

describe("GET /business/dashboard", () => {
  it("serves runs, activity, and recordings from the phone-owning business — not the newest row", async () => {
    if (!dbAvailable) return;

    const response = await app().request("/business/dashboard", {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        business: { id: string } | null;
        monthlyMetrics: { callsHandled: number };
        activities: Array<{ recordingUrl?: string | null }>;
        agentActivity: unknown[];
        callHistory: Array<{ customerPhone: string; direction: string; recordingUrl: string | null }>;
        executions: Array<{ status: string; workflowName: string }>;
      };
    };

    expect(body.data.business?.id).toBe(phoneBusinessId);
    // 1 LIVE call + 1 captured missed call = 2 handled this month.
    expect(body.data.monthlyMetrics.callsHandled).toBe(2);
    expect(body.data.agentActivity.length).toBeGreaterThan(0);
    expect(
      body.data.activities.some(
        (activity) => activity.recordingUrl === "https://recordings.test.local/live-1.wav"
      )
    ).toBe(true);

    // Call history + executions panels are fed from the same business.
    expect(body.data.callHistory.length).toBe(1);
    expect(body.data.callHistory[0].customerPhone).toBe("+15550140001");
    expect(body.data.callHistory[0].direction).toBe("inbound");
    expect(body.data.callHistory[0].recordingUrl).toBe("https://recordings.test.local/live-1.wav");
    expect(body.data.executions.length).toBe(1);
    expect(body.data.executions[0].status).toBe("COMPLETED");
  });
});
