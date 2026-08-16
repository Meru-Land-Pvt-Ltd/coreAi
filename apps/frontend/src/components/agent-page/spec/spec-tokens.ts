import type {
  FlexAlign,
  SpecAlign,
  SpecBgTone,
  SpecColumns,
  SpecGap,
  SpecMaxWidth,
  SpecPadding,
  SpecSize,
  SpecStyle
} from "@coreai/shared";
import type { CSSProperties } from "react";
import { surfaceInk, type SpecSurface } from "./spec-theme";

/**
 * Token → class maps. The spec can never hand the renderer a class or a rule;
 * it hands a token out of a closed set and this file decides what that token
 * paints. Every value is a COMPLETE literal string because Tailwind's scanner
 * only sees whole class names in source — never build one by concatenation.
 *
 * Mobile is the base case in every map: grids start at one column, rows start
 * stacked, and type steps UP at `sm:`/`lg:`. A page that has never been looked
 * at on a phone still works on a phone.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Rhythm.
// ---------------------------------------------------------------------------

/** Vertical air inside a section. `xl` is hero-sized. */
export const SECTION_PADDING: Record<SpecPadding, string> = {
  sm: "py-8 sm:py-10",
  md: "py-12 sm:py-16",
  lg: "py-16 sm:py-24",
  xl: "py-20 sm:py-28 lg:py-36"
};

/** The one content column every section shares — keeps edges aligned. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-5 sm:px-8";

export const STACK_GAP: Record<SpecGap, string> = {
  sm: "gap-3",
  md: "gap-5 sm:gap-6",
  lg: "gap-8 sm:gap-10"
};

export const GRID_GAP: Record<SpecGap, string> = {
  sm: "gap-4",
  md: "gap-5 sm:gap-6",
  lg: "gap-6 sm:gap-8"
};

export const ROW_GAP: Record<SpecGap, string> = {
  sm: "gap-2 sm:gap-3",
  md: "gap-3 sm:gap-4",
  lg: "gap-5 sm:gap-6"
};

/** Grids collapse to a single column on phones, always. */
export const GRID_COLUMNS: Record<SpecColumns, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
};

export const SPACER_HEIGHT: Record<SpecPadding, string> = {
  sm: "h-4",
  md: "h-8 sm:h-10",
  lg: "h-12 sm:h-16",
  xl: "h-20 sm:h-28"
};

// ---------------------------------------------------------------------------
// Alignment.
// ---------------------------------------------------------------------------

export const TEXT_ALIGN: Record<SpecAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
};

/** A column's cross-axis alignment (`stack`). */
export const STACK_ALIGN: Record<FlexAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  between: "items-stretch justify-between"
};

/**
 * A row's main-axis distribution. Unprefixed on purpose: a row WRAPS on small
 * screens rather than collapsing to a column, so its children keep their
 * natural size and the distribution keeps meaning at every width.
 */
export const ROW_JUSTIFY: Record<FlexAlign, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between"
};

/**
 * How a container's box alignment translates into its children's text align.
 * Explicit box alignment wins over whatever was inherited — a card that says
 * `align:"start"` inside a centered hero reads left, as the author meant.
 * `between` is about distribution, not reading direction, so it inherits.
 */
export const ALIGN_FROM_FLEX: Record<FlexAlign, SpecAlign | null> = {
  start: "left",
  center: "center",
  end: "right",
  between: null
};

export const MAX_WIDTH: Record<SpecMaxWidth, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  full: "max-w-none"
};

/** Centers a width-capped box when its content is centered or right-aligned. */
export const MAX_WIDTH_PLACEMENT: Record<SpecAlign, string> = {
  left: "",
  center: "mx-auto",
  right: "ml-auto"
};

// ---------------------------------------------------------------------------
// Type scale. One ramp for the whole product — headings never guess a size.
// ---------------------------------------------------------------------------

export const HEADING_SCALE: Record<1 | 2 | 3, string> = {
  1: "text-[2rem] leading-[1.1] sm:text-5xl sm:leading-[1.05] lg:text-6xl font-semibold tracking-tight text-balance",
  2: "text-[1.6rem] leading-[1.15] sm:text-4xl sm:leading-tight font-semibold tracking-tight text-balance",
  3: "text-lg leading-snug sm:text-xl font-semibold tracking-tight"
};

export const TEXT_SCALE: Record<SpecSize, string> = {
  sm: "text-sm leading-6",
  md: "text-base leading-7",
  lg: "text-lg leading-8 sm:text-xl sm:leading-9"
};

export const ICON_BOX: Record<SpecSize, string> = {
  sm: "h-8 w-8 rounded-lg",
  md: "h-11 w-11 rounded-xl",
  lg: "h-14 w-14 rounded-2xl"
};

export const ICON_PIXELS: Record<SpecSize, number> = { sm: 16, md: 20, lg: 26 };

export const IMAGE_RATIO: Record<"square" | "wide" | "tall" | "auto", string> = {
  square: "aspect-square",
  wide: "aspect-[16/9]",
  tall: "aspect-[3/4]",
  auto: ""
};

// ---------------------------------------------------------------------------
// Surfaces — the `style.bgTone` token turns any node into a card.
// ---------------------------------------------------------------------------

/** The shared card shell: soft edge, generous radius, restrained shadow. */
export const CARD_SHELL = "rounded-2xl p-5 sm:p-6 border";

export type ToneSurface = {
  /** Inline colors for the card shell. */
  style: CSSProperties;
  /** Ink surface children inside this card must read from. */
  surface: SpecSurface;
};

/**
 * Resolves a `bgTone` into a painted card. `none`/absent returns null, which
 * means "not a card" — the node stays transparent and inherits.
 */
export function bgToneSurface(tone: SpecBgTone | undefined, surface: SpecSurface): ToneSurface | null {
  const ink = surfaceInk(surface);
  switch (tone) {
    case "tint":
      // Deliberately the STRONG tint plus a shadow: a tint card is most often
      // dropped onto a tint band, and a card the same color as the band it
      // sits on is not a card. The lift is what makes it read.
      return {
        style: {
          background: surface === "dark" ? "var(--spec-inverse-tint)" : "var(--spec-tint-strong)",
          borderColor: ink.border,
          color: ink.ink,
          boxShadow: "var(--spec-shadow-sm)"
        },
        surface
      };
    case "accent":
      return {
        style: {
          background: "var(--spec-accent)",
          borderColor: "var(--spec-accent)",
          color: "var(--spec-accent-contrast)",
          boxShadow: "var(--spec-shadow)"
        },
        // An accent fill is a strong color: children read the contrast ink,
        // which the dark surface already resolves to.
        surface: "dark"
      };
    case "dark":
      return {
        style: {
          background: "var(--spec-inverse-ground)",
          borderColor: "var(--spec-inverse-border)",
          color: "var(--spec-inverse-ink)",
          boxShadow: "var(--spec-shadow)"
        },
        surface: "dark"
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tones — one palette shared by `badge.tone` and a stat's delta pill so a
// "success" never means two different greens on the same page.
// ---------------------------------------------------------------------------

export type ToneName = "neutral" | "accent" | "success" | "warning" | "danger";

type TonePaint = { fg: string; bg: string; border: string };

const TONE_ON_BASE: Record<Exclude<ToneName, "neutral" | "accent">, TonePaint> = {
  success: { fg: "#047857", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.28)" },
  warning: { fg: "#b45309", bg: "rgba(245, 158, 11, 0.14)", border: "rgba(245, 158, 11, 0.30)" },
  danger: { fg: "#b91c1c", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.28)" }
};

const TONE_ON_DARK: Record<Exclude<ToneName, "neutral" | "accent">, TonePaint> = {
  success: { fg: "#6ee7b7", bg: "rgba(16, 185, 129, 0.20)", border: "rgba(110, 231, 183, 0.34)" },
  warning: { fg: "#fcd34d", bg: "rgba(245, 158, 11, 0.22)", border: "rgba(252, 211, 77, 0.34)" },
  danger: { fg: "#fca5a5", bg: "rgba(239, 68, 68, 0.22)", border: "rgba(252, 165, 165, 0.34)" }
};

/** Paint for a small pill (badge, delta) on the surface it sits on. */
export function tonePaint(tone: ToneName | undefined, surface: SpecSurface): CSSProperties {
  const ink = surfaceInk(surface);
  if (!tone || tone === "neutral") {
    return { color: ink.muted, background: ink.borderSoft, borderColor: ink.border };
  }
  if (tone === "accent") {
    return {
      color: ink.accentInk,
      background: "var(--spec-accent-soft)",
      borderColor: "var(--spec-accent-line)"
    };
  }
  const paint = (surface === "dark" ? TONE_ON_DARK : TONE_ON_BASE)[tone];
  return { color: paint.fg, background: paint.bg, borderColor: paint.border };
}

/** The pill geometry every tone shares. */
export const PILL_SHELL =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium tracking-tight";

/**
 * The style bag a node applies for its own `style` tokens, minus color (color
 * belongs to the node, which knows whether it is ink, muted or a fill).
 */
export function styleBoxClasses(style: SpecStyle | undefined, inheritedAlign: SpecAlign): string {
  if (!style?.maxWidth) return "";
  const placement = MAX_WIDTH_PLACEMENT[style.align ?? inheritedAlign] ?? "";
  return cx(MAX_WIDTH[style.maxWidth], placement);
}
