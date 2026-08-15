"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ClipboardList, MessageCircle, Phone, Sparkles } from "lucide-react";
import { AgentPageShell } from "@/components/agent-page/agent-page-shell";
import { ChatTemplate } from "@/components/agent-page/chat-template";
import { VoiceTemplate } from "@/components/agent-page/voice-template";
import { MediaTemplate } from "@/components/agent-page/media-template";
import { FormTemplate } from "@/components/agent-page/form-template";
import type {
  AgentPageData,
  AgentPageRuntime,
  AgentPageTemplate
} from "@/components/agent-page/types";

/**
 * PreviewPanel — the builder's default Test view.
 *
 * Renders THE REAL customer Face (the same chat/voice/media/form templates
 * that ship on the public /a/<slug> pages) inside a device frame, powered by
 * a preview AgentPageRuntime built from three engine callbacks the container
 * provides. This component is pure: no API imports, no builder state — just
 * props in, the finished product out.
 */

type ChatHistoryTurn = { role: "user" | "assistant"; content: string };

/** Exactly what each runtime method resolves to — the container must match. */
export type PreviewChatResult = Awaited<ReturnType<AgentPageRuntime["sendChat"]>>;
export type PreviewVoiceResult = Awaited<ReturnType<AgentPageRuntime["startVoiceSession"]>>;
export type PreviewRunResult = Awaited<ReturnType<AgentPageRuntime["runOnce"]>>;

export type PreviewPanelProps = {
  workflowId: string;
  workflowName: string;
  hasVoiceNode: boolean;
  hasMediaNode: boolean;
  /**
   * The agent's saved customer-page design (GET /agent-pages/manage/:id).
   * When present, the preview shows it verbatim — accent, headline, welcome,
   * suggested prompts and saved template — exactly like the live page.
   * Null/undefined falls back to friendly built-in defaults.
   */
  page?: AgentPageData["page"] | null;
  /** Backend-inferred default template (from the manage endpoint). */
  defaultTemplate?: AgentPageTemplate;
  /** Shown in the page footer, exactly like the published page byline. */
  architectName?: string | null;
  /** While the agent is under review, testing is paused — say so plainly. */
  underReview?: boolean;
  onSendChat: (
    message: string,
    history: ChatHistoryTurn[],
    sessionId?: string
  ) => Promise<PreviewChatResult>;
  onStartVoice: () => Promise<PreviewVoiceResult>;
  onRunOnce: (prompt: string, sessionId?: string) => Promise<PreviewRunResult>;
  onOpenAdvanced: () => void;
};

/**
 * Shown to the Face when an engine callback throws. The templates render
 * their own friendly copy for `{ error }` results, so this string never
 * reaches the screen raw — it exists to satisfy the runtime shape.
 */
const ENGINE_SNAG_ERROR = "preview-engine-snag";

/** Per-face welcome line — plain, confident, zero plumbing words. */
const FACE_WELCOME: Record<AgentPageTemplate, string> = {
  chat: "Hi! I'm ready — ask me anything.",
  voice: "Hi! I'm ready — tap the button and let's talk.",
  media: "Describe what you'd like and I'll create it.",
  form: "Tell me what you need and I'll take care of the rest."
};

const FACES: {
  id: AgentPageTemplate;
  label: string;
  icon: typeof MessageCircle;
}[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "voice", label: "Voice", icon: Phone },
  { id: "media", label: "Create", icon: Sparkles },
  { id: "form", label: "Form", icon: ClipboardList }
];

/** The builder canvas dot grid (builder-styles.tsx .canvas-grid), inlined so
 *  this panel stays self-contained. */
const DOT_GRID_STYLE: CSSProperties = {
  backgroundColor: "#f7f8fa",
  backgroundImage: "radial-gradient(rgba(100, 116, 139, 0.3) 1px, transparent 1px)",
  backgroundSize: "22px 22px"
};

const PILL_FOCUS_CLASSES =
  " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1";

export function PreviewPanel({
  workflowId,
  workflowName,
  hasVoiceNode,
  hasMediaNode,
  page = null,
  defaultTemplate,
  architectName,
  underReview = false,
  onSendChat,
  onStartVoice,
  onRunOnce,
  onOpenAdvanced
}: PreviewPanelProps) {
  // Face priority: a manual pill pick wins; then the architect's saved page
  // template; then the backend's inferred default; last, the local node
  // heuristic for drafts we know nothing about. (Voice outranks media.)
  const autoFace: AgentPageTemplate = hasVoiceNode ? "voice" : hasMediaNode ? "media" : "chat";
  const [pickedFace, setPickedFace] = useState<AgentPageTemplate | null>(null);
  const face = pickedFace ?? page?.template ?? defaultTemplate ?? autoFace;

  // True after an engine failure (thrown or returned); cleared by the next
  // success so the snag card never lingers over a working agent.
  const [engineSnag, setEngineSnag] = useState(false);

  const runtime = useMemo<AgentPageRuntime>(
    () => ({
      mode: "preview",

      async sendChat({ message, history, sessionId }) {
        try {
          const result = await onSendChat(message, history, sessionId);
          setEngineSnag("error" in result);
          return result;
        } catch {
          setEngineSnag(true);
          return { error: ENGINE_SNAG_ERROR };
        }
      },

      async startVoiceSession() {
        // The voice Face fully explains a failed call start itself — no outer
        // snag card (whose copy talks about "answering") stacked on top.
        try {
          const result = await onStartVoice();
          if (!("error" in result)) setEngineSnag(false);
          return result;
        } catch {
          return { error: ENGINE_SNAG_ERROR };
        }
      },

      async runOnce({ prompt, sessionId }) {
        try {
          const result = await onRunOnce(prompt, sessionId);
          setEngineSnag("error" in result);
          return result;
        } catch {
          setEngineSnag(true);
          return { error: ENGINE_SNAG_ERROR };
        }
      }
    }),
    [onSendChat, onStartVoice, onRunOnce]
  );

  // The page config the Face renders. With a saved design we show it verbatim
  // (the caption promises "exactly what your customer will see"); otherwise a
  // minimal, real-looking default. Limits are a published-page concept;
  // preview templates ignore them entirely.
  const data = useMemo<AgentPageData>(
    () => ({
      page: page
        ? { ...page, template: face }
        : {
            slug: `preview-${workflowId}`,
            template: face,
            headline: null,
            welcomeMessage: FACE_WELCOME[face],
            suggestedPrompts: [],
            accentColor: null,
            status: "LIVE"
          },
      listing: {
        id: workflowId,
        name: workflowName.trim() || "Your agent",
        tagline: null,
        shortDescription: "",
        iconUrl: null,
        category: null,
        pricingModel: "FREE",
        priceCents: 0,
        freeTrialEnabled: false,
        trialDays: 0
      },
      architect: architectName?.trim()
        ? { displayName: architectName.trim(), photoUrl: null }
        : null,
      limits: { remainingToday: 1 }
    }),
    [architectName, face, page, workflowId, workflowName]
  );

  return (
    <div
      className="h-full min-h-0 w-full overflow-y-auto"
      style={DOT_GRID_STYLE}
      data-testid="preview-panel"
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <p
          className="text-center text-[13px] font-medium tracking-wide text-slate-500"
          data-testid="preview-panel-caption"
        >
          This is exactly what your customer will see.
        </p>

        {underReview ? (
          <div
            role="status"
            data-testid="preview-panel-review-lock"
            className="mx-auto mt-3 w-full max-w-2xl rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-center text-sm leading-relaxed text-slate-600 shadow-sm"
          >
            Testing is paused while your agent is under review.
          </div>
        ) : engineSnag ? (
          <div
            role="status"
            data-testid="preview-panel-error"
            className="mx-auto mt-3 flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm leading-relaxed text-amber-900"
          >
            <span>Your agent hit a snag answering. Try again or check</span>
            <button
              type="button"
              onClick={onOpenAdvanced}
              data-testid="preview-panel-error-advanced"
              className={
                "rounded font-semibold underline underline-offset-2 transition hover:text-amber-950" +
                PILL_FOCUS_CLASSES
              }
            >
              Advanced testing
            </button>
            <span>.</span>
          </div>
        ) : null}

        {/* The device frame — the real product, behind glass. `isolate` keeps
            the shell's sticky header z-index inside the frame. */}
        <div
          className="relative isolate mx-auto mt-4 min-h-[440px] w-full max-w-2xl flex-1 overflow-hidden rounded-3xl bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/10 lg:max-h-[860px]"
          data-testid="preview-panel-frame"
        >
          <AgentPageShell data={data} runtime={runtime}>
            {/* Chat, media and form stay mounted while hidden so switching
                looks never wipes a transcript or a feed of creations. Voice
                mounts only while active: leaving it hangs up and releases the
                microphone — a live call must never keep running unseen. */}
            <div
              className={face === "chat" ? "contents" : "hidden"}
              hidden={face !== "chat"}
              data-testid="preview-panel-face-slot-chat"
            >
              <ChatTemplate data={data} slug={data.page.slug} runtime={runtime} />
            </div>
            {face === "voice" ? (
              <VoiceTemplate data={data} slug={data.page.slug} runtime={runtime} />
            ) : null}
            <div
              className={face === "media" ? "contents" : "hidden"}
              hidden={face !== "media"}
              data-testid="preview-panel-face-slot-media"
            >
              <MediaTemplate data={data} slug={data.page.slug} runtime={runtime} />
            </div>
            <div
              className={face === "form" ? "contents" : "hidden"}
              hidden={face !== "form"}
              data-testid="preview-panel-face-slot-form"
            >
              <FormTemplate data={data} slug={data.page.slug} runtime={runtime} />
            </div>
          </AgentPageShell>
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-2xl flex-none flex-wrap items-center gap-x-3 gap-y-2 pb-1">
          <div
            role="group"
            className="flex flex-wrap items-center gap-1 rounded-full border border-gray-200 bg-white/85 p-1 shadow-sm backdrop-blur"
            aria-label="Choose a look"
            data-testid="preview-panel-face-switcher"
          >
            {FACES.map(({ id, label, icon: Icon }) => {
              const active = face === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPickedFace(id)}
                  data-testid={`preview-panel-face-${id}`}
                  className={
                    (active
                      ? "inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                      : "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900") +
                    PILL_FOCUS_CLASSES
                  }
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onOpenAdvanced}
            data-testid="preview-panel-advanced-toggle"
            className={
              "ml-auto rounded text-xs font-medium text-slate-400 underline-offset-4 transition hover:text-slate-600 hover:underline" +
              PILL_FOCUS_CLASSES
            }
          >
            Advanced testing
          </button>
        </div>
      </div>
    </div>
  );
}
