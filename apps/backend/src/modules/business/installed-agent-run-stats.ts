import { prisma } from "../../lib/prisma";

export type InstalledAgentRunRef = {
  id: string;
  listingId: string | null;
};

export type InstalledAgentRunStats = {
  runs: number;
  costMicroUsd: number;
};

/**
 * Uses the same execution definition as Business → My Agents:
 * AI calls plus booking and missed-call runs, attributed to installed agents.
 */
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

  const [vapiCalls, appointments, missedCalls, phoneLinks] = await Promise.all([
    prisma.vapiCall.findMany({
      where: { businessId, ...(createdAt ? { createdAt } : {}) },
      select: { installedAgentId: true, billedCostMicroUsd: true }
    }),
    // Test-mode appointments never count as production runs.
    prisma.appointment.count({
      where: { businessId, executionMode: "LIVE", ...(createdAt ? { createdAt } : {}) }
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

    if (installedAgents.length === 1) {
      const row = statsByAgent.get(installedAgents[0].id)!;
      row.runs += runs;
      row.costMicroUsd += costMicroUsd;
      return;
    }

    if (phoneAgentIds.length === 1) {
      const row = statsByAgent.get(phoneAgentIds[0]);
      if (row) {
        row.runs += runs;
        row.costMicroUsd += costMicroUsd;
      }
      return;
    }

    if (phoneAgentIds.length > 1) {
      for (const agentId of phoneAgentIds) {
        const row = statsByAgent.get(agentId);
        if (row) row.runs += runs;
      }
      const first = statsByAgent.get(phoneAgentIds[0]);
      if (first) first.costMicroUsd += costMicroUsd;
    }
  };

  attributeShared(unattributedRuns, unattributedCostMicroUsd);
  attributeShared(appointments + missedCalls, 0);

  return statsByAgent;
}
