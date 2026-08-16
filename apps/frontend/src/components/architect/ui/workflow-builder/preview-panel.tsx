"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  MessageCircle,
  Monitor,
  Phone,
  Smartphone,
  Sparkles,
  Tablet,
  Wand2,
  X
} from "lucide-react";
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
 * that ship on the public /a/<slug> pages) exactly like the live landing
 * page: full-bleed across the whole tab by default, with a floating device
 * switcher (desktop / tablet / phone) that wraps the very same page in a
 * centered device frame instead. When the graph carries product blocks
 * (`blueprint`), the page is block-assembled (FaceRenderer) — exactly like
 * the live page. The engines arrive as props; the one exception is the
 * floating Design Brain panel (bottom-right launcher), whose chat talks to
 * the styling endpoint itself and reports back through onDesignApplied so
 * the page refetches and restyles in place.
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
   * dial exactly like the live page; a change here live-updates the preview.
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
   * Called after the floating Design Brain lands a styling change so the
   * container refetches the saved page + design and the preview restyles
   * in front of the architect. `graphChanged` true means the saved canvas
   * graph changed too and the builder reloads nodes/edges from the server.
   */
  onDesignApplied?: (result: { graphChanged?: boolean }) => void;
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

/** The three ways an architect can look at their page — like a customer would. */
type PreviewDevice = "desktop" | "tablet" | "phone";

const DEVICES: {
  id: PreviewDevice;
  label: string;
  icon: typeof Monitor;
}[] = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "phone", label: "Phone", icon: Smartphone }
];

/**
 * The stage each device sits on. Desktop is the page itself — edge to edge,
 * nothing behind it. Tablet and phone center a device frame on a quiet
 * neutral stage, with room reserved under the floating toolbar.
 */
const STAGE_CLASSES: Record<PreviewDevice, string> = {
  desktop: "absolute inset-0",
  tablet:
    "absolute inset-0 flex justify-center overflow-y-auto px-4 pb-6 pt-6 sm:px-6",
  phone:
    "absolute inset-0 flex justify-center overflow-y-auto px-4 pb-6 pt-6 sm:px-6"
};

/**
 * The frame itself — one element across all three devices so the Face inside
 * never remounts (a device switch must never wipe a transcript). `isolate`
 * keeps the shell's sticky header z-index inside the frame. Desktop has no
 * chrome at all: the product's own background is the page. The phone frame
 * carries a slim dark bezel for an honest handset feel.
 */
const FRAME_CLASSES: Record<PreviewDevice, string> = {
  desktop: "relative isolate h-full w-full overflow-hidden",
  tablet:
    "relative isolate my-auto h-full max-h-[1024px] min-h-[440px] w-full max-w-[820px] flex-none overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/10",
  phone:
    "relative isolate my-auto h-full max-h-[844px] min-h-[440px] w-full max-w-[390px] flex-none overflow-hidden rounded-[2.5rem] border-[6px] border-slate-900 bg-white shadow-2xl shadow-slate-900/25"
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
  // Which device the architect is previewing as. Desktop is the default —
  // the full-bleed page, exactly like visiting the live link.
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  // The floating Design Brain panel behind the bottom-right launcher.
  const [designOpen, setDesignOpen] = useState(false);
  const designPanelRef = useRef<HTMLElement | null>(null);
  const designLauncherRef = useRef<HTMLButtonElement | null>(null);

  // Closing hands focus back to the launcher — the panel goes inert the same
  // moment, and focus must never be left stranded inside an inert subtree.
  const closeDesign = () => {
    setDesignOpen(false);
    designLauncherRef.current?.focus();
  };
  // Face priority: a manual pill pick wins; then the architect's saved page
  // template; then the backend's inferred default; last, the local node
  // heuristic for drafts we know nothing about. (Voice outranks media.)
  const autoFace: AgentPageTemplate = hasVoiceNode ? "voice" : hasMediaNode ? "media" : "chat";
  const [pickedFace, setPickedFace] = useState<AgentPageTemplate | null>(null);
  const face = pickedFace ?? page?.template ?? defaultTemplate ?? autoFace;

  // True after an engine failure (thrown or returned); cleared by the next
  // success so the snag card never lingers over a working agent.
  const [engineSnag, setEngineSnag] = useState(false);

  // Opening the panel hands focus to its composer, so the architect can type
  // how the page should look without an extra click.
  useEffect(() => {
    if (!designOpen) return;
    designPanelRef.current
      ?.querySelector<HTMLInputElement>("[data-testid='design-dock-input']")
      ?.focus();
  }, [designOpen]);

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
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100"
      data-testid="preview-panel"
    >
      {/* Enterprise preview chrome: the device switcher lives in its own slim
          top bar — like Figma or Webflow — so it can never cover the page. */}
      <div
        data-testid="preview-device-switcher"
        className="flex h-12 flex-none items-center justify-center gap-1 border-b border-slate-200 bg-white px-3"
      >
        {DEVICES.map(({ id, label, icon: Icon }) => {
          const active = device === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setDevice(id)}
              data-testid={`preview-device-${id}`}
              className={
                (active
                  ? "inline-flex flex-none items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                  : "inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900") +
                PILL_FOCUS_CLASSES
              }
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}

        <span className="mx-1 hidden h-4 w-px flex-none bg-slate-200 md:block" aria-hidden="true" />
        <p
          className="hidden min-w-0 max-w-[260px] truncate text-[11px] font-medium text-slate-400 md:block"
          data-testid="preview-panel-caption"
        >
          This is exactly what your customer will see.
        </p>
        <span className="mx-1 h-4 w-px flex-none bg-slate-200" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpenAdvanced}
          data-testid="preview-panel-advanced-toggle"
          className={
            "flex-none rounded-full px-1.5 py-1 text-[11px] font-medium text-slate-400 underline-offset-4 transition hover:text-slate-600 hover:underline" +
            PILL_FOCUS_CLASSES
          }
        >
          Advanced testing
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
      {/* The page, exactly as a customer meets it. One frame element for all
          three devices so switching widths never remounts (or wipes) the Face
          inside — desktop is the page full-bleed, tablet and phone wrap the
          same page in a centered device frame. */}
      <div className={STAGE_CLASSES[device]}>
        <div className={FRAME_CLASSES[device]} data-device={device} data-testid="preview-panel-frame">
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

          {/* A slim handset notch hint, floating over the page top like the
              real thing — decorative only, never interactive. */}
          {device === "phone" ? (
            <div
              aria-hidden="true"
              data-testid="preview-panel-phone-notch"
              className="pointer-events-none absolute left-1/2 top-2 z-[60] h-[17px] w-24 -translate-x-1/2 rounded-full bg-slate-900"
            />
          ) : null}
        </div>
      </div>

      {/* While the agent is under review (or after an engine snag) a quiet
          card floats just under the toolbar — the page stays visible. */}
      {underReview ? (
        <div
          role="status"
          data-testid="preview-panel-review-lock"
          className="absolute left-1/2 top-4 z-30 w-[min(90%,32rem)] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white/95 px-4 py-2.5 text-center text-sm leading-relaxed text-slate-600 shadow-lg backdrop-blur"
        >
          Testing is paused while your agent is under review.
        </div>
      ) : engineSnag ? (
        <div
          role="status"
          data-testid="preview-panel-error"
          className="absolute left-1/2 top-4 z-30 flex w-[min(90%,32rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-2.5 text-center text-sm leading-relaxed text-amber-900 shadow-lg backdrop-blur"
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

      {/* With product blocks on the canvas, the graph decides the product —
          the look pills would contradict it, so they step aside. Otherwise
          they float quietly at the bottom, matching the toolbar. */}
      {blueprint ? null : (
        <div
          role="group"
          className="absolute bottom-[4.25rem] left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-slate-200/70 bg-white/95 p-1 shadow-lg shadow-slate-900/10 backdrop-blur sm:bottom-4"
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
                    ? "inline-flex flex-none items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                    : "inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900") +
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

      {/* The Design Brain launcher — bottom-right, always one tap away. It
          fades out while the panel is up (the panel owns that corner). */}
      <button
        type="button"
        ref={designLauncherRef}
        onClick={() => setDesignOpen(true)}
        aria-expanded={designOpen}
        aria-haspopup="dialog"
        tabIndex={designOpen ? -1 : undefined}
        data-testid="design-float-toggle"
        className={
          "absolute bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-600 hover:to-rose-700 motion-reduce:transition-none" +
          (designOpen ? " pointer-events-none opacity-0" : " opacity-100") +
          PILL_FOCUS_CLASSES
        }
      >
        <Wand2 className="h-4 w-4" aria-hidden="true" />
        Design
      </button>

      {/* Phone-size scrim behind the bottom sheet — tap anywhere to close. */}
      {designOpen ? (
        <button
          type="button"
          aria-label="Close styling"
          onClick={closeDesign}
          data-testid="design-dock-backdrop"
          className="absolute inset-0 z-40 bg-slate-900/30 sm:hidden"
        />
      ) : null}

      {/* The floating Design Brain panel. Stays mounted so open and close both
          animate (translate + fade); `inert` keeps its controls out of reach
          while hidden. On phones it becomes a near-full-width bottom sheet. */}
      <section
        ref={designPanelRef}
        role="dialog"
        aria-label="Design Brain"
        inert={!designOpen}
        data-testid="design-dock"
        data-open={designOpen ? "true" : "false"}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeDesign();
        }}
        className={
          "absolute bottom-4 right-4 z-50 flex h-[min(65vh,560px)] max-h-[calc(100%-2rem)] w-[380px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/25 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none max-sm:inset-x-3 max-sm:bottom-3 max-sm:h-[70vh] max-sm:w-auto max-sm:max-w-none " +
          (designOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0")
        }
      >
        <div className="flex flex-none items-start justify-between gap-2 border-b border-gray-100 px-4 pb-3 pt-4">
          <div className="min-w-0">
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
            onClick={closeDesign}
            aria-label="Close"
            data-testid="design-dock-close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <DesignBrainChat variant="docked" workflowId={workflowId} onApplied={onDesignApplied} />
      </section>
      </div>
    </div>
  );
}
