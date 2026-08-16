import type { DesignConfig } from "./types";

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
