import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { buildInstalledAgentUsageStats } from "./installed-agent-run-stats";

/**
 * Buyer-facing execution stats come from the canonical AgentUsageExecution
 * ledger — the same rows invoices are built from. Lifetime numbers count from
 * the agent's very first execution; month numbers cover one billing month; and
 * the cost is the ledger's display cost (billed + legacy), so the My Agents
 * card, the dashboard rows, and the Billing page can never disagree.
 */

const MONTH = "2026-08";
const PREVIOUS_MONTH = "2026-07";

let ownerId = "";
let businessId = "";
let workflowId = "";
let agentAId = "";
let agentBId = "";

async function ledgerRow(input: {
  installedAgentId: string;
  executionNumber: number;
  billingMonth: string;
  occurredAt: Date;
  amountMicroUsd: number;
  legacyBilledCostMicroUsd?: number;
}) {
  await prisma.agentUsageExecution.create({
    data: {
      businessId,
      installedAgentId: input.installedAgentId,
      dedupeKey: `usage-stats-test:${input.installedAgentId}:${input.executionNumber}`,
      source: "VAPI",
      sourceId: `usage-stats-call-${input.installedAgentId}-${input.executionNumber}`,
      billingMonth: input.billingMonth,
      occurredAt: input.occurredAt,
      executionNumber: input.executionNumber,
      billable: input.amountMicroUsd > 0,
      unitPriceMicroUsd: input.amountMicroUsd,
      amountMicroUsd: input.amountMicroUsd,
      legacyBilledCostMicroUsd: input.legacyBilledCostMicroUsd ?? 0
    }
  });
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: "usage-stats-test-owner@example.com",
      role: "BUSINESS",
      fullName: "Usage Stats Test"
    },
    select: { id: true }
  });
  ownerId = owner.id;

  const business = await prisma.business.create({
    data: { ownerId, name: "Usage Stats Test Biz", type: "Testing" },
    select: { id: true }
  });
  businessId = business.id;

  const workflow = await prisma.workflowDefinition.create({
    data: {
      name: "Usage stats workflow",
      architectUserId: ownerId,
      workflowJson: { nodes: [], edges: [] }
    },
    select: { id: true }
  });
  workflowId = workflow.id;

  const [agentA, agentB] = await Promise.all([
    prisma.installedAgent.create({
      data: { businessId, workflowId, name: "Stats Agent A" },
      select: { id: true }
    }),
    prisma.installedAgent.create({
      data: { businessId, workflowId, name: "Stats Agent B" },
      select: { id: true }
    })
  ]);
  agentAId = agentA.id;
  agentBId = agentB.id;

  // Agent A: 2 executions last month ($1.00 + $0.25 legacy), 3 this month
  // ($0.50 each). Agent B: 1 free trial execution this month ($0).
  await ledgerRow({
    installedAgentId: agentAId,
    executionNumber: 1,
    billingMonth: PREVIOUS_MONTH,
    occurredAt: new Date("2026-07-05T10:00:00.000Z"),
    amountMicroUsd: 1_000_000
  });
  await ledgerRow({
    installedAgentId: agentAId,
    executionNumber: 2,
    billingMonth: PREVIOUS_MONTH,
    occurredAt: new Date("2026-07-06T10:00:00.000Z"),
    amountMicroUsd: 0,
    legacyBilledCostMicroUsd: 250_000
  });
  for (let index = 0; index < 3; index += 1) {
    await ledgerRow({
      installedAgentId: agentAId,
      executionNumber: 3 + index,
      billingMonth: MONTH,
      occurredAt: new Date(`2026-08-0${index + 1}T10:00:00.000Z`),
      amountMicroUsd: 500_000
    });
  }
  await ledgerRow({
    installedAgentId: agentBId,
    executionNumber: 1,
    billingMonth: MONTH,
    occurredAt: new Date("2026-08-02T10:00:00.000Z"),
    amountMicroUsd: 0
  });
});

afterAll(async () => {
  await prisma.agentUsageExecution.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("buildInstalledAgentUsageStats", () => {
  it("counts lifetime executions from day one and this month separately", async () => {
    const stats = await buildInstalledAgentUsageStats(
      businessId,
      [agentAId, agentBId],
      MONTH
    );

    const agentA = stats.get(agentAId)!;
    expect(agentA.lifetimeExecutions).toBe(5);
    expect(agentA.monthExecutions).toBe(3);
    // Lifetime cost = $1.00 + $0.25 legacy + 3 × $0.50 = $2.75.
    expect(agentA.lifetimeCostMicroUsd).toBe(2_750_000);
    expect(agentA.monthCostMicroUsd).toBe(1_500_000);
  });

  it("never mixes one agent's executions into another's stats", async () => {
    const stats = await buildInstalledAgentUsageStats(
      businessId,
      [agentAId, agentBId],
      MONTH
    );

    const agentB = stats.get(agentBId)!;
    expect(agentB.lifetimeExecutions).toBe(1);
    expect(agentB.monthExecutions).toBe(1);
    expect(agentB.lifetimeCostMicroUsd).toBe(0);
  });

  it("returns zeroed stats for an agent with no executions yet", async () => {
    const fresh = await prisma.installedAgent.create({
      data: { businessId, workflowId, name: "Stats Agent C" },
      select: { id: true }
    });
    try {
      const stats = await buildInstalledAgentUsageStats(
        businessId,
        [fresh.id],
        MONTH
      );
      expect(stats.get(fresh.id)).toEqual({
        lifetimeExecutions: 0,
        lifetimeCostMicroUsd: 0,
        monthExecutions: 0,
        monthCostMicroUsd: 0
      });
    } finally {
      await prisma.installedAgent.delete({ where: { id: fresh.id } });
    }
  });
});
