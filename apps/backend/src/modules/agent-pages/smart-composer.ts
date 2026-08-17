import type { Hono } from "hono";
import type { PublishedAgentPage } from "@prisma/client";
import { z } from "zod";
import {
  deriveDeclarations,
  isContainerNode,
  sanitizeProductSpec,
  type DeclaredAsk,
  type ProductSpec,
  type SpecNode,
  type Wire,
  type WorkflowDeclarations
} from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { MISSING_LLM_CREDENTIALS_MESSAGE } from "../ai-provider-engine/llm-credentials";
import { resolveBrainSlot } from "../admin/brain-slot-settings";
import { getSmartDesignerBrainConfig } from "../admin/smart-designer-brain-settings";
import {
  recordLlmProviderFailure,
  recordLlmProviderSuccess
} from "../ai-provider-engine/llm-health";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import type { AIExecuteRequest, AIMessage } from "../ai-provider-engine/types";
import { describeProductSpecContract } from "./product-chat";
import { getProductSpec, saveProductSpec, starterProductSpec } from "./product-spec-service";
import { deriveFaceBlueprint } from "./blueprint";
import { resolveDesign } from "./design";
import { ensureDraftAgentListingAndPage, type AgentPageTemplate } from "./slug";

/**
 * SMART DESIGNER — the orchestration generates the interface.
 *
 *   POST /agent-pages/manage/:workflowId/smart-compose   (the AI Composer)
 *   POST /agent-pages/manage/:workflowId/smart-designer  (the feedback loop)
 *
 * The frontend law this implements: nodes DECLARE (what they must ask a human
 * for, what they show back), and an AI COMPOSER — an LLM, never code rules —
 * reads all declarations together and generates the MINIMUM interface from our
 * pre-built components. A hundred template holes in the graph may surface as
 * three fields on screen; merging is the composer's core job and the merge
 * itself already happened in `deriveDeclarations`, so the model's contract is
 * simple: ONE control per declared ask, every ask present, nothing invented.
 *
 * Rules are guardrails FOR the AI, never a replacement: the model decides
 * which components and where, then `checkComposition` guarantees correctness —
 * repairing mechanically what is trivial (a result variant that is not "auto",
 * a second field for an already-placed ask, an extra page) and feeding every
 * other violation back for exactly one retry. A spec that still fails is never
 * saved.
 *
 * This is a completely separate, parallel feature: the existing Design Brain
 * node and its Style/Build chat are untouched, and this module runs on its own
 * admin battery (`getSmartDesignerBrainConfig`) so its model is swappable
 * without ever affecting the old designer.
 */

/** Graceful reply when the composer never produces a valid interface. */
export const SMART_COMPOSER_FALLBACK_REPLY =
  "I couldn't put the interface together this time. Run it again, or tell the Smart Designer what the page should capture.";

/** Graceful reply when a designer edit never survives validation. */
export const SMART_DESIGNER_FALLBACK_REPLY =
  "I couldn't apply that change safely, so I left your page as it was. Tell me again in a sentence what should be different.";

/** The one-line redirect for asks that belong to Packaging, not the product. */
export const SMART_DESIGNER_BOUNDARY_REPLY =
  "That belongs to Packaging — the place for sell pages, pricing, privacy and terms. I only shape the working product screen, so your page is unchanged.";

/** Roomy: a composed interface is a big JSON document (8k+ tokens of spec). */
const MAX_OUTPUT_TOKENS = 16000;

/** Above this the current product is summarized instead of pasted in full. */
const MAX_CURRENT_PRODUCT_CHARS = 60000;

export const smartDesignerBodySchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1, "Tell me what to change first")
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
// The boundary — product interface only, everything else goes to Packaging.
// ---------------------------------------------------------------------------

/**
 * Requests that are about the wrapper around the product, not the product's
 * working screen. The founder's boundary: privacy/terms, landing/sell pages,
 * marketing sites live in Packaging — the Smart Designer must redirect, never
 * attempt. This regex is the guardrail; the prompt teaches the model the same
 * boundary for phrasings no pattern anticipates.
 */
const PACKAGING_PATTERN =
  /\b(privacy(\s+policy)?|terms(\s+(of\s+service|and\s+conditions|&\s*conditions))?|t\s*&\s*cs?|legal\s+page|landing\s+page|sell(ing)?\s+page|sales\s+page|marketing\s+(site|page|section|copy|website)|pricing\s+page|checkout|payment\s+page|about\s+(us\s+)?page|testimonials?|blog|seo|full\s+website|whole\s+website|multi[-\s]?page\s+(site|website))\b/i;

/** True when the instruction asks for something beyond the product interface. */
export function isPackagingRequest(instruction: string): boolean {
  return PACKAGING_PATTERN.test(instruction);
}

// ---------------------------------------------------------------------------
// Prompts.
// ---------------------------------------------------------------------------

export type ComposerAgentFacts = {
  name: string;
  tagline?: string | null;
};

function describeDeclarations(declarations: WorkflowDeclarations): string {
  return [
    "THE DECLARATIONS — everything the orchestration needs from a human, already merged (this is your ONLY source of truth about the agent; never invent an ask or a show):",
    JSON.stringify(declarations),
    "",
    "How to read them:",
    '- Each ask is ONE value a human must supply. "nodeIds" lists every workflow node that needs it — place EXACTLY ONE field and wire it with { "role": "input", "nodeId": "<the first nodeId>" }. Two or more nodeIds means the merge already happened: one field feeds them all.',
    '- Give each field\'s "id" the ask\'s exact "id" (the field for ask "city" is { "id": "city", … }) so the validator can match them.',
    '- "kind" picks the component: "choice" → a "choice" node with the given options; "file" → an "upload" node; "longtext" → a multiline "input"; "text"/"number"/"date"/"phone"/"email"/"url" → an "input" (set its "kind" to the same value so the right keyboard appears).',
    '- An ask with "satisfiedByNodeId" is already captured by a block on the canvas — wire your one field to THAT node id and never add a second control for it.',
    '- An ask with "dependsOnNodeId" only makes sense after that node ran; keep its field close to the result area rather than first.',
    '- Each show is a place the agent answers. Give each one a "result" node with variant "auto", wired { "role": "output", "nodeId": "<its nodeId>" } (use "satisfiedByNodeId" as the nodeId when present).',
    '- "shape" is the product\'s nature: "form" wants fields + one run button + results; "conversation" wants a single prompt input and a conversational result; "generation" wants a prompt and a gallery-style result; "voice" happens on the phone — the page may need no fields at all, just what the customer should know and any results; "hybrid" combines them.'
  ].join("\n");
}

const COMPOSER_HARD_RULES = [
  "HARD RULES (a validator checks every one of these after you answer; a violation is sent back to you once, then the attempt is discarded):",
  "- ONE field per ask. NEVER two controls for the same ask id, no matter how many nodeIds it lists.",
  "- EVERY ask appears exactly once, wired to one of its nodeIds.",
  '- Every show gets a result area with "variant": "auto".',
  '- Every "nodeId" you write inside a wire must be one of the node ids given in the declarations. Never invent one.',
  "- MINIMUM interface: the working product only. No marketing sections, no fake stats, no testimonials, no pricing, no invented pages. Selling the product is Packaging's job, not yours.",
  '- ONE page only: a single "home" page with path "". Nothing else.',
  '- One run button with { "role": "action" } so the customer can start the agent (skip it only for a pure voice product with no fields).'
].join("\n");

export function buildComposerSystemPrompt(args: {
  agent: ComposerAgentFacts;
  declarations: WorkflowDeclarations;
}): string {
  return [
    `You are the AI Composer for "${args.agent.name}". The architect built an orchestration; you generate its working interface — the MINIMUM set of controls a customer needs, assembled from our pre-built components. You never write code and you never invent a component: you choose WHICH of our components to place and WHERE, and our renderer paints them beautifully.`,
    ...(args.agent.tagline ? [`The product in one line: ${args.agent.tagline}`] : []),
    "",
    describeDeclarations(args.declarations),
    "",
    describeProductSpecContract(),
    "",
    COMPOSER_HARD_RULES,
    "",
    "OUTPUT RULES:",
    '- Output ONLY a single JSON object, exactly: { "reply": string, "product": PRODUCT }. No markdown, no code fences, no words before or after it.',
    '- "reply": one warm, short line to the architect about the interface you composed — 200 characters or fewer, everyday words, no jargon.',
    "- Labels and helper text in plain, friendly English drawn from the ask labels. Never show a customer a variable name, a node id, or any technical word."
  ].join("\n");
}

function describeCurrentProduct(product: ProductSpec | null): string {
  if (!product) {
    return "THE PRODUCT RIGHT NOW: nothing stored yet — compose the interface fresh from the declarations.";
  }
  const json = JSON.stringify(product);
  if (json.length <= MAX_CURRENT_PRODUCT_CHARS) {
    return [
      "THE PRODUCT RIGHT NOW (your answer REPLACES it, so return the whole thing back with your changes made):",
      json
    ].join("\n");
  }
  // Too large to paste — an outline keeps the model oriented without letting
  // it "helpfully" rewrite pages it cannot see.
  const outline = product.pages
    .map((page) => `- ${page.id}: ${page.blocks.map((block) => `${block.type}#${block.id}`).join(", ")}`)
    .join("\n");
  return ["THE PRODUCT RIGHT NOW is too large to show in full. Its outline:", outline].join("\n");
}

export function buildSmartDesignerSystemPrompt(args: {
  agent: ComposerAgentFacts;
  declarations: WorkflowDeclarations;
  current: ProductSpec | null;
}): string {
  return [
    `You are the Smart Designer for "${args.agent.name}". The interface was composed from the architect's orchestration; the architect now fixes it by TALKING to you — "this box isn't capturing email separately", "put the results above the fields". You adjust the interface and nothing else.`,
    "",
    "YOUR BOUNDARY: you shape ONLY the working product interface derived from the orchestration. If the architect asks for anything beyond it — a privacy policy, terms, a landing page, a sell page, pricing, a marketing site — do not attempt it. Answer exactly:",
    '{ "reply": "<one friendly line redirecting them to Packaging>", "boundary": "packaging" }',
    "with NO product key, and change nothing.",
    "",
    describeDeclarations(args.declarations),
    "",
    describeProductSpecContract(),
    "",
    describeCurrentProduct(args.current),
    "",
    COMPOSER_HARD_RULES,
    "",
    "OUTPUT RULES:",
    '- For an interface change: output ONLY { "reply": string, "product": PRODUCT } — the COMPLETE product with the change made (anything you leave out is deleted).',
    '- For a request outside your boundary: output ONLY { "reply": string, "boundary": "packaging" }.',
    '- "reply": one warm, short line — 200 characters or fewer, everyday words, no jargon.'
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The gate: model text → { reply, product } or { reply, boundary }.
// ---------------------------------------------------------------------------

/**
 * Model text → the first balanced JSON object in it. Tolerates code fences and
 * prose around the object. A local copy on purpose: product-chat's twin is in
 * a file another fleet edits, and this gate must never move under us.
 */
export function extractComposerJson(text: string | null | undefined): unknown | null {
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

/** `reply` is clamped rather than rejected — a long confirmation line must
 * never cost the architect a whole composed interface. */
const composerEnvelopeSchema = z.object({
  reply: z
    .string()
    .trim()
    .min(1)
    .transform((value) => (value.length > 200 ? `${value.slice(0, 197).trimEnd()}…` : value)),
  boundary: z.literal("packaging").optional(),
  product: z.unknown().optional()
});

// ---------------------------------------------------------------------------
// The composer validator — the guardrails that run AFTER the AI decides.
// ---------------------------------------------------------------------------

export type CompositionCheck = {
  /** The (possibly repaired) spec when every guarantee holds, else null. */
  product: ProductSpec | null;
  /** What the model must fix — fed back verbatim on the single retry. */
  violations: string[];
  /** Declared asks that ended up with a wired field. */
  asksPlaced: number;
};

type WireHit = { specNodeId: string; nodeType: SpecNode["type"]; wire: Wire };

function collectWireHits(spec: ProductSpec): WireHit[] {
  const hits: WireHit[] = [];
  const walk = (nodes: SpecNode[]) => {
    for (const node of nodes) {
      const wire = (node as { wire?: Wire }).wire;
      if (wire) hits.push({ specNodeId: node.id, nodeType: node.type, wire });
      if (isContainerNode(node)) walk(node.children);
    }
  };
  for (const page of spec.pages) walk(page.blocks);
  return hits;
}

/** Drop the given spec node ids everywhere; emptied containers vanish too. */
function dropSpecNodes(nodes: SpecNode[], remove: Set<string>): SpecNode[] {
  const out: SpecNode[] = [];
  for (const node of nodes) {
    if (remove.has(node.id)) continue;
    if (isContainerNode(node)) {
      const children = dropSpecNodes(node.children, remove);
      if (children.length === 0) continue;
      out.push({ ...node, children });
      continue;
    }
    out.push(node);
  }
  return out;
}

/** Result areas are always variant "auto" — the renderer picks the best face. */
function forceAutoResults(nodes: SpecNode[]): SpecNode[] {
  return nodes.map((node) => {
    if (isContainerNode(node)) return { ...node, children: forceAutoResults(node.children) };
    if (node.type === "result" && node.variant !== "auto") return { ...node, variant: "auto" };
    return node;
  });
}

const INPUT_NODE_TYPES = new Set<SpecNode["type"]>(["input", "choice", "upload"]);

/** Node ids a field for this ask may be wired to. */
function askTargets(ask: DeclaredAsk): Set<string> {
  const targets = new Set(ask.nodeIds);
  if (ask.satisfiedByNodeId) targets.add(ask.satisfiedByNodeId);
  return targets;
}

/**
 * The guarantees behind the composer, checked mechanically after the AI
 * decided. Trivial misses are repaired in place (kept spec, no retry):
 * extra pages are dropped, result variants are flipped to "auto", and a
 * SECOND field for an already-placed ask is removed. Everything else — a
 * missing ask, a show with no result area, a wire at a node that does not
 * exist — is a violation the model gets back exactly once.
 */
export function checkComposition(
  spec: ProductSpec,
  declarations: WorkflowDeclarations,
  graphNodeIds: Set<string>
): CompositionCheck {
  const violations: string[] = [];

  // Repair: the product interface is ONE page. Anything else is dropped —
  // trivial, because the extra pages are exactly what must not exist.
  let working: ProductSpec = spec;
  if (working.pages.length > 1) {
    const home = working.pages.find((page) => page.id === "home") ?? working.pages[0];
    working = {
      ...working,
      pages: [home],
      nav: {
        ...working.nav,
        links: working.nav.links.filter((link) => link.pageId === home.id),
        footerLinks: []
      }
    };
  }

  // Repair: variant "auto" everywhere a result lands.
  working = {
    ...working,
    pages: working.pages.map((page) => ({ ...page, blocks: forceAutoResults(page.blocks) }))
  };

  // Wires must point at nodes the graph really has. Not trivially repairable —
  // guessing a target could feed a customer's value into the wrong node.
  for (const hit of collectWireHits(working)) {
    if (hit.wire.nodeId && !graphNodeIds.has(hit.wire.nodeId)) {
      violations.push(
        `Wire on "${hit.specNodeId}" points at node "${hit.wire.nodeId}", which does not exist in this agent. Use only the node ids from the declarations.`
      );
    }
  }

  // Every ask: exactly one wired field. Several asks routinely live on the
  // SAME graph node (one brain needing city and deadline), so a wire target
  // alone cannot say which ask a field feeds — the field's own id (the prompt
  // tells the model to reuse the ask id) is matched first, and the wire target
  // only settles what ids left open. A second field feeding an already-placed
  // ask is dropped (trivial); a missing field is a violation.
  const fields = collectWireHits(working).filter(
    (hit) => INPUT_NODE_TYPES.has(hit.nodeType) && hit.wire.role === "input"
  );
  const assigned = new Map<string, WireHit>();
  const claimed = new Set<string>();

  for (const ask of declarations.asks) {
    const match = fields.find(
      (field) =>
        !claimed.has(field.specNodeId) &&
        (field.specNodeId === ask.id || field.specNodeId === `field-${ask.id}`)
    );
    if (match) {
      assigned.set(ask.id, match);
      claimed.add(match.specNodeId);
    }
  }
  for (const ask of declarations.asks) {
    if (assigned.has(ask.id)) continue;
    const targets = askTargets(ask);
    const match = fields.find(
      (field) =>
        !claimed.has(field.specNodeId) &&
        field.wire.nodeId !== undefined &&
        targets.has(field.wire.nodeId)
    );
    if (match) {
      assigned.set(ask.id, match);
      claimed.add(match.specNodeId);
    }
  }

  let asksPlaced = 0;
  for (const ask of declarations.asks) {
    if (assigned.has(ask.id)) {
      asksPlaced += 1;
      continue;
    }
    violations.push(
      `Ask "${ask.id}" ("${ask.label}") has no field. Place exactly one ${ask.kind} control with "id": "${ask.id}" wired { "role": "input", "nodeId": "${ask.nodeIds[0]}" }.`
    );
  }

  // Unclaimed fields that feed a node an assigned ask already covers are the
  // duplicates the founder's rule forbids — dropped, never a second question.
  const placedTargets = new Set<string>();
  for (const ask of declarations.asks) {
    if (!assigned.has(ask.id)) continue;
    for (const target of askTargets(ask)) placedTargets.add(target);
  }
  const remove = new Set<string>();
  for (const field of fields) {
    if (claimed.has(field.specNodeId)) continue;
    if (field.wire.nodeId && placedTargets.has(field.wire.nodeId)) remove.add(field.specNodeId);
  }
  if (remove.size > 0) {
    working = {
      ...working,
      pages: working.pages.map((page) => ({ ...page, blocks: dropSpecNodes(page.blocks, remove) }))
    };
  }

  // Every show: a result area. A wire with no nodeId drives the main chain and
  // counts for any show — same meaning the renderer gives it.
  const outputHits = collectWireHits(working).filter(
    (hit) => (hit.nodeType === "result" || hit.nodeType === "history") && hit.wire.role === "output"
  );
  for (const show of declarations.shows) {
    const accepted = new Set([show.nodeId, ...(show.satisfiedByNodeId ? [show.satisfiedByNodeId] : [])]);
    const covered = outputHits.some((hit) => !hit.wire.nodeId || accepted.has(hit.wire.nodeId));
    if (!covered) {
      violations.push(
        `Show "${show.label}" has no result area. Add { "type": "result", "variant": "auto", "wire": { "role": "output", "nodeId": "${show.satisfiedByNodeId ?? show.nodeId}" } }.`
      );
    }
  }

  return { product: violations.length > 0 ? null : working, violations, asksPlaced };
}

// ---------------------------------------------------------------------------
// The engine loop, shared by both routes: call → gate → validate → retry once.
// ---------------------------------------------------------------------------

type ComposerBrain = { providerId: string; model?: string };

type ComposerOutcome =
  | { kind: "composed"; reply: string; product: ProductSpec; asksPlaced: number }
  | { kind: "boundary"; reply: string }
  | { kind: "failed" };

async function runComposerBrain(args: {
  brain: ComposerBrain;
  systemPrompt: string;
  conversationHistory: AIMessage[];
  userMessage: string;
  declarations: WorkflowDeclarations;
  graphNodeIds: Set<string>;
  /** Only the designer chat may answer with a boundary redirect. */
  allowBoundary: boolean;
  task: string;
  workflowId: string;
}): Promise<ComposerOutcome> {
  // Grows only on retry: [ask] -> [ask, bad output, exact violations].
  const messages: AIMessage[] = [{ role: "user", content: args.userMessage }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const request: AIExecuteRequest = {
      capability: "llm",
      systemPrompt: args.systemPrompt,
      conversationHistory: args.conversationHistory,
      messages: [...messages],
      // Interface composition is judgment, not arithmetic — a little warmth
      // writes better labels; the validator holds the correctness line.
      temperature: 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      outputFormat: "json",
      task: args.task,
      ...(args.brain.model ? { model: args.brain.model } : {})
    };

    let response;
    try {
      response = await getProviderEngine().executeWithProvider(args.brain.providerId, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordLlmProviderFailure(args.brain.providerId, message);
      console.error("[smart-composer] LLM call failed", {
        workflowId: args.workflowId,
        provider: args.brain.providerId,
        message
      });
      return { kind: "failed" }; // A transport failure will not be fixed by JSON feedback.
    }

    if (response.status === "error") {
      recordLlmProviderFailure(args.brain.providerId, response.error);
      console.error("[smart-composer] LLM returned error", {
        workflowId: args.workflowId,
        provider: args.brain.providerId,
        error: response.error
      });
      return { kind: "failed" };
    }
    recordLlmProviderSuccess(args.brain.providerId);

    const raw =
      response.structuredOutput && typeof response.structuredOutput === "object" && !Array.isArray(response.structuredOutput)
        ? response.structuredOutput
        : extractComposerJson(response.text);
    const envelope = composerEnvelopeSchema.safeParse(raw);

    let feedback: string;
    if (!envelope.success) {
      feedback = 'No usable JSON found. Output exactly { "reply": string, "product": { ... } }.';
    } else if (args.allowBoundary && envelope.data.boundary === "packaging") {
      // The model recognized a packaging request the regex guardrail missed.
      return { kind: "boundary", reply: envelope.data.reply };
    } else {
      // The one door every spec goes through, then the composer's own gate.
      const clean = sanitizeProductSpec(envelope.data.product);
      if (!clean) {
        feedback =
          'product: nothing in it could be rendered. Return the COMPLETE product: { "version": 1, "pages": [ { "id": "home", "title": …, "path": "", "blocks": [ … ] } ], "nav": { "links": [], "footerLinks": [] } }.';
      } else {
        const check = checkComposition(clean, args.declarations, args.graphNodeIds);
        if (check.product) {
          return {
            kind: "composed",
            reply: envelope.data.reply,
            product: check.product,
            asksPlaced: check.asksPlaced
          };
        }
        feedback = check.violations.join(" ");
      }
    }

    // Single retry: the exact violations go back to the model.
    messages.push(
      { role: "assistant", content: response.text ?? "" },
      {
        role: "user",
        content: `Your previous output was invalid: ${feedback} Respond again with ONLY the corrected JSON object — no markdown fences, and include the COMPLETE product.`
      }
    );
  }

  return { kind: "failed" };
}

// ---------------------------------------------------------------------------
// Shared route plumbing.
// ---------------------------------------------------------------------------

type WorkflowRow = {
  id: string;
  name: string;
  architectUserId: string;
  workflowJson: unknown;
};

type ComposerContext = {
  workflow: WorkflowRow;
  page: PublishedAgentPage;
  agent: ComposerAgentFacts;
  declarations: WorkflowDeclarations;
  graphNodeIds: Set<string>;
  stored: ProductSpec | null;
  /** The product to echo back when nothing changes. */
  unchangedProduct: () => ProductSpec;
};

const TEMPLATES: readonly AgentPageTemplate[] = ["chat", "voice", "media", "form"];

function normalizeTemplate(template: string): AgentPageTemplate {
  return (TEMPLATES as readonly string[]).includes(template) ? (template as AgentPageTemplate) : "chat";
}

/** Every node id in the stored graph — the only wire targets that exist. */
function collectGraphNodeIds(workflowJson: unknown): Set<string> {
  const ids = new Set<string>();
  const graph = (workflowJson ?? {}) as { nodes?: unknown };
  if (!Array.isArray(graph.nodes)) return ids;
  for (const raw of graph.nodes) {
    if (typeof raw !== "object" || raw === null) continue;
    const id = (raw as { id?: unknown }).id;
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

async function loadComposerContext(workflow: WorkflowRow): Promise<ComposerContext> {
  // Draft agents are first-class: no page row yet means we bootstrap the
  // DRAFT listing + page, exactly like the manage GET does.
  let page = await prisma.publishedAgentPage.findFirst({ where: { workflowId: workflow.id } });
  if (!page) {
    page = await ensureDraftAgentListingAndPage({
      id: workflow.id,
      name: workflow.name,
      architectUserId: workflow.architectUserId,
      workflowJson: workflow.workflowJson
    });
  }

  const listing = await prisma.agentListing.findUnique({
    where: { id: page.listingId },
    select: { name: true, tagline: true, shortDescription: true, iconUrl: true }
  });

  const declarations = deriveDeclarations(workflow.workflowJson);
  const stored = getProductSpec(page);
  const agent: ComposerAgentFacts = {
    name: (listing?.name || workflow.name || "Your AI Product").trim(),
    tagline: listing?.tagline ?? null
  };

  const resolvedPage = page;
  return {
    workflow,
    page,
    agent,
    declarations,
    graphNodeIds: collectGraphNodeIds(workflow.workflowJson),
    stored,
    unchangedProduct: () =>
      stored ??
      starterProductSpec({
        template: normalizeTemplate(resolvedPage.template),
        headline: resolvedPage.headline,
        welcomeMessage: resolvedPage.welcomeMessage,
        suggestedPrompts: resolvedPage.suggestedPrompts,
        accentColor: resolvedPage.accentColor,
        listingName: listing?.name ?? workflow.name,
        tagline: listing?.tagline ?? null,
        shortDescription: listing?.shortDescription ?? null,
        iconUrl: listing?.iconUrl ?? null,
        blueprint: deriveFaceBlueprint(workflow.workflowJson),
        design: resolveDesign(resolvedPage.designJson)
      })
  };
}

/** Merged = asks more than one node needs; the number the merge is judged by. */
function mergedCount(declarations: WorkflowDeclarations): number {
  return declarations.asks.filter((ask) => ask.nodeIds.length > 1).length;
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

export function registerSmartDesignerRoutes(routes: Hono) {
  /** THE AI COMPOSER: declarations in, the minimum interface out. */
  routes.post(
    "/manage/:workflowId/smart-compose",
    requireAuth,
    requireRole(["ARCHITECT"]),
    async (c) => {
      const authUser = c.get("authUser");
      // Registered on a plain Hono, param() types as string | undefined; a
      // missing value must read as "no such agent", never as "any agent".
      const workflowId = c.req.param("workflowId") ?? "";

      // Ownership: the same idiom as every other manage route.
      const workflow = await prisma.workflowDefinition.findFirst({
        where: { id: workflowId, architectUserId: authUser.id },
        select: { id: true, name: true, architectUserId: true, workflowJson: true }
      });
      if (!workflow) {
        return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
      }

      const context = await loadComposerContext(workflow);
      const merged = mergedCount(context.declarations);

      // The battery an admin picked for the Smart Designer — never a provider
      // frozen into this file, and never the old designer's battery.
      const brain = resolveBrainSlot(await getSmartDesignerBrainConfig());
      if (!brain) {
        return errorResponse(c, MISSING_LLM_CREDENTIALS_MESSAGE, 503, "LLM_NOT_CONFIGURED");
      }

      const outcome = await runComposerBrain({
        brain,
        systemPrompt: buildComposerSystemPrompt({
          agent: context.agent,
          declarations: context.declarations
        }),
        conversationHistory: [],
        userMessage:
          "Compose the working interface for this agent from its declarations. Remember: one field per ask, every ask present, minimum interface.",
        declarations: context.declarations,
        graphNodeIds: context.graphNodeIds,
        allowBoundary: false,
        task: "agent-page-smart-compose",
        workflowId
      });

      if (outcome.kind !== "composed") {
        // Nothing is written — the architect keeps whatever they had.
        return successResponse(c, {
          reply: SMART_COMPOSER_FALLBACK_REPLY,
          product: context.unchangedProduct(),
          composed: false,
          asksPlaced: 0,
          merged
        });
      }

      let saved: ProductSpec;
      try {
        saved = await saveProductSpec(context.page.id, outcome.product);
      } catch (error) {
        console.error("[smart-composer] could not save product", {
          workflowId,
          message: error instanceof Error ? error.message : String(error)
        });
        return successResponse(c, {
          reply: SMART_COMPOSER_FALLBACK_REPLY,
          product: context.unchangedProduct(),
          composed: false,
          asksPlaced: 0,
          merged
        });
      }

      return successResponse(c, {
        reply: outcome.reply,
        product: saved,
        composed: true,
        asksPlaced: outcome.asksPlaced,
        merged
      });
    }
  );

  /** SMART DESIGNER CHAT: the feedback loop, bounded to the product interface. */
  routes.post(
    "/manage/:workflowId/smart-designer",
    requireAuth,
    requireRole(["ARCHITECT"]),
    async (c) => {
      const authUser = c.get("authUser");
      // Registered on a plain Hono, param() types as string | undefined; a
      // missing value must read as "no such agent", never as "any agent".
      const workflowId = c.req.param("workflowId") ?? "";

      const workflow = await prisma.workflowDefinition.findFirst({
        where: { id: workflowId, architectUserId: authUser.id },
        select: { id: true, name: true, architectUserId: true, workflowJson: true }
      });
      if (!workflow) {
        return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
      }

      let input: z.infer<typeof smartDesignerBodySchema>;
      try {
        input = smartDesignerBodySchema.parse(await c.req.json().catch(() => ({})));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return errorResponse(c, error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
        }
        throw error;
      }

      const context = await loadComposerContext(workflow);

      // The boundary guardrail: packaging asks never reach the model and never
      // touch the page. The prompt teaches the model the same line for
      // phrasings this pattern cannot anticipate.
      if (isPackagingRequest(input.instruction)) {
        return successResponse(c, {
          reply: SMART_DESIGNER_BOUNDARY_REPLY,
          product: context.unchangedProduct(),
          boundary: "packaging"
        });
      }

      const brain = resolveBrainSlot(await getSmartDesignerBrainConfig());
      if (!brain) {
        return errorResponse(c, MISSING_LLM_CREDENTIALS_MESSAGE, 503, "LLM_NOT_CONFIGURED");
      }

      const outcome = await runComposerBrain({
        brain,
        systemPrompt: buildSmartDesignerSystemPrompt({
          agent: context.agent,
          declarations: context.declarations,
          current: context.stored
        }),
        conversationHistory: (input.history ?? []).map((turn) => ({
          role: turn.role,
          content: turn.content
        })),
        userMessage: input.instruction,
        declarations: context.declarations,
        graphNodeIds: context.graphNodeIds,
        allowBoundary: true,
        task: "agent-page-smart-designer",
        workflowId
      });

      if (outcome.kind === "boundary") {
        return successResponse(c, {
          reply: outcome.reply,
          product: context.unchangedProduct(),
          boundary: "packaging"
        });
      }

      if (outcome.kind !== "composed") {
        return successResponse(c, {
          reply: SMART_DESIGNER_FALLBACK_REPLY,
          product: context.unchangedProduct(),
          boundary: null
        });
      }

      let saved: ProductSpec;
      try {
        saved = await saveProductSpec(context.page.id, outcome.product);
      } catch (error) {
        console.error("[smart-designer] could not save product", {
          workflowId,
          message: error instanceof Error ? error.message : String(error)
        });
        return successResponse(c, {
          reply: SMART_DESIGNER_FALLBACK_REPLY,
          product: context.unchangedProduct(),
          boundary: null
        });
      }

      return successResponse(c, { reply: outcome.reply, product: saved, boundary: null });
    }
  );
}
