import { DEFAULT_ACCENT, type ProductTheme } from "@coreai/shared";
import { agentPageThemeTokens } from "../../design-tokens";

/**
 * Section tokens — the only place a Product Spec section learns what a color
 * is. The AI never writes CSS; it writes tokens ("tint", "dark", "accent") and
 * an accent hex, and this file turns that into a palette that is guaranteed
 * readable in every theme.
 *
 * Two rules make it impossible to be ugly:
 *   1. Text color is never taken straight from the accent. It is darkened (or
 *      lightened) until it clears WCAG AA against whatever it sits on.
 *   2. Every surface (plain / tint / gradient / dark / accent) publishes its
 *      OWN ink, border and card colors, so a section can be dropped anywhere
 *      and its contents follow the surface instead of the page.
 *
 * The base palette is shared with the classic agent page (design-tokens.ts) so
 * a spec-rendered page and a chat-rendered page feel like one product.
 */

export type SectionMode = NonNullable<ProductTheme["mode"]>;
export type SectionFont = NonNullable<ProductTheme["font"]>;

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Anything that is not a clean hex falls back to the Triven amber. */
export function normalizeAccent(input?: string | null): string {
  if (typeof input !== "string") return DEFAULT_ACCENT;
  const raw = input.trim();
  if (!HEX_PATTERN.test(raw)) return DEFAULT_ACCENT;
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return raw.toLowerCase();
}

type Rgb = { r: number; g: number; b: number };

function toRgb(hex: string): Rgb {
  const clean = normalizeAccent(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Blend two colors. `amount` 0 = all `from`, 1 = all `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = toRgb(from);
  const b = toRgb(to);
  const t = Math.max(0, Math.min(1, amount));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  });
}

/** `#f59e0b` + 0.12 → `rgba(245, 158, 11, 0.12)`. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = toRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

const NEAR_BLACK = "#0b1220";
const NEAR_WHITE = "#ffffff";

/** Pick whichever of near-black / white reads best on `background`. */
export function readableInk(background: string): string {
  return contrastRatio(NEAR_WHITE, background) >= contrastRatio(NEAR_BLACK, background)
    ? NEAR_WHITE
    : NEAR_BLACK;
}

/**
 * Nudge `foreground` toward black or white until it clears `target` contrast
 * against `background`. This is what stops a pale accent from being used as
 * unreadable body text — the section still looks accented, just legible.
 */
export function ensureContrast(
  foreground: string,
  background: string,
  target = 4.5
): string {
  const towards = relativeLuminance(background) > 0.45 ? NEAR_BLACK : NEAR_WHITE;
  let candidate = normalizeAccent(foreground);
  for (let step = 0; step <= 20; step += 1) {
    if (contrastRatio(candidate, background) >= target) return candidate;
    candidate = mixHex(normalizeAccent(foreground), towards, (step + 1) * 0.05);
  }
  return towards;
}

const FONT_STACKS: Record<SectionFont, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
};

/** One surface a section can sit on. Every color a section paints comes from here. */
export type SectionSurface = {
  /** Which spec token produced this surface. */
  key: "plain" | "tint" | "gradient" | "dark" | "accent";
  /** CSS `background` — a flat color for plain/tint/dark, a gradient for gradient. */
  background: string;
  /** True when the surface is dark enough that content must invert. */
  isDark: boolean;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  border: string;
  borderStrong: string;
  /** Cards floating on this surface. */
  card: string;
  cardBorder: string;
  cardShadow: string;
  cardShadowLg: string;
  /** Accent used as TEXT on this surface (contrast-corrected). */
  accentInk: string;
  /** Accent used as a soft fill (badges, icon chips) on this surface. */
  accentSoft: string;
  accentSoftBorder: string;
  /** The raw accent, for solid fills, and readable ink to sit on it. */
  accent: string;
  onAccent: string;
};

export type SectionTokens = {
  mode: SectionMode;
  font: SectionFont;
  fontFamily: string;
  accent: string;
  onAccent: string;
  /** The page ground, used when a section asks for no background of its own. */
  ground: string;
  /** Surfaces, pre-computed. Sections read these through `surfaceFor`. */
  surfaces: Record<SectionSurface["key"], SectionSurface>;
};

function buildSurface(
  key: SectionSurface["key"],
  background: string,
  base: {
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    border: string;
    borderStrong: string;
    card: string;
    cardBorder: string;
  },
  accent: string,
  /** Flat color behind `background` — used for contrast math when background is a gradient. */
  contrastBase: string,
  isDark: boolean
): SectionSurface {
  return {
    key,
    background,
    isDark,
    ...base,
    cardShadow: isDark
      ? "0 1px 2px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.35)"
      : "0 1px 2px rgba(15,23,42,0.05), 0 8px 24px rgba(15,23,42,0.06)",
    cardShadowLg: isDark
      ? "0 2px 4px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.45)"
      : "0 2px 6px rgba(15,23,42,0.06), 0 24px 60px rgba(15,23,42,0.10)",
    accentInk: ensureContrast(accent, contrastBase, 4.5),
    accentSoft: withAlpha(accent, isDark ? 0.2 : 0.12),
    accentSoftBorder: withAlpha(accent, isDark ? 0.38 : 0.24),
    accent,
    onAccent: readableInk(accent)
  };
}

/**
 * Build the full palette for one rendered product page.
 *
 * `mode` comes from `ProductSpec.theme.mode`, `accent` from
 * `ProductSpec.theme.accent`, `font` from `ProductSpec.theme.font`. All three
 * are optional and all three have sane, on-brand defaults.
 */
export function sectionTokens(
  mode?: SectionMode | null,
  accent?: string | null,
  font?: SectionFont | null
): SectionTokens {
  const resolvedMode: SectionMode =
    mode === "dark" || mode === "warm" || mode === "light" ? mode : "light";
  const resolvedFont: SectionFont =
    font === "serif" || font === "mono" || font === "sans" ? font : "sans";
  const brand = normalizeAccent(accent);
  const base = agentPageThemeTokens(resolvedMode);
  const modeIsDark = resolvedMode === "dark";

  // Tint: the page ground pulled a few percent toward the accent. Reads as a
  // band of color without ever fighting the text.
  const tintBg = mixHex(base.ground, brand, modeIsDark ? 0.08 : 0.05);
  const darkBg = modeIsDark ? mixHex(base.ground, "#000000", 0.35) : "#0b1220";
  const darkCard = mixHex(darkBg, "#ffffff", 0.07);

  const plain = buildSurface(
    "plain",
    base.ground,
    {
      ink: base.ink,
      inkMuted: base.inkMuted,
      inkSubtle: base.inkSubtle,
      border: base.border,
      borderStrong: base.borderStrong,
      card: base.card,
      cardBorder: base.borderStrong
    },
    brand,
    base.ground,
    modeIsDark
  );

  const tint = buildSurface(
    "tint",
    tintBg,
    {
      ink: base.ink,
      inkMuted: base.inkMuted,
      inkSubtle: base.inkSubtle,
      border: mixHex(base.border, brand, 0.1),
      borderStrong: mixHex(base.borderStrong, brand, 0.1),
      card: base.card,
      cardBorder: mixHex(base.borderStrong, brand, 0.12)
    },
    brand,
    tintBg,
    modeIsDark
  );

  const gradient = buildSurface(
    "gradient",
    `linear-gradient(180deg, ${withAlpha(brand, modeIsDark ? 0.22 : 0.13)} 0%, ${withAlpha(
      brand,
      modeIsDark ? 0.07 : 0.04
    )} 42%, ${base.ground} 100%)`,
    {
      ink: base.ink,
      inkMuted: base.inkMuted,
      inkSubtle: base.inkSubtle,
      border: mixHex(base.border, brand, 0.12),
      borderStrong: mixHex(base.borderStrong, brand, 0.12),
      card: base.card,
      cardBorder: mixHex(base.borderStrong, brand, 0.14)
    },
    brand,
    // Contrast is measured against the palest part of the gradient, which is
    // where text actually lands.
    mixHex(base.ground, brand, modeIsDark ? 0.14 : 0.09),
    modeIsDark
  );

  const dark = buildSurface(
    "dark",
    darkBg,
    {
      ink: "#f8fafc",
      inkMuted: "#cbd5e1",
      inkSubtle: "#94a3b8",
      border: withAlpha("#ffffff", 0.1),
      borderStrong: withAlpha("#ffffff", 0.16),
      card: darkCard,
      cardBorder: withAlpha("#ffffff", 0.12)
    },
    brand,
    darkBg,
    true
  );

  const onBrand = readableInk(brand);
  const accentSurface = buildSurface(
    "accent",
    brand,
    {
      ink: onBrand,
      inkMuted: withAlpha(onBrand, 0.82),
      inkSubtle: withAlpha(onBrand, 0.66),
      border: withAlpha(onBrand, 0.18),
      borderStrong: withAlpha(onBrand, 0.28),
      card: withAlpha(onBrand === "#ffffff" ? "#000000" : "#ffffff", 0.12),
      cardBorder: withAlpha(onBrand, 0.22)
    },
    // On a solid accent band the "accent" role has to become the ink color, or
    // accent-on-accent text would vanish.
    onBrand,
    brand,
    onBrand !== NEAR_BLACK
  );

  return {
    mode: resolvedMode,
    font: resolvedFont,
    fontFamily: FONT_STACKS[resolvedFont],
    accent: brand,
    onAccent: onBrand,
    ground: base.ground,
    surfaces: { plain, tint, gradient, dark, accent: accentSurface }
  };
}

/**
 * Resolve which surface a section paints on. `background` is the section
 * node's own token; `bgTone` is the universal style bag's override, which
 * wins when both are present.
 */
export function surfaceFor(
  tokens: SectionTokens,
  background?: "plain" | "tint" | "gradient" | "dark" | null,
  bgTone?: "none" | "tint" | "accent" | "dark" | null
): SectionSurface {
  if (bgTone === "accent") return tokens.surfaces.accent;
  if (bgTone === "dark") return tokens.surfaces.dark;
  if (bgTone === "tint") return tokens.surfaces.tint;
  if (bgTone === "none") return tokens.surfaces.plain;
  if (background === "dark") return tokens.surfaces.dark;
  if (background === "gradient") return tokens.surfaces.gradient;
  if (background === "tint") return tokens.surfaces.tint;
  return tokens.surfaces.plain;
}
