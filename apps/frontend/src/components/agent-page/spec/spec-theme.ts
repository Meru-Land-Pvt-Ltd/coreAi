import type { ProductTheme, SpecTextTone } from "@coreai/shared";
import { DEFAULT_ACCENT } from "@coreai/shared";
import type { CSSProperties } from "react";

/**
 * The Product Spec palette — the ONE place a color is decided.
 *
 * A spec can name exactly one color: `theme.accent`, a validated `#rrggbb`.
 * Everything else on the page (grounds, ink, hairlines, tints, gradients,
 * shadows) is DERIVED here from that accent plus the mode's neutral ramp, so
 * an architect can pick any accent in the world and the page still reads like
 * a real SaaS product.
 *
 * Two derivations do the heavy lifting:
 *
 *   `readableOn` — a pale accent (#fef08a) as body text on white is
 *   unreadable. Accent TEXT is walked toward black (light grounds) or white
 *   (dark grounds) until it clears WCAG AA 4.5:1, so "accent" copy is always
 *   legible while accent FILLS keep the architect's exact color.
 *
 *   `onAccent` — the ink laid on top of an accent fill is whichever of near-
 *   black / white wins the contrast test against that fill.
 *
 * Output is a flat bag of CSS custom properties applied once at the page
 * root. Node components read `var(--spec-*)` and never compute color.
 */

// ---------------------------------------------------------------------------
// Color math.
// ---------------------------------------------------------------------------

type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#([0-9a-f]{6})$/i;

function parseHex(value: string | null | undefined): Rgb | null {
  const match = HEX_RE.exec((value ?? "").trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(rgb: Rgb): string {
  const hex = (value: number) => clampChannel(value).toString(16).padStart(2, "0");
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

function rgba(rgb: Rgb, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)}, ${a})`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t
  };
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const channel = (raw: number) => {
    const c = clampChannel(raw) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio, 1..21. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

const BLACK: Rgb = { r: 12, g: 15, b: 22 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * WCAG contrast between two `#rrggbb` colors, 1..21. Exported so a caller (the
 * builder's accent picker, the renderer's tests) can prove a palette is
 * legible rather than trust that it is.
 */
export function hexContrast(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return 1;
  return contrastRatio(left, right);
}

/**
 * Walks `accent` toward black or white (whichever direction the ground calls
 * for) in 5% steps until it clears `target` contrast on that ground. Returns
 * the accent untouched when it already passes.
 */
function readableOn(accent: Rgb, ground: Rgb, target = 4.5): Rgb {
  if (contrastRatio(accent, ground) >= target) return accent;
  const toward = luminance(ground) > 0.4 ? BLACK : WHITE;
  let current = accent;
  for (let step = 1; step <= 20; step += 1) {
    current = mixRgb(accent, toward, step * 0.05);
    if (contrastRatio(current, ground) >= target) return current;
  }
  return toward;
}

/** Near-black or white — whichever reads better ON an accent fill. */
function onAccent(accent: Rgb): Rgb {
  return contrastRatio(accent, WHITE) >= contrastRatio(accent, BLACK) ? WHITE : BLACK;
}

// ---------------------------------------------------------------------------
// Neutral ramps. One per mode; the accent is layered on top.
// ---------------------------------------------------------------------------

export type SpecMode = NonNullable<ProductTheme["mode"]>;
export type SpecFont = NonNullable<ProductTheme["font"]>;

type Ramp = {
  ground: string;
  /** Cards and raised surfaces on the base ground. */
  card: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  border: string;
  borderSoft: string;
  /** The inverted surface a `background:"dark"` section paints. */
  inverseGround: string;
  inverseCard: string;
  inverseInk: string;
  inverseInkMuted: string;
  inverseBorder: string;
  /** Base of every shadow, so warm pages cast warm shadows. */
  shadowRgb: string;
};

const RAMPS: Record<SpecMode, Ramp> = {
  light: {
    ground: "#ffffff",
    card: "#ffffff",
    ink: "#0f172a",
    inkMuted: "#475569",
    inkSubtle: "#64748b",
    border: "#e2e8f0",
    borderSoft: "#f1f5f9",
    inverseGround: "#0b1120",
    inverseCard: "#151f33",
    inverseInk: "#f8fafc",
    inverseInkMuted: "#a9b6c9",
    inverseBorder: "#22304a",
    shadowRgb: "15, 23, 42"
  },
  dark: {
    ground: "#0b1120",
    card: "#141d30",
    ink: "#f1f5f9",
    inkMuted: "#a9b6c9",
    inkSubtle: "#8493a8",
    border: "#243149",
    borderSoft: "#1a2438",
    inverseGround: "#05090f",
    inverseCard: "#101828",
    inverseInk: "#f8fafc",
    inverseInkMuted: "#a9b6c9",
    inverseBorder: "#1d283d",
    shadowRgb: "2, 6, 16"
  },
  warm: {
    ground: "#fdfaf3",
    card: "#ffffff",
    ink: "#241f1b",
    inkMuted: "#57534e",
    inkSubtle: "#78716c",
    border: "#e9dcc4",
    borderSoft: "#f4ead6",
    inverseGround: "#1c1917",
    inverseCard: "#292420",
    inverseInk: "#faf7f1",
    inverseInkMuted: "#c2b8a9",
    inverseBorder: "#3a332d",
    shadowRgb: "60, 42, 20"
  }
};

const FONT_STACKS: Record<SpecFont, string> = {
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
};

// ---------------------------------------------------------------------------
// The resolved theme.
// ---------------------------------------------------------------------------

export type SpecTheme = {
  mode: SpecMode;
  font: SpecFont;
  /** The architect's exact accent, normalized to #rrggbb. */
  accent: string;
  /** The accent after the legibility walk — safe as text on the base ground. */
  accentInk: string;
  /** Ink laid on top of an accent FILL. */
  accentContrast: string;
  /** Every custom property the node components read. Applied at page root. */
  vars: CSSProperties;
};

/** True when the page's own ground is dark (drives the gradient recipe). */
function isDarkGround(mode: SpecMode): boolean {
  return mode === "dark";
}

/**
 * Resolves a spec's `theme` into a full palette. Unknown/absent values fall
 * back to the Triven amber brand in light mode — never to nothing.
 */
export function buildSpecTheme(theme?: ProductTheme | null): SpecTheme {
  const mode: SpecMode = theme?.mode ?? "light";
  const font: SpecFont = theme?.font ?? "sans";
  const ramp = RAMPS[mode] ?? RAMPS.light;

  const accentRgb = parseHex(theme?.accent) ?? parseHex(DEFAULT_ACCENT) ?? { r: 245, g: 158, b: 11 };
  const groundRgb = parseHex(ramp.ground) ?? WHITE;
  const inverseGroundRgb = parseHex(ramp.inverseGround) ?? BLACK;

  const accent = toHex(accentRgb);
  const accentInk = toHex(readableOn(accentRgb, groundRgb));
  const accentInkInverse = toHex(readableOn(accentRgb, inverseGroundRgb));
  const accentContrast = toHex(onAccent(accentRgb));

  // Tints: the accent washed into the ground. Dark grounds need a heavier
  // hand than white ones to read as a distinct band at all.
  const tintAmount = isDarkGround(mode) ? 0.09 : 0.06;
  const tint = toHex(mixRgb(groundRgb, accentRgb, tintAmount));
  const tintStrong = toHex(mixRgb(groundRgb, accentRgb, tintAmount * 2));
  const inverseTint = toHex(mixRgb(inverseGroundRgb, accentRgb, 0.14));

  // A hero gradient: accent wash at the top fading to the page ground, with a
  // soft off-center accent bloom over it. Two layers, no images, no motion.
  const gradient = [
    `radial-gradient(80% 60% at 18% 0%, ${rgba(accentRgb, isDarkGround(mode) ? 0.24 : 0.16)} 0%, ${rgba(accentRgb, 0)} 70%)`,
    `linear-gradient(180deg, ${tintStrong} 0%, ${ramp.ground} 78%)`
  ].join(", ");
  // The dark band lifts NEUTRALLY (toward its own card color) and takes all of
  // its color from the bloom. Washing a warm accent into a cool ground the way
  // the light gradient does turns muddy on dark.
  const inverseGradient = [
    `radial-gradient(80% 60% at 82% 0%, ${rgba(accentRgb, 0.26)} 0%, ${rgba(accentRgb, 0)} 68%)`,
    `linear-gradient(180deg, ${ramp.inverseCard} 0%, ${ramp.inverseGround} 78%)`
  ].join(", ");

  const vars = {
    "--spec-font": FONT_STACKS[font] ?? FONT_STACKS.sans,

    "--spec-ground": ramp.ground,
    "--spec-card": ramp.card,
    "--spec-ink": ramp.ink,
    "--spec-ink-muted": ramp.inkMuted,
    "--spec-ink-subtle": ramp.inkSubtle,
    "--spec-border": ramp.border,
    "--spec-border-soft": ramp.borderSoft,

    "--spec-inverse-ground": ramp.inverseGround,
    "--spec-inverse-card": ramp.inverseCard,
    "--spec-inverse-ink": ramp.inverseInk,
    "--spec-inverse-ink-muted": ramp.inverseInkMuted,
    "--spec-inverse-border": ramp.inverseBorder,

    "--spec-accent": accent,
    "--spec-accent-ink": accentInk,
    "--spec-accent-ink-inverse": accentInkInverse,
    "--spec-accent-contrast": accentContrast,
    "--spec-accent-soft": rgba(accentRgb, isDarkGround(mode) ? 0.18 : 0.12),
    "--spec-accent-line": rgba(accentRgb, 0.34),
    "--spec-accent-glow": rgba(accentRgb, 0.22),

    "--spec-tint": tint,
    "--spec-tint-strong": tintStrong,
    "--spec-inverse-tint": inverseTint,
    "--spec-gradient": gradient,
    "--spec-inverse-gradient": inverseGradient,

    "--spec-shadow-sm": `0 1px 2px rgba(${ramp.shadowRgb}, 0.06)`,
    "--spec-shadow": `0 1px 2px rgba(${ramp.shadowRgb}, 0.05), 0 10px 24px -14px rgba(${ramp.shadowRgb}, 0.28)`,
    "--spec-shadow-lg": `0 2px 4px rgba(${ramp.shadowRgb}, 0.05), 0 24px 56px -24px rgba(${ramp.shadowRgb}, 0.34)`,

    // Consumed by the root element itself so the page never inherits the
    // surrounding app's background or font.
    background: ramp.ground,
    color: ramp.ink,
    fontFamily: FONT_STACKS[font] ?? FONT_STACKS.sans
  } as CSSProperties;

  return { mode, font, accent, accentInk, accentContrast, vars };
}

// ---------------------------------------------------------------------------
// Surfaces — which var a node reads depends on what it is painted on.
// ---------------------------------------------------------------------------

/**
 * "base" = the page ground (or a tint of it). "dark" = inside a
 * `background:"dark"` section or an accent/dark card, where ink must invert.
 */
export type SpecSurface = "base" | "dark";

export type SurfaceInk = {
  ink: string;
  muted: string;
  subtle: string;
  border: string;
  borderSoft: string;
  card: string;
  accentInk: string;
};

const BASE_INK: SurfaceInk = {
  ink: "var(--spec-ink)",
  muted: "var(--spec-ink-muted)",
  subtle: "var(--spec-ink-subtle)",
  border: "var(--spec-border)",
  borderSoft: "var(--spec-border-soft)",
  card: "var(--spec-card)",
  accentInk: "var(--spec-accent-ink)"
};

const DARK_INK: SurfaceInk = {
  ink: "var(--spec-inverse-ink)",
  muted: "var(--spec-inverse-ink-muted)",
  subtle: "var(--spec-inverse-ink-muted)",
  border: "var(--spec-inverse-border)",
  borderSoft: "var(--spec-inverse-border)",
  card: "var(--spec-inverse-card)",
  accentInk: "var(--spec-accent-ink-inverse)"
};

export function surfaceInk(surface: SpecSurface): SurfaceInk {
  return surface === "dark" ? DARK_INK : BASE_INK;
}

/** Resolves the `style.textTone` token against the surface it sits on. */
export function textToneColor(
  tone: SpecTextTone | undefined,
  surface: SpecSurface,
  fallback: "ink" | "muted" = "ink"
): string {
  const ink = surfaceInk(surface);
  switch (tone) {
    case "muted":
      return ink.muted;
    case "accent":
      return ink.accentInk;
    case "inverse":
      return "var(--spec-inverse-ink)";
    case "default":
      return ink.ink;
    default:
      return fallback === "muted" ? ink.muted : ink.ink;
  }
}
