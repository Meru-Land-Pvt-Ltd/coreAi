import { describe, expect, it } from "vitest";
import { DESIGN_DEFAULTS, designConfigSchema, resolveDesign } from "./design";

/**
 * Design Brain resolution: designJson is untrusted storage — resolveDesign
 * must always return a full, valid DesignConfig (defaults filled in, invalid
 * values salvaged per key, unknown keys ignored) and never throw.
 */

describe("resolveDesign", () => {
  it("returns all defaults for null, undefined and non-object storage", () => {
    expect(resolveDesign(null)).toEqual(DESIGN_DEFAULTS);
    expect(resolveDesign(undefined)).toEqual(DESIGN_DEFAULTS);
    expect(resolveDesign("dark")).toEqual(DESIGN_DEFAULTS);
    expect(resolveDesign(42)).toEqual(DESIGN_DEFAULTS);
    expect(resolveDesign(["dark"])).toEqual(DESIGN_DEFAULTS);
  });

  it("has the contract defaults: light / center / cozy / bubbles / standard width / no sidebar / no arrangement", () => {
    expect(DESIGN_DEFAULTS).toEqual({
      theme: "light",
      composerPosition: "center",
      density: "cozy",
      bubbleStyle: "bubbles",
      contentWidth: "standard",
      showHistorySidebar: false,
      layout: {}
    });
  });

  it("merges a partial config over the defaults", () => {
    expect(resolveDesign({ theme: "dark", composerPosition: "bottom" })).toEqual({
      ...DESIGN_DEFAULTS,
      theme: "dark",
      composerPosition: "bottom"
    });
  });

  it("returns a full config when every dial is stored", () => {
    const full = {
      theme: "warm",
      composerPosition: "bottom",
      density: "compact",
      bubbleStyle: "flat",
      contentWidth: "wide",
      showHistorySidebar: true,
      layout: { "blk-1": { x: 16, y: 24, w: 480 } }
    };
    expect(resolveDesign(full)).toEqual(full);
  });

  it("salvages per key: one corrupt value falls back without dropping the rest", () => {
    expect(
      resolveDesign({ theme: "neon", bubbleStyle: "flat", showHistorySidebar: "yes" })
    ).toEqual({ ...DESIGN_DEFAULTS, bubbleStyle: "flat" });
  });

  it("ignores unknown keys entirely", () => {
    const resolved = resolveDesign({ theme: "dark", fontSize: "72px", customCss: "evil" });
    expect(resolved).toEqual({ ...DESIGN_DEFAULTS, theme: "dark" });
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(DESIGN_DEFAULTS).sort());
  });

  it("never returns a shared defaults reference callers could mutate", () => {
    const first = resolveDesign(null);
    first.theme = "dark";
    first.layout["blk-1"] = { x: 0, y: 0 };
    expect(resolveDesign(null).theme).toBe("light");
    expect(resolveDesign(null).layout).toEqual({});
    expect(DESIGN_DEFAULTS.theme).toBe("light");
    expect(DESIGN_DEFAULTS.layout).toEqual({});
  });
});

describe("resolveDesign — contentWidth (how wide the page runs)", () => {
  it("defaults to standard", () => {
    expect(resolveDesign({}).contentWidth).toBe("standard");
    expect(resolveDesign({ theme: "dark" }).contentWidth).toBe("standard");
  });

  it("keeps every value the dial allows", () => {
    for (const contentWidth of ["compact", "standard", "wide", "full"] as const) {
      expect(resolveDesign({ contentWidth }).contentWidth).toBe(contentWidth);
    }
  });

  it("falls back to standard for anything else, keeping the other dials", () => {
    for (const contentWidth of ["max-w-7xl", "1200px", 1200, null, true, ["wide"]]) {
      const resolved = resolveDesign({ theme: "dark", contentWidth });
      expect(resolved.contentWidth).toBe("standard");
      expect(resolved.theme).toBe("dark");
    }
  });

  it("is one of the schema's dials, so the Design Brain can turn it", () => {
    expect(Object.keys(designConfigSchema.shape)).toContain("contentWidth");
  });
});

describe("resolveDesign — layout (Arrange mode arrangement)", () => {
  it("keeps a valid stored arrangement, entry by entry, w optional", () => {
    const layout = {
      "blk-composer": { x: 0, y: 0 },
      "blk-output": { x: 808, y: 1200, w: 640 }
    };
    expect(resolveDesign({ layout }).layout).toEqual(layout);
  });

  it("drops invalid entries individually without discarding the valid ones", () => {
    const resolved = resolveDesign({
      layout: {
        good: { x: 8, y: 16 },
        negative: { x: -8, y: 0 },
        tooFar: { x: 4001, y: 0 },
        fractional: { x: 8.5, y: 0 },
        skinny: { x: 0, y: 0, w: 100 },
        tooWide: { x: 0, y: 0, w: 1300 },
        missingY: { x: 8 },
        garbage: "left: 8px",
        alsoGood: { x: 4000, y: 4000, w: 1200 }
      }
    });
    expect(resolved.layout).toEqual({
      good: { x: 8, y: 16 },
      alsoGood: { x: 4000, y: 4000, w: 1200 }
    });
  });

  it("strips unknown fields inside an entry instead of dropping the entry", () => {
    expect(
      resolveDesign({ layout: { blk: { x: 8, y: 16, zIndex: 99, css: "evil" } } }).layout
    ).toEqual({ blk: { x: 8, y: 16 } });
  });

  it("falls back to {} when layout is not a plain object, keeping the other dials", () => {
    for (const layout of ["absolute", 42, ["blk"], null]) {
      const resolved = resolveDesign({ theme: "dark", layout });
      expect(resolved.layout).toEqual({});
      expect(resolved.theme).toBe("dark");
    }
  });

  it("ignores blank keys and caps the arrangement at 100 entries", () => {
    const layout: Record<string, unknown> = { "": { x: 0, y: 0 } };
    for (let i = 0; i < 120; i++) layout[`blk-${i}`] = { x: 8, y: 8 };
    const resolved = resolveDesign({ layout });
    expect(Object.keys(resolved.layout)).toHaveLength(100);
    expect(resolved.layout[""]).toBeUndefined();
  });
});

describe("designConfigSchema", () => {
  it("accepts exactly the contract values", () => {
    expect(
      designConfigSchema.safeParse({
        theme: "dark",
        composerPosition: "bottom",
        density: "compact",
        bubbleStyle: "flat",
        contentWidth: "wide",
        showHistorySidebar: true
      }).success
    ).toBe(true);
  });

  it("never fails on layout — corrupt values collapse to a sanitized record", () => {
    const corrupt = designConfigSchema.shape.layout.safeParse("nonsense");
    expect(corrupt.success).toBe(true);
    expect(corrupt.data).toEqual({});

    const mixed = designConfigSchema.shape.layout.safeParse({
      keep: { x: 8, y: 16 },
      drop: { x: "8", y: 16 }
    });
    expect(mixed.success).toBe(true);
    expect(mixed.data).toEqual({ keep: { x: 8, y: 16 } });
  });

  it("rejects values outside the dials", () => {
    expect(designConfigSchema.shape.theme.safeParse("midnight").success).toBe(false);
    expect(designConfigSchema.shape.composerPosition.safeParse("top").success).toBe(false);
    expect(designConfigSchema.shape.density.safeParse("dense").success).toBe(false);
    expect(designConfigSchema.shape.bubbleStyle.safeParse("neumorphic").success).toBe(false);
    expect(designConfigSchema.shape.showHistorySidebar.safeParse("true").success).toBe(false);
    expect(designConfigSchema.shape.contentWidth.safeParse("max-w-7xl").success).toBe(false);
    expect(designConfigSchema.shape.contentWidth.safeParse("edge-to-edge").success).toBe(false);
  });
});
