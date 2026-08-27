import type { Hono } from "hono";
import type { PublishedAgentPage } from "@prisma/client";
import { z } from "zod";
import {
  CONTAINER_NODE_TYPES,
  DEFAULT_ACCENT,
  PRODUCT_SPEC_LIMITS,
  PRODUCT_SPEC_VERSION,
  WIRABLE_NODE_TYPES,
  collectWires,
  pageSpecSchema,
  productNavSchema,
  productThemeSchema,
  sanitizeProductSpec,
  specNodeSchema,
  specStyleSchema,
  wireSchema,
  type NavLink,
  type PageSpec,
  type ProductSpec,
  type SpecNode,
  type WireRole
} from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { MISSING_LLM_CREDENTIALS_MESSAGE } from "../ai-provider-engine/llm-credentials";
import { resolveBrainSlot } from "../admin/brain-slot-settings";
import { getDesignBrainConfig } from "../admin/design-brain-settings";
import {
  recordLlmProviderFailure,
  recordLlmProviderSuccess
} from "../ai-provider-engine/llm-health";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest, AIMessage } from "../ai-provider-engine/types";
import { LEGAL_REVIEW_NOTE, generateLegalPages, type LegalPagesInput } from "./legal-pages";
import { getProductSpec, saveProductSpec, starterProductSpec } from "./product-spec-service";
import { deriveFaceBlueprint } from "./blueprint";
import { resolveDesign } from "./design";
import { ensureDraftAgentListingAndPage, type AgentPageTemplate } from "./slug";

/**
 * PRODUCT CHAT — the AI that builds a whole sellable product by talking.
 *
 *   POST /agent-pages/manage/:workflowId/product-chat
 *
 * The architect types plain language ("build me a proper website for this,
 * with pricing and an FAQ"). The model answers with ONE JSON blueprint — a
 * complete ProductSpec — and nothing else. No code is generated, nothing is
 * executed, and no byte of model output reaches storage without going through
 * the shared sanitizer first.
 *
 * Doctrine: "The AI writes the design freely; our renderer paints it; the
 * wires live in named slots." So this route's whole job is:
 *
 *   1. Tell the model the truth — the FULL contract (generated from the shared
 *      zod schemas, so it can never drift), the section shapes our renderer
 *      recognizes, the agent's REAL graph node ids, the current product, and
 *      the admin house rules.
 *   2. Take back only JSON: { reply, product }.
 *   3. Validate, sanitize, and AUTO-FIX the misses a language model always
 *      makes (no home page, a beautiful site with nothing wired, a paid
 *      product with no privacy policy, nav links to pages it forgot to write).
 *   4. Persist through the service and echo exactly what was stored.
 *
 * On invalid output it retries ONCE with the validation error fed back. On a
 * second failure it changes nothing and replies kindly.
 *
 * LLM entry: the same path design-chat and ai.llm_call use —
 * resolveConfiguredLlmProvider into getProviderEngine().executeWithProvider.
 */

/**
 * Product generation runs on the AI Builder battery an admin picks — never a
 * provider hardcoded here. Both design paths share it: building a whole product
 * and restyling one is the same craft.
 */

/** Graceful reply when the model never produces a usable product. */
export const PRODUCT_CHAT_FALLBACK_REPLY =
  "I couldn't build that one. Tell me in a sentence what the page should say or do, and I'll try again.";

/** Roomy: a multi-page product is a big JSON document. */
const MAX_OUTPUT_TOKENS = 16000;

/** Above this the current product is summarized instead of pasted in full. */
const MAX_CURRENT_PRODUCT_CHARS = 60000;

/** Page ids the legal generator owns. */
const LEGAL_PAGE_IDS = ["privacy", "terms"] as const;

/**
 * Pages that belong in the footer or at the end of a flow, never in the top
 * bar — a "Thanks" tab next to "Pricing" is what an amateur site looks like.
 */
const NEVER_IN_TOP_NAV = new Set<string>([
  ...LEGAL_PAGE_IDS,
  "thanks",
  "thank-you",
  "success",
  "checkout"
]);

export const productChatBodySchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1, "Tell me what to build first")
    .max(800, "Instructions must be 800 characters or fewer"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // Bounded so a replayed conversation can never balloon the prompt.
        content: z.string().trim().min(1).max(2000)
      })
    )
    .max(10, "History is capped at the last 10 messages")
    .optional()
});

// ---------------------------------------------------------------------------
// The contract description — generated from the shared zod schemas.
//
// Hand-written prompt documentation drifts the moment someone adds a token to
// product-spec.ts. So the contract the model is given is READ OUT OF THE
// SCHEMAS THEMSELVES: node types, field names, optionality and every allowed
// value come from `specNodeSchema` and friends at call time.
// ---------------------------------------------------------------------------

/** The shape of a zod v4 internal definition, as much of it as we read. */
type SchemaDef = {
  type?: string;
  shape?: Record<string, unknown>;
  options?: unknown[];
  innerType?: unknown;
  element?: unknown;
  getter?: () => unknown;
  in?: unknown;
  out?: unknown;
  entries?: Record<string, unknown>;
  values?: unknown[];
};

function defOf(schema: unknown): SchemaDef | null {
  if (typeof schema !== "object" || schema === null) return null;
  const holder = schema as { def?: unknown; _def?: unknown };
  const def = holder.def ?? holder._def;
  return typeof def === "object" && def !== null ? (def as SchemaDef) : null;
}

/** Wrappers that only decorate an inner schema (`.optional()`, `.catch()`, …). */
const WRAPPER_TYPES = new Set([
  "optional",
  "nullable",
  "catch",
  "default",
  "prefault",
  "readonly",
  "nonoptional"
]);

/** Types we can put a name to in the prompt. */
const NAMEABLE_TYPES = new Set([
  "object",
  "enum",
  "union",
  "literal",
  "array",
  "boolean",
  "number",
  "string"
]);

/**
 * Peel wrappers, lazies and pipes until a nameable definition is reached.
 *
 * A pipe is either `z.preprocess(fn, object)` — where the OUT side is the real
 * shape — or `z.string().transform(...)` — where the IN side is. Trying `out`
 * first and falling back to `in` handles both without knowing which is which.
 */
function resolveDef(schema: unknown, depth = 0): SchemaDef | null {
  if (depth > 12) return null;
  const def = defOf(schema);
  if (!def) return null;
  const type = def.type ?? "";

  if (WRAPPER_TYPES.has(type) && def.innerType !== undefined) {
    return resolveDef(def.innerType, depth + 1);
  }
  if (type === "lazy" && typeof def.getter === "function") {
    return resolveDef(def.getter(), depth + 1);
  }
  if (type === "pipe") {
    const out = resolveDef(def.out, depth + 1);
    if (out && NAMEABLE_TYPES.has(out.type ?? "")) return out;
    return resolveDef(def.in, depth + 1);
  }
  return def;
}

/** True when the schema accepts a missing value (so the field is optional). */
function acceptsUndefined(schema: unknown): boolean {
  const parser = schema as { safeParse?: (value: unknown) => { success: boolean } };
  if (typeof parser?.safeParse !== "function") return false;
  try {
    return parser.safeParse(undefined).success;
  } catch {
    return false;
  }
}

function quote(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

/**
 * Fields whose zod type is technically a string/array but whose CONTENT rule
 * matters more to the model than its type. Values are prose, never a token the
 * renderer reads, so this can never drift into a wrong allowed-value list.
 */
const FIELD_LABELS: Record<string, string> = {
  id: "string",
  style: "STYLE",
  wire: "WIRE",
  children: "NODE[]",
  blocks: "NODE[]",
  seo: "{ description?: string, ogImageUrl?: string }",
  brand: "{ text?: string, logoUrl?: string }",
  links: "LINK[]",
  footerLinks: "LINK[]",
  items: `string[] (up to ${PRODUCT_SPEC_LIMITS.maxListItems})`,
  options: `string[] (up to ${PRODUCT_SPEC_LIMITS.maxChoiceOptions})`,
  url: "string — https://… or a /path on this site",
  logoUrl: "string — https://… or a /path on this site",
  ogImageUrl: "string — https://… or a /path on this site",
  href: "string — https://…, mailto:…, /path, or #anchor (a link, NOT a wire)",
  accent: `string — hex color like "${DEFAULT_ACCENT}"`,
  accept: 'string — file types, e.g. "image/*"',
  path: 'string — "" for home, else a slug like "pricing"'
};

function labelForDef(def: SchemaDef | null, depth = 0): string {
  if (!def || depth > 8) return "unknown";
  switch (def.type) {
    case "enum":
      return Object.values(def.entries ?? {}).map(quote).join(" | ");
    case "literal":
      return (def.values ?? []).map(quote).join(" | ");
    case "union":
      return (def.options ?? [])
        .map((option) => labelForDef(resolveDef(option), depth + 1))
        .join(" | ");
    case "array":
      return `${labelForDef(resolveDef(def.element), depth + 1)}[]`;
    case "boolean":
      return "true | false";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

function labelForField(field: string, schema: unknown): string {
  return FIELD_LABELS[field] ?? labelForDef(resolveDef(schema));
}

/** `"field": <type>` for every key of an object schema, `type` and `id` first. */
function describeShape(shape: Record<string, unknown>, skip: string[] = []): string[] {
  const keys = Object.keys(shape).filter((key) => !skip.includes(key));
  const ordered = [
    ...keys.filter((key) => key === "type"),
    ...keys.filter((key) => key === "id"),
    ...keys.filter((key) => key !== "type" && key !== "id")
  ];
  return ordered.map((key) => {
    const field = shape[key];
    const optional = key === "type" ? false : acceptsUndefined(field);
    return `"${key}"${optional ? "?" : ""}: ${labelForField(key, field)}`;
  });
}

function objectShapeOf(schema: unknown): Record<string, unknown> | null {
  const def = resolveDef(schema);
  return def?.type === "object" && def.shape ? def.shape : null;
}

/** The type literal a node-union member is keyed by ("heading", "grid", …). */
function nodeTypeOf(shape: Record<string, unknown>): string {
  const def = resolveDef(shape.type);
  const value = def?.values?.[0];
  return typeof value === "string" ? value : "";
}

type NodeLine = { nodeType: string; line: string };

function describeNodeUnion(): NodeLine[] {
  const def = resolveDef(specNodeSchema);
  const options = def?.type === "union" ? (def.options ?? []) : [];
  const lines: NodeLine[] = [];
  for (const option of options) {
    const shape = objectShapeOf(option);
    if (!shape) continue;
    const nodeType = nodeTypeOf(shape);
    if (!nodeType) continue;
    lines.push({ nodeType, line: `{ ${describeShape(shape).join(", ")} }` });
  }
  return lines;
}

function describeObject(schema: unknown, skip: string[] = []): string {
  const shape = objectShapeOf(schema);
  if (!shape) return "{ }";
  return `{ ${describeShape(shape, skip).join(", ")} }`;
}

/**
 * The whole ProductSpec contract in prompt form, generated from the shared
 * schemas. Every type name, field name, optionality marker and allowed value
 * below is read out of `specNodeSchema` / `pageSpecSchema` / `productNavSchema`
 * / `productThemeSchema` / `specStyleSchema` / `wireSchema` at call time, so
 * the prompt can never fall behind the contract.
 */
export function describeProductSpecContract(): string {
  const nodes = describeNodeUnion();
  const containers = new Set<string>(CONTAINER_NODE_TYPES);
  const wirable = new Set<string>(WIRABLE_NODE_TYPES);

  const layout = nodes.filter((node) => containers.has(node.nodeType));
  const content = nodes.filter((node) => !containers.has(node.nodeType) && !wirable.has(node.nodeType));
  const live = nodes.filter((node) => wirable.has(node.nodeType));

  const format = (group: NodeLine[]) => group.map((node) => `  ${node.line}`).join("\n");

  return [
    "THE PRODUCT SPEC — the only thing you may output:",
    `PRODUCT = { "version": ${PRODUCT_SPEC_VERSION}, "pages": PAGE[], "nav": NAV, "theme"?: THEME }`,
    `PAGE = ${describeObject(pageSpecSchema)}`,
    `NAV = ${describeObject(productNavSchema)}`,
    "LINK = { \"label\": string, \"pageId\": string — the id of a page you wrote }",
    `THEME = ${describeObject(productThemeSchema)}`,
    `STYLE = ${describeObject(specStyleSchema)}`,
    `WIRE = ${describeObject(wireSchema)}`,
    "",
    'Every id is your own short, unique name for that thing, e.g. "home", "hero-title", "plan-pro". A "?" means the field is optional.',
    "",
    "NODE is exactly one of these. Nothing else exists — never invent a type, a field, or a value:",
    "",
    "LAYOUT (these hold other nodes):",
    format(layout),
    "",
    "CONTENT (decoration — these never carry a wire):",
    format(content),
    "",
    "LIVE (these are the sockets into the agent; only these may carry a wire):",
    format(live),
    "",
    "LIMITS (anything past them is dropped):",
    `- up to ${PRODUCT_SPEC_LIMITS.maxPages} pages, and exactly one of them has id "home" with path ""`,
    `- up to ${PRODUCT_SPEC_LIMITS.maxNodesPerPage} nodes per page, nested at most ${PRODUCT_SPEC_LIMITS.maxDepth} deep`,
    `- up to ${PRODUCT_SPEC_LIMITS.maxNavLinks} header links and ${PRODUCT_SPEC_LIMITS.maxFooterLinks} footer links`,
    "- every node id must be unique inside its page"
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The professional section vocabulary.
//
// Nothing here is a template name the model may write: our renderer reads the
// SHAPE of an ordinary tree and paints the matching composition. These are the
// shapes that get recognized (see the frontend recognizer), described so the
// model writes trees that land on them.
// ---------------------------------------------------------------------------

export const SECTION_VOCABULARY = [
  "HOW YOUR PAGE IS PAINTED:",
  "You never name a template and you never ask for a component. Our renderer reads the SHAPE of what you write and paints the matching professional section — a real SaaS website, mobile-perfect, on every screen. Write these shapes and they will be recognized:",
  "",
  '- hero — the first section of the home page: a heading with "level": 1, one line of "text" under it, then the live elements (an input, one or two buttons in a row, a result) and optionally one image. Use padding "xl" and background "gradient".',
  '- featureGrid — a section holding a level-2 heading, a line of text, and a "grid" (columns 2, 3 or 4) whose children are "stack" cards. Each card: an "icon", a level-3 heading, one short "text".',
  '- statsBand — a section holding a "grid" of 2 to 4 "stat" nodes. Nothing else. Use padding "md" and background "tint".',
  '- pricingTable — a section holding a level-2 heading and a "grid" of 2 to 4 "stack" plans. Each plan: a level-3 heading (the plan name), a "text" holding the price like "$29", an optional small "text" like "per month", a "list" with listStyle "check" of what is included, and one "button". Put a "badge" in the plan you want highlighted.',
  '- testimonialRow — a section holding a "grid" whose children are stacks, each holding one "quote" with author and role. Two or more quotes.',
  '- faqAccordion — a section holding a "stack" whose children are stacks of exactly [level-3 heading = the question, "text" = the answer]. Three to eight of them. Write real questions that end in a question mark.',
  '- ctaBand — a short closing section: a level-2 heading, one line of "text", one "button". No grid, no images. Use background "dark".',
  "- header and footer — you do NOT write these as nodes. They are built from \"nav\": brand, links (the top bar) and footerLinks (the bottom).",
  "",
  "A good home page runs: hero → statsBand or featureGrid → featureGrid → testimonialRow → pricingTable → faqAccordion → ctaBand. Not every product needs all of them; a thin page beats a padded one."
].join("\n");

/**
 * The worked example the prompt shows: a small, complete, working one-page
 * product in the exact envelope the model must answer with.
 *
 * It is a TYPED `ProductSpec`, not a string, so the compiler itself stops it
 * drifting from the contract, and its wires carry no `nodeId` so it can never
 * teach a model graph ids that belong to a different agent.
 */
export const PRODUCT_CHAT_EXAMPLE: { reply: string; product: ProductSpec } = {
  reply: "Built it — a home page that works, with your product right at the top.",
  product: {
    version: PRODUCT_SPEC_VERSION,
    pages: [
      {
        id: "home",
        title: "Thumbnail Genie",
        path: "",
        seo: { description: "Thumbnails that get clicked, in about ten seconds." },
        blocks: [
          {
            id: "hero",
            type: "section",
            padding: "xl",
            background: "gradient",
            children: [
              {
                id: "hero-stack",
                type: "stack",
                gap: "md",
                align: "center",
                children: [
                  { id: "hero-badge", type: "badge", text: "Live now", tone: "accent" },
                  {
                    id: "hero-title",
                    type: "heading",
                    level: 1,
                    text: "Thumbnails that get clicked",
                    align: "center"
                  },
                  {
                    id: "hero-sub",
                    type: "text",
                    size: "lg",
                    align: "center",
                    text: "Tell it what your video is about. Get three thumbnails back in about ten seconds.",
                    style: { textTone: "muted", maxWidth: "md" }
                  },
                  {
                    id: "hero-input",
                    type: "input",
                    label: "What is your video about?",
                    placeholder: "A five-minute review of the new espresso machine…",
                    multiline: true,
                    wire: { role: "input" }
                  },
                  {
                    id: "hero-go",
                    type: "button",
                    label: "Make my thumbnails",
                    variant: "primary",
                    size: "lg",
                    wire: { role: "action" }
                  },
                  { id: "hero-result", type: "result", variant: "gallery", wire: { role: "output" } }
                ]
              }
            ]
          }
        ]
      }
    ],
    nav: {
      brand: { text: "Thumbnail Genie" },
      links: [{ label: "Home", pageId: "home" }],
      footerLinks: [],
      footerNote: "© Thumbnail Genie"
    },
    theme: { accent: DEFAULT_ACCENT, mode: "light", font: "sans" }
  }
};

// ---------------------------------------------------------------------------
// The agent's real graph — so wires point at nodes that actually exist.
// ---------------------------------------------------------------------------

export type GraphNodeSummary = {
  id: string;
  slug: string;
  /** "block" | "ai" | "trigger" | "action" | "design" | "node" */
  kind: string;
  title: string;
};

export type AgentGraphSummary = {
  nodes: GraphNodeSummary[];
  /** The node a customer's typing should feed, when the canvas has one. */
  inputNodeId?: string;
  /** The node a "run it" button should drive. */
  actionNodeId?: string;
  /** The node whose answer should be rendered. */
  outputNodeId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown, max = 80): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Kind from the canvas's own `nodeKind`, else the slug prefix. */
function kindOf(slug: string, data: Record<string, unknown>): string {
  const declared = textOf(data.nodeKind, 20);
  if (declared) return declared;
  const prefix = slug.split(".")[0];
  return prefix || "node";
}

/**
 * The agent's canvas, flattened to what the model needs to wire correctly:
 * every node's REAL id, its slug, its kind and its human title.
 *
 * Read defensively straight off workflowJson (the same flat `data.type` /
 * `data.nodeKind` shape blueprint.ts and graph-patch.ts document) rather than
 * through the node registry, which another fleet is actively changing.
 */
export function summarizeAgentGraph(workflowJson: unknown): AgentGraphSummary {
  const raw = asRecord(workflowJson);
  const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const nodes: GraphNodeSummary[] = [];

  for (const entry of rawNodes) {
    const node = asRecord(entry);
    if (!node) continue;
    const id = textOf(node.id, 120);
    if (!id) continue;
    const data = asRecord(node.data) ?? {};
    const slug = textOf(data.type, 80) || textOf(node.type, 80);
    const title = textOf(data.title) || textOf(data.label) || slug || id;
    nodes.push({ id, slug, kind: kindOf(slug, data), title });
  }

  const bySlug = (slug: string) => nodes.find((node) => node.slug === slug)?.id;
  const firstOfKind = (kind: string) => nodes.find((node) => node.kind === kind)?.id;

  return {
    nodes,
    inputNodeId:
      bySlug("block.prompt_composer") ??
      bySlug("block.file_upload") ??
      bySlug("block.preset_gallery"),
    actionNodeId: bySlug("block.action_button") ?? bySlug("block.continue_chain") ?? firstOfKind("ai"),
    outputNodeId: bySlug("block.output_stage") ?? bySlug("block.history_shelf") ?? firstOfKind("ai")
  };
}

/** Max graph nodes listed in the prompt — a huge canvas must not drown it. */
const MAX_GRAPH_NODES_IN_PROMPT = 40;

function describeAgentGraph(graph: AgentGraphSummary): string {
  if (graph.nodes.length === 0) {
    return [
      "THE AGENT'S INSIDES: this agent has no steps on its canvas yet.",
      'Leave "nodeId" out of every wire — a wire with no nodeId drives the agent\'s main chain, which is exactly right here.'
    ].join("\n");
  }

  const listed = graph.nodes.slice(0, MAX_GRAPH_NODES_IN_PROMPT);
  const lines = listed.map((node) => `- ${node.id} — ${node.slug || node.kind} ("${node.title}")`);
  const more =
    graph.nodes.length > listed.length ? [`- …and ${graph.nodes.length - listed.length} more`] : [];

  const hints: string[] = [];
  if (graph.inputNodeId) hints.push(`role "input" → "nodeId": "${graph.inputNodeId}"`);
  if (graph.actionNodeId) hints.push(`role "action" → "nodeId": "${graph.actionNodeId}"`);
  if (graph.outputNodeId) hints.push(`role "output" → "nodeId": "${graph.outputNodeId}"`);

  return [
    "THE AGENT'S INSIDES (use these EXACT ids in wires — never invent one):",
    ...lines,
    ...more,
    "",
    ...(hints.length > 0 ? [`For this agent: ${hints.join(", ")}.`] : []),
    'A wire with no "nodeId" drives the agent\'s main chain — that is fine when you are not sure.'
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The system prompt.
// ---------------------------------------------------------------------------

export type ProductChatAgentFacts = {
  name: string;
  tagline?: string | null;
  description?: string | null;
  accent?: string | null;
  mode?: "light" | "dark" | "warm" | null;
  template?: string | null;
  headline?: string | null;
  welcomeMessage?: string | null;
};

function describeCurrentProduct(product: ProductSpec | null): string {
  if (!product) {
    return "THE PRODUCT RIGHT NOW: nothing yet. You are writing the first version — build the whole thing.";
  }

  const json = JSON.stringify(product);
  if (json.length <= MAX_CURRENT_PRODUCT_CHARS) {
    return [
      "THE PRODUCT RIGHT NOW (your answer REPLACES this, so return the whole thing back with your changes made — anything you leave out is deleted):",
      json
    ].join("\n");
  }

  // Too large to paste. An outline keeps the model oriented and the caution
  // below stops it from "helpfully" rewriting a site it cannot see.
  const outline = product.pages
    .map((page) => {
      const blocks = page.blocks.map((block) => `${block.type}#${block.id}`).join(", ");
      return `- ${page.id} ("${page.title}", path "${page.path}"): ${blocks}`;
    })
    .join("\n");
  return [
    "THE PRODUCT RIGHT NOW is too large to show in full. Here is its outline:",
    outline,
    `NAV: ${JSON.stringify(product.nav)}`,
    `THEME: ${JSON.stringify(product.theme ?? {})}`,
    "Because you cannot see every word of it, only rewrite the pages the architect asked about, and keep every other page exactly as it is by copying its outline shape back."
  ].join("\n");
}

export function buildProductChatSystemPrompt(args: {
  agent: ProductChatAgentFacts;
  graph: AgentGraphSummary;
  current: ProductSpec | null;
  houseRules?: string;
}): string {
  const rules = (args.houseRules ?? "").trim();
  const agent = args.agent;
  const facts = {
    name: agent.name,
    tagline: agent.tagline ?? null,
    whatItDoes: agent.description ?? null,
    accentColor: agent.accent ?? DEFAULT_ACCENT,
    mode: agent.mode ?? "light",
    kind: agent.template ?? "chat",
    headline: agent.headline ?? null,
    welcomeMessage: agent.welcomeMessage ?? null
  };

  return [
    // The admin-editable constitution leads the prompt so it outranks
    // everything after it. Empty rules add nothing.
    ...(rules ? [`HOUSE RULES you must always obey:\n${rules}`, ""] : []),
    /* No persona here (the founder's ruling, 2026-08-27): this file briefs a
       hand with FACTS. Who the employee is comes from the one mind — a
       briefing that says "you are the Packaging writer" is a third employee
       inside one product. */
    `THIS HAND: the marketplace pages that SELL "${agent.name}" — the sell/landing page that explains it, pricing, FAQ, contact, privacy and terms.`,
    // The product's own working interface is derived from the orchestration by
    // the AI Builder — packaging must never rebuild or replace it. This is
    // the founder's locked frontend law: no general website building anywhere.
    "You do not build the product's working interface — that is your OTHER hand, and any wired input/button/result blocks already in the saved blueprint must be carried through unchanged here, never redesigned. If the architect asks for a change to the working product screen while you are on this hand, make the packaging change and say in one line that you will do the screen next.",
    "You never write code, HTML, CSS, or scripts. You write ONE JSON blueprint and our renderer paints it. Every element you write is drawn from a fixed design system, so you can be as creative as you like and the result can never come out broken, ugly, or off-brand.",
    "",
    describeProductSpecContract(),
    "",
    SECTION_VOCABULARY,
    "",
    "WIRES — how the product actually works:",
    'An element WITHOUT a "wire" is decoration. An element WITH a "wire" is plugged into the agent:',
    '- { "role": "input" } — whatever the customer types, picks, or uploads here is fed to the agent.',
    '- { "role": "action" } — pressing this runs the agent.',
    '- { "role": "output" } — the agent\'s answer appears here.',
    'A "result" element must use "variant": "auto" (or no variant at all), so the customer sees EVERYTHING the agent sends back — text, stat cards, charts, tables, images. Never "text" for an agent that returns data or numbers; that setting hides the agent\'s own cards and charts. Pick a single-kind variant ("gallery", "chart", "stats", "table") only when the agent clearly returns just that one kind or the architect asked for exactly that.',
    "Every page where a customer can actually use the product needs all three. The home page ALWAYS needs all three.",
    'A "button" with an "href" is a link (to another page or an #anchor); a "button" with a "wire" runs the agent. Never give one button both.',
    "",
    describeAgentGraph(args.graph),
    "",
    `ABOUT THIS AGENT: ${JSON.stringify(facts)}`,
    "",
    describeCurrentProduct(args.current),
    "",
    "WORKED EXAMPLE — the exact envelope, for a small one-page product (yours will usually be bigger, and its wires should carry the node ids listed above):",
    JSON.stringify(PRODUCT_CHAT_EXAMPLE),
    "",
    "WRITING RULES:",
    "- Write like a $100-billion company's website. Real, specific, confident copy — never lorem ipsum, never a placeholder, never \"[insert here]\".",
    "- Plain everyday English. No technical words: no API, prompt, model, LLM, token, workflow, node, wire, or JSON on any page a customer reads.",
    "- Say what the customer gets, not how it works inside.",
    '- Every "image" needs a real "alt" describing what is in it.',
    "- Reply in the same language the architect wrote in, and write the product's pages in that language too.",
    "- Every page you add must be reachable: add it to nav.links (or nav.footerLinks for legal pages).",
    '- Legal pages: give the site "privacy" and "terms" pages when it sells something or is going live. Write them plainly and honestly, and link them from footerLinks.',
    "- Keep one accent color and one mood across the whole site. The brand default is amber " +
      `"${DEFAULT_ACCENT}" unless the architect asked for something else.`,
    "- Do not try to control spacing, fonts, or exact colors: the renderer owns those and always gets mobile right.",
    "",
    "OUTPUT RULES:",
    '- Output ONLY a single JSON object, exactly: { "reply": string, "product": PRODUCT }. No markdown, no code fences, no words before or after it.',
    "- \"product\" is ALWAYS the complete product — every page, including the ones you did not change. It replaces what is stored.",
    "- \"reply\": one warm, short line to the architect about what you just built — 200 characters or fewer, everyday words, no jargon.",
    "- If the architect asks for something the contract cannot express, build the closest thing that IS possible and say so kindly in the reply. Never refuse with an empty product."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The gate: model output → a sanitized ProductSpec, or an error to feed back.
// ---------------------------------------------------------------------------

/**
 * Model text → the first balanced JSON object in it. Tolerates code fences and
 * prose around the object. Deliberately a local copy rather than an import
 * from design-chat.ts, which another fleet may be rewriting right now.
 */
export function extractProductChatJson(text: string | null | undefined): unknown | null {
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * The envelope gate. `reply` is CLAMPED rather than rejected: losing a whole
 * multi-page product because a confirmation line ran twelve characters long
 * would be absurd. `product` is the thing that must really validate.
 */
export const productChatOutputSchema = z.object({
  reply: z
    .string()
    .trim()
    .min(1, "reply must not be empty")
    .transform((value) => (value.length > 200 ? `${value.slice(0, 197).trimEnd()}…` : value)),
  product: z.unknown()
});

export type ProductChatGate =
  | { reply: string; product: ProductSpec; error: null }
  | { reply: null; product: null; error: string };

export function gateProductChatOutput(
  structuredOutput: unknown,
  text: string | null
): ProductChatGate {
  const raw =
    structuredOutput && typeof structuredOutput === "object" && !Array.isArray(structuredOutput)
      ? structuredOutput
      : extractProductChatJson(text);

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      reply: null,
      product: null,
      error: 'No JSON object found. Output exactly { "reply": string, "product": { ... } }.'
    };
  }

  const check = productChatOutputSchema.safeParse(raw);
  if (!check.success) {
    const issues = check.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { reply: null, product: null, error: issues };
  }

  // The one door every spec goes through. Anything unrenderable is dropped
  // node-by-node; null means nothing at all survived.
  const clean = sanitizeProductSpec(check.data.product);
  if (!clean) {
    return {
      reply: null,
      product: null,
      error:
        'product: nothing in it could be rendered. It must be { "version": 1, "pages": [ { "id": "home", "title": …, "path": "", "blocks": [ … ] } ], "nav": { "links": [], "footerLinks": [] } } with at least one real node on the home page.'
    };
  }

  return { reply: check.data.reply, product: clean, error: null };
}

// ---------------------------------------------------------------------------
// Auto-fix: the misses a language model always makes.
// ---------------------------------------------------------------------------

function pageById(spec: ProductSpec, id: string): PageSpec | undefined {
  return spec.pages.find((page) => page.id === id);
}

/** A unique id in the page, derived from `base`. */
function freeId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function collectIds(nodes: SpecNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    into.add(node.id);
    const children = (node as { children?: SpecNode[] }).children;
    if (Array.isArray(children)) collectIds(children, into);
  }
  return into;
}

/** The home page is required. The sanitizer promotes one, this is the belt. */
function ensureHomePage(spec: ProductSpec): ProductSpec {
  if (spec.pages.some((page) => page.id === "home")) return spec;
  const [first, ...rest] = spec.pages;
  if (!first) return spec;
  return { ...spec, pages: [{ ...first, id: "home", path: "" }, ...rest] };
}

/**
 * The home page must be a working product, not a brochure: at least one input,
 * one action and one output wire. Whatever is missing is appended as a real
 * section, wired to the agent's actual graph nodes.
 */
function ensureHomeIsUsable(
  spec: ProductSpec,
  graph: AgentGraphSummary,
  agentName: string
): { spec: ProductSpec; added: boolean } {
  const home = pageById(spec, "home");
  if (!home) return { spec, added: false };

  const roles = new Set<WireRole>(
    collectWires(spec)
      .filter((ref) => ref.pageId === "home")
      .map((ref) => ref.wire.role)
  );
  const missing = (["input", "action", "output"] as const).filter((role) => !roles.has(role));
  if (missing.length === 0) return { spec, added: false };

  const used = collectIds(home.blocks, new Set<string>());
  const children: SpecNode[] = [];

  if (missing.includes("input")) {
    children.push({
      id: freeId("product-input", used),
      type: "input",
      label: "What do you need?",
      placeholder: "Tell it what you need…",
      multiline: true,
      wire: graph.inputNodeId ? { role: "input", nodeId: graph.inputNodeId } : { role: "input" }
    });
  }
  if (missing.includes("action")) {
    children.push({
      id: freeId("product-run", used),
      type: "button",
      label: "Run it",
      variant: "primary",
      size: "lg",
      wire: graph.actionNodeId ? { role: "action", nodeId: graph.actionNodeId } : { role: "action" }
    });
  }
  if (missing.includes("output")) {
    children.push({
      id: freeId("product-result", used),
      type: "result",
      variant: "auto",
      wire: graph.outputNodeId ? { role: "output", nodeId: graph.outputNodeId } : { role: "output" }
    });
  }
  if (children.length === 0) return { spec, added: false };

  // A heading only when the whole product surface is missing — a lone result
  // node slotted under an existing hero should not announce itself.
  const stack: SpecNode[] = missing.length === 3
    ? [
        {
          id: freeId("product-title", used),
          type: "heading",
          level: 2,
          text: `Try ${agentName}`,
          align: "center"
        },
        ...children
      ]
    : children;

  const section: SpecNode = {
    id: freeId("product", used),
    type: "section",
    padding: "lg",
    background: "plain",
    children: [
      {
        id: freeId("product-stack", used),
        type: "stack",
        gap: "md",
        align: missing.length === 3 ? "center" : "start",
        children: stack
      }
    ]
  };

  const pages = spec.pages.map((page) =>
    page.id === "home" ? { ...page, blocks: [...page.blocks, section] } : page
  );
  return { spec: { ...spec, pages }, added: true };
}

const PRICE_PATTERN = /[$€£₹]\s?\d|\bper month\b|\bper year\b|\/mo\b|\bmonthly\b|\bsubscription\b/i;
const SELLING_PAGE_PATTERN = /pric|plan|checkout|buy|subscribe|billing/i;

function nodeSells(node: SpecNode): boolean {
  const candidate =
    (node as { text?: string }).text ??
    (node as { label?: string }).label ??
    (node as { value?: string }).value ??
    "";
  if (typeof candidate === "string" && PRICE_PATTERN.test(candidate)) return true;
  const children = (node as { children?: SpecNode[] }).children;
  return Array.isArray(children) ? children.some(nodeSells) : false;
}

/** Does this product take money (or look like it is about to)? */
export function productSellsSomething(spec: ProductSpec): boolean {
  for (const page of spec.pages) {
    if (SELLING_PAGE_PATTERN.test(`${page.id} ${page.path} ${page.title}`)) return true;
    if (page.blocks.some(nodeSells)) return true;
  }
  return false;
}

const FULL_PRODUCT_PATTERN =
  /\b(full|complete|whole|entire|multi[-\s]?page|proper|professional|real)\s+(product|site|website|web\s?site|business|company|saas|store|shop|thing)\b|\b(launch|publish|go\s+live|sell|sellable|monetis\w*|monetiz\w*|checkout|payment|paid|pricing|subscription|legal|privacy|terms)\b/i;

/** Did the architect ask for something that needs legal pages before it ships? */
export function asksForFullProduct(instruction: string): boolean {
  return FULL_PRODUCT_PATTERN.test(instruction);
}

/**
 * Privacy + Terms, appended when the product would need them to be published
 * and the model did not write them. Existing legal pages are never overwritten
 * — an architect's own wording survives.
 */
function ensureLegalPages(
  spec: ProductSpec,
  input: LegalPagesInput
): { spec: ProductSpec; added: string[] } {
  const have = new Set(spec.pages.map((page) => page.id));
  const missing = LEGAL_PAGE_IDS.filter((id) => !have.has(id));
  if (missing.length === 0) return { spec, added: [] };

  const generated = generateLegalPages(input);
  const pages = [...spec.pages];
  const footerLinks: NavLink[] = [...spec.nav.footerLinks];
  const added: string[] = [];

  for (const id of missing) {
    if (pages.length >= PRODUCT_SPEC_LIMITS.maxPages) break;
    pages.push(id === "privacy" ? generated.privacy : generated.terms);
    footerLinks.push({ label: id === "privacy" ? "Privacy" : "Terms", pageId: id });
    added.push(id);
  }
  if (added.length === 0) return { spec, added: [] };

  return { spec: { ...spec, pages, nav: { ...spec.nav, footerLinks } }, added };
}

/**
 * Every page reachable, every link real. The sanitizer already drops links to
 * pages that do not exist; this adds the links a model forgot, so a page it
 * wrote is never stranded with no way in.
 */
function ensureNavCoverage(spec: ProductSpec): ProductSpec {
  const pageIds = new Set(spec.pages.map((page) => page.id));

  const links: NavLink[] = spec.nav.links.filter((link) => pageIds.has(link.pageId));
  const linked = new Set(links.map((link) => link.pageId));

  if (!linked.has("home") && pageIds.has("home")) {
    links.unshift({ label: "Home", pageId: "home" });
    linked.add("home");
  }
  for (const page of spec.pages) {
    if (links.length >= PRODUCT_SPEC_LIMITS.maxNavLinks) break;
    if (NEVER_IN_TOP_NAV.has(page.id) || linked.has(page.id)) continue;
    links.push({ label: page.title, pageId: page.id });
    linked.add(page.id);
  }

  const footerLinks: NavLink[] = spec.nav.footerLinks.filter((link) => pageIds.has(link.pageId));
  const footerLinked = new Set(footerLinks.map((link) => link.pageId));
  for (const id of LEGAL_PAGE_IDS) {
    if (footerLinks.length >= PRODUCT_SPEC_LIMITS.maxFooterLinks) break;
    if (!pageIds.has(id) || footerLinked.has(id)) continue;
    footerLinks.push({ label: id === "privacy" ? "Privacy" : "Terms", pageId: id });
    footerLinked.add(id);
  }

  return { ...spec, nav: { ...spec.nav, links, footerLinks } };
}

export type AutoFixInput = {
  spec: ProductSpec;
  graph: AgentGraphSummary;
  instruction: string;
  agentName: string;
  legal: LegalPagesInput;
};

export type AutoFixResult = {
  product: ProductSpec;
  /** Page ids the auto-fix itself added (legal pages today). */
  legalPagesAdded: string[];
  /** True when a working product surface had to be appended to home. */
  productSurfaceAdded: boolean;
};

/**
 * Everything a language model reliably gets wrong, fixed server-side:
 * a missing home page, a beautiful site with nothing wired, a product that
 * takes money with no privacy policy, and pages with no way to reach them.
 */
export function autoFixProduct(input: AutoFixInput): AutoFixResult {
  let spec = ensureHomePage(input.spec);

  const usable = ensureHomeIsUsable(spec, input.graph, input.agentName);
  spec = usable.spec;

  const needsLegal =
    asksForFullProduct(input.instruction) ||
    productSellsSomething(spec) ||
    spec.pages.length >= 3;
  let legalPagesAdded: string[] = [];
  if (needsLegal) {
    const withLegal = ensureLegalPages(spec, input.legal);
    spec = withLegal.spec;
    legalPagesAdded = withLegal.added;
  }

  spec = ensureNavCoverage(spec);

  // Back through the one door: the fixes are re-checked for caps, ids and
  // dangling links exactly like model output is.
  const clean = sanitizeProductSpec(spec);
  return {
    product: clean ?? input.spec,
    legalPagesAdded,
    productSurfaceAdded: usable.added
  };
}

// ---------------------------------------------------------------------------
// House rules — owned by another fleet, so imported defensively.
// ---------------------------------------------------------------------------

/**
 * The admin-editable constitution, or "" when that module is not present.
 *
 * `../admin/design-brain-rules` belongs to another fleet. A dynamic import in
 * a try/catch means a missing module, a renamed export or a database hiccup
 * costs the prompt its house rules — never the architect their reply.
 */
export async function loadHouseRules(): Promise<string> {
  try {
    // The ".js" specifier is what Node16 resolution wants for a dynamic
    // import; TypeScript, vitest and the compiled CJS all resolve it to the
    // real module, and a missing file rejects the promise instead of throwing
    // at load time — which is the whole point of importing it this way.
    const module: unknown = await import("../admin/design-brain-rules.js");
    const accessor = (module as { getDesignBrainRules?: unknown }).getDesignBrainRules;
    if (typeof accessor !== "function") return "";
    const rules: unknown = await (accessor as () => Promise<unknown>)();
    return typeof rules === "string" ? rules : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// The route.
// ---------------------------------------------------------------------------

type ListingFacts = {
  name: string;
  tagline: string | null;
  shortDescription: string;
  iconUrl: string | null;
  priceCents: number;
  pricingModel: string;
};

const TEMPLATES: readonly AgentPageTemplate[] = ["chat", "voice", "media", "form"];

function normalizeTemplate(template: string): AgentPageTemplate {
  return (TEMPLATES as readonly string[]).includes(template) ? (template as AgentPageTemplate) : "chat";
}

async function loadListingFacts(page: PublishedAgentPage): Promise<ListingFacts | null> {
  const listing = await prisma.agentListing.findUnique({
    where: { id: page.listingId },
    select: {
      name: true,
      tagline: true,
      shortDescription: true,
      iconUrl: true,
      priceCents: true,
      pricingModel: true
    }
  });
  if (!listing) return null;
  return {
    name: listing.name,
    tagline: listing.tagline,
    shortDescription: listing.shortDescription,
    iconUrl: listing.iconUrl,
    priceCents: listing.priceCents,
    pricingModel: String(listing.pricingModel)
  };
}

export function registerAgentPageProductChatRoute(routes: Hono) {
  routes.post(
    "/manage/:workflowId/product-chat",
    requireAuth,
    requireRole(["ARCHITECT"]),
    async (c) => {
      const authUser = c.get("authUser");
      const workflowId = c.req.param("workflowId");

      // Ownership: the same idiom as every other manage route.
      const workflow = await prisma.workflowDefinition.findFirst({
        where: { id: workflowId, architectUserId: authUser.id },
        select: { id: true, name: true, architectUserId: true, workflowJson: true }
      });
      if (!workflow) {
        return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
      }

      let input: z.infer<typeof productChatBodySchema>;
      try {
        input = productChatBodySchema.parse(await c.req.json().catch(() => ({})));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return errorResponse(c, error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
        }
        throw error;
      }

      // Draft agents are first-class: no page row yet means we bootstrap the
      // DRAFT listing + page, so a product can be designed before publishing.
      let page = await prisma.publishedAgentPage.findFirst({ where: { workflowId } });
      if (!page) {
        page = await ensureDraftAgentListingAndPage({
          id: workflow.id,
          name: workflow.name,
          architectUserId: workflow.architectUserId,
          workflowJson: workflow.workflowJson
        });
      }

      const listing = await loadListingFacts(page);
      const design = resolveDesign(page.designJson);
      const graph = summarizeAgentGraph(workflow.workflowJson);
      const stored = getProductSpec(page);

      const agentName = (listing?.name || workflow.name || "Your AI Product").trim();
      const agentFacts: ProductChatAgentFacts = {
        name: agentName,
        tagline: listing?.tagline ?? null,
        description: listing?.shortDescription ?? null,
        accent: page.accentColor ?? stored?.theme?.accent ?? DEFAULT_ACCENT,
        mode: stored?.theme?.mode ?? design.theme,
        template: page.template,
        headline: page.headline,
        welcomeMessage: page.welcomeMessage
      };

      /** The product to echo back when nothing changes. */
      const unchangedProduct = (): ProductSpec =>
        stored ??
        starterProductSpec({
          template: normalizeTemplate(page.template),
          headline: page.headline,
          welcomeMessage: page.welcomeMessage,
          suggestedPrompts: page.suggestedPrompts,
          accentColor: page.accentColor,
          listingName: listing?.name ?? workflow.name,
          tagline: listing?.tagline ?? null,
          shortDescription: listing?.shortDescription ?? null,
          iconUrl: listing?.iconUrl ?? null,
          blueprint: deriveFaceBlueprint(workflow.workflowJson),
          design
        });

      // The battery an admin picked for design work, not a provider frozen into
      // this file. Building a whole product is the job where taste shows, so it
      // must be swappable the day a better model exists.
      const resolved = resolveBrainSlot(await getDesignBrainConfig());
      if (!resolved) {
        return errorResponse(c, MISSING_LLM_CREDENTIALS_MESSAGE, 503, "LLM_NOT_CONFIGURED");
      }

      const houseRules = await loadHouseRules();
      const systemPrompt = buildProductChatSystemPrompt({
        agent: agentFacts,
        graph,
        current: stored,
        houseRules
      });

      const conversationHistory: AIMessage[] = (input.history ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content
      }));

      // Grows only on retry: [instruction] -> [instruction, bad output, feedback].
      const messages: AIMessage[] = [{ role: "user", content: input.instruction }];

      let reply: string | null = null;
      let product: ProductSpec | null = null;

      for (let attempt = 0; attempt < 2 && !product; attempt++) {
        const request: AIExecuteRequest = {
          capability: "llm",
          systemPrompt,
          conversationHistory,
          messages: [...messages],
          // Design work, not arithmetic: a little warmth writes better copy.
          temperature: 0.4,
          maxTokens: MAX_OUTPUT_TOKENS,
          outputFormat: "json",
          task: "agent-page-product-chat",
          ...(resolved.model ? { model: resolved.model } : {})
        };

        let response;
        try {
          response = await getProviderEngine().executeWithProvider(resolved.providerId, request);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordLlmProviderFailure(resolved.providerId, message);
          console.error("[product-chat] LLM call failed", {
            workflowId,
            provider: resolved.providerId,
            message
          });
          break; // A transport failure will not be fixed by JSON feedback.
        }

        if (response.status === "error") {
          recordLlmProviderFailure(resolved.providerId, response.error);
          console.error("[product-chat] LLM returned error", {
            workflowId,
            provider: resolved.providerId,
            error: response.error
          });
          break;
        }
        recordLlmProviderSuccess(resolved.providerId);

        const gate = gateProductChatOutput(response.structuredOutput, response.text);
        if (gate.product) {
          reply = gate.reply;
          product = gate.product;
          break;
        }

        // Rejections were invisible: the architect saw only the kind fallback
        // and the logs said nothing. One line so an operator can tell a model
        // hiccup from a contract drift.
        console.error("[product-chat] gate rejected model output", {
          workflowId,
          provider: resolved.providerId,
          error: String(gate.error ?? "unknown").slice(0, 300)
        });

        // Single retry: the exact validation error goes back to the model.
        messages.push(
          { role: "assistant", content: response.text ?? "" },
          {
            role: "user",
            content: `Your previous output was invalid: ${gate.error} Respond again with ONLY the corrected JSON object — no markdown fences, no extra keys, and include the COMPLETE product.`
          }
        );
      }

      if (!product || !reply) {
        // Nothing is written. The architect gets a kind nudge and the product
        // they already had.
        return successResponse(c, {
          reply: PRODUCT_CHAT_FALLBACK_REPLY,
          product: unchangedProduct(),
          pagesCreated: [],
          legalNote: null
        });
      }

      const legalInput: LegalPagesInput = {
        businessName: agentName,
        contactEmail: authUser.email,
        productName: agentName,
        paymentsEnabled: (listing?.priceCents ?? 0) > 0 || listing?.pricingModel !== "FREE"
      };

      const fixed = autoFixProduct({
        spec: product,
        graph,
        instruction: input.instruction,
        agentName,
        legal: legalInput
      });

      let saved: ProductSpec;
      try {
        saved = await saveProductSpec(page.id, fixed.product);
      } catch (error) {
        console.error("[product-chat] could not save product", {
          workflowId,
          message: error instanceof Error ? error.message : String(error)
        });
        return successResponse(c, {
          reply: PRODUCT_CHAT_FALLBACK_REPLY,
          product: unchangedProduct(),
          pagesCreated: [],
          legalNote: null
        });
      }

      const before = new Set((stored?.pages ?? []).map((existing) => existing.id));
      const pagesCreated = saved.pages
        .map((existing) => existing.id)
        .filter((id) => !before.has(id));

      return successResponse(c, {
        reply,
        product: saved,
        pagesCreated,
        // Architect-facing only, never rendered on the customer's site.
        legalNote: fixed.legalPagesAdded.length > 0 ? LEGAL_REVIEW_NOTE : null
      });
    }
  );
}
