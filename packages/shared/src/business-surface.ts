/**
 * WHAT THE BUSINESS SEES — derived from the nodes the architect used.
 *
 * The platform's model, settled by the founder: the architect builds the
 * brain, the business logs in and uses it. That means an agent owes its buyer
 * two screens, and both are implied by the graph rather than drawn by hand:
 *
 *   SETUP    — asked once, on day one. Already derived elsewhere
 *              (setup-visibility.ts) from the same nodes.
 *   DASHBOARD — opened every day for the next two years. Who called, who
 *              booked, what it cost. Nothing derived this before.
 *
 * The second one is the product. A business fills the setup form once and
 * then judges the whole $199/month on what the dashboard shows them; an agent
 * that only has a settings page gets cancelled in month three.
 *
 * This file works out WHAT the dashboard must contain. AI Builder decides
 * what it looks like — that separation is deliberate, so a better composer
 * improves every agent's dashboard without anyone editing a template.
 */

import { CALL_LIST_NODE_TYPE } from "./call-list.js";

/** A number worth putting on the wall. */
export type BusinessMetric = {
  /** Referenced in a composed spec as {{metric.key}}. */
  key: string;
  label: string;
  /** Why a business owner should care — becomes helper text. */
  help: string;
  /** Big numbers lead; supporting numbers sit underneath. */
  emphasis: "primary" | "secondary";
  /** How to render it, so "62%" never comes out as "62". */
  format: "number" | "percent" | "money" | "duration";
};

/** A board of rows the business can scan. */
export type BusinessTable = {
  key: string;
  label: string;
  /** The node whose work this table shows. */
  nodeId?: string;
  columns: string[];
};

/** A thing the business does here, not just reads. */
export type BusinessAction = {
  key: string;
  label: string;
  help: string;
  nodeId?: string;
  kind: "upload" | "start-stop" | "link";
};

export type BusinessSurface = {
  /** True when this agent has anything worth showing daily. */
  hasDashboard: boolean;
  metrics: BusinessMetric[];
  tables: BusinessTable[];
  actions: BusinessAction[];
  /** One line for the composer: what this agent actually does for them. */
  summary: string;
};

type GraphNode = { id?: string; data?: Record<string, unknown> };

function nodesOf(workflowJson: unknown): GraphNode[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as GraphNode[]) : [];
}

function typeOf(node: GraphNode): string {
  return typeof node.data?.type === "string" ? node.data.type : "";
}

/**
 * Read a graph and say what the buyer's daily screen must contain.
 *
 * Purely derived, no network, no model call — the composer needs a truthful
 * list of what exists before it is allowed to design anything, or it invents
 * metrics the platform cannot fill and the dashboard shows zeros forever.
 */
export function deriveBusinessSurface(workflowJson: unknown): BusinessSurface {
  const nodes = nodesOf(workflowJson);
  const types = new Set(nodes.map(typeOf).filter(Boolean));

  const metrics: BusinessMetric[] = [];
  const tables: BusinessTable[] = [];
  const actions: BusinessAction[] = [];
  const does: string[] = [];

  const hasVoice = types.has("ai.voice_conversation") || types.has("action.start_vapi_call");
  const hasCallList = types.has(CALL_LIST_NODE_TYPE);
  const hasBooking = types.has("calendar.book_appointment");
  const hasLead = types.has("action.save_lead");
  const hasSms = types.has("action.send_sms") || types.has("channel.sms");
  const hasEmail = types.has("action.send_email");

  if (hasVoice) {
    does.push("answers and makes phone calls");
    metrics.push(
      {
        key: "callsMade",
        label: "Calls",
        help: "How many calls your agent handled.",
        emphasis: "primary",
        format: "number"
      },
      {
        key: "callsAnswered",
        label: "Reached a person",
        help: "Calls where someone actually picked up and spoke.",
        emphasis: "primary",
        format: "number"
      },
      {
        key: "connectRate",
        label: "Answer rate",
        help: "Out of every hundred calls, how many reached a real person.",
        emphasis: "secondary",
        format: "percent"
      },
      {
        key: "callMinutes",
        label: "Time on the phone",
        help: "Total minutes your agent spent talking to people.",
        emphasis: "secondary",
        format: "duration"
      },
      {
        key: "spend",
        label: "Cost",
        help: "What these calls cost you.",
        emphasis: "secondary",
        format: "money"
      }
    );
    tables.push({
      key: "recentCalls",
      label: "Recent calls",
      columns: ["When", "Who", "What happened", "Length"]
    });
  }

  if (hasBooking) {
    does.push("books appointments into your calendar");
    metrics.push(
      {
        key: "booked",
        label: "Appointments booked",
        help: "The number that pays for this. Every one is a customer who would otherwise have been missed.",
        emphasis: "primary",
        format: "number"
      },
      {
        key: "bookRate",
        label: "Booking rate",
        help: "Of the people your agent actually spoke to, how many booked.",
        emphasis: "secondary",
        format: "percent"
      }
    );
    tables.push({
      key: "appointments",
      label: "Booked appointments",
      columns: ["When", "Who", "Service", "Phone"]
    });
  }

  if (hasLead) {
    does.push("saves everyone who gets in touch");
    metrics.push({
      key: "leads",
      label: "New leads",
      help: "People your agent captured details for.",
      emphasis: "secondary",
      format: "number"
    });
  }

  if (hasSms || hasEmail) {
    does.push(hasSms ? "texts people back" : "emails people back");
    metrics.push({
      key: "messagesSent",
      label: "Messages sent",
      help: "Texts and emails your agent sent on your behalf.",
      emphasis: "secondary",
      format: "number"
    });
  }

  // The call list is the one node the business OPERATES rather than watches,
  // so it earns controls, its own progress numbers and a board of people.
  for (const node of nodes) {
    if (typeOf(node) !== CALL_LIST_NODE_TYPE) continue;
    const nodeId = String(node.id ?? "");
    const label =
      typeof node.data?.title === "string" && node.data.title.trim() ? node.data.title.trim() : "My list";

    does.push("works through a list of people you upload");
    metrics.push(
      {
        key: "listWaiting",
        label: "Still to call",
        help: "People on your list your agent has not reached yet.",
        emphasis: "secondary",
        format: "number"
      },
      {
        key: "listDone",
        label: "Called so far",
        help: "How far through the list your agent has got.",
        emphasis: "secondary",
        format: "number"
      }
    );
    tables.push({
      key: "listPeople",
      label,
      nodeId,
      columns: ["Name", "Phone", "Status", "Tries", "Next try"]
    });
    actions.push(
      {
        key: "uploadPeople",
        label: "Add people to call",
        help: "Paste your list — a name and a phone number on each line.",
        nodeId,
        kind: "upload"
      },
      {
        key: "startStop",
        label: "Start or stop calling",
        help: "Nothing is dialled until you press start, and stop halts it immediately.",
        nodeId,
        kind: "start-stop"
      }
    );
  }

  const summary = does.length
    ? `This agent ${does.slice(0, 3).join(", ")}.`
    : "This agent runs in the background for you.";

  return {
    hasDashboard: metrics.length > 0,
    metrics,
    tables,
    actions,
    summary
  };
}

/** Every metric key the platform can actually fill. Guards invented metrics. */
export function knownMetricKeys(surface: BusinessSurface): string[] {
  return surface.metrics.map((metric) => metric.key);
}

/**
 * Replace {{metric.key}} tokens with real values.
 *
 * A composed dashboard is a normal ProductSpec whose numbers are written as
 * tokens, so the whole existing renderer, sanitizer and Designer's Eyes work
 * on it unchanged. An unknown token renders as "—" rather than leaking the
 * token itself onto a paying customer's screen.
 */
export function fillMetricTokens(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{\{\s*metric\.([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === "") return "—";
    return String(value);
  });
}

/** Format one metric for display, so a percent never renders as a bare number. */
export function formatMetricValue(format: BusinessMetric["format"], value: number): string {
  switch (format) {
    case "percent":
      return `${Math.round(value)}%`;
    case "money":
      return `$${value.toFixed(2)}`;
    case "duration": {
      const minutes = Math.round(value);
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.floor(minutes / 60);
      return `${hours}h ${minutes % 60}m`;
    }
    default:
      return String(Math.round(value));
  }
}
