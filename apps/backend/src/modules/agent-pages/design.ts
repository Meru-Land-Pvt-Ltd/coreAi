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
  showHistorySidebar: z.boolean()
});

export type DesignConfig = z.infer<typeof designConfigSchema>;

export const DESIGN_DEFAULTS: DesignConfig = {
  theme: "light",
  composerPosition: "center",
  density: "cozy",
  bubbleStyle: "bubbles",
  showHistorySidebar: false
};

const DESIGN_KEYS = Object.keys(designConfigSchema.shape) as (keyof DesignConfig)[];

/**
 * Full DesignConfig from whatever is stored in designJson. Salvages per key:
 * a corrupt or outdated value falls back to its default without discarding
 * the architect's other dials. Unknown keys are ignored. Never throws.
 */
export function resolveDesign(designJson: unknown): DesignConfig {
  const resolved: DesignConfig = { ...DESIGN_DEFAULTS };
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
