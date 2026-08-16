"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ClipboardList, MessageCircle, Phone, Sparkles, Wand2, X } from "lucide-react";
import { DesignBrainChat } from "./design-brain-chat";
import { AgentPageShell } from "@/components/agent-page/agent-page-shell";
import { ChatTemplate } from "@/components/agent-page/chat-template";
import { VoiceTemplate } from "@/components/agent-page/voice-template";
import { MediaTemplate } from "@/components/agent-page/media-template";
import { FormTemplate } from "@/components/agent-page/form-template";
import { FaceRenderer } from "@/components/agent-page/face-renderer";
import type {
  AgentPageData,
  AgentPageRuntime,
  AgentPageTemplate,
  DesignConfig,
  FaceBlueprint
} from "@/components/agent-page/types";

/**
 * PreviewPanel — the builder's default Test view.
 *
 * Renders THE REAL customer Face (the same chat/voice/media/form templates
 * that ship on the public /a/<slug> pages) inside a device frame, powered by
 * a preview AgentPageRuntime built from three engine callbacks the container
 * provides. When the graph carries product blocks (`blueprint`), the frame
 * shows the block-assembled page (FaceRenderer) instead — exactly like the
 * live page. The engines arrive as props; the one exception is the Design
 * Brain dock beside the frame, whose chat talks to the styling endpoint
 * itself and reports back through onDesignApplied so the frame refetches.
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
  /**
   * The product blocks the architect placed on their canvas (from the manage
   * endpoint, derived from the saved graph). Non-null means the graph decides
   * the product: the preview assembles the page from these blocks
   * (FaceRenderer) and the look pills hide. Null/undefined keeps the
   * template Faces exactly as before.
   */
  blueprint?: FaceBlueprint | null;
  /**
   * The saved Design Brain config (GET /agent-pages/manage/:id `design`).
   * Passed straight into the page data so the shell + templates render every
   * dial exactly like the live page; a change here live-updates the frame.
   * Null/undefined falls back to the design defaults.
   */
  design?: DesignConfig | null;
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
  /**
   * Called after the docked Design Brain lands a styling change so the
   * container refetches the saved page + design and the frame restyles
   * in front of the architect.
   */
  onDesignApplied?: () => void;
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
  blueprint = null,
  design = null,
  architectName,
  underReview = false,
  onSendChat,
  onStartVoice,
  onRunOnce,
  onOpenAdvanced,
  onDesignApplied
}: PreviewPanelProps) {
  // Below xl the Design Brain lives behind the floating "Style" pill; this
  // opens it as a slide-over sheet. On xl+ the dock is always visible and
  // this flag is ignored (pill and sheet chrome are hidden by CSS).
  const [dockOpen, setDockOpen] = useState(false);
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
      limits: { remainingToday: 1 },
      // The Design Brain dials — absent reads as defaults inside the shell.
      design: design ?? null
    }),
    [architectName, design, face, page, workflowId, workflowName]
  );

  return (
    <div
      className="relative flex h-full min-h-0 w-full overflow-hidden"
      style={DOT_GRID_STYLE}
      data-testid="preview-panel"
    >
      {/* Center: the device frame keeps its own centered, scrollable column —
          on xl+ the Design Brain dock sits beside it as a flex sibling, so
          the frame centers in the remaining space with no horizontal scroll. */}
      <div className="relative h-full min-h-0 min-w-0 flex-1">
        <div className="h-full min-h-0 w-full overflow-y-auto">
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
            {blueprint ? (
              // The architect placed product blocks on their canvas — the
              // preview assembles the page from them, exactly like /a/<slug>.
              <FaceRenderer
                data={data}
                slug={data.page.slug}
                runtime={runtime}
                blueprint={blueprint}
              />
            ) : (
              <>
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
              </>
            )}
          </AgentPageShell>
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-2xl flex-none flex-wrap items-center gap-x-3 gap-y-2 pb-1">
          {/* With product blocks on the canvas, the graph decides the product —
              the look pills would contradict it, so they step aside. */}
          {blueprint ? null : (
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
          )}

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

        {/* Below xl the dock hides behind this floating pill. */}
        <button
          type="button"
          onClick={() => setDockOpen(true)}
          data-testid="design-dock-toggle"
          className={
            "absolute bottom-5 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/30 transition hover:bg-rose-700 xl:hidden" +
            PILL_FOCUS_CLASSES
          }
        >
          <Wand2 className="h-4 w-4" aria-hidden="true" />
          Style
        </button>
      </div>

      {/* Small-screen scrim behind the slide-over — tap anywhere to close. */}
      {dockOpen ? (
        <button
          type="button"
          aria-label="Close styling"
          onClick={() => setDockOpen(false)}
          data-testid="design-dock-backdrop"
          className="absolute inset-0 z-30 bg-slate-900/30 xl:hidden"
        />
      ) : null}

      {/* The Design Brain dock: a fixed-width column beside the frame on xl+,
          a right slide-over sheet behind the "Style" pill below that. */}
      <aside
        data-testid="design-dock"
        data-open={dockOpen ? "true" : "false"}
        className={
          "absolute inset-y-0 right-0 z-40 flex w-[340px] max-w-[88vw] shrink-0 flex-col border-l border-gray-200 bg-white transition-transform duration-200 xl:static xl:z-auto xl:translate-x-0 xl:shadow-none " +
          (dockOpen ? "translate-x-0 shadow-2xl" : "translate-x-full shadow-none")
        }
      >
        <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 pb-3 pt-4">
          <div>
            <h3
              className="text-xs font-bold uppercase tracking-wider text-slate-400"
              data-testid="design-dock-title"
            >
              Design Brain
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500" data-testid="design-dock-intro">
              Type how it should look — watch it change.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDockOpen(false)}
            aria-label="Close"
            data-testid="design-dock-close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600 xl:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <DesignBrainChat variant="docked" workflowId={workflowId} onApplied={onDesignApplied} />
      </aside>
    </div>
  );
}
