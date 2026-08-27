/**
 * The real numbers behind a composed dashboard.
 *
 * the AI Builder decides what the business sees and where; this decides what
 * the numbers actually are. The two are joined by {{metric.key}} tokens, so a
 * dashboard designed once shows today's figures every time it is opened.
 *
 * Every figure here is scoped to ONE installed agent belonging to ONE business.
 * A dashboard that leaked another business's call count would be worse than no
 * dashboard at all.
 */

import {
  deriveBusinessSurface,
  deriveBuyerContract,
  fillMetricTokens,
  formatMetricValue,
  sanitizeProductSpec,
  type ProductSpec
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { allConnectors } from "../connectors/registry";
import { allCachedArchitectFrames } from "../connectors/architect-frames";
import { connectorTotals } from "../connectors/run-log";

export type DashboardWindow = "today" | "week" | "month" | "all";

function since(window: DashboardWindow): Date | undefined {
  const now = Date.now();
  switch (window) {
    case "today":
      return new Date(new Date().setHours(0, 0, 0, 0));
    case "week":
      return new Date(now - 7 * 24 * 60 * 60_000);
    case "month":
      return new Date(now - 30 * 24 * 60 * 60_000);
    default:
      return undefined;
  }
}

export type DashboardData = {
  values: Record<string, string>;
  raw: Record<string, number>;
  tables: Record<string, Array<Record<string, string>>>;
  lists: Array<{
    id: string;
    name: string;
    status: string;
    waiting: number;
    called: number;
    booked: number;
  }>;
};

/**
 * Gather everything one dashboard needs, in one pass.
 *
 * Reads the agent's own graph first so we only compute figures the agent can
 * actually produce — an agent with no booking step never asks the database
 * about appointments.
 */
export async function loadDashboardData(
  installedAgentId: string,
  businessId: string,
  window: DashboardWindow = "month"
): Promise<DashboardData> {
  const agent = await prisma.installedAgent.findFirst({
    where: { id: installedAgentId, businessId },
    select: { id: true, workflow: { select: { workflowJson: true } } }
  });

  const surface = deriveBusinessSurface(agent?.workflow?.workflowJson);
  const wanted = new Set(surface.metrics.map((metric) => metric.key));
  const from = since(window);

  const raw: Record<string, number> = {};
  const tables: DashboardData["tables"] = {};

  // ---- Calls -------------------------------------------------------------
  if (wanted.has("callsMade") || wanted.has("callsAnswered")) {
    /* THEIR BUSINESS, NOT THEIR TESTING. None of these queries excluded the
       owner's own test calls, so pressing "test" on their setup screen moved
       the numbers on their dashboard. Every sibling surface already pins
       executionMode LIVE; this one did not. */
    const liveCalls = {
      businessId,
      installedAgentId,
      executionMode: "LIVE" as const,
      ...(from ? { createdAt: { gte: from } } : {})
    };

    const calls = await prisma.vapiCall.findMany({
      where: liveCalls,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        createdAt: true,
        customerPhone: true,
        outcome: true,
        durationSeconds: true,
        billedCostMicroUsd: true
      }
    });

    /* A COUNT MUST BE A COUNT, NOT A PAGE SIZE (found by the platform audit,
       2026-08-27). This reported the length of a deliberately truncated
       page: a business with 500 calls was shown "200", and every rate built
       on it was wrong too. The totals are counted in the database; the rows
       stay a page, because a table only shows 25 anyway. */
    const [callsMade, callsAnswered, totals] = await Promise.all([
      prisma.vapiCall.count({ where: liveCalls }),
      prisma.vapiCall.count({
        where: { ...liveCalls, outcome: { in: ["ANSWERED", "BOOKED"] } }
      }),
      /* Minutes and spend were added up over the same truncated page as the
         counts above once were: a business with 500 calls was shown the cost
         of 200 of them, on the tile that says what they are spending. */
      prisma.vapiCall.aggregate({
        where: liveCalls,
        _sum: { durationSeconds: true, billedCostMicroUsd: true }
      })
    ]);

    raw.callsMade = callsMade;
    // "Answered" means a human spoke — a voicemail is not a conversation, and
    // counting it as one would flatter the number that matters most.
    raw.callsAnswered = callsAnswered;
    raw.connectRate = callsMade ? (callsAnswered / callsMade) * 100 : 0;
    raw.callMinutes = Math.round((totals._sum.durationSeconds ?? 0) / 60);
    raw.spend = Number(totals._sum.billedCostMicroUsd ?? 0) / 1_000_000;

    tables.recentCalls = calls.slice(0, 25).map((call) => ({
      When: call.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      Who: call.customerPhone || "Unknown",
      "What happened": friendlyOutcome(call.outcome),
      Length: call.durationSeconds ? `${Math.round(call.durationSeconds / 60)} min` : "—"
    }));
  }

  // ---- Appointments ------------------------------------------------------
  if (wanted.has("booked")) {
    /* SCOPED TO THIS AGENT (found by the same audit). The file's own header
       promises "every figure here is scoped to ONE installed agent belonging
       to ONE business" — and this query was scoped to the business only, so
       a business running two agents saw both their bookings on each one's
       dashboard. */
    /* Live bookings only — a rehearsal is not a customer. */
    const liveAppointments = {
      businessId,
      installedAgentId,
      executionMode: "LIVE" as const,
      ...(from ? { createdAt: { gte: from } } : {})
    };

    const appointments = await prisma.appointment.findMany({
      where: liveAppointments,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        createdAt: true,
        startAt: true,
        customerName: true,
        customerPhone: true,
        service: true
      }
    });

    const booked = await prisma.appointment.count({ where: liveAppointments });
    raw.booked = booked;
    raw.bookRate = raw.callsAnswered ? (booked / raw.callsAnswered) * 100 : 0;

    tables.appointments = appointments.slice(0, 25).map((appointment) => ({
      When: appointment.startAt
        ? appointment.startAt.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
          })
        : "—",
      Who: appointment.customerName || "—",
      Service: appointment.service || "—",
      Phone: appointment.customerPhone || "—"
    }));
  }

  // ---- Leads and messages ------------------------------------------------
  if (wanted.has("leads")) {
    raw.leads = await prisma.lead.count({
      where: { businessId, ...(from ? { createdAt: { gte: from } } : {}) }
    });
  }

  // ---- Call lists --------------------------------------------------------
  const lists = await prisma.callList.findMany({
    where: { installedAgentId, businessId },
    include: { people: { select: { status: true } } }
  });

  const listSummaries = lists.map((list) => {
    const waiting = list.people.filter((p) => p.status === "WAITING" || p.status === "RETRY").length;
    const booked = list.people.filter((p) => p.status === "BOOKED").length;
    return {
      id: list.id,
      name: list.name,
      status: list.status,
      waiting,
      called: list.people.length - waiting,
      booked
    };
  });

  if (wanted.has("listWaiting")) {
    raw.listWaiting = listSummaries.reduce((total, list) => total + list.waiting, 0);
    raw.listDone = listSummaries.reduce((total, list) => total + list.called, 0);

    const people = await prisma.callListPerson.findMany({
      where: { list: { installedAgentId, businessId } },
      orderBy: [{ lastAttemptAt: "desc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        name: true,
        phone: true,
        status: true,
        attempts: true,
        nextAttemptAt: true
      }
    });

    tables.listPeople = people.map((person) => ({
      Name: person.name || "—",
      Phone: person.phone,
      Status: friendlyPersonStatus(person.status),
      Tries: String(person.attempts),
      "Next try": person.nextAttemptAt
        ? person.nextAttemptAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })
        : "—"
    }));
  }

  // ---- Every agent: how often it ran, and how often it went wrong --------
  //
  // TILES THAT COULD ONLY EVER SHOW A DASH. Every agent's contract declares
  // "Times it ran" and "Problems", and nothing counted them — so the only two
  // tiles a non-voice business gets, on the only dashboard they have, were
  // blank from the day the agent went live.
  if (wanted.has("runs") || wanted.has("runsFailed")) {
    const runWhere = {
      installedAgentId,
      businessId,
      mode: "LIVE" as const,
      ...(from ? { startedAt: { gte: from } } : {})
    };
    const [runs, runsFailed] = await Promise.all([
      prisma.workflowRun.count({ where: runWhere }),
      prisma.workflowRun.count({ where: { ...runWhere, status: "FAILED" } })
    ]);
    raw.runs = runs;
    raw.runsFailed = runsFailed;
  }

  // ---- Messages the agent sent on their behalf ---------------------------
  if (wanted.has("messagesSent")) {
    /* Declared by every texting or emailing agent and counted by nobody, so
       the tile read zero however many messages went out. */
    const [texts, emails] = await Promise.all([
      prisma.smsExecution.count({
        where: {
          businessId,
          installedAgentId,
          status: { in: ["SENT", "DELIVERED", "ACCEPTED"] },
          ...(from ? { createdAt: { gte: from } } : {})
        }
      }),
      prisma.emailMessage
        .count({
          where: {
            businessId,
            direction: "OUTBOUND",
            ...(from ? { createdAt: { gte: from } } : {})
          }
        })
        .catch(() => 0)
    ]);
    raw.messagesSent = texts + emails;
  }

  // ---- Connectors --------------------------------------------------------
  //
  // Everything above is a figure the platform knows how to count because
  // somebody wrote code for it. This part is not: these tiles were generated
  // from whatever connectors the agent's nodes declared, including connectors
  // that did not exist when this file was written. They are filled from the
  // connector run log, which every connector writes to identically.
  const connectorMetrics = deriveBuyerContract(agent?.workflow?.workflowJson, {
    connectors: [...allConnectors(), ...allCachedArchitectFrames()]
  }).metrics.filter((metric) => metric.source.startsWith("connector."));

  if (connectorMetrics.length > 0) {
    const totals = await connectorTotals(businessId, installedAgentId, from);
    for (const metric of connectorMetrics) {
      // source is "connector.<id>.<what>", and an id contains dots of its own,
      // so the last segment is the figure and everything between is the id.
      const parts = metric.source.split(".");
      const what = parts[parts.length - 1];
      const connectorId = parts.slice(1, -1).join(".");

      if (what === "units") raw[metric.key] = totals.units[connectorId] ?? 0;
      else if (what === "spend") raw[metric.key] = totals.spend[connectorId] ?? 0;
      else if (what === "failed") raw[metric.key] = totals.failed[connectorId] ?? 0;
    }
  }

  // Format for display, so a percent never lands on screen as "62".
  const values: Record<string, string> = {};
  for (const metric of [...surface.metrics, ...connectorMetrics]) {
    values[metric.key] = formatMetricValue(metric.format, raw[metric.key] ?? 0);
  }

  return { values, raw, tables, lists: listSummaries };
}

/** Words a dentist uses, not the enum we store. */
export function friendlyOutcome(outcome: string | null): string {
  switch (outcome) {
    case "ANSWERED":
      return "Spoke to them";
    case "BOOKED":
      return "Booked an appointment";
    case "VOICEMAIL":
      return "Left a voicemail";
    case "NO_ANSWER":
      return "No answer";
    case "BUSY":
      return "Line was busy";
    case "BAD_NUMBER":
      return "Number does not work";
    case "FAILED":
      return "Call failed";
    default:
      return "—";
  }
}

export function friendlyPersonStatus(status: string): string {
  switch (status) {
    case "WAITING":
      return "Waiting to be called";
    case "CALLING":
      return "Calling now";
    case "RETRY":
      return "Will try again";
    case "ANSWERED":
      return "Spoke to them";
    case "BOOKED":
      return "Booked";
    case "NO_ANSWER":
      return "No answer";
    case "VOICEMAIL":
      return "Voicemail";
    case "BUSY":
      return "Busy";
    case "BAD_NUMBER":
      return "Bad number";
    case "OPTED_OUT":
      return "Asked not to be called";
    case "SUPPRESSED":
      return "On your do-not-call list";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

/**
 * Put today's numbers into the stored design.
 *
 * The spec is walked as JSON text rather than node by node: metric tokens can
 * legitimately appear in a stat value, a heading, or a line of body text, and
 * the composer should be free to put a number wherever it reads best.
 */
export function fillDashboardSpec(
  spec: ProductSpec,
  values: Record<string, string>
): ProductSpec {
  const filled = fillMetricTokens(JSON.stringify(spec), values);
  return sanitizeProductSpec(JSON.parse(filled)) ?? spec;
}
