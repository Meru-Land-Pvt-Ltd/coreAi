/**
 * The real numbers behind a composed dashboard.
 *
 * Smart Designer decides what the business sees and where; this decides what
 * the numbers actually are. The two are joined by {{metric.key}} tokens, so a
 * dashboard designed once shows today's figures every time it is opened.
 *
 * Every figure here is scoped to ONE installed agent belonging to ONE business.
 * A dashboard that leaked another business's call count would be worse than no
 * dashboard at all.
 */

import {
  deriveBusinessSurface,
  fillMetricTokens,
  formatMetricValue,
  sanitizeProductSpec,
  type ProductSpec
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";

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
    const calls = await prisma.vapiCall.findMany({
      where: {
        businessId,
        installedAgentId,
        ...(from ? { createdAt: { gte: from } } : {})
      },
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

    raw.callsMade = calls.length;
    // "Answered" means a human spoke — a voicemail is not a conversation, and
    // counting it as one would flatter the number that matters most.
    raw.callsAnswered = calls.filter((call) => call.outcome === "ANSWERED" || call.outcome === "BOOKED").length;
    raw.connectRate = calls.length ? (raw.callsAnswered / calls.length) * 100 : 0;
    raw.callMinutes = Math.round(
      calls.reduce((total, call) => total + (call.durationSeconds ?? 0), 0) / 60
    );
    raw.spend =
      calls.reduce((total, call) => total + Number(call.billedCostMicroUsd ?? 0), 0) / 1_000_000;

    tables.recentCalls = calls.slice(0, 25).map((call) => ({
      When: call.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      Who: call.customerPhone || "Unknown",
      "What happened": friendlyOutcome(call.outcome),
      Length: call.durationSeconds ? `${Math.round(call.durationSeconds / 60)} min` : "—"
    }));
  }

  // ---- Appointments ------------------------------------------------------
  if (wanted.has("booked")) {
    const appointments = await prisma.appointment.findMany({
      where: { businessId, ...(from ? { createdAt: { gte: from } } : {}) },
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

    raw.booked = appointments.length;
    raw.bookRate = raw.callsAnswered ? (appointments.length / raw.callsAnswered) * 100 : 0;

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

  // Format for display, so a percent never lands on screen as "62".
  const values: Record<string, string> = {};
  for (const metric of surface.metrics) {
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
