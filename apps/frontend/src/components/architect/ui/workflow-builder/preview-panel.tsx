"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  MessageCircle,
  Phone,
  Sparkles,
  X
} from "lucide-react";
import { SmartDesignerPanel } from "./smart-designer-panel";
import { AgentPageShell } from "@/components/agent-page/agent-page-shell";
import { ChatTemplate } from "@/components/agent-page/chat-template";
import { VoiceTemplate } from "@/components/agent-page/voice-template";
import { MediaTemplate } from "@/components/agent-page/media-template";
import { FormTemplate } from "@/components/agent-page/form-template";
import { FaceRenderer } from "@/components/agent-page/face-renderer";
import type { ProductSpec } from "@coreai/shared";
import { SpecRunProvider, buildSpecTheme, useWiredNodeRenderer } from "@/components/agent-page/spec";
import { ProductSite, productHomePage, productPathForPageId } from "@/components/agent-page/spec/site";
import type {
  AgentPageData,
  AgentPageRuntime,
  AgentPageTemplate,
  DesignConfig,
  FaceBlueprint,
  FaceLayoutMap
} from "@/components/agent-page/types";
import { updateAgentPageConfig } from "@/components/architect/features/api";

/**
 * PreviewPanel — the builder's default Test view.
 *
 * Renders THE REAL customer Face (the same chat/voice/media/form templates
 * that ship on the public /a/<slug> pages) exactly like the live landing
 * page: full-bleed across the whole tab by default. The device on show
 * (desktop / tablet / phone) arrives as a prop — the switcher lives in the
 * main builder header — and tablet/phone wrap the very same page in a
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
   * Which device frame the stage shows. Owned by the view and switched from
   * the main builder header — the panel only renders what it is told.
   */
  device: PreviewDevice;
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
   * The saved ProductSpec — the whole product the Design Brain's Build mode
   * wrote (pages, copy, wires). Non-null means the architect built a product,
   * and the preview shows THAT — the real multi-page site — over the single
   * assembled Face. Absent/null keeps every pre-Build behavior untouched.
   */
  product?: ProductSpec | null;
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
  /**
   * Arrange mode (the header's "Arrange" pill). Only takes effect on the
   * desktop device with a block-assembled page; drops PATCH the layout via
   * the manage endpoint and report through onDesignApplied.
   */
  arrangeMode?: boolean;
  /** Escape inside the page (or any other exit) turns the pill off. */
  onArrangeExit?: () => void;
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

/**
 * The three ways an architect can look at their page — like a customer
 * would. Exported so the header switcher and the view share one vocabulary.
 */
export type PreviewDevice = "desktop" | "tablet" | "phone";

/**
 * The stage each device sits on. Desktop is the page itself — edge to edge,
 * nothing behind it. Tablet and phone center a device frame on a quiet
 * neutral stage.
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
  device,
  page = null,
  defaultTemplate,
  blueprint = null,
  product = null,
  design = null,
  architectName,
  underReview = false,
  arrangeMode = false,
  onArrangeExit,
  onSendChat,
  onStartVoice,
  onRunOnce,
  onOpenAdvanced,
  onDesignApplied
}: PreviewPanelProps) {
  // The Smart Designer — ONE door for everything design: it fixes the
  // composed interface itself and quietly routes packaging asks (sell page,
  // pricing, legal) to the packaging brain. One launcher owns the corner.
  const [smartOpen, setSmartOpen] = useState(false);
  const smartPanelRef = useRef<HTMLElement | null>(null);
  const smartLauncherRef = useRef<HTMLButtonElement | null>(null);

  // Closing hands focus back to the launcher — the panel goes inert the same
  // moment, and focus must never be left stranded inside an inert subtree.
  const closeSmart = () => {
    setSmartOpen(false);
    smartLauncherRef.current?.focus();
  };
  const openSmart = () => {
    setSmartOpen(true);
  };

  // Opening hands focus to the composer, same as the Design Brain dock.
  useEffect(() => {
    if (!smartOpen) return;
    smartPanelRef.current
      ?.querySelector<HTMLInputElement>("[data-testid='smart-designer-input']")
      ?.focus();
  }, [smartOpen]);

  // Face priority: a manual pill pick wins; then the architect's saved page
  // template; then the backend's inferred default; last, the local node
  // heuristic for drafts we know nothing about. (Voice outranks media.)
  const autoFace: AgentPageTemplate = hasVoiceNode ? "voice" : hasMediaNode ? "media" : "chat";
  const [pickedFace, setPickedFace] = useState<AgentPageTemplate | null>(null);
  const face = pickedFace ?? page?.template ?? defaultTemplate ?? autoFace;

  // A built product (Design Brain "Build") outranks everything: the preview's
  // promise is "what your customer will meet", and once a product exists,
  // that is the product. An empty spec reads as none.
  const productSpec = product && product.pages.length > 0 ? product : null;
  // Which of the product's pages is on show. Nav clicks switch it in place;
  // a rebuilt product that dropped the shown page falls back to home.
  const [productPageId, setProductPageId] = useState<string | null>(null);
  const productPage = useMemo(() => {
    if (!productSpec) return null;
    return (
      productSpec.pages.find((entry) => entry.id === productPageId) ??
      productHomePage(productSpec)
    );
  }, [productSpec, productPageId]);
  const productAccent = useMemo(
    () => (productSpec ? buildSpecTheme(productSpec.theme).accent : undefined),
    [productSpec]
  );
  const renderWiredNode = useWiredNodeRenderer();
  // The same slug the page config renders under — the spec runtime keys its
  // session on it, and product hrefs are built from it.
  const previewSlug = page?.slug ?? `preview-${workflowId}`;
  const handleProductNavigate = useCallback(
    (href: string) => {
      if (!productSpec) return;
      const target = productSpec.pages.find(
        (entry) => productPathForPageId(productSpec, previewSlug, entry.id) === href
      );
      if (target) setProductPageId(target.id);
    },
    [productSpec, previewSlug]
  );

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

  // Arrange Editor plumbing: a drop saves the full layout map through the
  // manage PATCH, then the container refetches so the preview (and the live
  // page next visit) holds the saved truth. A failed save still refetches —
  // the block then honestly snaps back to its last saved spot. Review-locked
  // agents never write, same rule as every other builder surface.
  const arrangeActive =
    arrangeMode && device === "desktop" && blueprint !== null && productSpec === null && !underReview;

  const handleArrangeCommit = useCallback(
    async (layout: FaceLayoutMap) => {
      try {
        await updateAgentPageConfig(workflowId, { design: { layout } });
      } catch {
        // The refetch below restores the saved arrangement.
      }
      onDesignApplied?.({});
    },
    [workflowId, onDesignApplied]
  );

  const handleArrangeReset = useCallback(async () => {
    try {
      await updateAgentPageConfig(workflowId, { design: { layout: {} } });
    } catch {
      // The refetch below restores the saved arrangement.
    }
    onDesignApplied?.({});
  }, [workflowId, onDesignApplied]);

  const handleArrangeExit = useCallback(() => {
    onArrangeExit?.();
  }, [onArrangeExit]);

  const arrangeHandlers = useMemo(
    () =>
      arrangeActive
        ? {
            onCommit: handleArrangeCommit,
            onReset: handleArrangeReset,
            onExit: handleArrangeExit
          }
        : null,
    [arrangeActive, handleArrangeCommit, handleArrangeReset, handleArrangeExit]
  );

  // The page config the Face renders. With a saved design we show it verbatim
  // (the preview promises "exactly what your customer will see"); otherwise a
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
      className="relative h-full min-h-0 w-full overflow-hidden bg-slate-100"
      data-testid="preview-panel"
    >
      {/* The page, exactly as a customer meets it. One frame element for all
          three devices so switching widths never remounts (or wipes) the Face
          inside — desktop is the page full-bleed, tablet and phone wrap the
          same page in a centered device frame. The device switcher lives in
          the main builder header, so nothing here ever covers the page. */}
      <div className={STAGE_CLASSES[device]}>
        <div className={FRAME_CLASSES[device]} data-device={device} data-testid="preview-panel-frame">
          {productSpec && productPage ? (
            // The architect BUILT a product — the preview shows the real
            // multi-page site with its wires live, exactly what /a/<slug>
            // serves once the agent is approved. The frame clips overflow, so
            // the site scrolls inside its own column, like a browser page.
            <div
              className="h-full w-full overflow-y-auto"
              data-testid="preview-panel-product-site"
            >
              <SpecRunProvider
                page={productPage}
                runtime={runtime}
                accent={productAccent}
                listingName={data.listing.name}
              >
                <ProductSite
                  slug={previewSlug}
                  product={productSpec}
                  page={productPage}
                  renderNode={renderWiredNode}
                  contentWidth={design?.contentWidth ?? null}
                  navigate={handleProductNavigate}
                />
              </SpecRunProvider>
            </div>
          ) : (
          <AgentPageShell data={data} runtime={runtime}>
            {blueprint ? (
              // The architect placed product blocks on their canvas — the
              // preview assembles the page from them, exactly like /a/<slug>.
              <FaceRenderer
                data={data}
                slug={data.page.slug}
                runtime={runtime}
                blueprint={blueprint}
                // Device frames are CSS widths, not real windows — tell the
                // renderer which flow to show instead of letting matchMedia
                // read the browser window behind the frame.
                layoutViewport={device === "desktop" ? "desktop" : "stacked"}
                arrange={arrangeHandlers}
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
          )}

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
          card floats near the top — the page stays visible. */}
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

      {/* With product blocks on the canvas (or a built product), the graph
          decides the product — the look pills would contradict it, so they
          step aside. Otherwise they float quietly at the bottom. */}
      {blueprint || productSpec ? null : (
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
                    ? "inline-flex flex-none items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
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

      {/* THE design launcher — one button owns the corner. The Smart Designer
          fixes the interface and routes packaging asks itself, so nothing
          else needs a door here. Fades out while its panel is up. */}
      <button
        type="button"
        ref={smartLauncherRef}
        onClick={openSmart}
        aria-expanded={smartOpen}
        aria-haspopup="dialog"
        tabIndex={smartOpen ? -1 : undefined}
        data-testid="smart-designer-toggle"
        className={
          "absolute bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:from-amber-500 hover:to-amber-600 motion-reduce:transition-none" +
          (smartOpen ? " pointer-events-none opacity-0" : " opacity-100") +
          PILL_FOCUS_CLASSES
        }
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Smart Designer
      </button>

      {/* Phone-size scrim behind the Smart Designer sheet — tap to close. */}
      {smartOpen ? (
        <button
          type="button"
          aria-label="Close Smart Designer"
          onClick={closeSmart}
          data-testid="smart-designer-backdrop"
          className="absolute inset-0 z-40 bg-slate-900/30 sm:hidden"
        />
      ) : null}

      {/* The floating Smart Designer panel — a sibling of the Design Brain
          dock, never a replacement. Same mount-and-fade mechanics. */}
      <section
        ref={smartPanelRef}
        role="dialog"
        aria-label="Smart Designer"
        inert={!smartOpen}
        data-testid="smart-designer-dock"
        data-open={smartOpen ? "true" : "false"}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeSmart();
        }}
        className={
          "absolute bottom-4 right-4 z-50 flex h-[min(65vh,560px)] max-h-[calc(100%-2rem)] w-[380px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/25 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none max-sm:inset-x-3 max-sm:bottom-3 max-sm:h-[70vh] max-sm:w-auto max-sm:max-w-none " +
          (smartOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0")
        }
      >
        <div className="flex flex-none items-start justify-between gap-2 border-b border-gray-100 px-4 pb-3 pt-4">
          <div className="min-w-0">
            <h3
              className="text-xs font-bold uppercase tracking-wider text-slate-400"
              data-testid="smart-designer-title"
            >
              Smart Designer
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500" data-testid="smart-designer-dock-intro">
              Generate your product&apos;s interface — then fix it by talking.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSmart}
            aria-label="Close"
            data-testid="smart-designer-close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <SmartDesignerPanel
          workflowId={workflowId}
          // A composed interface exists when the saved ProductSpec does (the
          // composer writes the spec, not canvas blocks) — or when the graph
          // carries product blocks. Checking only blocks locked the chat
          // behind a pointless re-Generate after every page reload.
          hasComposedSpec={productSpec !== null || blueprint !== null}
          onApplied={onDesignApplied}
        />
      </section>
    </div>
  );
}
