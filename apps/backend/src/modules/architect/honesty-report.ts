/**
 * WHAT TURNED RED.
 *
 * Every node execution is now compared against what its node type says it
 * produces. This is where that comparison is read back — grouped by node type
 * and by what was missing, because the same fault fails hundreds of times and a
 * list of hundreds of identical lines is a list nobody reads.
 *
 * Grouping is also what makes the AI layer cheap when it arrives: one
 * diagnosis per CAUSE, never one per occurrence.
 *
 * Three counts, and the third is the one people skip over:
 *
 *   proven      — did what it said.
 *   unproven    — said it worked, returned nothing it declared. Broken, hiding.
 *   cannot-tell — declares nothing, so no answer is possible. Not a pass. This
 *                 number is the size of the blind spot, and shrinking it is
 *                 exactly the "fill in the missing declarations" job.
 */

import { prisma } from "../../lib/prisma";

export type HonestyGroup = {
  nodeType: string;
  label: string;
  missing: string[];
  runs: number;
  firstSeen: string;
  lastSeen: string;
  /** One real example, so a person can go and look at it. */
  exampleRunId: string;
};

export type HonestyReport = {
  since: string;
  totals: { proven: number; unproven: number; cannotTell: number; judged: number };
  /** Ordered by how often each fault has happened. */
  broken: HonestyGroup[];
  /** Node types that declare nothing, so nothing can check them. */
  blind: Array<{ nodeType: string; runs: number }>;
};

export async function honestyReport(days = 30): Promise<HonestyReport> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);

  const counts = await prisma.nodeRun.groupBy({
    by: ["honesty"],
    where: { createdAt: { gte: since } },
    _count: { _all: true }
  });

  const total = (verdict: string) =>
    counts.find((row) => row.honesty === verdict)?._count._all ?? 0;

  // Only the ones that claimed success and did not deliver. An error row was
  // already honest about failing.
  const failures = await prisma.nodeRun.findMany({
    where: { honesty: "unproven", createdAt: { gte: since } },
    select: {
      nodeType: true,
      nodeLabel: true,
      missingOutputs: true,
      createdAt: true,
      workflowRunId: true
    },
    orderBy: { createdAt: "desc" },
    take: 5000
  });

  const groups = new Map<string, HonestyGroup>();
  for (const row of failures) {
    // The cause is the node type plus what it failed to return — the same step
    // missing a different field is a different fault.
    const key = `${row.nodeType}::${[...row.missingOutputs].sort().join(",")}`;
    const existing = groups.get(key);
    const at = row.createdAt.toISOString();

    if (existing) {
      existing.runs += 1;
      if (at < existing.firstSeen) existing.firstSeen = at;
      if (at > existing.lastSeen) existing.lastSeen = at;
      continue;
    }

    groups.set(key, {
      nodeType: row.nodeType,
      label: row.nodeLabel ?? row.nodeType,
      missing: [...row.missingOutputs],
      runs: 1,
      firstSeen: at,
      lastSeen: at,
      exampleRunId: row.workflowRunId
    });
  }

  const blindRows = await prisma.nodeRun.groupBy({
    by: ["nodeType"],
    where: { honesty: "cannot-tell", status: "SUCCESS", createdAt: { gte: since } },
    _count: { _all: true }
  });

  return {
    since: since.toISOString(),
    totals: {
      proven: total("proven"),
      unproven: total("unproven"),
      cannotTell: total("cannot-tell"),
      judged: counts.reduce((sum, row) => sum + row._count._all, 0)
    },
    broken: [...groups.values()].sort((a, b) => b.runs - a.runs),
    blind: blindRows
      .map((row) => ({ nodeType: row.nodeType, runs: row._count._all }))
      .sort((a, b) => b.runs - a.runs)
  };
}
