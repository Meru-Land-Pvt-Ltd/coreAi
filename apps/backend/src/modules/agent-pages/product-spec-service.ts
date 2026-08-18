import { Prisma } from "@prisma/client";
import {
  DEFAULT_ACCENT,
  PRODUCT_SPEC_VERSION,
  defaultProductSpec,
  sanitizeProductSpec,
  slugify,
  type PageSpec,
  type ProductSpec,
  type SpecNode
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { deriveFaceBlueprint, type FaceBlueprint, type FaceBlueprintBlock } from "./blueprint";
import { resolveDesign, type DesignConfig } from "./design";
import type { AgentPageTemplate } from "./slug";

/**
 * Product Spec storage + resolution for published agent pages.
 *
 * The Product Spec is the whole customer-facing product: a multi-page site
 * with the agent working inside it. It lives in PublishedAgentPage.productJson
 * and is ALWAYS read through `getProductSpec` (parse + sanitize), never raw —
 * the column holds whatever a language model wrote months ago.
 *
 * Backward compatibility is mandatory and is handled here, not by a data
 * migration: a page with no productJson still resolves to a complete
 * ProductSpec, synthesized from the older Face Blueprint (the block.* nodes on
 * the architect's canvas). Every agent that renders today keeps rendering
 * after this ships, and an architect's first edit simply writes a real spec.
 */

// ---------------------------------------------------------------------------
// Load / save.
// ---------------------------------------------------------------------------

/** The only field of the page row this reader needs. */
export type ProductSpecRow = { productJson?: unknown } | null | undefined;

/**
 * The stored spec for a page row, sanitized, or null when the page has none
 * (or when nothing in the stored JSON survived sanitizing). Never throws.
 */
export function getProductSpec(pageRow: ProductSpecRow): ProductSpec | null {
  if (!pageRow) return null;
  const raw = pageRow.productJson;
  if (raw === null || raw === undefined) return null;
  // Older rows (and hand-edited ones) can hold a JSON string rather than an
  // object; parse it rather than throwing the architect's work away.
  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  return sanitizeProductSpec(value);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class ProductSpecRejectedError extends Error {
  constructor() {
    super("This design could not be saved. Nothing in it could be rendered.");
    this.name = "ProductSpecRejectedError";
  }
}

/**
 * Sanitizes then persists a spec, returning exactly what was stored so the
 * caller can echo the cleaned version straight back to the builder. Throws
 * `ProductSpecRejectedError` when nothing survives — an empty product is
 * never written over a working one.
 */
export async function saveProductSpec(pageId: string, spec: unknown): Promise<ProductSpec> {
  const clean = sanitizeProductSpec(spec);
  if (!clean) throw new ProductSpecRejectedError();

  await prisma.publishedAgentPage.update({
    where: { id: pageId },
    data: { productJson: clean as unknown as Prisma.InputJsonValue }
  });
  return clean;
}

/** Clears the stored spec — the page falls back to the synthesized one. */
export async function clearProductSpec(pageId: string): Promise<void> {
  await prisma.publishedAgentPage.update({
    where: { id: pageId },
    data: { productJson: Prisma.DbNull }
  });
}

// ---------------------------------------------------------------------------
// Blueprint → ProductSpec (the backward-compatibility path).
// ---------------------------------------------------------------------------

const BLOCK_PROMPT_COMPOSER = "block.prompt_composer";
const BLOCK_PRESET_GALLERY = "block.preset_gallery";
const BLOCK_MODEL_PICKER = "block.model_picker";
const BLOCK_ACTION_BUTTON = "block.action_button";
const BLOCK_OUTPUT_STAGE = "block.output_stage";
const BLOCK_CONTINUE_CHAIN = "block.continue_chain";
const BLOCK_HISTORY_SHELF = "block.history_shelf";

/** Everything the synthesizer knows about the agent. All of it optional. */
export type SynthesisSource = {
  template?: AgentPageTemplate;
  headline?: string | null;
  welcomeMessage?: string | null;
  suggestedPrompts?: string[];
  accentColor?: string | null;
  listingName?: string | null;
  tagline?: string | null;
  shortDescription?: string | null;
  iconUrl?: string | null;
  blueprint?: FaceBlueprint | null;
  design?: DesignConfig | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

/** Titles out of a preset-gallery config; ids out of a model-picker config. */
function optionLabels(value: unknown, key: "title" | "label"): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const label = text((entry as Record<string, unknown>)[key]);
    if (label) labels.push(label);
  }
  return labels;
}

function resultVariantFor(kind: unknown): "auto" | "text" | "gallery" {
  switch (text(kind)) {
    case "image":
    case "video":
      return "gallery";
    case "text":
      return "text";
    default:
      return "auto";
  }
}

/**
 * One canvas block → one spec node, wired to that same canvas node. Returns
 * null for a block type this version does not paint, so an unknown future
 * block never breaks an old page.
 */
function nodeForBlock(block: FaceBlueprintBlock, id: string): SpecNode | null {
  const nodeId = block.nodeId;
  const config = block.config;

  switch (block.type) {
    case BLOCK_PROMPT_COMPOSER:
      return {
        id,
        type: "input",
        label: "What do you need?",
        placeholder: text(config.placeholder) || "Tell it what you need…",
        multiline: true,
        wire: { role: "input", nodeId }
      };
    case BLOCK_PRESET_GALLERY: {
      const options = optionLabels(config.presets, "title");
      if (options.length === 0) return null;
      return { id, type: "choice", label: "Start from a preset", options, wire: { role: "input", nodeId } };
    }
    case BLOCK_MODEL_PICKER: {
      const options = optionLabels(config.options, "label");
      if (options.length === 0) return null;
      return { id, type: "choice", label: "Model", options, wire: { role: "input", nodeId } };
    }
    case BLOCK_ACTION_BUTTON:
      return {
        id,
        type: "button",
        label: text(config.label) || "Go",
        variant: "primary",
        size: "lg",
        wire: { role: "action", nodeId }
      };
    case BLOCK_CONTINUE_CHAIN:
      return {
        id,
        type: "button",
        label: text(config.label) || "Continue",
        variant: "secondary",
        wire: { role: "action", nodeId }
      };
    case BLOCK_OUTPUT_STAGE:
      return { id, type: "result", variant: resultVariantFor(config.kind), wire: { role: "output", nodeId } };
    case BLOCK_HISTORY_SHELF:
      return { id, type: "history", wire: { role: "output", nodeId } };
    default:
      return null;
  }
}

/** Stable, unique, slug-safe spec id for a canvas block. */
function specIdForBlock(block: FaceBlueprintBlock, index: number, used: Set<string>): string {
  const base = `blk-${slugify(block.nodeId, 40) || String(index + 1)}`;
  let id = base;
  let suffix = index + 1;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

/**
 * The product surface when the agent has no canvas blocks at all: the classic
 * per-template face (type → run → result), so a page published before product
 * blocks existed still gets a real, working product.
 */
function fallbackProductNodes(source: SynthesisSource): SpecNode[] {
  const template = source.template ?? "chat";
  const prompts = (source.suggestedPrompts ?? []).map((prompt) => text(prompt)).filter(Boolean);
  const nodes: SpecNode[] = [];

  if (prompts.length > 0) {
    nodes.push({
      id: "product-presets",
      type: "choice",
      label: "Try one of these",
      options: prompts.slice(0, 4),
      wire: { role: "input" }
    });
  }

  if (template === "voice") {
    nodes.push({
      id: "product-run",
      type: "button",
      label: "Start the call",
      variant: "primary",
      size: "lg",
      wire: { role: "action" }
    });
    nodes.push({ id: "product-result", type: "result", variant: "auto", wire: { role: "output" } });
    return nodes;
  }

  nodes.push({
    id: "product-input",
    type: "input",
    label: "What do you need?",
    placeholder: "Tell it what you need…",
    multiline: true,
    wire: { role: "input" }
  });
  nodes.push({
    id: "product-run",
    type: "button",
    label: template === "media" ? "Generate" : "Send",
    variant: "primary",
    size: "lg",
    wire: { role: "action" }
  });
  nodes.push({
    id: "product-result",
    type: "result",
    variant: template === "media" ? "gallery" : "auto",
    wire: { role: "output" }
  });
  return nodes;
}

/** Consecutive buttons sit side by side; everything else stacks. */
function groupProductNodes(nodes: SpecNode[]): SpecNode[] {
  const grouped: SpecNode[] = [];
  let run: SpecNode[] = [];
  let rowIndex = 0;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      grouped.push(run[0]);
    } else {
      rowIndex += 1;
      grouped.push({ id: `product-actions-${rowIndex}`, type: "row", gap: "sm", align: "start", children: run });
    }
    run = [];
  };

  for (const node of nodes) {
    if (node.type === "button") {
      run.push(node);
      continue;
    }
    flush();
    grouped.push(node);
  }
  flush();
  return grouped;
}

/**
 * A complete one-page ProductSpec for an agent that has no stored spec: hero,
 * the working agent, and the architect's own description. Every interactive
 * node is wired to the same canvas node the old Face Blueprint drove, so the
 * page behaves exactly as it did before the Product Spec existed.
 */
export function productSpecFromBlueprint(source: SynthesisSource): ProductSpec {
  // Built here, but still driven through the same door every stored spec goes
  // through: the listing name, icon URL and welcome copy are architect-typed,
  // so nothing reaches the renderer unsanitized.
  const synthesized = buildBlueprintSpec(source);
  return (
    sanitizeProductSpec(synthesized) ??
    defaultProductSpec({
      name: source.listingName,
      tagline: source.tagline,
      description: source.shortDescription,
      accent: source.accentColor,
      mode: source.design?.theme
    })
  );
}

function buildBlueprintSpec(source: SynthesisSource): ProductSpec {
  const name = text(source.listingName) || "AI Agent";
  const headline = text(source.headline) || name;
  const sub = text(source.welcomeMessage) || text(source.tagline) || text(source.shortDescription);
  const accent = /^#[0-9a-fA-F]{6}$/.test(text(source.accentColor)) ? text(source.accentColor).toLowerCase() : DEFAULT_ACCENT;

  const heroChildren: SpecNode[] = [];
  const iconUrl = text(source.iconUrl);
  if (iconUrl) {
    heroChildren.push({ id: "hero-icon", type: "image", url: iconUrl, alt: name, ratio: "square", rounded: true });
  }
  heroChildren.push({ id: "hero-title", type: "heading", level: 1, text: headline, align: "center" });
  if (sub) {
    heroChildren.push({
      id: "hero-sub",
      type: "text",
      text: sub,
      size: "lg",
      align: "center",
      style: { textTone: "muted", maxWidth: "md" }
    });
  }

  const blocks = source.blueprint?.blocks ?? [];
  const used = new Set<string>();
  const productNodes: SpecNode[] = [];
  for (const [index, block] of blocks.entries()) {
    const node = nodeForBlock(block, specIdForBlock(block, index, used));
    if (node) productNodes.push(node);
  }
  const surface = productNodes.length > 0 ? productNodes : fallbackProductNodes(source);

  const pageBlocks: SpecNode[] = [
    { id: "hero", type: "section", padding: "xl", background: "gradient", children: [
      { id: "hero-stack", type: "stack", gap: "md", align: "center", children: heroChildren }
    ] },
    { id: "product", type: "section", padding: "lg", background: "plain", children: [
      { id: "product-stack", type: "stack", gap: "md", children: groupProductNodes(surface) }
    ] }
  ];

  const description = text(source.shortDescription);
  // Only worth its own section when it actually says something new.
  if (description && description !== sub) {
    pageBlocks.push({
      id: "about",
      type: "section",
      padding: "lg",
      background: "tint",
      children: [
        { id: "about-stack", type: "stack", gap: "sm", align: "center", children: [
          { id: "about-title", type: "heading", level: 2, text: "About this agent", align: "center" },
          { id: "about-text", type: "text", text: description, align: "center", style: { textTone: "muted", maxWidth: "md" } }
        ] }
      ]
    });
  }

  const home: PageSpec = {
    id: "home",
    title: name,
    path: "",
    blocks: pageBlocks
  };
  if (sub) home.seo = { description: sub };

  const mode = source.design?.theme ?? "light";

  return {
    version: PRODUCT_SPEC_VERSION,
    pages: [home],
    nav: {
      brand: iconUrl ? { text: name, logoUrl: iconUrl } : { text: name },
      links: [{ label: "Home", pageId: "home" }],
      footerLinks: [],
      footerNote: `© ${new Date().getFullYear()} ${name}`
    },
    theme: { accent, mode, font: "sans" }
  };
}

// ---------------------------------------------------------------------------
// Public resolution.
// ---------------------------------------------------------------------------

export type PublicProductPage = {
  slug: string;
  template: AgentPageTemplate;
  headline: string | null;
  welcomeMessage: string | null;
  suggestedPrompts: string[];
  accentColor: string | null;
  status: "LIVE";
};

export type PublicProductListing = {
  id: string;
  name: string;
  tagline: string | null;
  shortDescription: string;
  iconUrl: string | null;
  category: string | null;
  pricingModel: string;
  priceCents: number;
  freeTrialEnabled: boolean;
  trialDays: number;
};

export type PublicProductArchitect = { displayName: string; photoUrl: string | null };

export type ResolvedPublicProduct = {
  slug: string;
  workflowId: string;
  /** Always a complete, sanitized spec — never null for a live page. */
  product: ProductSpec;
  /** "spec" = the architect's stored design. "blueprint" = synthesized. */
  source: "spec" | "blueprint";
  page: PublicProductPage;
  listing: PublicProductListing;
  architect: PublicProductArchitect | null;
  /** Design Brain dials — the old renderer still needs them. */
  design: DesignConfig;
  /** The Face Blueprint, so blueprint-era callers keep working unchanged. */
  blueprint: FaceBlueprint | null;
};

const PUBLIC_LISTING_SELECT = {
  id: true,
  name: true,
  tagline: true,
  shortDescription: true,
  iconUrl: true,
  category: true,
  pricingModel: true,
  priceCents: true,
  freeTrialEnabled: true,
  trialDays: true,
  status: true,
  architect: {
    select: {
      fullName: true,
      architectProfile: { select: { displayName: true, marketplacePhotoUrl: true } }
    }
  }
} as const;

const TEMPLATES: readonly AgentPageTemplate[] = ["chat", "voice", "media", "form"];

function normalizeTemplate(template: string): AgentPageTemplate {
  return (TEMPLATES as readonly string[]).includes(template) ? (template as AgentPageTemplate) : "chat";
}

/**
 * Everything a public /a/<slug> render needs, in one read: the product itself
 * plus the listing, the architect and the blueprint-era payloads the existing
 * page still consumes.
 *
 * Returns null unless the page is LIVE and its listing APPROVED — an
 * unpublished agent must be indistinguishable from a missing one.
 *
 * `product` is NEVER null for a resolvable page. When no spec is stored (or
 * the stored one is unsalvageable) it is synthesized from the Face Blueprint,
 * which is what makes this ship without a data migration.
 */
export async function resolveProductForPublic(slug: string): Promise<ResolvedPublicProduct | null> {
  const page = await prisma.publishedAgentPage.findUnique({
    where: { slug },
    include: { listing: { select: PUBLIC_LISTING_SELECT } }
  });

  if (!page || page.status !== "LIVE" || page.listing?.status !== "APPROVED") return null;

  const workflow = await prisma.workflowDefinition.findUnique({
    where: { id: page.workflowId },
    select: { workflowJson: true }
  });

  const blueprint = workflow ? deriveFaceBlueprint(workflow.workflowJson) : null;
  const design = resolveDesign(page.designJson);
  const listing = page.listing;

  const pagePayload: PublicProductPage = {
    slug: page.slug,
    template: normalizeTemplate(page.template),
    headline: page.headline,
    welcomeMessage: page.welcomeMessage,
    suggestedPrompts: stringList(page.suggestedPrompts),
    accentColor: page.accentColor,
    status: "LIVE"
  };

  const stored = getProductSpec(page);
  const product =
    stored ??
    productSpecFromBlueprint({
      template: pagePayload.template,
      headline: page.headline,
      welcomeMessage: page.welcomeMessage,
      suggestedPrompts: pagePayload.suggestedPrompts,
      accentColor: page.accentColor,
      listingName: listing.name,
      tagline: listing.tagline,
      shortDescription: listing.shortDescription,
      iconUrl: listing.iconUrl,
      blueprint,
      design
    });

  const displayName =
    listing.architect?.architectProfile?.displayName?.trim() || listing.architect?.fullName?.trim() || "";

  return {
    slug: page.slug,
    workflowId: page.workflowId,
    product,
    source: stored ? "spec" : "blueprint",
    page: pagePayload,
    listing: {
      id: listing.id,
      name: listing.name,
      tagline: listing.tagline,
      shortDescription: listing.shortDescription,
      iconUrl: listing.iconUrl,
      category: listing.category,
      pricingModel: String(listing.pricingModel),
      priceCents: listing.priceCents,
      freeTrialEnabled: listing.freeTrialEnabled,
      trialDays: listing.trialDays
    },
    architect: displayName
      ? { displayName, photoUrl: listing.architect?.architectProfile?.marketplacePhotoUrl ?? null }
      : null,
    design,
    blueprint
  };
}

/**
 * The starter spec for an agent that has none yet — used when the architect
 * opens the product designer for the first time. Prefers the agent's real
 * canvas blocks (so the wires are already correct) and falls back to the
 * generic starter when there is nothing to read.
 */
export function starterProductSpec(source: SynthesisSource): ProductSpec {
  if (source.blueprint && source.blueprint.blocks.length > 0) {
    return productSpecFromBlueprint(source);
  }
  if (text(source.listingName) || text(source.headline)) {
    return productSpecFromBlueprint(source);
  }
  return defaultProductSpec({
    name: source.listingName,
    tagline: source.tagline,
    description: source.shortDescription,
    accent: source.accentColor,
    mode: source.design?.theme
  });
}
