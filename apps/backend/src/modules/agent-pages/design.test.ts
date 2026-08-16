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

  it("has the contract defaults: light / center / cozy / bubbles / no sidebar", () => {
    expect(DESIGN_DEFAULTS).toEqual({
      theme: "light",
      composerPosition: "center",
      density: "cozy",
      bubbleStyle: "bubbles",
      showHistorySidebar: false
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
      showHistorySidebar: true
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
    expect(resolveDesign(null).theme).toBe("light");
    expect(DESIGN_DEFAULTS.theme).toBe("light");
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
        showHistorySidebar: true
      }).success
    ).toBe(true);
  });

  it("rejects values outside the dials", () => {
    expect(designConfigSchema.shape.theme.safeParse("midnight").success).toBe(false);
    expect(designConfigSchema.shape.composerPosition.safeParse("top").success).toBe(false);
    expect(designConfigSchema.shape.density.safeParse("dense").success).toBe(false);
    expect(designConfigSchema.shape.bubbleStyle.safeParse("neumorphic").success).toBe(false);
    expect(designConfigSchema.shape.showHistorySidebar.safeParse("true").success).toBe(false);
  });
});
