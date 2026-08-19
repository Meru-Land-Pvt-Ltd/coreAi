/**
 * SMART DESIGNER DESIGNS THE WHOLE BUSINESS SIDE.
 *
 * Two surfaces, one contract, no hand-written pages:
 *
 *   SETUP     — every question the business must answer before the agent works
 *   DASHBOARD — every number and board worth showing them afterwards
 *
 * deriveBuyerContract (packages/shared) reads the architect's nodes and says
 * WHAT must appear. This file asks Smart Designer HOW it should look, and then
 * refuses anything that would lie to a paying customer: a field the platform
 * cannot save, a number it cannot fill, a control that does nothing.
 *
 * The gates matter more than the prompts. A composed screen is shown to
 * someone paying $199 a month, and the failure it must never have is looking
 * finished while being empty.
 */

import {
  contractMetricKeys,
  sanitizeProductSpec,
  type BuyerContract,
  type ProductSpec
} from "@coreai/shared";

export type SurfaceAgentFacts = {
  name: string;
  tagline?: string | null;
};

/* -------------------------------------------------------------------------- */
/* The setup form                                                              */
/* -------------------------------------------------------------------------- */

export function buildSetupPrompt(args: { agent: SurfaceAgentFacts; contract: BuyerContract }): string {
  const { agent, contract } = args;

  const fieldLines = contract.inputs
    .map(
      (input) =>
        `- id "${input.key}" — ${input.label} (${input.kind}${input.required ? ", required" : ", optional"}). ${input.help}`
    )
    .join("\n");

  const connectionLines = contract.connections
    .map((connection) => `- id "${connection.key}" — ${connection.label}. ${connection.help}`)
    .join("\n");

  return [
    `You are designing the setup screen for a business that has just bought the agent "${agent.name}".`,
    agent.tagline ? `The agent in one line: ${agent.tagline}` : "",
    contract.summary,
    "",
    "WHO YOU ARE DESIGNING FOR",
    "The owner of a small business — a dentist, a salon owner, a plumber, a school. Not technical. They have just paid, they are mildly nervous, and they want to be working in five minutes. Every extra question costs you a customer.",
    "",
    "THE QUESTIONS YOU MUST ASK (these are the only ones that exist — never invent another):",
    fieldLines || "- (none)",
    "",
    "THE ACCOUNTS THEY MUST CONNECT:",
    connectionLines || "- (none)",
    "",
    "HOW TO DESIGN IT",
    "- Group the questions the way a person thinks about their business, not the way software thinks. Put a heading above each group in your own warm words — 'About your practice', 'How we reach you', 'What you offer'.",
    "- Ask the easy, obvious things first. Anything that needs them to go and find something goes last.",
    "- Every field is a block whose \"id\" is EXACTLY the id given above. Copy it character for character — that id is how the platform saves their answer. Example, for a field with id \"teamPhone\":",
    '    { "type": "input", "id": "teamPhone", "label": "Which number should we ring?", "kind": "phone" }',
    "  A long answer uses \"multiline\": true. An account to connect is a button:",
    '    { "type": "button", "id": "connect_google_calendar", "label": "Connect your Google Calendar" }',
    "- Rewrite every label into a real question a person would be asked out loud. 'teamPhone' becomes 'Which number should we ring when someone needs a human?' Never show the raw field name.",
    "- One short line of help under anything that is not obvious. Say WHY you are asking — people answer honestly when they know what it is for.",
    "- One page. No marketing, no pricing, no testimonials, no sign-up, no navigation. They already bought.",
    "- Plain words only. Never say node, workflow, orchestration, webhook, API, config, or any word a dentist would not use.",
    "",
    "OUTPUT RULES:",
    '- Output ONLY a single JSON object, exactly: { "reply": string, "product": PRODUCT }. No markdown, no code fences, nothing before or after.',
    '- "reply": one short warm line about the setup screen you designed, under 200 characters.',
    '- PRODUCT is a Product Spec with exactly one page whose path is "".'
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A setup screen is only finished when every question it was given is on it.
 *
 * A missing field is not cosmetic: the agent then runs without a value it
 * needs, and the business discovers this when a customer is already on the
 * phone.
 */
export function checkSetup(spec: ProductSpec, contract: BuyerContract): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const json = JSON.stringify(spec);

  for (const input of contract.inputs) {
    if (!json.includes(`"${input.key}"`)) {
      problems.push(`The question "${input.label}" is missing — the agent cannot run without it.`);
    }
  }
  for (const connection of contract.connections) {
    if (connection.optional) continue;
    if (!json.includes(`"${connection.key}"`)) {
      problems.push(`"${connection.label}" is missing, so they can never connect it.`);
    }
  }
  if (spec.pages.length !== 1) {
    problems.push(`A setup screen is one page; this has ${spec.pages.length}.`);
  }

  return { ok: problems.length === 0, problems };
}

/* -------------------------------------------------------------------------- */
/* The dashboard                                                               */
/* -------------------------------------------------------------------------- */

export function buildDashboardPrompt(args: { agent: SurfaceAgentFacts; contract: BuyerContract }): string {
  const { agent, contract } = args;

  const metricLines = contract.metrics
    .map((metric) => `- {{metric.${metric.key}}} — ${metric.label} (${metric.emphasis}). ${metric.help}`)
    .join("\n");

  const tableLines = contract.tables
    .map((table) => `- "${table.label}" — columns: ${table.columns.join(", ")}. Its id is "${table.key}".`)
    .join("\n");

  const actionLines = contract.actions
    .map((action) => `- ${action.label} (${action.kind}) — ${action.help}. Its id is "${action.key}".`)
    .join("\n");

  return [
    `You are designing the daily screen for a business that PAYS for the agent "${agent.name}".`,
    agent.tagline ? `The agent in one line: ${agent.tagline}` : "",
    contract.summary,
    "",
    "WHO YOU ARE DESIGNING FOR",
    "A busy owner of a small business. They open this on a phone between customers, they have about eight seconds, and they want one question answered: is this thing earning me money?",
    "",
    "THE NUMBERS YOU MAY SHOW (these are the only ones that exist — never invent another):",
    metricLines || "- (none)",
    "",
    "THE BOARDS YOU MAY SHOW:",
    tableLines || "- (none)",
    "",
    "THE CONTROLS YOU MUST PLACE:",
    actionLines || "- (none)",
    "",
    "HOW TO DESIGN IT",
    "- Lead with the money. Primary numbers at the top, big, before anything else.",
    "- Put the primary numbers in one row of stat blocks. Secondary ones go underneath, smaller.",
    '- Write each number as its token exactly, e.g. value: "{{metric.booked}}". Never write a made-up number or a placeholder.',
    "- One short line under each number saying why it matters, in your own warmer words.",
    "- Controls come after the numbers: an owner checks results first, then acts.",
    "- A control or board is a block whose \"id\" is EXACTLY the id given above. Examples:",
    '    { "type": "button", "id": "startStop", "label": "Start calling", "variant": "primary" }',
    '    { "type": "upload", "id": "uploadPeople", "label": "Add the people you want called" }',
    '    { "type": "result", "id": "listPeople", "variant": "table" }',
    "- Give each board a heading above it in your own words.",
    "- One page. No marketing, no navigation. This is a private screen for someone who already bought.",
    "- Plain words only. Warm and calm, never corporate. \"You reached 14 people this week\" beats \"Total connections: 14\".",
    "",
    "OUTPUT RULES:",
    '- Output ONLY a single JSON object, exactly: { "reply": string, "product": PRODUCT }. No markdown, no code fences, nothing before or after.',
    '- "reply": one short warm line about the screen you designed, under 200 characters.',
    '- PRODUCT is a Product Spec with exactly one page whose path is "".'
  ]
    .filter(Boolean)
    .join("\n");
}

export function checkDashboardSurface(
  spec: ProductSpec,
  contract: BuyerContract
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const allowed = new Set(contractMetricKeys(contract));
  const json = JSON.stringify(spec);

  const used = new Set<string>();
  for (const match of json.matchAll(/\{\{\s*metric\.([a-zA-Z0-9_]+)\s*\}\}/g)) used.add(match[1]);

  for (const key of used) {
    if (!allowed.has(key)) {
      problems.push(`"${key}" is not a number this platform can fill — it would show a dash forever.`);
    }
  }
  for (const metric of contract.metrics.filter((entry) => entry.emphasis === "primary")) {
    if (!used.has(metric.key)) {
      problems.push(`The most important number, ${metric.label}, is missing.`);
    }
  }
  for (const action of contract.actions) {
    if (!json.includes(`"${action.key}"`)) {
      problems.push(`The "${action.label}" control is missing, so they cannot actually run it.`);
    }
  }
  if (spec.pages.length !== 1) {
    problems.push(`A dashboard is one page; this has ${spec.pages.length}.`);
  }

  return { ok: problems.length === 0, problems };
}

/** Belt and braces: nothing reaches storage without passing the sanitizer. */
export function safeSpec(raw: unknown): ProductSpec | null {
  return sanitizeProductSpec(raw);
}
