import type { ContentWidth, DesignConfig } from "./types";

/**
 * Theme tokens for published agent pages — the single mapping from the Design
 * Brain's `theme` dial to concrete colors. The shell applies `ground`/`ink` at
 * its root so every template inherits a sensible base; chat consumes the rest
 * for bubbles, chips and the composer. All values are inline-style colors
 * except the two `*Class` entries, which exist because inline styles cannot
 * reach `::placeholder` or focus rings.
 *
 * "light" reproduces the classic page exactly. "dark" is a hand-tuned slate
 * palette (legible, not a naive inversion). "warm" is cream ground with
 * warm-stone ink and amber-tinted hairlines.
 */
export type AgentPageThemeTokens = {
  /** Page background. */
  ground: string;
  /** Sticky header backdrop (translucent — sits over ground with blur). */
  surfaceTranslucent: string;
  /** Cards, assistant bubbles, chips, the composer field. */
  card: string;
  /** Primary text. */
  ink: string;
  /** Secondary text (welcome copy, card bodies). */
  inkMuted: string;
  /** Tertiary text (taglines). */
  inkSubtle: string;
  /** Faintest text (footer byline). */
  inkFaint: string;
  /** Hairline borders (header/footer rules, assistant bubble edge). */
  border: string;
  /** Stronger borders (inputs, chips, flat-thread rules). */
  borderStrong: string;
  /** The visitor's own bubble. */
  userBubbleBg: string;
  /** Typing-indicator dots. */
  typingDot: string;
  errorBg: string;
  errorBorder: string;
  errorText: string;
  /** Tailwind class for the composer placeholder color. */
  placeholderClass: string;
  /** Tailwind classes for the composer focus border + ring. */
  composerFocusClass: string;
};

const THEME_TOKENS: Record<DesignConfig["theme"], AgentPageThemeTokens> = {
  light: {
    ground: "#ffffff",
    surfaceTranslucent: "rgba(255, 255, 255, 0.9)",
    card: "#ffffff",
    ink: "#0f172a",
    inkMuted: "#475569",
    inkSubtle: "#64748b",
    inkFaint: "#94a3b8",
    border: "#f3f4f6",
    borderStrong: "#e5e7eb",
    userBubbleBg: "#fffbeb",
    typingDot: "#cbd5e1",
    errorBg: "#fef2f2",
    errorBorder: "#fee2e2",
    errorText: "#b91c1c",
    placeholderClass: "placeholder:text-slate-400",
    composerFocusClass: "focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
  },
  dark: {
    ground: "#0f172a",
    surfaceTranslucent: "rgba(15, 23, 42, 0.9)",
    card: "#1e293b",
    ink: "#f1f5f9",
    inkMuted: "#cbd5e1",
    inkSubtle: "#94a3b8",
    inkFaint: "#64748b",
    border: "#334155",
    borderStrong: "#334155",
    userBubbleBg: "#334155",
    typingDot: "#64748b",
    errorBg: "#451a1a",
    errorBorder: "#7f1d1d",
    errorText: "#fca5a5",
    placeholderClass: "placeholder:text-slate-500",
    composerFocusClass: "focus:border-amber-400 focus:ring-4 focus:ring-amber-400/20"
  },
  warm: {
    ground: "#faf6ef",
    surfaceTranslucent: "rgba(250, 246, 239, 0.9)",
    card: "#ffffff",
    ink: "#292524",
    inkMuted: "#57534e",
    inkSubtle: "#78716c",
    inkFaint: "#a8a29e",
    border: "#f0e6d3",
    borderStrong: "#e7dac0",
    userBubbleBg: "#f7ecd9",
    typingDot: "#d6c9ae",
    errorBg: "#fef2f2",
    errorBorder: "#fee2e2",
    errorText: "#b91c1c",
    placeholderClass: "placeholder:text-stone-400",
    composerFocusClass: "focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
  }
};

export function agentPageThemeTokens(theme: DesignConfig["theme"]): AgentPageThemeTokens {
  return THEME_TOKENS[theme] ?? THEME_TOKENS.light;
}

// ---------------------------------------------------------------------------
// Content width — how wide the page runs.
// ---------------------------------------------------------------------------

/**
 * The `contentWidth` dial as a max-width class.
 *
 * Every entry is `lg:`-prefixed on purpose: below 1024px the page always uses
 * the full width it has, minus the gutter. A phone is never narrowed by a
 * choice made for a desktop, and a tablet never leaves half its screen empty.
 * Above lg the dial decides — one reading column, the standard working width,
 * dashboard width, or edge to edge.
 *
 * Each value is a COMPLETE literal class string: Tailwind's scanner only sees
 * whole class names in source, so these must never be built by concatenation.
 */
export const AGENT_PAGE_CONTENT_WIDTH: Record<ContentWidth, string> = {
  compact: "lg:max-w-2xl",
  standard: "lg:max-w-4xl",
  wide: "lg:max-w-6xl",
  full: "lg:max-w-none"
};

/** Page gutter — content never touches the screen edge, at any width. */
export const AGENT_PAGE_GUTTER = "px-4 sm:px-6 lg:px-8";

/**
 * The shared content column class for the shell, the Face and the templates.
 * They all call this so the header, the body and the docked composer line up
 * to the same edges at every width.
 */
export function agentPageContentColumn(width?: ContentWidth | null): string {
  const cap = AGENT_PAGE_CONTENT_WIDTH[width ?? "standard"] ?? AGENT_PAGE_CONTENT_WIDTH.standard;
  return `mx-auto w-full ${AGENT_PAGE_GUTTER} ${cap}`;
}
