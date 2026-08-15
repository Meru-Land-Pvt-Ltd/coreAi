/**
 * Shared contract for the published agent page (triven.ai/a/<slug>).
 *
 * `AgentPageData` mirrors the GET /agent-pages/:slug response `data` shape
 * exactly. Every template component (chat, voice, media, form) receives the
 * same `AgentPageTemplateProps` — keep this file the single source of truth.
 */

export type AgentPageTemplate = "chat" | "voice" | "media" | "form";

export type AgentPageData = {
  page: {
    slug: string;
    template: AgentPageTemplate;
    headline: string | null;
    welcomeMessage: string | null;
    suggestedPrompts: string[];
    accentColor: string | null;
    status: "LIVE";
  };
  listing: {
    id: string;
    name: string;
    tagline: string | null;
    shortDescription: string;
    iconUrl: string | null;
    category: string | null;
    pricingModel: "FREE" | "ONE_TIME" | "SUBSCRIPTION";
    priceCents: number;
    freeTrialEnabled: boolean;
    trialDays: number;
  };
  architect: { displayName: string; photoUrl: string | null } | null;
  limits: { remainingToday: number };
};

export type AgentPageTemplateProps = {
  data: AgentPageData;
  slug: string;
};

export const DEFAULT_AGENT_PAGE_ACCENT = "#f59e0b";

/** Accent color for CTAs and highlights, falling back to the Triven amber. */
export function agentPageAccent(data: AgentPageData): string {
  return data.page.accentColor?.trim() || DEFAULT_AGENT_PAGE_ACCENT;
}

/**
 * Readable text/icon color on top of the accent: white normally, deep slate
 * when the architect picked a light accent (e.g. a pastel yellow) that would
 * make white text illegible. Threshold keeps the default amber on white text.
 */
export function agentPageAccentForeground(accent: string): string {
  const hex = accent.replace(/^#/, "").trim();
  const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";

  const linearChannel = (index: number) => {
    const value = parseInt(full.slice(index * 2, index * 2 + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * linearChannel(0) + 0.7152 * linearChannel(1) + 0.0722 * linearChannel(2);

  return luminance > 0.55 ? "#0f172a" : "#ffffff";
}
