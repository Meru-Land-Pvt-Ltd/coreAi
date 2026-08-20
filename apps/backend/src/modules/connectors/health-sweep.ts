/**
 * THE DAILY SELF-TEST — what replaces a person reading changelogs.
 *
 * The founder's instinct was to put a human on every provider: someone whose
 * job is to notice when Apollo changes an endpoint or Twilio deprecates a
 * version. That instinct was right about the risk and expensive about the fix.
 * A connector that declares a probe can test itself, every day, before a
 * customer's agent discovers the problem on their behalf.
 *
 * What this catches is the quiet failure. A provider renames one field and
 * every response still returns 200 — nothing errors, nothing alerts, and the
 * agent goes on producing empty results until somebody complains. The probe
 * checks the SHAPE of the answer, not just that an answer arrived.
 *
 * What it deliberately does not do is cry wolf. A connector nobody has given a
 * key to is not broken; it is unused. Reporting that as a failure every day is
 * how an alert becomes something people scroll past.
 */

import { prisma } from "../../lib/prisma";
import { checkConnectorHealth, type HealthResult } from "./engine";
import { allConnectors, connectorsNeedingReview } from "./registry";

export type SweepResult = {
  checkedAt: string;
  checked: number;
  broken: HealthResult[];
  /** Working, but nobody has confirmed it against current docs in a long time. */
  needsReview: Array<{ connectorId: string; provider: string; lastVerified: string }>;
};

/**
 * Test every connector once and write down what happened.
 *
 * Sequential on purpose. This runs once a day against a handful of providers;
 * a burst of parallel requests to each of them buys nothing and looks, from
 * their side, exactly like the thing their own rate limits exist to stop.
 */
export async function sweepConnectorHealth(): Promise<SweepResult> {
  const contracts = allConnectors();
  const broken: HealthResult[] = [];

  for (const contract of contracts) {
    const health = await checkConnectorHealth(contract);

    try {
      await prisma.connectorHealthCheck.create({
        data: {
          connectorId: health.connectorId,
          healthy: health.healthy,
          severity: health.severity,
          message: health.message.slice(0, 500),
          missingKeys: health.missingKeys ?? []
        }
      });
    } catch (error) {
      console.warn("[connectors] could not record health check", (error as Error).message);
    }

    if (!health.healthy) {
      broken.push(health);
      // Loud in the log, because "breaks-agents" means somebody's paid agent
      // is producing nothing right now.
      console.error(
        `[connectors] ${health.connectorId} FAILED its self-test (${health.severity}): ${health.message}`
      );
    }
  }

  const needsReview = connectorsNeedingReview().map((contract) => ({
    connectorId: contract.id,
    provider: contract.provider.name,
    lastVerified: contract.provider.lastVerified
  }));

  if (needsReview.length > 0) {
    console.warn(
      `[connectors] ${needsReview.length} connector(s) have not been checked against their provider's docs in over six months: ${needsReview
        .map((entry) => entry.connectorId)
        .join(", ")}`
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    checked: contracts.length,
    broken,
    needsReview
  };
}

/**
 * The most recent verdict for every connector, for an admin screen.
 *
 * One row per connector — the latest — rather than a history, because the
 * question being asked is always "is anything broken right now".
 */
export async function latestConnectorHealth(): Promise<
  Array<{
    connectorId: string;
    label: string;
    provider: string;
    healthy: boolean | null;
    severity: string;
    message: string;
    checkedAt: string | null;
  }>
> {
  const contracts = allConnectors();

  const rows = await prisma.connectorHealthCheck.findMany({
    where: { connectorId: { in: contracts.map((contract) => contract.id) } },
    orderBy: { checkedAt: "desc" },
    take: contracts.length * 5
  });

  return contracts.map((contract) => {
    const latest = rows.find((row) => row.connectorId === contract.id);
    return {
      connectorId: contract.id,
      label: contract.label,
      provider: contract.provider.name,
      healthy: latest ? latest.healthy : null,
      severity: contract.health.severity,
      message: latest?.message ?? "Not checked yet.",
      checkedAt: latest?.checkedAt.toISOString() ?? null
    };
  });
}
