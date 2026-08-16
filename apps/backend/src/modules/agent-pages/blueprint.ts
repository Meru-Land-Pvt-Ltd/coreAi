import { BLOCK_NODE_TYPES, isBlockNodeType, isDesignBrainNodeType } from "@coreai/shared";
import { z } from "zod";

/**
 * Face Blueprint derivation — the single source of truth for which product
 * blocks a published agent page (/a/<slug>) and the builder's Test preview
 * render, and in what order.
 *
 * Verified workflowJson shape (inspected on a real WorkflowDefinition row):
 *
 *   {
 *     nodes: [{
 *       id: string,                       // e.g. "trigger.phone_call" or a nanoid
 *       type: "coreNode",                 // React Flow renderer type — NOT the node slug
 *       position: { x: number, y: number },
 *       measured?: { width: number, height: number },
 *       data: {
 *         type: "block.prompt_composer",  // canonical node slug lives on data.type
 *         nodeKind: "block",              // runner kind from the registry
 *         label, title, subtitle, icon, accent, kind, // presentation fields
 *         ...configFields                 // defaultConfig + inspector edits are
 *       }                                 // spread FLAT into data (library.ts
 *     }],                                 // paletteItem) — no nested config key
 *     edges: [{ id: string, source: string, target: string }]
 *   }
 *
 * So block config is read from flattened node.data fields (data.placeholder,
 * data.presets, data.options, data.kind, data.label).
 */

export type FaceBlueprintBlock = {
  type: string;
  config: Record<string, unknown>;
};

export type FaceBlueprint = {
  blocks: FaceBlueprintBlock[];
};

const MAX_TEXT_LENGTH = 120;
const MAX_BUTTON_LABEL_LENGTH = 40;
const MAX_PRESETS = 8;
const MAX_OPTIONS = 6;

const DEFAULT_PROMPT_PLACEHOLDER = "Describe what you want…";
const DEFAULT_CONTINUE_LABEL = "Continue";
const DEFAULT_ACTION_BUTTON_LABEL = "Go";

/** Trimmed, capped string; falls back when missing/blank/not a string. */
const textWithFallback = (fallback: string, maxLength: number = MAX_TEXT_LENGTH) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, maxLength))
    .refine((value) => value.length > 0)
    .catch(fallback);

/** Trimmed, capped string that must survive as non-empty (no fallback). */
const requiredText = z
  .string()
  .transform((value) => value.trim().slice(0, MAX_TEXT_LENGTH))
  .refine((value) => value.length > 0);

/** Optional string — anything non-string becomes "". */
const optionalText = z
  .string()
  .catch("")
  .transform((value) => value.trim().slice(0, MAX_TEXT_LENGTH));

const presetSchema = z.object({
  id: requiredText,
  title: requiredText,
  emoji: optionalText,
  promptFragment: optionalText
});

const optionSchema = z
  .object({ id: requiredText, label: z.unknown().optional() })
  .transform(({ id, label }) => ({
    id,
    label:
      typeof label === "string" && label.trim().length > 0
        ? label.trim().slice(0, MAX_TEXT_LENGTH)
        : id
  }));

/** Tolerant list parse: non-arrays become [], malformed entries are dropped. */
function sanitizeList<T>(
  value: unknown,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
  cap: number
): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  for (const entry of value) {
    if (items.length >= cap) break;
    const parsed = schema.safeParse(entry);
    if (parsed.success && parsed.data !== undefined) items.push(parsed.data);
  }
  return items;
}

const outputKindSchema = z.enum(["auto", "image", "video", "text"]).catch("auto");

/**
 * Per-block sanitized config from the node's flattened data. Unknown block.*
 * types get an empty config so future blocks flow through without breaking
 * older readers (the renderer skips types it does not know).
 */
function deriveBlockConfig(type: string, data: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case BLOCK_NODE_TYPES.promptComposer:
      return { placeholder: textWithFallback(DEFAULT_PROMPT_PLACEHOLDER).parse(data.placeholder) };
    case BLOCK_NODE_TYPES.presetGallery:
      return { presets: sanitizeList(data.presets, presetSchema, MAX_PRESETS) };
    case BLOCK_NODE_TYPES.modelPicker:
      return { options: sanitizeList(data.options, optionSchema, MAX_OPTIONS) };
    case BLOCK_NODE_TYPES.actionButton:
      return {
        label: textWithFallback(DEFAULT_ACTION_BUTTON_LABEL, MAX_BUTTON_LABEL_LENGTH).parse(
          data.label
        )
      };
    case BLOCK_NODE_TYPES.outputStage:
      return { kind: outputKindSchema.parse(data.kind) };
    case BLOCK_NODE_TYPES.continueChain:
      return { label: textWithFallback(DEFAULT_CONTINUE_LABEL).parse(data.label) };
    case BLOCK_NODE_TYPES.historyShelf:
      return {};
    default:
      return {};
  }
}

type BlockEntry = {
  index: number;
  type: string;
  data: Record<string, unknown>;
  x: number | null;
  y: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Derives the Face Blueprint from a workflow graph.
 *
 * Returns null when the graph contains no block.* nodes (the page keeps its
 * default Face). Otherwise blocks are returned in canvas reading order —
 * position y then x. If any block node lacks a usable position the whole
 * list falls back to node array order, so a partially-positioned graph never
 * interleaves unpredictably.
 */
export function deriveFaceBlueprint(workflowJson: unknown): FaceBlueprint | null {
  const graph = asRecord(workflowJson);
  if (!graph || !Array.isArray(graph.nodes)) return null;

  const entries: BlockEntry[] = [];

  graph.nodes.forEach((node, index) => {
    const raw = asRecord(node);
    if (!raw) return;
    const data = asRecord(raw.data) ?? {};

    // Design Brain is never a rendered section — it styles the page through
    // designJson, so it must not leak onto the customer page even if the
    // block-slug check below is ever loosened.
    if (isDesignBrainNodeType(typeof data.type === "string" ? data.type : null)) return;
    if (isDesignBrainNodeType(typeof raw.type === "string" ? raw.type : null)) return;

    // Canonical slug lives on data.type; node.type is the React Flow renderer
    // ("coreNode"). Tolerate a top-level block.* type for hand-written graphs.
    const type =
      typeof data.type === "string" && isBlockNodeType(data.type)
        ? data.type
        : typeof raw.type === "string" && isBlockNodeType(raw.type)
          ? raw.type
          : null;
    if (!type) return;

    const position = asRecord(raw.position);
    entries.push({
      index,
      type,
      data,
      x: finiteNumber(position?.x),
      y: finiteNumber(position?.y)
    });
  });

  if (entries.length === 0) return null;

  const allPositioned = entries.every((entry) => entry.x !== null && entry.y !== null);
  const ordered = allPositioned
    ? [...entries].sort(
        (a, b) => (a.y as number) - (b.y as number) || (a.x as number) - (b.x as number) || a.index - b.index
      )
    : entries;

  return {
    blocks: ordered.map((entry) => ({
      type: entry.type,
      config: deriveBlockConfig(entry.type, entry.data)
    }))
  };
}
