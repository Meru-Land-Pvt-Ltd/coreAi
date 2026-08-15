/**
 * Shared contract for the published agent page (triven.ai/a/<slug>).
 *
 * `AgentPageData` mirrors the GET /agent-pages/:slug response `data` shape
 * exactly. Every template component (chat, voice, media, form) receives the
 * same `AgentPageTemplateProps` — keep this file the single source of truth.
 */

import { apiPost } from "@/lib/api";

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
  runtime: AgentPageRuntime;
};

/**
 * The engine behind a template. `live` is the published page talking to the
 * public /agent-pages/:slug API; `preview` is the builder's Test tab talking
 * to architect endpoints. Every method resolves to either its success payload
 * or `{ error, code? }` — branch with an `"error" in result` check. Limits:
 * a daily-limit failure always carries code "PAGE_LIMIT_REACHED" (voice may
 * also use "DEMO_LIMIT_REACHED"), including plain HTTP 429s, so templates
 * never inspect statuses.
 */
export type AgentPageRuntime = {
  mode: "live" | "preview";
  sendChat(args: {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
    sessionId?: string;
  }): Promise<
    | { reply: string; sessionId: string; remainingToday?: number }
    | { error: string; code?: string }
  >;
  startVoiceSession(): Promise<
    | {
        session: {
          publicKey: string;
          assistantId: string;
          assistantOverrides?: unknown;
          maxDurationSeconds?: number;
        };
      }
    | { error: string; code?: string }
  >;
  runOnce(args: {
    prompt: string;
    sessionId?: string;
  }): Promise<
    | { output: { text: string | null; mediaUrls: string[] }; remainingToday?: number }
    | { error: string; code?: string }
  >;
};

/** Response of POST /agent-pages/:slug/voice-session — a marketplace demo session. */
type PublicVoiceSession = {
  publicKey: string;
  assistantId: string;
  assistantOverrides?: Record<string, unknown>;
  listingId: string;
  maxDurationSeconds: number;
  remainingDemosToday: number;
};

/**
 * Collapse a failed public-API response into the runtime error shape,
 * preserving the templates' historical 429 handling: an HTTP 429 whose code
 * is not already a recognized limit code surfaces as "PAGE_LIMIT_REACHED".
 */
function publicRuntimeError(
  response: { error?: string; code?: string; status?: number },
  fallbackError: string
): { error: string; code?: string } {
  const limitByStatus =
    response.status === 429 &&
    response.code !== "PAGE_LIMIT_REACHED" &&
    response.code !== "DEMO_LIMIT_REACHED";
  return {
    error: response.error ?? fallbackError,
    code: limitByStatus ? "PAGE_LIMIT_REACHED" : response.code
  };
}

/**
 * The live runtime used by /a/<slug> — the exact fetch behavior the templates
 * had before the runtime existed, byte-for-byte on the wire.
 */
export function createPublicAgentPageRuntime(slug: string): AgentPageRuntime {
  return {
    mode: "live",

    async sendChat({ message, history, sessionId }) {
      const response = await apiPost<{
        reply: string;
        sessionId: string;
        remainingToday: number;
      }>(`/agent-pages/${slug}/chat`, {
        message,
        ...(history.length > 0 ? { history } : {}),
        ...(sessionId ? { sessionId } : {})
      });

      const payload = response.success ? response.data : undefined;
      if (payload) return payload;
      return publicRuntimeError(response, "Something went wrong.");
    },

    async startVoiceSession() {
      const response = await apiPost<{ session: PublicVoiceSession }>(
        `/agent-pages/${slug}/voice-session`,
        {}
      );

      const session = response.success ? response.data?.session : undefined;
      if (session) {
        return {
          session: {
            publicKey: session.publicKey,
            assistantId: session.assistantId,
            maxDurationSeconds: session.maxDurationSeconds,
            // The marketplace demo metadata rides inside the overrides so the
            // template passes the identical payload to the voice client.
            assistantOverrides: {
              ...(session.assistantOverrides ?? {}),
              metadata: { listingId: session.listingId, purpose: "MARKETPLACE_DEMO" }
            }
          }
        };
      }
      return publicRuntimeError(response, "We couldn't start the call right now.");
    },

    async runOnce({ prompt }) {
      // The public run endpoint has no session concept — sessionId is a
      // preview-runtime affordance and is intentionally not sent here.
      const response = await apiPost<{
        output: { text: string | null; mediaUrls: string[] };
        remainingToday: number;
      }>(`/agent-pages/${slug}/run`, { prompt });

      const payload = response.success ? response.data : undefined;
      if (payload) return payload;
      return publicRuntimeError(response, "Something went wrong.");
    }
  };
}

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
