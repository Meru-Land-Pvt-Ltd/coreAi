/**
 * RUNNING A CONNECTOR FOR REAL — the engine, plus a record of what happened.
 *
 * The engine itself never touches the database. That is deliberate: it is the
 * piece every connector depends on, so it stays a pure function of its inputs
 * and can be tested without a Postgres anywhere near it.
 *
 * This is the thin layer production uses. It runs the engine and writes down
 * what happened, because a business's dashboard figures are read back out of
 * these rows. A number on a screen has to come from a record of something that
 * actually occurred — otherwise it is the same invention the engine exists to
 * prevent, just drawn instead of logged.
 */

import type { NodeFrame } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { runConnector, type ConnectorRunInput, type ConnectorRunResult } from "./engine";

export type ConnectorRunContext = ConnectorRunInput & {
  installedAgentId?: string;
  workflowRunId?: string;
};

/**
 * How many things this run produced.
 *
 * Read from the outputs the contract declared, not from a count the heart
 * volunteered — a heart could report ten and return none, and the number on
 * the dashboard is the one a business makes decisions with.
 */
function unitsFrom(contract: NodeFrame, result: ConnectorRunResult): number {
  let units = 0;
  for (const output of contract.produces) {
    const value = result.outputs[output.key];
    if (Array.isArray(value)) units += value.length;
  }
  /* A CARD THAT FOUND NOBODY REPORTED FINDING ONE.
     The fallback below is right for a card that produces a single thing — "0
     messages sent" after a successful send would be wrong. But it also fired
     for a card that declares a LIST and came back with an empty one, so a
     search that found nobody was written down as one unit, and the business's
     dashboard counted leads that were never found. An empty list is a real
     answer, and its answer is zero. */
  const producesAList = contract.produces.some((output) => output.kind === "list");
  if (units === 0 && result.ok && !producesAList) units = result.pagesFetched;
  return units;
}

export async function runConnectorAndRecord(
  input: ConnectorRunContext
): Promise<ConnectorRunResult> {
  const startedAt = Date.now();
  const result = await runConnector(input);

  try {
    await prisma.connectorRun.create({
      data: {
        connectorId: input.contract.id,
        businessId: input.businessId || null,
        installedAgentId: input.installedAgentId || null,
        workflowRunId: input.workflowRunId || null,
        ok: result.ok,
        code: result.code,
        message: result.message.slice(0, 500),
        unitsProduced: unitsFrom(input.contract, result),
        pagesFetched: result.pagesFetched,
        costCents: Math.round(result.costCents),
        isTest: input.isTest === true,
        durationMs: Date.now() - startedAt
      }
    });
  } catch (error) {
    // Failing to write the log must never fail the work. The leads were found;
    // losing the row that says so is a reporting problem, not a run problem.
    console.warn("[connectors] could not record run", (error as Error).message);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Reading it back                                                             */
/* -------------------------------------------------------------------------- */

export type ConnectorTotals = {
  /** Keyed by connector id: how many things it produced. */
  units: Record<string, number>;
  /** Keyed by connector id: what it cost, in whole US dollars and cents. */
  spend: Record<string, number>;
  /** Keyed by connector id: runs that hit a problem. */
  failed: Record<string, number>;
};

/**
 * Every connector figure one dashboard needs, in one query.
 *
 * Test runs are excluded. An architect rehearsing an agent forty times must
 * never show up as forty leads on the business's screen.
 */
export async function connectorTotals(
  businessId: string,
  installedAgentId: string,
  from?: Date
): Promise<ConnectorTotals> {
  const rows = await prisma.connectorRun.groupBy({
    by: ["connectorId", "ok"],
    where: {
      businessId,
      installedAgentId,
      isTest: false,
      ...(from ? { createdAt: { gte: from } } : {})
    },
    _sum: { unitsProduced: true, costCents: true },
    _count: { _all: true }
  });

  const totals: ConnectorTotals = { units: {}, spend: {}, failed: {} };
  for (const row of rows) {
    const id = row.connectorId;
    totals.units[id] = (totals.units[id] ?? 0) + (row._sum.unitsProduced ?? 0);
    totals.spend[id] = (totals.spend[id] ?? 0) + (row._sum.costCents ?? 0) / 100;
    if (!row.ok) totals.failed[id] = (totals.failed[id] ?? 0) + row._count._all;
  }
  return totals;
}
