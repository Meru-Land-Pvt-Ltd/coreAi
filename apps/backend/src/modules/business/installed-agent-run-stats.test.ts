import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { buildInstalledAgentRunStats } from "./installed-agent-run-stats";

/**
 * Production run counting: runs = LIVE voice-call sessions + captured missed
 * calls. Test executions never count, an appointment is never a second run for
 * the call that booked it, and shared events are attributed exactly once.
 */

const RUN = `runstats-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let workflowId = "";
let agentAId = "";
let agentBId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[installed-agent-run-stats.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "salon" } })
  ).id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;
  agentAId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} agent A` }
    })
  ).id;

  // Two LIVE calls attributed to agent A; one unattributed LIVE call; one
  // BUSINESS_TEST browser preview and one ARCHITECT_DRY_RUN browser test.
  await prisma.vapiCall.createMany({
    data: [
      { businessId, installedAgentId: agentAId, callId: `${RUN}-live-1`, customerPhone: "+15550100001", executionMode: "LIVE", billedCostMicroUsd: 100 },
      { businessId, installedAgentId: agentAId, callId: `${RUN}-live-2`, customerPhone: "+15550100002", executionMode: "LIVE", billedCostMicroUsd: 100 },
      { businessId, callId: `${RUN}-live-3`, customerPhone: "+15550100003", executionMode: "LIVE", billedCostMicroUsd: 50 },
      { businessId, installedAgentId: agentAId, callId: `${RUN}-test-1`, customerPhone: "+15550100004", executionMode: "BUSINESS_TEST" },
      { businessId, installedAgentId: agentAId, callId: `${RUN}-test-2`, customerPhone: "+15550100005", executionMode: "ARCHITECT_DRY_RUN" }
    ]
  });

  // A LIVE appointment booked during live-1 (must NOT count as a second run)
  // and a test appointment (must not count at all).
  await prisma.appointment.createMany({
    data: [
      {
        businessId,
        customerPhone: "+15550100001",
        service: "Haircut",
        startAt: new Date("2099-01-05T15:00:00Z"),
        endAt: new Date("2099-01-05T15:30:00Z"),
        timeZone: "America/New_York",
        executionMode: "LIVE"
      },
      {
        businessId,
        customerPhone: "+15550100004",
        service: "Haircut",
        startAt: new Date("2099-01-06T15:00:00Z"),
        endAt: new Date("2099-01-06T15:30:00Z"),
        timeZone: "America/New_York",
        executionMode: "BUSINESS_TEST"
      }
    ]
  });

  // One captured missed call.
  await prisma.lead.create({
    data: { businessId, phoneNumber: "+15550100009", source: "TWILIO_MISSED_CALL", status: "CAPTURED" }
  });
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.lead.deleteMany({ where: { businessId } });
  await prisma.businessPhoneNumber.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("buildInstalledAgentRunStats", () => {
  it("counts LIVE calls + missed calls only — appointments and test calls never inflate runs", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const stats = await buildInstalledAgentRunStats(businessId, [{ id: agentAId, listingId: null }]);
    const agentStats = stats.get(agentAId);

    // 2 attributed LIVE calls + 1 unattributed LIVE call + 1 missed call = 4.
    // The LIVE appointment adds nothing (its call was already counted); the
    // BUSINESS_TEST and ARCHITECT_DRY_RUN calls add nothing.
    expect(agentStats?.runs).toBe(4);
    expect(agentStats?.costMicroUsd).toBe(250);
  });

  it("attributes shared events exactly once when several agents share phone links", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    agentBId = (
      await prisma.installedAgent.create({
        data: { businessId, workflowId, name: `${RUN} agent B`, listingId: null }
      })
    ).id;
    await prisma.businessPhoneNumber.createMany({
      data: [
        { businessId, installedAgentId: agentAId, phoneNumber: `+1776${String(Date.now()).slice(-7)}`, isActive: true },
        { businessId, installedAgentId: agentBId, phoneNumber: `+1775${String(Date.now()).slice(-7)}`, isActive: true }
      ]
    });

    const stats = await buildInstalledAgentRunStats(businessId, [
      { id: agentAId, listingId: null },
      { id: agentBId, listingId: null }
    ]);

    const totalRuns = [...stats.values()].reduce((sum, row) => sum + row.runs, 0);
    // 3 LIVE calls + 1 missed call = 4 actual events. Shared/unattributed
    // events land on exactly one agent — never duplicated across both.
    expect(totalRuns).toBe(4);
  });
});
