/**
 * THE BUYER CONTRACT — what a business must give an agent, and what it gets back.
 *
 * The founder's law: the architect builds the brain, the business logs in and
 * uses it, and NOBODY hand-writes the business's screens. That only holds if
 * the platform can read any orchestration — including node types nobody has
 * invented yet — and work out on its own:
 *
 *   INPUTS  — every question the business must answer before the agent works
 *   OUTPUTS — every number and board worth showing them afterwards
 *   PROOF   — what must be verified before an architect may test it
 *
 * Nothing here is a list of known agents. Everything is derived from what each
 * node DECLARES about itself in the registry: the connectors it needs and who
 * owns them, the config it reads, the variables it produces, its capability.
 * A node type added next year, by someone we never meet, produces a working
 * setup form and dashboard the day it ships — because it declares the same
 * things every other node declares.
 *
 * The fallbacks matter as much as the rules. An unknown node with no useful
 * declarations still contributes "it ran, it worked, it failed", because a
 * business that cannot see whether the thing ran has no product at all.
 */

import { getNodeDefinition, type ConnectorRequirement, type NodeDefinition } from "./node-registry.js";

/* -------------------------------------------------------------------------- */
/* What we ask the business                                                    */
/* -------------------------------------------------------------------------- */

export type BuyerInputKind =
  | "text"
  | "longtext"
  | "number"
  | "phone"
  | "email"
  | "url"
  | "date"
  | "time"
  | "hours"
  | "choice"
  | "file"
  | "list";

export type BuyerInput = {
  /** Stable key the composer references and the answer is saved under. */
  key: string;
  label: string;
  help: string;
  kind: BuyerInputKind;
  required: boolean;
  /** Every node that needs this answer. Length > 1 means it was merged. */
  nodeIds: string[];
  choices?: string[];
  placeholder?: string;
};

/** An account the business must connect, e.g. their Google Calendar. */
export type BuyerConnection = {
  key: string;
  label: string;
  help: string;
  connector: string;
  optional: boolean;
  nodeIds: string[];
};

/* -------------------------------------------------------------------------- */
/* What we show the business                                                   */
/* -------------------------------------------------------------------------- */

export type BuyerMetric = {
  key: string;
  label: string;
  help: string;
  emphasis: "primary" | "secondary";
  format: "number" | "percent" | "money" | "duration";
  /** Where the number comes from, so the resolver knows what to count. */
  source: string;
  nodeIds: string[];
};

export type BuyerTable = {
  key: string;
  label: string;
  columns: string[];
  source: string;
  nodeIds: string[];
};

export type BuyerAction = {
  key: string;
  label: string;
  help: string;
  kind: "upload" | "start-stop" | "link";
  nodeIds: string[];
};

/* -------------------------------------------------------------------------- */
/* What must be verified before a test may run                                 */
/* -------------------------------------------------------------------------- */

/**
 * A test that can reach a stranger is not a test, it is a live campaign with
 * no consent behind it. Every channel an orchestration can reach OUT on is
 * listed here, and testing is confined to identities the architect has proven
 * they own.
 */
export type TestVerification = {
  /** Same value as `channel`; present so verifications merge like everything else. */
  key: string;
  channel: "phone" | "email" | "sms" | "whatsapp" | "telegram";
  label: string;
  /** Shown to the architect, in their words, before they can press test. */
  requirement: string;
  nodeIds: string[];
};

export type BuyerContract = {
  inputs: BuyerInput[];
  connections: BuyerConnection[];
  metrics: BuyerMetric[];
  tables: BuyerTable[];
  actions: BuyerAction[];
  verification: TestVerification[];
  /** One plain line describing what this agent does for the business. */
  summary: string;
  /** True when there is anything worth showing daily. */
  hasDashboard: boolean;
  /** Node types we could not recognise — surfaced, never silently dropped. */
  unknownNodeTypes: string[];
};

/* -------------------------------------------------------------------------- */
/* Reading the graph                                                           */
/* -------------------------------------------------------------------------- */

type GraphNode = { id?: string; data?: Record<string, unknown> };

function nodesOf(workflowJson: unknown): GraphNode[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as GraphNode[]) : [];
}

function nodeType(node: GraphNode): string {
  return typeof node.data?.type === "string" ? node.data.type : "";
}

function nodeTitle(node: GraphNode, def?: NodeDefinition): string {
  const title = node.data?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return def?.label ?? "This step";
}

/** Turn a config key or variable name into words a business owner reads. */
export function humanise(key: string): string {
  const spaced = key
    .replace(/[_.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * What kind of answer a key wants.
 *
 * Keyword tables rather than a chain of special cases: a new node naming its
 * field "ownerMobile" gets a phone keypad without anyone touching this file.
 */
const KIND_HINTS: Array<{ kind: BuyerInputKind; match: RegExp }> = [
  // Content first, deliberately. "smsBody" and "emailTemplate" name a MESSAGE,
  // not an address, and a phone keypad on a message box is a nasty little bug
  // that only shows up on someone's phone.
  { kind: "longtext", match: /(prompt|instructions|message|body|description|script|template|brief|guidelines|notes|greeting|subject)/i },
  { kind: "file", match: /(file|upload|document|pdf|attachment|photo|image|logo)/i },
  { kind: "list", match: /(services|faqs|list|items|tags|keywords|objections|talking)/i },
  { kind: "phone", match: /(phone|mobile|whatsapp|sms|number)(?!s?of)/i },
  { kind: "email", match: /(email|mail(?!ing)|inbox)/i },
  { kind: "url", match: /(url|link|website|domain|webhook)/i },
  { kind: "hours", match: /(hours|opening|schedule|availability)/i },
  { kind: "time", match: /(time|hour|when)/i },
  { kind: "date", match: /(date|day|deadline)/i },
  { kind: "number", match: /(count|max|min|limit|duration|budget|price|amount|days|minutes|quantity|size)/i },
  { kind: "choice", match: /(tone|style|mode|type|language)/i }
];

export function inferInputKind(key: string): BuyerInputKind {
  for (const hint of KIND_HINTS) {
    if (hint.match.test(key)) return hint.kind;
  }
  return "text";
}

/**
 * Which channel a node can reach OUT on — the thing that decides what an
 * architect must verify before testing. Driven by the connector and capability
 * the node declares, so a new messaging node is covered automatically.
 */
const CHANNEL_HINTS: Array<{ channel: TestVerification["channel"]; match: RegExp }> = [
  { channel: "whatsapp", match: /whatsapp/i },
  { channel: "telegram", match: /telegram/i },
  { channel: "sms", match: /(sms|text message|twilio)/i },
  { channel: "email", match: /(email|gmail|smtp|ses|mail)/i },
  { channel: "phone", match: /(voice|vapi|telephon|phone|dial)/i }
];

const CHANNEL_REQUIREMENTS: Record<TestVerification["channel"], string> = {
  phone: "Testing can only call a phone number you have verified as your own.",
  sms: "Testing can only text a phone number you have verified as your own.",
  whatsapp: "Testing can only message a WhatsApp number you have verified as your own.",
  telegram: "Testing can only message a Telegram account you have verified as your own.",
  email: "Testing can only email an address you have verified as your own."
};

function channelFor(def: NodeDefinition | undefined, type: string): TestVerification["channel"] | null {
  const haystack = [def?.runtime?.connector ?? "", def?.capability ?? "", type, def?.label ?? ""].join(" ");
  // Only nodes that actually reach a person count. A node that merely reads a
  // calendar cannot disturb anyone, and demanding verification for it would
  // train architects to click past the warning that matters.
  if (!/send|message|notify|outbound|conversation|dial|reply|trigger\.phone|call_list/i.test(haystack)) return null;
  for (const hint of CHANNEL_HINTS) {
    if (hint.match.test(haystack)) return hint.channel;
  }
  return null;
}

/**
 * The numbers a node earns on the dashboard.
 *
 * Capability tokens rather than node types: "calendar.book_appointment" and a
 * future "scheduling.reserve_slot" both contain "book", so both produce a
 * bookings figure. Anything unrecognised still gets run counts.
 */
const METRIC_HINTS: Array<{
  match: RegExp;
  metrics: Array<Omit<BuyerMetric, "nodeIds">>;
  tables?: Array<Omit<BuyerTable, "nodeIds">>;
}> = [
  {
    // Deliberately NOT the bare word "call": ai.llm_call is a model call, and
    // matching it gave a five-brain WhatsApp agent a phone dashboard.
    match: /(voice|vapi|telephon|phone|dial|call_list|start_vapi)/i,
    metrics: [
      { key: "callsMade", label: "Calls", help: "How many calls your agent handled.", emphasis: "primary", format: "number", source: "calls.total" },
      { key: "callsAnswered", label: "Reached a person", help: "Calls where someone actually picked up and spoke.", emphasis: "primary", format: "number", source: "calls.answered" },
      { key: "connectRate", label: "Answer rate", help: "Out of every hundred calls, how many reached a real person.", emphasis: "secondary", format: "percent", source: "calls.connectRate" },
      { key: "callMinutes", label: "Time on the phone", help: "Total minutes your agent spent talking to people.", emphasis: "secondary", format: "duration", source: "calls.minutes" },
      { key: "spend", label: "Cost", help: "What this cost you.", emphasis: "secondary", format: "money", source: "calls.spend" }
    ],
    tables: [
      { key: "recentCalls", label: "Recent calls", columns: ["When", "Who", "What happened", "Length"], source: "calls.recent" }
    ]
  },
  {
    // "schedul" would catch trigger.schedule, which is a timer, not a booking —
    // an agent that merely runs every morning was showing appointment figures.
    match: /(appointment|booking|book_|reserv|slot)/i,
    metrics: [
      { key: "booked", label: "Appointments booked", help: "The number that pays for this — customers who would otherwise have been missed.", emphasis: "primary", format: "number", source: "appointments.total" },
      { key: "bookRate", label: "Booking rate", help: "Of the people your agent spoke to, how many booked.", emphasis: "secondary", format: "percent", source: "appointments.rate" }
    ],
    tables: [
      { key: "appointments", label: "Booked appointments", columns: ["When", "Who", "Service", "Phone"], source: "appointments.recent" }
    ]
  },
  {
    match: /(lead|contact|crm|save_lead)/i,
    metrics: [
      { key: "leads", label: "New leads", help: "People your agent captured details for.", emphasis: "secondary", format: "number", source: "leads.total" }
    ]
  },
  {
    match: /(sms|whatsapp|telegram|email|message|notify)/i,
    metrics: [
      { key: "messagesSent", label: "Messages sent", help: "Messages your agent sent on your behalf.", emphasis: "secondary", format: "number", source: "messages.total" }
    ]
  }
];

/** Every agent gets these, whatever it is built from. */
const UNIVERSAL_METRICS: Array<Omit<BuyerMetric, "nodeIds">> = [
  { key: "runs", label: "Times it ran", help: "How often your agent went to work.", emphasis: "secondary", format: "number", source: "runs.total" },
  { key: "runsFailed", label: "Problems", help: "Runs that hit a problem. Zero is what you want to see.", emphasis: "secondary", format: "number", source: "runs.failed" }
];

/* -------------------------------------------------------------------------- */
/* The derivation                                                              */
/* -------------------------------------------------------------------------- */

function pushMerged<T extends { key: string; nodeIds: string[] }>(list: T[], item: T): void {
  const existing = list.find((entry) => entry.key === item.key);
  if (existing) {
    for (const nodeId of item.nodeIds) {
      if (!existing.nodeIds.includes(nodeId)) existing.nodeIds.push(nodeId);
    }
    return;
  }
  list.push(item);
}

/**
 * Config the BUYER must fill, as opposed to config the architect already set.
 *
 * A value the architect typed is a decision they made on the buyer's behalf —
 * asking the business to type it again is how a five-minute setup becomes
 * forty. Only what is genuinely missing, or explicitly addressed to the
 * business through a {{business.*}} token, is asked.
 */
function buyerConfigKeys(node: GraphNode, def: NodeDefinition | undefined): string[] {
  const data = node.data ?? {};
  const keys = new Set<string>();

  for (const key of def?.requiredConfig ?? []) {
    const value = data[key];
    if (value === undefined || value === null || String(value).trim() === "") keys.add(key);
  }

  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") continue;
    // The architect writing {{business.phone}} is literally saying "the buyer
    // supplies this".
    for (const match of value.matchAll(/\{\{\s*business\.([a-zA-Z0-9_]+)\s*\}\}/g)) {
      keys.add(match[1]);
    }
  }

  // Presentation and wiring are never buyer questions.
  const NEVER = /^(type|nodeKind|label|title|subtitle|icon|accent|kind|footer|connector|connectorAction|doors|position)$/;
  return [...keys].filter((key) => !NEVER.test(key));
}

export function deriveBuyerContract(workflowJson: unknown): BuyerContract {
  const nodes = nodesOf(workflowJson);

  const inputs: BuyerInput[] = [];
  const connections: BuyerConnection[] = [];
  const metrics: BuyerMetric[] = [];
  const tables: BuyerTable[] = [];
  const actions: BuyerAction[] = [];
  const verification: TestVerification[] = [];
  const unknownNodeTypes: string[] = [];
  const does: string[] = [];

  for (const node of nodes) {
    const type = nodeType(node);
    if (!type) continue;
    const nodeId = String(node.id ?? "");
    const def = getNodeDefinition(type);
    if (!def && !unknownNodeTypes.includes(type)) unknownNodeTypes.push(type);

    if (def?.description) does.push(def.label.toLowerCase());

    // ---- Accounts the business connects themselves.
    for (const requirement of (def?.requiredConnectors ?? []) as ConnectorRequirement[]) {
      if (requirement.ownedBy !== "buyer") continue;
      pushMerged(connections, {
        key: `connect_${requirement.connector}`,
        label: `Connect your ${requirement.label}`,
        help: requirement.note || `${nodeTitle(node, def)} needs this to work.`,
        connector: requirement.connector,
        optional: requirement.optional === true,
        nodeIds: [nodeId]
      });
    }

    // ---- Questions the business answers.
    for (const key of buyerConfigKeys(node, def)) {
      pushMerged(inputs, {
        key,
        label: humanise(key),
        help: `${nodeTitle(node, def)} uses this.`,
        kind: inferInputKind(key),
        required: (def?.requiredConfig ?? []).includes(key),
        nodeIds: [nodeId]
      });
    }

    // ---- What we can show them afterwards.
    const haystack = [def?.capability ?? "", def?.runtime?.connector ?? "", type, def?.label ?? ""].join(" ");
    for (const hint of METRIC_HINTS) {
      if (!hint.match.test(haystack)) continue;
      for (const metric of hint.metrics) pushMerged(metrics, { ...metric, nodeIds: [nodeId] });
      for (const table of hint.tables ?? []) pushMerged(tables, { ...table, nodeIds: [nodeId] });
    }

    // ---- What must be proven before a test may run.
    const channel = channelFor(def, type);
    if (channel) {
      pushMerged(verification, {
        key: channel,
        channel,
        label: humanise(channel),
        requirement: CHANNEL_REQUIREMENTS[channel],
        nodeIds: [nodeId]
      });
    }

    // ---- Steps the business OPERATES rather than watches.
    if (type === "trigger.call_list") {
      pushMerged(actions, {
        key: "uploadPeople",
        label: "Add people to call",
        help: "Paste your list — a name and a phone number on each line.",
        kind: "upload",
        nodeIds: [nodeId]
      });
      pushMerged(actions, {
        key: "startStop",
        label: "Start or stop calling",
        help: "Nothing is dialled until you press start, and stop halts it immediately.",
        kind: "start-stop",
        nodeIds: [nodeId]
      });
      pushMerged(metrics, {
        key: "listWaiting",
        label: "Still to call",
        help: "People on your list your agent has not reached yet.",
        emphasis: "secondary",
        format: "number",
        source: "list.waiting",
        nodeIds: [nodeId]
      });
      pushMerged(metrics, {
        key: "listDone",
        label: "Called so far",
        help: "How far through the list your agent has got.",
        emphasis: "secondary",
        format: "number",
        source: "list.done",
        nodeIds: [nodeId]
      });
      pushMerged(tables, {
        key: "listPeople",
        label: nodeTitle(node, def),
        columns: ["Name", "Phone", "Status", "Tries", "Next try"],
        source: "list.people",
        nodeIds: [nodeId]
      });
    }
  }

  // Every agent can at least say whether it ran and whether it worked. An
  // unrecognised orchestration still gets a real dashboard.
  for (const metric of UNIVERSAL_METRICS) {
    pushMerged(metrics, { ...metric, nodeIds: [] });
  }

  return {
    inputs,
    connections,
    metrics,
    tables,
    actions,
    verification,
    summary: does.length
      ? `This agent ${[...new Set(does)].slice(0, 3).join(", ")}.`
      : "This agent runs in the background for you.",
    hasDashboard: metrics.length > 0,
    unknownNodeTypes
  };
}

/** Every metric key the platform can fill for this agent. Guards invention. */
export function contractMetricKeys(contract: BuyerContract): string[] {
  return contract.metrics.map((metric) => metric.key);
}

/** Replace {{metric.key}} tokens with real values; unknown ones read as a dash. */
export function fillContractTokens(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{\{\s*metric\.([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === "") return "—";
    return String(value);
  });
}

export function formatContractValue(format: BuyerMetric["format"], value: number): string {
  switch (format) {
    case "percent":
      return `${Math.round(value)}%`;
    case "money":
      return `$${value.toFixed(2)}`;
    case "duration": {
      const minutes = Math.round(value);
      if (minutes < 60) return `${minutes} min`;
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }
    default:
      return String(Math.round(value));
  }
}
