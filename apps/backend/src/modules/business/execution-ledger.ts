import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const EXECUTION_PROVIDER = "VAPI";

export const ACTIVE_INSTALL_STATUS = "ACTIVE";

export type ExecutionRange = { start?: Date; end?: Date };

/**
 * Architect-facing execution counts read the SAME canonical billing ledger
 * (AgentUsageExecution) the buyer pages read — the rows invoices are built
 * from. One execution definition platform-wide: an architect's card, the
 * buyer's My Agents card, and the Billing page can never disagree about how
 * many times an agent ran. Rows are unique per execution by dedupeKey, so a
 * plain count is already a distinct count.
 */
export function countableExecutionWhere(params: {
  businessId?: string;
  installedAgentIds?: string[];
  range?: ExecutionRange;
}): Prisma.AgentUsageExecutionWhereInput {
  return {
    ...(params.businessId ? { businessId: params.businessId } : {}),
    ...(params.installedAgentIds
      ? { installedAgentId: { in: params.installedAgentIds } }
      : {}),
    ...(params.range?.start || params.range?.end
      ? {
          occurredAt: {
            ...(params.range.start ? { gte: params.range.start } : {}),
            ...(params.range.end ? { lt: params.range.end } : {})
          }
        }
      : {})
  };
}

export async function countDistinctExecutions(params: {
  businessId?: string;
  installedAgentIds?: string[];
  range?: ExecutionRange;
}): Promise<number> {
  if (params.installedAgentIds && params.installedAgentIds.length === 0) return 0;
  return prisma.agentUsageExecution.count({ where: countableExecutionWhere(params) });
}

export async function executionTotalsByInstalledAgent(params: {
  installedAgentIds: string[];
  range?: ExecutionRange;
}): Promise<Map<string, { executions: number; billedCostMicroUsd: number }>> {
  const totals = new Map<string, { executions: number; billedCostMicroUsd: number }>();
  if (params.installedAgentIds.length === 0) return totals;

  const grouped = await prisma.agentUsageExecution.groupBy({
    by: ["installedAgentId"],
    where: countableExecutionWhere(params),
    _count: { _all: true },
    _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true }
  });

  for (const row of grouped) {
    if (!row.installedAgentId) continue;
    totals.set(row.installedAgentId, {
      executions: row._count._all,
      billedCostMicroUsd:
        (row._sum.amountMicroUsd ?? 0) + (row._sum.legacyBilledCostMicroUsd ?? 0)
    });
  }
  return totals;
}

function isArchitectTestInstall(configJson: unknown): boolean {
  const config =
    configJson && typeof configJson === "object" && !Array.isArray(configJson)
      ? (configJson as Record<string, unknown>)
      : {};
  return config.purpose === "ARCHITECT_TEST";
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type ArchitectExecutionMetrics = {
  activeExecutionCount: number;
  periodExecutionCount: number;
  lifetimeExecutionCount: number;
  excludedPausedInstallationCount: number;
};

export async function buildArchitectExecutionMetrics(params: {
  architectUserId: string;
  now?: Date;
}): Promise<ArchitectExecutionMetrics> {
  const installs = await prisma.installedAgent.findMany({
    where: { listing: { architectUserId: params.architectUserId } },
    select: { id: true, status: true, configJson: true }
  });

  const realInstalls = installs.filter((install) => !isArchitectTestInstall(install.configJson));
  const allIds = realInstalls.map((install) => install.id);
  const activeIds = realInstalls
    .filter((install) => install.status === ACTIVE_INSTALL_STATUS)
    .map((install) => install.id);
  const pausedCount = realInstalls.filter((install) => install.status === "PAUSED").length;

  const now = params.now ?? new Date();
  const periodStart = monthStartUtc(now);

  const [lifetimeExecutionCount, periodExecutionCount, activeExecutionCount] = await Promise.all([
    countDistinctExecutions({ installedAgentIds: allIds }),
    countDistinctExecutions({ installedAgentIds: allIds, range: { start: periodStart } }),
    countDistinctExecutions({ installedAgentIds: activeIds, range: { start: periodStart } })
  ]);

  return {
    activeExecutionCount,
    periodExecutionCount,
    lifetimeExecutionCount,
    excludedPausedInstallationCount: pausedCount
  };
}

/**
 * LIVE calls the reconciler could not attribute to any agent. These never
 * reach the ledger or any agent's stats — surfaced report-only so the platform
 * can see attribution gaps instead of silently guessing an owner.
 */
export async function countUnattributedLiveExecutions(range?: ExecutionRange): Promise<number> {
  return prisma.vapiCall.count({
    where: {
      executionMode: "LIVE",
      installedAgentId: null,
      ...(range?.start || range?.end
        ? {
            createdAt: {
              ...(range?.start ? { gte: range.start } : {}),
              ...(range?.end ? { lt: range.end } : {})
            }
          }
        : {})
    }
  });
}
