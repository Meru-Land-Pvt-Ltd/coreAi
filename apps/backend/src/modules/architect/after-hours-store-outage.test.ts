import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { resolveLiveAfterHoursGateContext } from "./after-hours-live-gate";
import {
  resetAfterHoursCallStateStore,
  setAfterHoursProductionModeForTests,
  setAfterHoursRedisAdapterForTests
} from "../business/after-hours-call-state";

await vi.hoisted(async () => {
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");
  const dotenv = await import("dotenv");
  dotenv.config({
    path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../../.env")
  });
  process.env.NODE_ENV = "test";
  delete process.env.REDIS_URL;
  return {};
});

const RUN = `ahoutage-${process.pid}-${Date.now().toString(36)}`;
let dbAvailable = false;

const ALWAYS_OPEN = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
].map((day) => ({ day, closed: false, open: "00:00", close: "23:59" }));

const CLOSED_NOW = (() => {
  const laHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false })
  );
  const openHour = (laHour + 3) % 24;
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
  ].map((day) => ({ day, closed: false, open: `${pad(openHour)}:00`, close: `${pad(openHour)}:59` }));
})();

type Fixture = { userId: string; businessId: string; workflowId: string; agentId: string };
const fixtures: Fixture[] = [];

async function makeBusiness(options: {
  hoursJson: unknown | null;
  explicitPolicy: boolean;
}): Promise<Fixture> {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${fixtures.length}@test.local`, role: "BUSINESS" }
  });
  const business = await prisma.business.create({
    data: { ownerId: user.id, name: `${RUN} Biz ${fixtures.length}`, type: "dental practice" }
  });
  await prisma.businessProfile.create({
    data: {
      businessId: business.id,
      timeZone: "America/Los_Angeles",
      ...(options.hoursJson ? { hoursJson: options.hoursJson as never, hoursConfirmedAt: new Date() } : {})
    }
  });
  const workflow = await prisma.workflowDefinition.create({
    data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: user.id }
  });
  const agent = await prisma.installedAgent.create({
    data: {
      businessId: business.id,
      workflowId: workflow.id,
      name: `${RUN} agent`,
      status: "ACTIVE",
      configJson: (options.explicitPolicy
        ? {
            afterHoursPolicy: {
              enabled: true,
              emergencyScreeningEnabled: true,
              emergencyCategory: "DENTAL",
              emergencyContactMethod: "SMS"
            }
          }
        : {}) as never
    }
  });
  const fixture = { userId: user.id, businessId: business.id, workflowId: workflow.id, agentId: agent.id };
  fixtures.push(fixture);
  return fixture;
}

function gateParams(businessId: string, agentId: string) {
  return {
    businessId,
    installedAgentId: agentId,
    callId: `call_${RUN}_${Math.floor(Math.random() * 1e9)}`,
    executionMode: "LIVE",
    body: {}
  };
}

/** Simulate production with NO distributed store at all. */
function simulateProductionOutage() {
  setAfterHoursProductionModeForTests(true);
  setAfterHoursRedisAdapterForTests(null);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[after-hours-store-outage.test] database unreachable — suite skipped");
  }
});

afterEach(() => {
  resetAfterHoursCallStateStore();
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  for (const fixture of fixtures) {
    await prisma.installedAgent.deleteMany({ where: { id: fixture.agentId } });
    await prisma.workflowDefinition.deleteMany({ where: { id: fixture.workflowId } });
    await prisma.businessProfile.deleteMany({ where: { businessId: fixture.businessId } });
    await prisma.business.deleteMany({ where: { id: fixture.businessId } });
    await prisma.user.deleteMany({ where: { id: fixture.userId } });
  }
  await prisma.$disconnect();
});

describe("after-hours gate during a distributed-store outage (production)", () => {
  it("OPEN business on the default policy stays ungated (the Better White case)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fixture = await makeBusiness({ hoursJson: ALWAYS_OPEN, explicitPolicy: false });
    simulateProductionOutage();

    const gate = await resolveLiveAfterHoursGateContext(gateParams(fixture.businessId, fixture.agentId));
    expect(gate.active).toBe(false);
  }, 30000);

  it("UNKNOWN-hours business on the default policy stays ungated", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fixture = await makeBusiness({ hoursJson: null, explicitPolicy: false });
    simulateProductionOutage();

    const gate = await resolveLiveAfterHoursGateContext(gateParams(fixture.businessId, fixture.agentId));
    expect(gate.active).toBe(false);
  }, 30000);

  it("CLOSED business fails closed: gate active with storeUnavailable", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fixture = await makeBusiness({ hoursJson: CLOSED_NOW, explicitPolicy: false });
    simulateProductionOutage();

    const gate = await resolveLiveAfterHoursGateContext(gateParams(fixture.businessId, fixture.agentId));
    expect(gate.active).toBe(true);
    expect(gate.storeUnavailable).toBe(true);
  }, 30000);

  it("an EXPLICITLY saved policy with UNKNOWN hours still fails closed (opted-in screening)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fixture = await makeBusiness({ hoursJson: null, explicitPolicy: true });
    simulateProductionOutage();

    const gate = await resolveLiveAfterHoursGateContext(gateParams(fixture.businessId, fixture.agentId));
    expect(gate.active).toBe(true);
    expect(gate.storeUnavailable).toBe(true);
  }, 30000);

  it("outside the outage, the CLOSED default-policy flow still derives full state", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fixture = await makeBusiness({ hoursJson: CLOSED_NOW, explicitPolicy: false });
    // Non-production: memory store fallback is allowed — no outage.
    setAfterHoursProductionModeForTests(false);

    const gate = await resolveLiveAfterHoursGateContext(gateParams(fixture.businessId, fixture.agentId));
    expect(gate.active).toBe(true);
    expect(gate.storeUnavailable).toBeUndefined();
    expect(gate.state?.businessHoursState).toBe("CLOSED");
  }, 30000);
});
