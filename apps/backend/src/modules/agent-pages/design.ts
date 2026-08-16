import { z } from "zod";

/**
 * Design Brain dials for published agent pages (triven.ai/a/<slug>).
 *
 * The whole feature turns on a fixed set of dials: the AI (and the manage
 * surface) may only ever set these values — nothing free-form ever reaches
 * the renderer. `PublishedAgentPage.designJson` stores a partial config;
 * every read goes through `resolveDesign` so callers always hold a full,
 * valid `DesignConfig`.
 */

/** One arranged block on the desktop canvas, keyed by the block's nodeId. */
const layoutEntrySchema = z.object({
  /** Distance from the artboard's left edge, in px (the editor snaps it). */
  x: z.number().int().min(0).max(4000),
  /** Distance from the artboard's top edge, in px. */
  y: z.number().int().min(0).max(4000),
  /** Optional custom width in px; without it the block keeps its natural width. */
  w: z.number().int().min(200).max(1200).optional()
});

export type AgentPageLayoutEntry = z.infer<typeof layoutEntrySchema>;
export type AgentPageLayout = Record<string, AgentPageLayoutEntry>;

const MAX_LAYOUT_ENTRIES = 100;
const MAX_LAYOUT_KEY_LENGTH = 200;

/**
 * Tolerant layout parse: anything that is not a plain object becomes {}, and
 * each entry is validated on its own — one corrupt entry is dropped without
 * discarding the rest of the arrangement. Unknown fields inside an entry are
 * stripped. Never throws.
 */
export const agentPageLayoutSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((raw): AgentPageLayout => {
    const layout: AgentPageLayout = {};
    for (const [nodeId, value] of Object.entries(raw)) {
      if (Object.keys(layout).length >= MAX_LAYOUT_ENTRIES) break;
      if (nodeId.length === 0 || nodeId.length > MAX_LAYOUT_KEY_LENGTH) continue;
      const entry = layoutEntrySchema.safeParse(value);
      if (entry.success) layout[nodeId] = entry.data;
    }
    return layout;
  });

export const designConfigSchema = z.object({
  /** Page-wide color mood. */
  theme: z.enum(["light", "dark", "warm"]),
  /**
   * "center" = empty-state composer sits centered with the hero and docks to
   * the bottom after the first message (ChatGPT feel); "bottom" = always
   * docked (Claude feel).
   */
  composerPosition: z.enum(["center", "bottom"]),
  /** Spacing scale — cozy is the classic layout, compact tightens it. */
  density: z.enum(["cozy", "compact"]),
  /** "bubbles" = classic chat bubbles; "flat" = editorial thread, no bubbles. */
  bubbleStyle: z.enum(["bubbles", "flat"]),
  /** This-session conversation list on wide screens (never on mobile). */
  showHistorySidebar: z.boolean(),
  /**
   * Desktop arrangement from the builder's Arrange mode: free positions per
   * block, keyed by the block's canvas nodeId. {} means the classic stacked
   * flow. Small screens always keep the stacked flow regardless of this value.
   */
  layout: agentPageLayoutSchema
});

export type DesignConfig = z.infer<typeof designConfigSchema>;

export const DESIGN_DEFAULTS: DesignConfig = {
  theme: "light",
  composerPosition: "center",
  density: "cozy",
  bubbleStyle: "bubbles",
  showHistorySidebar: false,
  layout: {}
};

const DESIGN_KEYS = Object.keys(designConfigSchema.shape) as (keyof DesignConfig)[];

/**
 * Full DesignConfig from whatever is stored in designJson. Salvages per key:
 * a corrupt or outdated value falls back to its default without discarding
 * the architect's other dials. Unknown keys are ignored. Never throws.
 */
export function resolveDesign(designJson: unknown): DesignConfig {
  // layout gets a fresh object per call so callers can never mutate the
  // shared DESIGN_DEFAULTS.layout reference through a resolved config.
  const resolved: DesignConfig = { ...DESIGN_DEFAULTS, layout: {} };
  if (typeof designJson !== "object" || designJson === null || Array.isArray(designJson)) {
    return resolved;
  }

  const stored = designJson as Record<string, unknown>;
  for (const key of DESIGN_KEYS) {
    if (stored[key] === undefined) continue;
    const check = designConfigSchema.shape[key].safeParse(stored[key]);
    if (check.success) {
      (resolved as Record<string, unknown>)[key] = check.data;
    }
  }
  return resolved;
}
