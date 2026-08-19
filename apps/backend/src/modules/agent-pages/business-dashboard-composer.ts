/**
 * SMART DESIGNER'S SECOND JOB — the screen the business opens every day.
 *
 * The composer already designs the surface an agent's END CUSTOMER touches.
 * This designs the surface its BUYER touches, and it is the more valuable of
 * the two: a business fills the setup form once and then judges the entire
 * subscription on what this screen shows them.
 *
 * The design is not hand-written anywhere. deriveBusinessSurface reads the
 * architect's nodes and says WHAT must appear — calls, bookings, cost, the
 * list board, the start/stop control — and Smart Designer decides what it
 * looks like. That separation is the point: improving the composer improves
 * every agent's dashboard at once, without anyone editing a template.
 *
 * Numbers are written as {{metric.key}} tokens rather than baked in, so the
 * same stored spec renders with today's real figures every time it is opened.
 */

import {
  deriveBusinessSurface,
  knownMetricKeys,
  sanitizeProductSpec,
  type BusinessSurface,
  type ProductSpec
} from "@coreai/shared";

/** What the composer is told about the agent it is designing for. */
export type DashboardAgentFacts = {
  name: string;
  tagline?: string | null;
};

/**
 * The brief. Deliberately concrete about what exists, because a composer left
 * to imagine metrics invents ones the platform cannot fill, and the business
 * opens a dashboard of permanent zeros.
 */
export function buildBusinessDashboardPrompt(args: {
  agent: DashboardAgentFacts;
  surface: BusinessSurface;
}): string {
  const { agent, surface } = args;

  const metricLines = surface.metrics
    .map(
      (metric) =>
        `- {{metric.${metric.key}}} — ${metric.label} (${metric.emphasis}). ${metric.help}`
    )
    .join("\n");

  const tableLines = surface.tables
    .map((table) => `- "${table.label}" — columns: ${table.columns.join(", ")}. Reference it with id "${table.key}".`)
    .join("\n");

  const actionLines = surface.actions
    .map((action) => `- ${action.label} (${action.kind}) — ${action.help}. Reference it with id "${action.key}".`)
    .join("\n");

  return [
    `You are designing the daily dashboard for a business that PAYS for the agent "${agent.name}".`,
    agent.tagline ? `The agent in one line: ${agent.tagline}` : "",
    surface.summary,
    "",
    "WHO YOU ARE DESIGNING FOR",
    "A busy owner of a small service business — a dentist, a salon owner, a plumber. Not technical. They open this on a phone between customers. They have about eight seconds, and they want one question answered: is this thing earning me money?",
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
    "- Lead with the money. The primary metrics go at the top, big, before anything else. If this agent books appointments, the number of appointments booked is the single most important thing on the screen.",
    "- Put every primary metric in one row of stat blocks at the very top. Secondary metrics go underneath, smaller.",
    "- Write each number as its token exactly, e.g. value: \"{{metric.booked}}\". Never write a made-up number. Never write a placeholder like \"123\" or \"—\".",
    "- Under each number, one short line of plain English saying why it matters. Use the help text given above, in your own warmer words.",
    "- Controls come after the numbers, never above them: an owner checks results first and only then does something.",
    "- A control is a block whose \"id\" is EXACTLY the id given above. Copy it character for character — that id is how the platform attaches the real working control to your design. Example, for a control with id \"startStop\":",
    '    { "type": "button", "id": "startStop", "label": "Start calling", "variant": "primary" }',
    "  and for one with id \"uploadPeople\":",
    '    { "type": "upload", "id": "uploadPeople", "label": "Add the people you want called" }',
    "- Boards go last. A board is a result block whose \"id\" is EXACTLY the board id given above. Example, for a board with id \"listPeople\":",
    '    { "type": "result", "id": "listPeople", "variant": "table" }',
    "- Give the block a heading above it in your own words so the business knows what they are looking at.",
    "- One page. No navigation, no marketing, no hero image, no pricing, no testimonials, no sign-up. This is a private screen for someone who already bought.",
    "- Plain words only. Never say node, workflow, orchestration, agent id, webhook, API, or any word a dentist would not use.",
    "- Warm and calm, not corporate. \"You reached 14 people this week\" beats \"Total connections: 14\".",
    "",
    "OUTPUT RULES:",
    '- Output ONLY a single JSON object, exactly: { "reply": string, "product": PRODUCT }. No markdown, no code fences, nothing before or after.',
    '- "reply": one short warm line about the dashboard you designed, under 200 characters.',
    "- PRODUCT is a Product Spec with exactly one page whose path is \"/\"."
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Check a composed dashboard before it is ever shown to a paying customer.
 *
 * The failure this catches is specific and would be invisible otherwise: a
 * metric token the platform cannot fill renders as a dash forever, so the
 * business sees a beautiful dashboard of blanks and concludes the product does
 * not work.
 */
export function checkDashboard(
  spec: ProductSpec,
  surface: BusinessSurface
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const allowed = new Set(knownMetricKeys(surface));
  const json = JSON.stringify(spec);

  const used = new Set<string>();
  for (const match of json.matchAll(/\{\{\s*metric\.([a-zA-Z0-9_]+)\s*\}\}/g)) {
    used.add(match[1]);
  }

  for (const key of used) {
    if (!allowed.has(key)) {
      problems.push(`"${key}" is not a number this platform can fill — it would show a dash forever.`);
    }
  }

  const primary = surface.metrics.filter((metric) => metric.emphasis === "primary");
  for (const metric of primary) {
    if (!used.has(metric.key)) {
      problems.push(`The most important number, ${metric.label}, is missing from the dashboard.`);
    }
  }

  if (spec.pages.length !== 1) {
    problems.push(`A dashboard is one page; this has ${spec.pages.length}.`);
  }

  // A dashboard with no controls is a dashboard the business cannot use.
  for (const action of surface.actions) {
    if (!json.includes(action.key)) {
      problems.push(`The "${action.label}" control is missing, so they cannot actually run it.`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Turn the model's JSON into a spec we are willing to store.
 *
 * Reuses the same sanitizer as the customer-facing composer, so a dashboard
 * can never contain a node type the renderer does not know how to paint.
 */
export function parseDashboardOutput(
  raw: unknown
): { reply: string; product: ProductSpec } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const product = sanitizeProductSpec(record.product);
  if (!product) return null;

  const reply =
    typeof record.reply === "string" && record.reply.trim()
      ? record.reply.trim().slice(0, 200)
      : "Here's the screen your customers will open every day.";

  return { reply, product };
}

/** Convenience: everything the composer needs, straight from a graph. */
export function dashboardBriefFor(workflowJson: unknown, agent: DashboardAgentFacts) {
  const surface = deriveBusinessSurface(workflowJson);
  return {
    surface,
    prompt: buildBusinessDashboardPrompt({ agent, surface })
  };
}
