import { prisma } from "../../lib/prisma";

export type InstalledAgentRunRef = {
  id: string;
  listingId: string | null;
};

export type InstalledAgentRunStats = {
  runs: number;
  costMicroUsd: number;
};

export type InstalledAgentUsageStats = {
  /** Every canonical execution since day one — the number billing counts. */
  lifetimeExecutions: number;
  /** Total cost consumed since day one (billed + legacy display cost). */
  lifetimeCostMicroUsd: number;
  monthExecutions: number;
  monthCostMicroUsd: number;
};

/**
 * Canonical per-agent execution stats from the AgentUsageExecution ledger —
 * the SAME rows the buyer is invoiced from, so the dashboard, My Agents cards,
 * and the Billing page can never disagree with what is actually charged.
 * (buildInstalledAgentRunStats above is a call-centric view kept for architect
 * analytics and data export; buyer-facing surfaces read this one.)
 */
export async function buildInstalledAgentUsageStats(
  businessId: string,
  installedAgentIds: string[],
  billingMonth: string
): Promise<Map<string, InstalledAgentUsageStats>> {
  const statsByAgent = new Map<string, InstalledAgentUsageStats>();
  for (const id of installedAgentIds) {
    statsByAgent.set(id, {
      lifetimeExecutions: 0,
      lifetimeCostMicroUsd: 0,
      monthExecutions: 0,
      monthCostMicroUsd: 0
    });
  }
  if (installedAgentIds.length === 0) return statsByAgent;

  const [lifetime, month] = await Promise.all([
    prisma.agentUsageExecution.groupBy({
      by: ["installedAgentId"],
      where: { businessId, installedAgentId: { in: installedAgentIds } },
      _count: { _all: true },
      _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true }
    }),
    prisma.agentUsageExecution.groupBy({
      by: ["installedAgentId"],
      where: {
        businessId,
        installedAgentId: { in: installedAgentIds },
        billingMonth
      },
      _count: { _all: true },
      _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true }
    })
  ]);

  for (const row of lifetime) {
    const stats = statsByAgent.get(row.installedAgentId);
    if (!stats) continue;
    stats.lifetimeExecutions = row._count._all;
    stats.lifetimeCostMicroUsd =
      (row._sum.amountMicroUsd ?? 0) + (row._sum.legacyBilledCostMicroUsd ?? 0);
  }
  for (const row of month) {
    const stats = statsByAgent.get(row.installedAgentId);
    if (!stats) continue;
    stats.monthExecutions = row._count._all;
    stats.monthCostMicroUsd =
      (row._sum.amountMicroUsd ?? 0) + (row._sum.legacyBilledCostMicroUsd ?? 0);
  }
  return statsByAgent;
}


export async function buildInstalledAgentRunStats(
  businessId: string,
  installedAgents: InstalledAgentRunRef[],
  range?: { start?: Date; end?: Date }
) {
  const agentIds = installedAgents.map((agent) => agent.id);
  const statsByAgent = new Map<string, InstalledAgentRunStats>();

  for (const agent of installedAgents) {
    statsByAgent.set(agent.id, { runs: 0, costMicroUsd: 0 });
  }

  if (agentIds.length === 0) return statsByAgent;

  const createdAt = range?.start || range?.end
    ? { ...(range.start ? { gte: range.start } : {}), ...(range.end ? { lt: range.end } : {}) }
    : undefined;

  const [vapiCalls, missedCalls, phoneLinks] = await Promise.all([
    prisma.vapiCall.findMany({
      where: { businessId, executionMode: "LIVE", ...(createdAt ? { createdAt } : {}) },
      select: { installedAgentId: true, billedCostMicroUsd: true }
    }),
    prisma.lead.count({
      where: {
        businessId,
        source: { contains: "MISSED_CALL" },
        ...(createdAt ? { createdAt } : {})
      }
    }),
    prisma.businessPhoneNumber.findMany({
      where: { businessId, isActive: true },
      select: { installedAgentId: true }
    })
  ]);

  const phoneAgentIds = [
    ...new Set(phoneLinks.map((link) => link.installedAgentId).filter(Boolean) as string[])
  ];
  let unattributedRuns = 0;
  let unattributedCostMicroUsd = 0;

  for (const call of vapiCalls) {
    if (call.installedAgentId && statsByAgent.has(call.installedAgentId)) {
      const row = statsByAgent.get(call.installedAgentId)!;
      row.runs += 1;
      row.costMicroUsd += call.billedCostMicroUsd ?? 0;
      continue;
    }
    unattributedRuns += 1;
    unattributedCostMicroUsd += call.billedCostMicroUsd ?? 0;
  }

  const attributeShared = (runs: number, costMicroUsd: number) => {
    if (runs <= 0 && costMicroUsd <= 0) return;

    // Unattributed activity is credited ONLY when there is exactly one agent
    // it could belong to. Guessing phoneAgentIds[0] in a multi-agent business
    // handed one agent's history to whichever agent happened to hold a number
    // — including across a number reassignment, and across ARCHITECTS when
    // their agents share a business. Ambiguous activity stays uncounted.
    if (installedAgents.length !== 1) {
      if (phoneAgentIds.length > 1) {
        console.warn("[run-stats] unattributed activity left uncounted — several phone-linked agents", {
          phoneAgentCount: phoneAgentIds.length,
          runs
        });
      }
      return;
    }

    const target = statsByAgent.get(installedAgents[0].id);
    if (!target) return;
    target.runs += runs;
    target.costMicroUsd += costMicroUsd;
  };

  attributeShared(unattributedRuns, unattributedCostMicroUsd);
  attributeShared(missedCalls, 0);

  return statsByAgent;
}
