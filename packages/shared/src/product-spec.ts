import { z } from "zod";

/**
 * Product Spec — the ONE contract between the AI architect and the renderer.
 *
 * Doctrine: "The AI writes the design freely; our renderer paints it; the
 * wires live in named slots." The AI never writes code. It emits this JSON
 * blueprint and nothing else. The renderer paints every node from a fixed
 * token set, so a spec can be creative but can never be broken or ugly:
 *
 *   - A node WITHOUT a `wire` is decoration (hero, copy, image, stat, list).
 *   - A node WITH a `wire` is a socket into the agent's workflow graph:
 *       role "input"  → the customer's value is fed into that graph node
 *       role "action" → running it runs the chain that node belongs to
 *       role "output" → that graph node's result is rendered here
 *
 * Everything that arrives here originates from a language model or from an
 * old stored row, so NOTHING is trusted. `sanitizeProductSpec` salvages what
 * it can node-by-node (a corrupt hero never costs you the pricing page) and
 * enforces hard caps: 12 pages, 120 nodes per page, 8 levels of nesting.
 *
 * Storage: PublishedAgentPage.productJson. Absent = the page still renders,
 * synthesized from the older Face Blueprint (see the backend service).
 */

export const PRODUCT_SPEC_VERSION = 1 as const;

/** Hard limits. Exported so the builder UI can warn before the cap bites. */
export const PRODUCT_SPEC_LIMITS = {
  maxPages: 12,
  maxNodesPerPage: 120,
  maxDepth: 8,
  maxNavLinks: 8,
  maxFooterLinks: 12,
  maxListItems: 12,
  maxChoiceOptions: 12
} as const;

// ---------------------------------------------------------------------------
// Wires — the only bridge between a painted element and the agent's graph.
// ---------------------------------------------------------------------------

export const WIRE_ROLES = ["input", "action", "output"] as const;
export type WireRole = (typeof WIRE_ROLES)[number];

/**
 * `nodeId` points at a node in the agent's workflow graph (the same id the
 * canvas uses). It is optional: a wire without a nodeId means "the agent's
 * main chain", which is what a one-brain agent wants and what the AI writes
 * when it does not know the graph yet.
 */
export type Wire = { role: WireRole; nodeId?: string };

// ---------------------------------------------------------------------------
// Style tokens — a SMALL closed set. Never raw CSS, never a color string.
// ---------------------------------------------------------------------------

export type SpecAlign = "left" | "center" | "right";
export type SpecMaxWidth = "sm" | "md" | "lg" | "full";
export type SpecTextTone = "default" | "muted" | "accent" | "inverse";
export type SpecBgTone = "none" | "tint" | "accent" | "dark";

export type SpecStyle = {
  align?: SpecAlign;
  maxWidth?: SpecMaxWidth;
  textTone?: SpecTextTone;
  bgTone?: SpecBgTone;
};

export type SpecPadding = "sm" | "md" | "lg" | "xl";
export type SpecGap = "sm" | "md" | "lg";
export type SpecSize = "sm" | "md" | "lg";
export type SpecColumns = 2 | 3 | 4;
export type SectionBackground = "plain" | "tint" | "gradient" | "dark";
export type FlexAlign = "start" | "center" | "end" | "between";

// ---------------------------------------------------------------------------
// Nodes.
// ---------------------------------------------------------------------------

type NodeBase = { id: string; style?: SpecStyle };

/** Layout. */
export type SectionNode = NodeBase & {
  type: "section";
  padding?: SpecPadding;
  background?: SectionBackground;
  children: SpecNode[];
};
export type StackNode = NodeBase & {
  type: "stack";
  gap?: SpecGap;
  align?: FlexAlign;
  children: SpecNode[];
};
export type GridNode = NodeBase & {
  type: "grid";
  columns?: SpecColumns;
  gap?: SpecGap;
  children: SpecNode[];
};
export type RowNode = NodeBase & {
  type: "row";
  gap?: SpecGap;
  align?: FlexAlign;
  children: SpecNode[];
};

/** Content. */
export type HeadingNode = NodeBase & {
  type: "heading";
  text: string;
  level?: 1 | 2 | 3;
  align?: SpecAlign;
};
export type TextNode = NodeBase & {
  type: "text";
  text: string;
  size?: SpecSize;
  align?: SpecAlign;
};
export type ImageNode = NodeBase & {
  type: "image";
  url: string;
  alt: string;
  ratio?: "square" | "wide" | "tall" | "auto";
  rounded?: boolean;
};
export type IconNode = NodeBase & { type: "icon"; name: string; size?: SpecSize };
export type BadgeNode = NodeBase & {
  type: "badge";
  text: string;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
};
export type DividerNode = NodeBase & { type: "divider" };
export type SpacerNode = NodeBase & { type: "spacer"; size?: SpecPadding };
/**
 * `listStyle` is the bullet form. The AI-facing contract calls it `style`
 * (`{type:"list", items, style:"check"}`) — that collides with the universal
 * `style` token bag every node carries, so the parser accepts BOTH: a string
 * `style` is normalized into `listStyle`, an object `style` stays the token
 * bag. The renderer only ever reads `listStyle`, never a string `style`.
 */
export type ListNode = NodeBase & {
  type: "list";
  items: string[];
  listStyle?: "check" | "bullet" | "number";
};
export type QuoteNode = NodeBase & {
  type: "quote";
  text: string;
  author?: string;
  role?: string;
};
export type StatNode = NodeBase & {
  type: "stat";
  label: string;
  value: string;
  delta?: string;
};

/**
 * Interactive — the only nodes a customer touches.
 *
 * `variant` is the button's look. Same collision as `list.listStyle`: the
 * AI-facing contract writes `style:"primary"`, which the parser normalizes
 * into `variant` so the universal `style` token bag keeps its meaning.
 */
export type ButtonNode = NodeBase & {
  type: "button";
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: SpecSize;
  wire?: Wire;
  href?: string;
};
export type InputNode = NodeBase & {
  type: "input";
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  wire?: Wire;
};
export type UploadNode = NodeBase & {
  type: "upload";
  label?: string;
  accept?: string;
  wire?: Wire;
};
export type ChoiceNode = NodeBase & {
  type: "choice";
  label?: string;
  options: string[];
  wire?: Wire;
};

/** Output — where the agent's answer lands. */
export type ResultNode = NodeBase & {
  type: "result";
  variant?: "auto" | "text" | "cards" | "chart" | "table" | "gallery";
  wire?: Wire;
};
export type HistoryNode = NodeBase & { type: "history"; wire?: Wire };

export type SpecNode =
  | SectionNode
  | StackNode
  | GridNode
  | RowNode
  | HeadingNode
  | TextNode
  | ImageNode
  | IconNode
  | BadgeNode
  | DividerNode
  | SpacerNode
  | ListNode
  | QuoteNode
  | StatNode
  | ButtonNode
  | InputNode
  | UploadNode
  | ChoiceNode
  | ResultNode
  | HistoryNode;

export type SpecNodeType = SpecNode["type"];

export type ContainerNode = SectionNode | StackNode | GridNode | RowNode;

export const CONTAINER_NODE_TYPES: readonly SpecNodeType[] = ["section", "stack", "grid", "row"];

/** Node types that may carry a wire. Everything else is decoration. */
export const WIRABLE_NODE_TYPES: readonly SpecNodeType[] = [
  "button",
  "input",
  "upload",
  "choice",
  "result",
  "history"
];

export function isContainerNode(node: SpecNode): node is ContainerNode {
  return (CONTAINER_NODE_TYPES as readonly string[]).includes(node.type);
}

// ---------------------------------------------------------------------------
// Pages, nav, theme, spec.
// ---------------------------------------------------------------------------

export type PageSeo = { description?: string; ogImageUrl?: string };

export type PageSpec = {
  /** Slug-safe, unique in the spec. "home" is required and always exists. */
  id: string;
  title: string;
  /** "" for home, else a slug: "pricing" | "about" | "privacy" | ... */
  path: string;
  seo?: PageSeo;
  blocks: SpecNode[];
};

export type NavLink = { label: string; pageId: string };

export type ProductNav = {
  brand?: { text?: string; logoUrl?: string };
  links: NavLink[];
  footerLinks: NavLink[];
  footerNote?: string;
};

export type ProductTheme = {
  /** #rrggbb. The architect's accent; the amber brand is the default. */
  accent?: string;
  mode?: "light" | "dark" | "warm";
  font?: "sans" | "serif" | "mono";
};

export type ProductSpec = {
  version: 1;
  pages: PageSpec[];
  nav: ProductNav;
  theme?: ProductTheme;
};

/** Triven brand amber — the accent every spec falls back to. */
export const DEFAULT_ACCENT = "#f59e0b";

// ---------------------------------------------------------------------------
// Field helpers (shared by the strict schema and the salvaging sanitizer, so
// the two can never drift on caps or cleaning rules).
// ---------------------------------------------------------------------------

// Control characters are stripped everywhere: they are invisible in the
// builder but can break the rendered page.
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

const TEXT_CAPS = {
  id: 80,
  heading: 160,
  text: 2000,
  quote: 600,
  short: 80,
  label: 60,
  alt: 200,
  iconName: 40,
  listItem: 200,
  option: 80,
  placeholder: 160,
  accept: 120,
  title: 120,
  seoDescription: 300,
  footerNote: 300,
  url: 2048,
  nodeId: 200
} as const;

function cleanString(value: string, max: number): string {
  return value.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

/** Required text: cleaned, capped, must survive as non-empty. */
const requiredText = (max: number) =>
  z
    .string()
    .transform((value) => cleanString(value, max))
    .refine((value) => value.length > 0);

/** Optional text: anything unusable simply disappears (never fails a node). */
const optionalText = (max: number) => requiredText(max).optional().catch(undefined);

/** Optional enum: an unknown token disappears and the renderer's default wins. */
const optionalEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .enum(values as unknown as [T, ...T[]])
    .optional()
    .catch(undefined);

const optionalBool = z.boolean().optional().catch(undefined);

/**
 * Link safety. AI-authored URLs are untrusted, so only absolute http(s) and
 * site-relative paths survive — `javascript:`, `data:` and protocol-relative
 * `//host` are dropped, which closes the obvious injection door in an <a> or
 * an <img src>. `mailto:` and in-page anchors are additionally allowed for
 * button hrefs.
 */
function cleanUrl(value: string, opts?: { allowMailto?: boolean; allowAnchor?: boolean }): string {
  const raw = cleanString(value, TEXT_CAPS.url);
  if (!raw) return "";
  if (/^https?:\/\/[^\s]+$/i.test(raw)) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (opts?.allowMailto && /^mailto:[^\s]+@[^\s]+$/i.test(raw)) return raw;
  if (opts?.allowAnchor && /^#[A-Za-z0-9_-]+$/.test(raw)) return raw;
  return "";
}

const urlText = (opts?: { allowMailto?: boolean; allowAnchor?: boolean }) =>
  z
    .string()
    .transform((value) => cleanUrl(value, opts))
    .refine((value) => value.length > 0)
    .optional()
    .catch(undefined);

const stringListSchema = (max: number, itemCap: number) =>
  z
    .array(z.unknown())
    .transform((items) => {
      const out: string[] = [];
      for (const item of items) {
        if (out.length >= max) break;
        if (typeof item !== "string") continue;
        const clean = cleanString(item, itemCap);
        if (clean) out.push(clean);
      }
      return out;
    })
    .refine((items) => items.length > 0);

export const wireSchema: z.ZodType<Wire> = z
  .object({
    role: z.enum(WIRE_ROLES),
    nodeId: requiredText(TEXT_CAPS.nodeId).optional().catch(undefined)
  })
  .transform((wire) => (wire.nodeId ? { role: wire.role, nodeId: wire.nodeId } : { role: wire.role }));

const optionalWire = wireSchema.optional().catch(undefined);

export const specStyleSchema = z
  .object({
    align: optionalEnum(["left", "center", "right"]),
    maxWidth: optionalEnum(["sm", "md", "lg", "full"]),
    textTone: optionalEnum(["default", "muted", "accent", "inverse"]),
    bgTone: optionalEnum(["none", "tint", "accent", "dark"])
  })
  .optional()
  .catch(undefined);

const nodeBaseShape = {
  id: z.string().min(1).max(TEXT_CAPS.id),
  style: specStyleSchema
};

// ---------------------------------------------------------------------------
// Per-node schemas. Containers are declared "shallow" (no children) so the
// sanitizer can validate a node's own fields before it decides how deep to
// recurse; the strict recursive schema re-adds `children` on top.
// ---------------------------------------------------------------------------

const shallowSection = z.object({
  ...nodeBaseShape,
  type: z.literal("section"),
  padding: optionalEnum(["sm", "md", "lg", "xl"]),
  background: optionalEnum(["plain", "tint", "gradient", "dark"])
});
const shallowStack = z.object({
  ...nodeBaseShape,
  type: z.literal("stack"),
  gap: optionalEnum(["sm", "md", "lg"]),
  align: optionalEnum(["start", "center", "end", "between"])
});
const shallowGrid = z.object({
  ...nodeBaseShape,
  type: z.literal("grid"),
  columns: z
    .union([z.literal(2), z.literal(3), z.literal(4)])
    .optional()
    .catch(undefined),
  gap: optionalEnum(["sm", "md", "lg"])
});
const shallowRow = z.object({
  ...nodeBaseShape,
  type: z.literal("row"),
  gap: optionalEnum(["sm", "md", "lg"]),
  align: optionalEnum(["start", "center", "end", "between"])
});

const headingNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("heading"),
  text: requiredText(TEXT_CAPS.heading),
  level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .catch(undefined),
  align: optionalEnum(["left", "center", "right"])
});
const textNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("text"),
  text: requiredText(TEXT_CAPS.text),
  size: optionalEnum(["sm", "md", "lg"]),
  align: optionalEnum(["left", "center", "right"])
});
const imageNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("image"),
  url: z
    .string()
    .transform((value) => cleanUrl(value))
    .refine((value) => value.length > 0),
  // Accessibility is not optional at the $100B bar: an image with no
  // description still renders, with an empty alt marking it decorative.
  alt: z
    .string()
    .transform((value) => cleanString(value, TEXT_CAPS.alt))
    .catch(""),
  ratio: optionalEnum(["square", "wide", "tall", "auto"]),
  rounded: optionalBool
});
const iconNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("icon"),
  name: requiredText(TEXT_CAPS.iconName),
  size: optionalEnum(["sm", "md", "lg"])
});
const badgeNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("badge"),
  text: requiredText(TEXT_CAPS.short),
  tone: optionalEnum(["neutral", "accent", "success", "warning", "danger"])
});
const dividerNodeSchema = z.object({ ...nodeBaseShape, type: z.literal("divider") });
const spacerNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("spacer"),
  size: optionalEnum(["sm", "md", "lg", "xl"])
});
const listNodeObject = z.object({
  ...nodeBaseShape,
  type: z.literal("list"),
  items: stringListSchema(PRODUCT_SPEC_LIMITS.maxListItems, TEXT_CAPS.listItem),
  listStyle: optionalEnum(["check", "bullet", "number"])
});
const listNodeSchema = z.preprocess(liftStringStyle("listStyle"), listNodeObject);
const quoteNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("quote"),
  text: requiredText(TEXT_CAPS.quote),
  author: optionalText(TEXT_CAPS.short),
  role: optionalText(TEXT_CAPS.short)
});
const statNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("stat"),
  label: requiredText(TEXT_CAPS.short),
  value: requiredText(TEXT_CAPS.short),
  delta: optionalText(TEXT_CAPS.short)
});

/**
 * Moves a STRING `style` (the AI-facing spelling) onto its canonical key.
 * An object `style` — the universal token bag — is left exactly where it is.
 * Runs before validation on `button` and `list` only.
 */
function liftStringStyle(canonicalKey: "variant" | "listStyle") {
  return (raw: unknown): unknown => {
    const record = asRecord(raw);
    if (!record || typeof record.style !== "string") return raw;
    const { style, ...rest } = record;
    return { ...rest, [canonicalKey]: rest[canonicalKey] ?? style };
  };
}

const buttonNodeObject = z.object({
  ...nodeBaseShape,
  type: z.literal("button"),
  label: requiredText(TEXT_CAPS.label),
  variant: optionalEnum(["primary", "secondary", "ghost"]),
  size: optionalEnum(["sm", "md", "lg"]),
  wire: optionalWire,
  href: urlText({ allowMailto: true, allowAnchor: true })
});
const buttonNodeSchema = z.preprocess(liftStringStyle("variant"), buttonNodeObject);
const inputNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("input"),
  placeholder: optionalText(TEXT_CAPS.placeholder),
  label: optionalText(TEXT_CAPS.label),
  multiline: optionalBool,
  wire: optionalWire
});
const uploadNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("upload"),
  label: optionalText(TEXT_CAPS.label),
  accept: optionalText(TEXT_CAPS.accept),
  wire: optionalWire
});
const choiceNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("choice"),
  label: optionalText(TEXT_CAPS.label),
  options: stringListSchema(PRODUCT_SPEC_LIMITS.maxChoiceOptions, TEXT_CAPS.option),
  wire: optionalWire
});

const resultNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("result"),
  variant: optionalEnum(["auto", "text", "cards", "chart", "table", "gallery"]),
  wire: optionalWire
});
const historyNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal("history"),
  wire: optionalWire
});

/** Leaf schemas by type — the sanitizer's lookup table. */
const LEAF_NODE_SCHEMAS = {
  heading: headingNodeSchema,
  text: textNodeSchema,
  image: imageNodeSchema,
  icon: iconNodeSchema,
  badge: badgeNodeSchema,
  divider: dividerNodeSchema,
  spacer: spacerNodeSchema,
  list: listNodeSchema,
  quote: quoteNodeSchema,
  stat: statNodeSchema,
  button: buttonNodeSchema,
  input: inputNodeSchema,
  upload: uploadNodeSchema,
  choice: choiceNodeSchema,
  result: resultNodeSchema,
  history: historyNodeSchema
} as const;

const SHALLOW_CONTAINER_SCHEMAS = {
  section: shallowSection,
  stack: shallowStack,
  grid: shallowGrid,
  row: shallowRow
} as const;

const childrenField = z.array(z.lazy((): z.ZodType<SpecNode> => specNodeSchema));

/**
 * The strict recursive node schema. Use it to VALIDATE (an API body, a test);
 * use `sanitizeProductSpec` to SALVAGE (anything a model wrote, anything the
 * database already holds).
 */
export const specNodeSchema: z.ZodType<SpecNode> = z.lazy(() =>
  // A plain union rather than a discriminated one: `button` and `list` are
  // preprocessed (see liftStringStyle) and so are pipes, not bare objects.
  // The `type` literals are disjoint, so at most one member can ever match.
  z.union([
    shallowSection.extend({ children: childrenField }),
    shallowStack.extend({ children: childrenField }),
    shallowGrid.extend({ children: childrenField }),
    shallowRow.extend({ children: childrenField }),
    headingNodeSchema,
    textNodeSchema,
    imageNodeSchema,
    iconNodeSchema,
    badgeNodeSchema,
    dividerNodeSchema,
    spacerNodeSchema,
    listNodeSchema,
    quoteNodeSchema,
    statNodeSchema,
    buttonNodeSchema,
    inputNodeSchema,
    uploadNodeSchema,
    choiceNodeSchema,
    resultNodeSchema,
    historyNodeSchema
  ])
);

export const pageSeoSchema = z
  .object({
    description: optionalText(TEXT_CAPS.seoDescription),
    ogImageUrl: urlText()
  })
  .optional()
  .catch(undefined);

export const pageSpecSchema: z.ZodType<PageSpec> = z.object({
  id: z.string().min(1).max(TEXT_CAPS.id),
  title: requiredText(TEXT_CAPS.title),
  path: z.string().max(TEXT_CAPS.id),
  seo: pageSeoSchema,
  blocks: z.array(specNodeSchema)
});

export const navLinkSchema: z.ZodType<NavLink> = z.object({
  label: requiredText(TEXT_CAPS.short),
  pageId: z.string().min(1).max(TEXT_CAPS.id)
});

export const productNavSchema: z.ZodType<ProductNav> = z.object({
  brand: z
    .object({ text: optionalText(TEXT_CAPS.short), logoUrl: urlText() })
    .optional()
    .catch(undefined),
  links: z.array(navLinkSchema),
  footerLinks: z.array(navLinkSchema),
  footerNote: optionalText(TEXT_CAPS.footerNote)
});

const hexColorSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => /^#[0-9a-f]{6}$/.test(value))
  .optional()
  .catch(undefined);

export const productThemeSchema = z
  .object({
    accent: hexColorSchema,
    mode: optionalEnum(["light", "dark", "warm"]),
    font: optionalEnum(["sans", "serif", "mono"])
  })
  .optional()
  .catch(undefined);

/** Strict whole-spec schema. `sanitizeProductSpec` is the tolerant door. */
export const productSpecSchema: z.ZodType<ProductSpec> = z.object({
  version: z.literal(1),
  pages: z
    .array(pageSpecSchema)
    .min(1)
    .max(PRODUCT_SPEC_LIMITS.maxPages)
    // Every site needs a front door: "home" is the one required page id.
    .refine((pages) => pages.some((page) => page.id === "home")),
  nav: productNavSchema,
  theme: productThemeSchema
});

// ---------------------------------------------------------------------------
// Sanitizer — the tolerant door every stored/AI-authored spec goes through.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Lowercase, dash-joined, safe for a URL segment and for a DOM id. */
export function slugify(value: string, max = 40): string {
  return cleanString(value, max * 3)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/**
 * zod keeps a key whose value caught to `undefined`, so a node written with
 * `align: "diagonal"` comes back as `{ align: undefined }` and an all-invalid
 * `style` comes back as an empty-ish object. Both are noise the renderer would
 * have to defend against, and both make stored JSON differ from an equivalent
 * hand-built spec. This drops them: undefined values, and objects left empty
 * once their undefined values are gone. Arrays (children, items) pass through.
 */
function compact<T>(value: T): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const nested = compact(entry as Record<string, unknown>);
      if (Object.keys(nested).length === 0) continue;
      out[key] = nested;
      continue;
    }
    out[key] = entry;
  }
  return out as T;
}

type PageContext = {
  pageId: string;
  ids: Set<string>;
  autoCounter: number;
  /** Nodes still allowed on this page. */
  budget: number;
};

/**
 * A node's final id: the author's when it is usable and unclaimed, otherwise
 * a deterministic generated one. Ids are never dropped — the renderer keys
 * and the data-testids depend on every node having one.
 */
function takeNodeId(raw: unknown, ctx: PageContext): string {
  if (typeof raw === "string") {
    const candidate = cleanString(raw, TEXT_CAPS.id)
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (candidate && !ctx.ids.has(candidate)) {
      ctx.ids.add(candidate);
      return candidate;
    }
  }
  let generated: string;
  do {
    ctx.autoCounter += 1;
    generated = `${ctx.pageId}-n${ctx.autoCounter}`;
  } while (ctx.ids.has(generated));
  ctx.ids.add(generated);
  return generated;
}

function sanitizeNode(raw: unknown, ctx: PageContext, depth: number): SpecNode | null {
  if (depth > PRODUCT_SPEC_LIMITS.maxDepth) return null;
  if (ctx.budget <= 0) return null;

  const record = asRecord(raw);
  if (!record) return null;
  const type = typeof record.type === "string" ? record.type : null;
  if (!type) return null;

  const isContainer = type in SHALLOW_CONTAINER_SCHEMAS;
  const schema = isContainer
    ? SHALLOW_CONTAINER_SCHEMAS[type as keyof typeof SHALLOW_CONTAINER_SCHEMAS]
    : LEAF_NODE_SCHEMAS[type as keyof typeof LEAF_NODE_SCHEMAS];
  // Unknown type (a future node, a hallucinated one) — dropped, never thrown.
  if (!schema) return null;

  // The id is claimed before validation so a dropped node cannot leave a hole
  // in the sequence; on failure the claim is simply unused.
  const id = takeNodeId(record.id, ctx);
  const parsed = schema.safeParse({ ...record, id });
  if (!parsed.success) return null;

  ctx.budget -= 1;

  // Decoration nodes never declare `wire`, so zod has already stripped any a
  // model attached to one — a node without a socket can never become one.
  if (!isContainer) return compact(parsed.data) as SpecNode;

  const rawChildren = Array.isArray(record.children) ? record.children : [];
  const children: SpecNode[] = [];
  for (const child of rawChildren) {
    if (ctx.budget <= 0) break;
    const sanitized = sanitizeNode(child, ctx, depth + 1);
    if (sanitized) children.push(sanitized);
  }

  // An empty container paints nothing but blank space — drop it and give the
  // budget back so a bad wrapper never starves the rest of the page.
  if (children.length === 0) {
    ctx.budget += 1;
    return null;
  }

  return { ...compact(parsed.data as object), children } as SpecNode;
}

function sanitizePagePath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  const slug = slugify(trimmed, 60);
  return slug || fallback;
}

type SanitizedPage = { page: PageSpec; sourceId: string };

function sanitizePage(raw: unknown, index: number, usedPageIds: Set<string>): SanitizedPage | null {
  const record = asRecord(raw);
  if (!record) return null;

  const sourceId = typeof record.id === "string" ? record.id : "";
  let id = slugify(sourceId || "", 40);
  if (!id) id = slugify(typeof record.title === "string" ? record.title : "", 40);
  if (!id) id = `page-${index + 1}`;
  while (usedPageIds.has(id)) id = `${id}-${index + 1}`;
  usedPageIds.add(id);

  const titleParse = requiredText(TEXT_CAPS.title).safeParse(record.title);
  const title = titleParse.success ? titleParse.data : id.replace(/-/g, " ");

  const path = id === "home" ? "" : sanitizePagePath(record.path, id);

  const ctx: PageContext = {
    pageId: id,
    ids: new Set<string>(),
    autoCounter: 0,
    budget: PRODUCT_SPEC_LIMITS.maxNodesPerPage
  };

  const rawBlocks = Array.isArray(record.blocks) ? record.blocks : [];
  const blocks: SpecNode[] = [];
  for (const block of rawBlocks) {
    if (ctx.budget <= 0) break;
    const node = sanitizeNode(block, ctx, 1);
    if (node) blocks.push(node);
  }
  // A page with nothing on it is worse than no page at all.
  if (blocks.length === 0) return null;

  // Key order is kept identical to a hand-built PageSpec so a sanitize pass
  // over an already-clean spec is byte-for-byte identical (stable diffs).
  const seo = pageSeoSchema.safeParse(record.seo);
  const seoValue =
    seo.success && seo.data && (seo.data.description || seo.data.ogImageUrl)
      ? compact(seo.data)
      : undefined;
  const page: PageSpec = seoValue
    ? { id, title, path, seo: seoValue, blocks }
    : { id, title, path, blocks };
  return { page, sourceId: sourceId || id };
}

function sanitizeNavLinks(raw: unknown, knownIds: Map<string, string>, max: number): NavLink[] {
  if (!Array.isArray(raw)) return [];
  const links: NavLink[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (links.length >= max) break;
    const record = asRecord(entry);
    if (!record) continue;
    const label = requiredText(TEXT_CAPS.short).safeParse(record.label);
    if (!label.success) continue;
    const rawPageId = typeof record.pageId === "string" ? record.pageId : "";
    // A link to a page that does not exist is a 404 in a nav bar — dropped.
    const pageId = knownIds.get(rawPageId) ?? knownIds.get(slugify(rawPageId, 40));
    if (!pageId) continue;
    const key = `${pageId}:${label.data}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ label: label.data, pageId });
  }
  return links;
}

/**
 * Salvages whatever is usable out of `input` and returns a spec the renderer
 * can paint, or null when nothing survives (the caller then falls back —
 * see `resolveProductForPublic`). Never throws.
 *
 * Guarantees on a non-null result: `version` is 1, exactly one page has id
 * "home" and path "", every page id and path is unique and slug-safe, every
 * node id is unique inside its page, nav links point at real pages, and no
 * page exceeds 120 nodes or 8 levels of nesting.
 */
export function sanitizeProductSpec(input: unknown): ProductSpec | null {
  const record = asRecord(input);
  if (!record) return null;

  const rawPages = Array.isArray(record.pages) ? record.pages : [];
  const usedPageIds = new Set<string>();
  const sanitized: SanitizedPage[] = [];
  for (const rawPage of rawPages) {
    if (sanitized.length >= PRODUCT_SPEC_LIMITS.maxPages) break;
    const page = sanitizePage(rawPage, sanitized.length, usedPageIds);
    if (page) sanitized.push(page);
  }
  if (sanitized.length === 0) return null;

  // "home" is required. If the author never wrote one, the first surviving
  // page is promoted so the site always has a front door.
  if (!sanitized.some((entry) => entry.page.id === "home")) {
    const first = sanitized[0];
    usedPageIds.delete(first.page.id);
    first.page.id = "home";
    usedPageIds.add("home");
  }

  // Exactly one page owns the root path.
  const usedPaths = new Set<string>();
  const pages: PageSpec[] = [];
  for (const entry of sanitized) {
    const page = entry.page;
    if (page.id === "home") {
      page.path = "";
    } else if (page.path === "" || usedPaths.has(page.path)) {
      page.path = page.id;
    }
    if (usedPaths.has(page.path)) continue;
    usedPaths.add(page.path);
    pages.push(page);
  }

  // Nav links may reference either the author's original page id or the final
  // one (they differ when a page was promoted to "home" or de-duplicated).
  const knownIds = new Map<string, string>();
  for (const entry of sanitized) {
    if (!pages.includes(entry.page)) continue;
    knownIds.set(entry.page.id, entry.page.id);
    if (entry.sourceId) knownIds.set(entry.sourceId, entry.page.id);
    knownIds.set(slugify(entry.sourceId, 40), entry.page.id);
  }

  const navRecord = asRecord(record.nav) ?? {};
  const brandRecord = asRecord(navRecord.brand);
  const brandText = brandRecord ? optionalText(TEXT_CAPS.short).safeParse(brandRecord.text) : null;
  const brandLogo = brandRecord ? urlText().safeParse(brandRecord.logoUrl) : null;
  const brand: ProductNav["brand"] = {};
  if (brandText?.success && brandText.data) brand.text = brandText.data;
  if (brandLogo?.success && brandLogo.data) brand.logoUrl = brandLogo.data;

  const nav: ProductNav = {
    links: sanitizeNavLinks(navRecord.links, knownIds, PRODUCT_SPEC_LIMITS.maxNavLinks),
    footerLinks: sanitizeNavLinks(navRecord.footerLinks, knownIds, PRODUCT_SPEC_LIMITS.maxFooterLinks)
  };
  if (brand.text || brand.logoUrl) nav.brand = brand;
  const footerNote = optionalText(TEXT_CAPS.footerNote).safeParse(navRecord.footerNote);
  if (footerNote.success && footerNote.data) nav.footerNote = footerNote.data;

  const spec: ProductSpec = { version: PRODUCT_SPEC_VERSION, pages, nav };

  const theme = productThemeSchema.safeParse(record.theme);
  if (theme.success && theme.data) {
    const cleanTheme: ProductTheme = {};
    if (theme.data.accent) cleanTheme.accent = theme.data.accent;
    if (theme.data.mode) cleanTheme.mode = theme.data.mode;
    if (theme.data.font) cleanTheme.font = theme.data.font;
    if (Object.keys(cleanTheme).length > 0) spec.theme = cleanTheme;
  }

  return spec;
}

// ---------------------------------------------------------------------------
// Helpers the renderer and the wiring layer need.
// ---------------------------------------------------------------------------

/** One wired socket: where it lives in the spec and what it points at. */
export type WireRef = {
  pageId: string;
  pagePath: string;
  /** The spec node's own id (the renderer's key / data-testid anchor). */
  specNodeId: string;
  nodeType: SpecNodeType;
  wire: Wire;
};

function walkNodes(nodes: SpecNode[], visit: (node: SpecNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (isContainerNode(node)) walkNodes(node.children, visit);
  }
}

/**
 * Every wire in the spec, in page then document order, each tagged with the
 * page and the spec node that carries it. This is the list the runtime binds
 * to the agent's workflow graph.
 */
export function collectWires(spec: ProductSpec): WireRef[] {
  const refs: WireRef[] = [];
  for (const page of spec.pages) {
    walkNodes(page.blocks, (node) => {
      const wire = (node as { wire?: Wire }).wire;
      if (!wire) return;
      refs.push({
        pageId: page.id,
        pagePath: page.path,
        specNodeId: node.id,
        nodeType: node.type,
        wire
      });
    });
  }
  return refs;
}

/**
 * The page for a public path. "", "/", "home" and "/home" all resolve to the
 * home page; anything unknown returns null so the caller can 404 honestly.
 */
export function findPage(spec: ProductSpec, path: string | null | undefined): PageSpec | null {
  const normalized = (path ?? "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (normalized === "" || normalized === "home") {
    return spec.pages.find((page) => page.id === "home") ?? spec.pages[0] ?? null;
  }
  return (
    spec.pages.find((page) => page.path === normalized) ??
    spec.pages.find((page) => page.id === normalized) ??
    null
  );
}

/** Total node count across every page (nested nodes included). */
export function specNodeCount(spec: ProductSpec): number {
  let count = 0;
  for (const page of spec.pages) {
    walkNodes(page.blocks, () => {
      count += 1;
    });
  }
  return count;
}

/** Node count for a single page (nested nodes included). */
export function pageNodeCount(page: PageSpec): number {
  let count = 0;
  walkNodes(page.blocks, () => {
    count += 1;
  });
  return count;
}

// ---------------------------------------------------------------------------
// defaultProductSpec — the starter every new agent gets.
// ---------------------------------------------------------------------------

export type DefaultProductSpecAgent = {
  /** The agent/product name. The only field that really matters. */
  name?: string | null;
  /** One line under the headline. */
  tagline?: string | null;
  /** A paragraph for the "what it does" section. */
  description?: string | null;
  accent?: string | null;
  mode?: ProductTheme["mode"] | null;
  inputPlaceholder?: string | null;
  actionLabel?: string | null;
  /** Three short value lines for the feature grid. */
  highlights?: string[] | null;
  /** Graph node ids for the three sockets. Omit for a single-brain agent. */
  wires?: {
    inputNodeId?: string | null;
    actionNodeId?: string | null;
    outputNodeId?: string | null;
  } | null;
};

function wireFor(role: WireRole, nodeId?: string | null): Wire {
  const clean = typeof nodeId === "string" ? cleanString(nodeId, TEXT_CAPS.nodeId) : "";
  return clean ? { role, nodeId: clean } : { role };
}

/**
 * A sensible, sellable starter: a hero that explains the product, the working
 * agent right there on the page (input → run → result), a three-up value grid
 * and a closing call to action. Always passes the sanitizer.
 *
 * Legal pages are NOT included here — the backend's `generateLegalPages`
 * builds privacy/terms from the architect's real business details and the
 * caller appends them.
 */
export function defaultProductSpec(agent: DefaultProductSpecAgent = {}): ProductSpec {
  const name = cleanString(agent.name ?? "", TEXT_CAPS.short) || "Your AI Product";
  const tagline =
    cleanString(agent.tagline ?? "", TEXT_CAPS.heading) || `${name} does the work for you.`;
  const description =
    cleanString(agent.description ?? "", TEXT_CAPS.text) ||
    `Tell ${name} what you need in plain words. It reads your request, does the work, and hands back a finished result in seconds.`;
  const placeholder = cleanString(agent.inputPlaceholder ?? "", TEXT_CAPS.placeholder) || "Tell it what you need…";
  const actionLabel = cleanString(agent.actionLabel ?? "", TEXT_CAPS.label) || "Run it";

  const highlights = (agent.highlights ?? [])
    .map((item) => cleanString(String(item ?? ""), TEXT_CAPS.listItem))
    .filter((item) => item.length > 0)
    .slice(0, 3);
  const cards =
    highlights.length === 3
      ? highlights
      : ["Ready in seconds", "Works from plain English", "Nothing to install"];

  const accent = (() => {
    const raw = (agent.accent ?? "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(raw) ? raw : DEFAULT_ACCENT;
  })();

  const home: PageSpec = {
    id: "home",
    title: name,
    path: "",
    seo: { description: tagline },
    blocks: [
      {
        id: "home-hero",
        type: "section",
        padding: "xl",
        background: "gradient",
        children: [
          {
            id: "home-hero-stack",
            type: "stack",
            gap: "md",
            align: "center",
            children: [
              { id: "home-hero-badge", type: "badge", text: "Live now", tone: "accent" },
              {
                id: "home-hero-title",
                type: "heading",
                level: 1,
                text: name,
                align: "center"
              },
              {
                id: "home-hero-tagline",
                type: "text",
                text: tagline,
                size: "lg",
                align: "center",
                style: { textTone: "muted", maxWidth: "md" }
              }
            ]
          }
        ]
      },
      {
        id: "home-product",
        type: "section",
        padding: "lg",
        background: "plain",
        children: [
          {
            id: "home-product-stack",
            type: "stack",
            gap: "md",
            children: [
              {
                id: "home-product-input",
                type: "input",
                label: "What do you need?",
                placeholder,
                multiline: true,
                wire: wireFor("input", agent.wires?.inputNodeId)
              },
              {
                id: "home-product-actions",
                type: "row",
                gap: "sm",
                align: "start",
                children: [
                  {
                    id: "home-product-run",
                    type: "button",
                    label: actionLabel,
                    variant: "primary",
                    size: "lg",
                    wire: wireFor("action", agent.wires?.actionNodeId)
                  }
                ]
              },
              {
                id: "home-product-result",
                type: "result",
                variant: "auto",
                wire: wireFor("output", agent.wires?.outputNodeId)
              }
            ]
          }
        ]
      },
      {
        id: "home-about",
        type: "section",
        padding: "lg",
        background: "tint",
        children: [
          {
            id: "home-about-stack",
            type: "stack",
            gap: "md",
            align: "center",
            children: [
              {
                id: "home-about-title",
                type: "heading",
                level: 2,
                text: "What it does",
                align: "center"
              },
              {
                id: "home-about-text",
                type: "text",
                text: description,
                align: "center",
                style: { textTone: "muted", maxWidth: "md" }
              },
              {
                id: "home-about-grid",
                type: "grid",
                columns: 3,
                gap: "md",
                children: cards.map((card, index) => ({
                  id: `home-about-card-${index + 1}`,
                  type: "stack" as const,
                  gap: "sm" as const,
                  align: "start" as const,
                  children: [
                    { id: `home-about-card-${index + 1}-icon`, type: "icon" as const, name: "sparkles", size: "md" as const },
                    {
                      id: `home-about-card-${index + 1}-title`,
                      type: "heading" as const,
                      level: 3 as const,
                      text: card
                    }
                  ]
                }))
              }
            ]
          }
        ]
      },
      {
        id: "home-cta",
        type: "section",
        padding: "lg",
        background: "dark",
        children: [
          {
            id: "home-cta-stack",
            type: "stack",
            gap: "sm",
            align: "center",
            children: [
              {
                id: "home-cta-title",
                type: "heading",
                level: 2,
                text: `Try ${name} now`,
                align: "center"
              },
              {
                id: "home-cta-text",
                type: "text",
                text: "No sign-up. No setup. Type what you need and see it work.",
                align: "center",
                style: { textTone: "muted" }
              },
              {
                id: "home-cta-button",
                type: "button",
                label: actionLabel,
                variant: "primary",
                size: "lg",
                wire: wireFor("action", agent.wires?.actionNodeId)
              }
            ]
          }
        ]
      }
    ]
  };

  return {
    version: PRODUCT_SPEC_VERSION,
    pages: [home],
    nav: {
      brand: { text: name },
      links: [{ label: "Home", pageId: "home" }],
      footerLinks: [],
      footerNote: `© ${new Date().getFullYear()} ${name}`
    },
    theme: { accent, mode: agent.mode ?? "light", font: "sans" }
  };
}
