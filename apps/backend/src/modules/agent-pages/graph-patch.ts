import {
  BLOCK_NODE_TYPES,
  NODE_DEFINITIONS,
  getNodeDefinition,
  isBlockNodeType,
  isDesignBrainNodeType
} from "@coreai/shared";
import { z } from "zod";

/**
 * Foundation graph mutation service — applies Design Brain GraphOps to a
 * WorkflowDefinition.workflowJson server-side.
 *
 * Canvas shape (verified on a real WorkflowDefinition row, id
 * wfyatra48329affb28ef025 — the "Yatra" insert pattern — and matching the
 * builder's addNodeFromLibrary + node-defaults.ts + library.ts paletteItem):
 *
 *   nodes: [{
 *     id: "blk-composer",                 // "blk-" + short slug (+ suffix)
 *     type: "coreNode",                   // React Flow renderer type
 *     position: { x, y },                 // blocks stack in one column
 *     data: {
 *       type: "block.prompt_composer",    // canonical slug on data.type
 *       nodeKind: "block",
 *       icon, kind, label, title, subtitle, accent, footer,  // presentation
 *       ...configFields                   // config is spread FLAT into data
 *     }
 *   }]
 *   edges: [{ id: "edge-<src>-<tgt>", source, target, animated: true,
 *             style: { stroke: "#f59e0b", strokeWidth: 2.6 } }]
 *
 * Rules enforced here (single source of truth for graph mutation):
 *  - Only block.* nodes are ever created, moved, edited, or removed.
 *  - design.brain, brains (ai), and hands (triggers/connectors) are untouchable
 *    through ops, as are edges between non-block nodes.
 *  - Config keys/caps derive from each registry NodeDefinition's defaultConfig
 *    shape, mirroring blueprint.ts sanitizers.
 *  - Malformed ops are skipped with a note — never thrown.
 */

/* ------------------------------------------------------------------ */
/* Contract types                                                      */
/* ------------------------------------------------------------------ */

const positionArgSchema = z.union([
  z.literal("start"),
  z.literal("end"),
  z.object({ after: z.string().min(1) })
]);

export type GraphOpPosition = z.infer<typeof positionArgSchema>;

/** Zod gate for a single GraphOp — design-chat reuses this in its patch schema. */
export const graphOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("addBlock"),
    blockType: z.string().min(1),
    config: z.record(z.string(), z.unknown()).optional(),
    position: positionArgSchema.optional()
  }),
  z.object({ op: z.literal("removeBlock"), nodeId: z.string().min(1) }),
  z.object({
    op: z.literal("reorderBlock"),
    nodeId: z.string().min(1),
    to: positionArgSchema
  }),
  z.object({
    op: z.literal("updateBlockConfig"),
    nodeId: z.string().min(1),
    config: z.record(z.string(), z.unknown())
  })
]);

export type GraphOp = z.infer<typeof graphOpSchema>;

export const graphOpsSchema = z.array(graphOpSchema).max(20);

export type ApplyGraphOpsResult = {
  workflowJson: unknown;
  changed: boolean;
  notes: string[];
};

/* ------------------------------------------------------------------ */
/* Canvas constants (mirroring the builder + Yatra production shape)   */
/* ------------------------------------------------------------------ */

/** Vertical gap between stacked blocks in the block column. */
const BLOCK_COLUMN_SPACING = 190;

/** Edge styling saved by the builder for amber (default) edges. */
const EDGE_STROKE = "#f59e0b";
const EDGE_STROKE_WIDTH = 2.6;

/** Palette icons per block slug (library.ts presentation; cosmetic only). */
const BLOCK_ICONS: Record<string, string> = {
  [BLOCK_NODE_TYPES.promptComposer]: "edit",
  [BLOCK_NODE_TYPES.presetGallery]: "gallery",
  [BLOCK_NODE_TYPES.modelPicker]: "sliders",
  [BLOCK_NODE_TYPES.actionButton]: "pointer-click",
  [BLOCK_NODE_TYPES.outputStage]: "eye",
  [BLOCK_NODE_TYPES.continueChain]: "arrow-right",
  [BLOCK_NODE_TYPES.historyShelf]: "clock",
  "block.file_upload": "upload"
};
const DEFAULT_BLOCK_ICON = "gallery";

/** Compact id fragments, matching hand-authored canvases (blk-composer, …). */
const BLOCK_ID_SLUGS: Record<string, string> = {
  [BLOCK_NODE_TYPES.promptComposer]: "composer",
  [BLOCK_NODE_TYPES.presetGallery]: "styles",
  [BLOCK_NODE_TYPES.modelPicker]: "models",
  [BLOCK_NODE_TYPES.actionButton]: "button",
  [BLOCK_NODE_TYPES.outputStage]: "output",
  [BLOCK_NODE_TYPES.continueChain]: "continue",
  [BLOCK_NODE_TYPES.historyShelf]: "history",
  "block.file_upload": "file"
};

/** Blocks that feed the brain (customer input) — wired block -> brain. */
const INPUT_BLOCK_TYPES = new Set<string>([
  BLOCK_NODE_TYPES.promptComposer,
  BLOCK_NODE_TYPES.actionButton,
  BLOCK_NODE_TYPES.presetGallery,
  BLOCK_NODE_TYPES.modelPicker,
  "block.file_upload"
]);

/** Blocks that show the brain's result — wired brain -> block. */
const OUTPUT_BLOCK_TYPES = new Set<string>([BLOCK_NODE_TYPES.outputStage]);

/* ------------------------------------------------------------------ */
/* Config validation (registry defaultConfig shape + blueprint caps)   */
/* ------------------------------------------------------------------ */

const MAX_TEXT_LENGTH = 120;
const MAX_LONG_TEXT_LENGTH = 500;
/** Keys allowed the long cap (500) instead of the default 120. */
const LONG_TEXT_KEYS = new Set(["promptFragment", "welcome", "welcomeMessage"]);
const MAX_PRESETS = 8;
const MAX_OPTIONS = 6;
const MIN_INT = 1;
const MAX_INT = 100000;

/** Closed value sets for enum-like string keys (kept in one place). */
const VALUE_ENUMS: Record<string, Record<string, readonly string[]>> = {
  [BLOCK_NODE_TYPES.outputStage]: { kind: ["auto", "image", "video", "text"] },
  "block.file_upload": { accept: ["any", "images", "documents"] }
};

function textCap(key: string): number {
  return LONG_TEXT_KEYS.has(key) ? MAX_LONG_TEXT_LENGTH : MAX_TEXT_LENGTH;
}

function sanitizeText(key: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, textCap(key));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item"
  );
}

/** Preset item — id auto-derived from title when the model omits it. */
function sanitizePresetItem(entry: unknown): Record<string, unknown> | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  const title = sanitizeText("title", raw.title);
  if (!title) return null;
  const id = sanitizeText("id", raw.id) || slugify(title);
  const emoji = sanitizeText("emoji", raw.emoji) ?? "";
  const promptFragment = sanitizeText("promptFragment", raw.promptFragment) ?? "";
  return { id, title, emoji, promptFragment };
}

/** Model-picker option item — id auto-derived from label when omitted. */
function sanitizeOptionItem(entry: unknown): Record<string, unknown> | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  const label = sanitizeText("label", raw.label);
  const id = sanitizeText("id", raw.id) || (label ? slugify(label) : null);
  if (!id) return null;
  return { id, label: label || id };
}

function sanitizeList(
  value: unknown,
  itemSanitizer: (entry: unknown) => Record<string, unknown> | null,
  cap: number
): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const items: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (items.length >= cap) break;
    const item = itemSanitizer(entry);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Validate one config value against the registry defaultConfig sample for the
 * same key. Returns undefined when the value must be rejected.
 */
function sanitizeConfigValue(
  blockType: string,
  key: string,
  sample: unknown,
  value: unknown
): unknown {
  const allowed = VALUE_ENUMS[blockType]?.[key];
  if (allowed) {
    return typeof value === "string" && allowed.includes(value) ? value : undefined;
  }
  if (typeof sample === "string") {
    const text = sanitizeText(key, value);
    return text === null ? undefined : text;
  }
  if (Array.isArray(sample)) {
    if (key === "presets") return sanitizeList(value, sanitizePresetItem, MAX_PRESETS) ?? undefined;
    if (key === "options") return sanitizeList(value, sanitizeOptionItem, MAX_OPTIONS) ?? undefined;
    // Future list keys: accept short text entries, same cap discipline.
    if (!Array.isArray(value)) return undefined;
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, MAX_TEXT_LENGTH))
      .filter((entry) => entry.length > 0)
      .slice(0, MAX_PRESETS);
  }
  if (typeof sample === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.min(MAX_INT, Math.max(MIN_INT, Math.trunc(value)));
  }
  if (typeof sample === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }
  return undefined;
}

/** Editable config keys for a block type, straight from the registry. */
function editableConfigKeys(blockType: string): string[] {
  const def = getNodeDefinition(blockType);
  return Object.keys(def?.defaultConfig ?? {});
}

/* ------------------------------------------------------------------ */
/* Graph helpers                                                       */
/* ------------------------------------------------------------------ */

type GraphNode = Record<string, unknown>;
type GraphEdge = Record<string, unknown>;

type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rest: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nodeData(node: GraphNode): Record<string, unknown> {
  return asRecord(node.data) ?? {};
}

function nodeSlug(node: GraphNode): string {
  const data = nodeData(node);
  if (typeof data.type === "string") return data.type;
  return typeof node.type === "string" ? node.type : "";
}

function nodeId(node: GraphNode): string {
  return typeof node.id === "string" ? node.id : "";
}

/** A page-section node: block.* slug (design.brain is NOT a page section). */
function isBlockNode(node: GraphNode): boolean {
  const slug = nodeSlug(node);
  return isBlockNodeType(slug) && !isDesignBrainNodeType(slug);
}

/** A brain: nodeKind "ai" on data, or an ai-kind slug in the registry. */
function isAiNode(node: GraphNode): boolean {
  const data = nodeData(node);
  if (data.nodeKind === "ai") return true;
  const slug = nodeSlug(node);
  return getNodeDefinition(slug)?.runtime.nodeKind === "ai";
}

function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

/** Parse workflowJson into a workable graph, or null when unreadable. */
function readGraph(workflowJson: unknown): Graph | null {
  const raw = asRecord(workflowJson);
  if (!raw) return null;
  const cloned = deepClone(raw);
  const nodes = Array.isArray(cloned.nodes)
    ? cloned.nodes.filter((node): node is GraphNode => asRecord(node) !== null)
    : [];
  const edges = Array.isArray(cloned.edges)
    ? cloned.edges.filter((edge): edge is GraphEdge => asRecord(edge) !== null)
    : [];
  const rest: Record<string, unknown> = { ...cloned };
  delete rest.nodes;
  delete rest.edges;
  return { nodes, edges, rest };
}

function writeGraph(graph: Graph): Record<string, unknown> {
  return { ...graph.rest, nodes: graph.nodes, edges: graph.edges };
}

/** Block nodes in Face reading order — y, then x, then array order. */
function orderedBlockNodes(graph: Graph): GraphNode[] {
  const entries = graph.nodes
    .map((node, index) => ({ node, index }))
    .filter((entry) => isBlockNode(entry.node));
  return entries
    .sort((a, b) => {
      const pa = asRecord(a.node.position);
      const pb = asRecord(b.node.position);
      const ya = finiteNumber(pa?.y);
      const yb = finiteNumber(pb?.y);
      if (ya !== null && yb !== null && ya !== yb) return ya - yb;
      const xa = finiteNumber(pa?.x);
      const xb = finiteNumber(pb?.x);
      if (ya !== null && yb !== null && xa !== null && xb !== null && xa !== xb) return xa - xb;
      return a.index - b.index;
    })
    .map((entry) => entry.node);
}

/** The x of the block column: the topmost block's x, else 0. */
function blockColumnX(ordered: GraphNode[]): number {
  for (const node of ordered) {
    const x = finiteNumber(asRecord(node.position)?.x);
    if (x !== null) return x;
  }
  return 0;
}

/** Reassign y down the block column in the given order; x is left alone. */
function reflowBlockColumn(ordered: GraphNode[]): boolean {
  let baseY: number | null = null;
  for (const node of ordered) {
    const y = finiteNumber(asRecord(node.position)?.y);
    if (y !== null) baseY = baseY === null ? y : Math.min(baseY, y);
  }
  const startY = baseY ?? 0;
  let changed = false;
  ordered.forEach((node, index) => {
    const position = asRecord(node.position) ?? {};
    const nextY = startY + index * BLOCK_COLUMN_SPACING;
    if (finiteNumber(position.y) !== nextY) {
      node.position = { ...position, x: finiteNumber(position.x) ?? 0, y: nextY };
      changed = true;
    }
  });
  return changed;
}

function makeIdFactory(graph: Graph, idSeed?: string) {
  const taken = new Set(graph.nodes.map(nodeId).filter(Boolean));
  let counter = 0;
  return (blockType: string): string => {
    const slugPart =
      BLOCK_ID_SLUGS[blockType] ??
      blockType.replace(/^block\./, "").replace(/[^a-z0-9]+/gi, "-");
    counter += 1;
    const suffix = idSeed ? `${idSeed}${counter}` : Math.random().toString(36).slice(2, 8);
    let candidate = `blk-${slugPart}-${suffix}`;
    let bump = 1;
    while (taken.has(candidate)) {
      bump += 1;
      candidate = `blk-${slugPart}-${suffix}-${bump}`;
    }
    taken.add(candidate);
    return candidate;
  };
}

function makeEdge(source: string, target: string, existing: GraphEdge[]): GraphEdge | null {
  const duplicate = existing.some((edge) => edge.source === source && edge.target === target);
  if (duplicate) return null;
  const ids = new Set(existing.map((edge) => (typeof edge.id === "string" ? edge.id : "")));
  let id = `edge-${source}-${target}`;
  let bump = 1;
  while (ids.has(id)) {
    bump += 1;
    id = `edge-${source}-${target}-${bump}`;
  }
  return {
    id,
    source,
    target,
    animated: true,
    style: { stroke: EDGE_STROKE, strokeWidth: EDGE_STROKE_WIDTH }
  };
}

/* ------------------------------------------------------------------ */
/* Op application                                                      */
/* ------------------------------------------------------------------ */

const NOTE_UNKNOWN_OP = "I skipped one change I couldn't understand.";
const NOTE_PICK_BRAIN = "Tell me which brain to connect it to";

type OpContext = {
  graph: Graph;
  notes: string[];
  makeId: (blockType: string) => string;
};

function findBlockNode(graph: Graph, id: string): GraphNode | null {
  const node = graph.nodes.find((candidate) => nodeId(candidate) === id);
  if (!node || !isBlockNode(node)) return null;
  return node;
}

/** Insert `node` into the ordered block list per the position arg, then reflow. */
function placeInColumn(
  ctx: OpContext,
  node: GraphNode,
  position: GraphOpPosition
): { changed: boolean; ok: boolean } {
  const ordered = orderedBlockNodes(ctx.graph).filter((entry) => entry !== node);
  let index = ordered.length;
  if (position === "start") {
    index = 0;
  } else if (position !== "end") {
    const anchorIndex = ordered.findIndex((entry) => nodeId(entry) === position.after);
    if (anchorIndex === -1) {
      ctx.notes.push("I couldn't find the section you asked me to place it after, so it went to the bottom.");
    } else {
      index = anchorIndex + 1;
    }
  }
  ordered.splice(index, 0, node);
  const changed = reflowBlockColumn(ordered);
  return { changed, ok: true };
}

function applyAddBlock(ctx: OpContext, op: Extract<GraphOp, { op: "addBlock" }>): boolean {
  const blockType = op.blockType;
  if (!isBlockNodeType(blockType) || isDesignBrainNodeType(blockType)) {
    ctx.notes.push(NOTE_UNKNOWN_OP);
    return false;
  }
  const def = getNodeDefinition(blockType);
  if (!def || def.runtime.nodeKind !== "block") {
    ctx.notes.push(NOTE_UNKNOWN_OP);
    return false;
  }

  // Config: registry defaults first, then validated overrides — spread FLAT
  // into data, exactly like the builder's paletteItem + defaultNodeData.
  const defaults = deepClone(def.defaultConfig ?? {});
  const overrides: Record<string, unknown> = {};
  if (op.config) {
    const keys = new Set(editableConfigKeys(blockType));
    for (const [key, value] of Object.entries(op.config)) {
      if (!keys.has(key)) {
        ctx.notes.push(`"${key}" isn't something I can set on that section, so I left it out.`);
        continue;
      }
      const sanitized = sanitizeConfigValue(blockType, key, defaults[key], value);
      if (sanitized === undefined) {
        ctx.notes.push(`The value for "${key}" didn't look right, so I kept the default.`);
        continue;
      }
      overrides[key] = sanitized;
    }
  }

  const ordered = orderedBlockNodes(ctx.graph);
  const columnX = blockColumnX(ordered);
  let maxY: number | null = null;
  for (const entry of ordered) {
    const y = finiteNumber(asRecord(entry.position)?.y);
    if (y !== null) maxY = maxY === null ? y : Math.max(maxY, y);
  }

  const id = ctx.makeId(blockType);
  const node: GraphNode = {
    id,
    type: "coreNode",
    position: {
      x: columnX,
      y: maxY === null ? 0 : maxY + BLOCK_COLUMN_SPACING
    },
    data: {
      // Base presentation (node-defaults.ts "block" branch)…
      label: "Product Section",
      title: def.label,
      nodeKind: "block",
      kind: "PRODUCT",
      accent: "rose",
      icon: BLOCK_ICONS[blockType] ?? DEFAULT_BLOCK_ICON,
      subtitle: def.description,
      footer: "",
      type: blockType,
      // …then flat config (may override label/kind, as in the builder).
      ...defaults,
      ...overrides
    }
  };
  ctx.graph.nodes.push(node);

  const position = op.position ?? "end";
  if (position !== "end") placeInColumn(ctx, node, position);

  // Auto-wire to the single brain, when there is exactly one.
  const wireable = INPUT_BLOCK_TYPES.has(blockType) || OUTPUT_BLOCK_TYPES.has(blockType);
  if (wireable) {
    const brains = ctx.graph.nodes.filter((candidate) => isAiNode(candidate));
    if (brains.length === 1) {
      const brainId = nodeId(brains[0]);
      if (brainId) {
        const edge = INPUT_BLOCK_TYPES.has(blockType)
          ? makeEdge(id, brainId, ctx.graph.edges)
          : makeEdge(brainId, id, ctx.graph.edges);
        if (edge) ctx.graph.edges.push(edge);
      }
    } else {
      ctx.notes.push(NOTE_PICK_BRAIN);
    }
  }
  return true;
}

function applyRemoveBlock(ctx: OpContext, op: Extract<GraphOp, { op: "removeBlock" }>): boolean {
  const node = findBlockNode(ctx.graph, op.nodeId);
  if (!node) {
    ctx.notes.push("I couldn't find that section to remove, so nothing changed.");
    return false;
  }
  ctx.graph.nodes = ctx.graph.nodes.filter((candidate) => candidate !== node);
  ctx.graph.edges = ctx.graph.edges.filter(
    (edge) => edge.source !== op.nodeId && edge.target !== op.nodeId
  );
  return true;
}

function applyReorderBlock(ctx: OpContext, op: Extract<GraphOp, { op: "reorderBlock" }>): boolean {
  const node = findBlockNode(ctx.graph, op.nodeId);
  if (!node) {
    ctx.notes.push("I couldn't find that section to move, so nothing changed.");
    return false;
  }
  if (typeof op.to === "object" && op.to.after === op.nodeId) {
    // "After itself" is a no-op.
    return false;
  }
  const { changed } = placeInColumn(ctx, node, op.to);
  return changed;
}

function applyUpdateBlockConfig(
  ctx: OpContext,
  op: Extract<GraphOp, { op: "updateBlockConfig" }>
): boolean {
  const node = findBlockNode(ctx.graph, op.nodeId);
  if (!node) {
    ctx.notes.push("I couldn't find that section to update, so nothing changed.");
    return false;
  }
  const blockType = nodeSlug(node);
  const def = getNodeDefinition(blockType);
  const defaults = def?.defaultConfig ?? {};
  const keys = new Set(editableConfigKeys(blockType));
  const data = nodeData(node);
  let changed = false;
  for (const [key, value] of Object.entries(op.config)) {
    if (!keys.has(key)) {
      ctx.notes.push(`"${key}" isn't something I can change on that section.`);
      continue;
    }
    const sanitized = sanitizeConfigValue(blockType, key, defaults[key], value);
    if (sanitized === undefined) {
      ctx.notes.push(`The value for "${key}" didn't look right, so I left it as it was.`);
      continue;
    }
    if (JSON.stringify(data[key]) !== JSON.stringify(sanitized)) {
      data[key] = sanitized;
      changed = true;
    }
  }
  node.data = data;
  return changed;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Apply Design Brain GraphOps to a workflow graph. Never throws: unreadable
 * graphs and malformed ops turn into notes, and non-block nodes plus their
 * edges are guaranteed untouched.
 */
export function applyGraphOps(input: {
  workflowJson: unknown;
  ops: unknown;
  idSeed?: string;
}): ApplyGraphOpsResult {
  const notes: string[] = [];

  const graph = readGraph(input.workflowJson);
  if (!graph) {
    notes.push("I couldn't read the canvas, so nothing changed.");
    return { workflowJson: input.workflowJson, changed: false, notes };
  }

  if (!Array.isArray(input.ops)) {
    if (input.ops !== undefined && input.ops !== null) notes.push(NOTE_UNKNOWN_OP);
    return { workflowJson: input.workflowJson, changed: false, notes };
  }

  const ctx: OpContext = { graph, notes, makeId: makeIdFactory(graph, input.idSeed) };
  let changed = false;

  for (const rawOp of input.ops) {
    const parsed = graphOpSchema.safeParse(rawOp);
    if (!parsed.success) {
      notes.push(NOTE_UNKNOWN_OP);
      continue;
    }
    const op = parsed.data;
    try {
      if (op.op === "addBlock") changed = applyAddBlock(ctx, op) || changed;
      else if (op.op === "removeBlock") changed = applyRemoveBlock(ctx, op) || changed;
      else if (op.op === "reorderBlock") changed = applyReorderBlock(ctx, op) || changed;
      else changed = applyUpdateBlockConfig(ctx, op) || changed;
    } catch {
      notes.push(NOTE_UNKNOWN_OP);
    }
  }

  return {
    workflowJson: changed ? writeGraph(graph) : input.workflowJson,
    changed,
    notes
  };
}

/* ------------------------------------------------------------------ */
/* Prompt catalog                                                      */
/* ------------------------------------------------------------------ */

function describeConfigKey(blockType: string, key: string, sample: unknown): string {
  const allowed = VALUE_ENUMS[blockType]?.[key];
  if (allowed) return `${key} (one of: ${allowed.join(", ")})`;
  if (typeof sample === "string") return `${key} (text, up to ${textCap(key)} characters)`;
  if (Array.isArray(sample)) {
    if (key === "presets") {
      return `presets (list of up to ${MAX_PRESETS} items with title, emoji, promptFragment)`;
    }
    if (key === "options") {
      return `options (list of up to ${MAX_OPTIONS} items with id, label)`;
    }
    return `${key} (list of up to ${MAX_PRESETS} short texts)`;
  }
  if (typeof sample === "number") return `${key} (whole number ${MIN_INT}-${MAX_INT})`;
  if (typeof sample === "boolean") return `${key} (true or false)`;
  return key;
}

/**
 * Compact catalog of every page-section block — type, label, and editable
 * properties — derived from the registry for design-chat's system prompt.
 * New registry blocks (e.g. block.file_upload) appear here automatically.
 */
export function blockCatalogForPrompt(): string {
  const lines: string[] = [];
  for (const def of NODE_DEFINITIONS) {
    if (def.runtime.nodeKind !== "block") continue;
    if (!isBlockNodeType(def.type) || isDesignBrainNodeType(def.type)) continue;
    const entries = Object.entries(def.defaultConfig ?? {});
    const editable =
      entries.length > 0
        ? entries.map(([key, sample]) => describeConfigKey(def.type, key, sample)).join("; ")
        : "nothing — it works as is";
    lines.push(`- ${def.type} ("${def.label}"): ${def.description} Editable: ${editable}`);
  }
  return lines.join("\n");
}

/** One compact "key: value" fragment for the current-sections listing. */
function describeCurrentValue(key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const text = value.length > 60 ? `${value.slice(0, 57)}…` : value;
    return `${key}: ${JSON.stringify(text)}`;
  }
  if (Array.isArray(value)) {
    const names = value
      .map((entry) => {
        const raw = asRecord(entry);
        if (!raw) return null;
        if (typeof raw.title === "string" && raw.title) return raw.title;
        if (typeof raw.label === "string" && raw.label) return raw.label;
        return null;
      })
      .filter((name): name is string => name !== null);
    return names.length > 0
      ? `${key}: ${value.length} (${names.slice(0, MAX_PRESETS).join(", ")})`
      : `${key}: ${value.length}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return `${key}: ${String(value)}`;
  return null;
}

/**
 * The canvas's existing page sections, top to bottom, with their REAL nodeIds
 * and current editable config — injected into design-chat's system prompt so
 * the LLM references exact nodeIds in removeBlock/reorderBlock/
 * updateBlockConfig ops. Brains, triggers, connectors, and the Design Brain
 * never appear here. Empty string when the canvas has no block sections.
 */
export function currentBlocksForPrompt(workflowJson: unknown): string {
  const graph = readGraph(workflowJson);
  if (!graph) return "";
  const ordered = orderedBlockNodes(graph);
  if (ordered.length === 0) return "";
  const lines = ordered.map((node) => {
    const slug = nodeSlug(node);
    const def = getNodeDefinition(slug);
    const data = nodeData(node);
    const parts = editableConfigKeys(slug)
      .map((key) => describeCurrentValue(key, data[key] ?? def?.defaultConfig?.[key]))
      .filter((part): part is string => part !== null);
    const label = def?.label ?? slug;
    return `- ${nodeId(node)} — ${slug} ("${label}")${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
  });
  return lines.join("\n");
}
