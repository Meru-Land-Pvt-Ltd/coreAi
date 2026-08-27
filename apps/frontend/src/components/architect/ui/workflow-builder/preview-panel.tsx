"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  MessageCircle,
  Phone,
  Sparkles,
  X
} from "lucide-react";
import { AiBuilderPanel } from "./ai-builder-panel";
import { AgentPageShell } from "@/components/agent-page/agent-page-shell";
import { ChatTemplate } from "@/components/agent-page/chat-template";
import { VoiceTemplate } from "@/components/agent-page/voice-template";
import { MediaTemplate } from "@/components/agent-page/media-template";
import { FormTemplate } from "@/components/agent-page/form-template";
import { FaceRenderer } from "@/components/agent-page/face-renderer";
import type { ProductSpec } from "@coreai/shared";
import { SpecRunProvider, buildSpecTheme, useWiredNodeRenderer } from "@/components/agent-page/spec";
import { ProductSite, productHomePage, productPathForPageId } from "@/components/agent-page/spec/site";
import { BuyerSurface, type BuyerContractLite, type SurfaceSpec } from "@/components/buyer-surface/buyer-surface";
import { apiGet } from "@/lib/api";
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
 * floating AI Builder panel (bottom-right launcher), whose chat talks to
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
   * The saved ProductSpec — the whole product the AI Builder's Build mode
   * wrote (pages, copy, wires). Non-null means the architect built a product,
   * and the preview shows THAT — the real multi-page site — over the single
   * assembled Face. Absent/null keeps every pre-Build behavior untouched.
   */
  product?: ProductSpec | null;
  /**
   * True while the saved page/product is still being fetched. The stage stays
   * quiet rather than painting the built-in Face and swapping it a moment
   * later — an architect must never see a page they did not design.
   */
  configLoading?: boolean;
  /**
   * The saved AI Builder config (GET /agent-pages/manage/:id `design`).
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
  onRunOnce: (
    prompt: string,
    sessionId?: string,
    attachments?: Array<{ name: string; mimeType: string; data: string }>
  ) => Promise<PreviewRunResult>;
  /** The declared purpose, and where a newly saved one is reported. */
  purpose?: string;
  onPurposeSaved?: (purpose: string) => void;
  onOpenAdvanced: () => void;
  /**
   * Called after the floating AI Builder lands a styling change so the
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
  configLoading = false,
  design = null,
  architectName,
  underReview = false,
  arrangeMode = false,
  onArrangeExit,
  onSendChat,
  onStartVoice,
  onRunOnce,
  purpose = "",
  onPurposeSaved,
  onOpenAdvanced,
  onDesignApplied
}: PreviewPanelProps) {
  /* The AI Builder's own dock died with the founder's ruling
     (2026-08-27): one employee, one dock, mounted at the view level. */

  // Face priority: a manual pill pick wins; then the architect's saved page
  // template; then the backend's inferred default; last, the local node
  // heuristic for drafts we know nothing about. (Voice outranks media.)
  const autoFace: AgentPageTemplate = hasVoiceNode ? "voice" : hasMediaNode ? "media" : "chat";
  const face = page?.template ?? defaultTemplate ?? autoFace;

  // A built product (AI Builder "Build") outranks everything: the preview's
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
  // WHAT THE BUSINESS WILL SEE.
  //
  // The preview is no longer a website preview. An architect builds a brain;
  // the people who pay for it never see a marketing page, they see a short
  // setup form and a daily screen of results. Previewing anything else taught
  // architects to design the wrong thing.
  const [buyerView, setBuyerView] = useState<{
    contract: BuyerContractLite;
    setup: SurfaceSpec;
    dashboard: SurfaceSpec;
  } | null>(null);
  const [buyerTab, setBuyerTab] = useState<"setup" | "results">("setup");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const response = await apiGet<{
        contract: BuyerContractLite;
        setup: SurfaceSpec;
        dashboard: SurfaceSpec;
      }>(`/agent-pages/manage/${workflowId}/buyer-preview`);
      if (alive && response.success && response.data) setBuyerView(response.data);
    })();
    return () => {
      alive = false;
    };
  }, [workflowId, product]);

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

      async runOnce({ prompt, sessionId, attachments }) {
        try {
          const result = await onRunOnce(prompt, sessionId, attachments);
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
      // The AI Builder dials — absent reads as defaults inside the shell.
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
          {configLoading ? (
            // Nothing is known yet about this agent's saved product, so the
            // stage holds still — a flash of a page the architect never
            // designed is worse than a beat of nothing. The spinner itself
            // only fades in after a third of a second, so a fast load looks
            // instant and a slow one still explains itself.
            <div
              className="flex h-full w-full items-center justify-center bg-white"
              data-testid="preview-panel-loading"
            >
              <span
                className="h-6 w-6 animate-spin rounded-full border-2 border-amber-200 border-t-amber-500 opacity-0 [animation-delay:0ms] motion-reduce:animate-none"
                style={{ animation: "spin 0.7s linear infinite, preview-hold-fade 0.2s ease-out 0.33s forwards" }}
              />
            </div>
          ) : buyerView && (buyerView.setup || buyerView.dashboard) ? (
            // The buyer's own screens, rendered by the buyer's own component.
            // Not a mock-up of them — the same code, the same stored design,
            // in test mode. What an architect signs off here is exactly what
            // their customer opens.
            <div className="h-full w-full overflow-y-auto bg-white" data-testid="preview-panel-buyer-surfaces">
              <div className="mx-auto max-w-3xl px-6 py-6">
                <div className="mb-4 flex w-fit gap-1 rounded-lg border border-gray-200 bg-white p-1">
                  {(["setup", "results"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setBuyerTab(option)}
                      data-testid={`preview-buyer-tab-${option}`}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        buyerTab === option ? "bg-amber-500 text-white shadow-sm shadow-amber-500/30" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {option === "setup" ? "What the business fills in" : "What the business sees"}
                    </button>
                  ))}
                </div>
                <BuyerSurface
                  spec={buyerTab === "setup" ? buyerView.setup : buyerView.dashboard}
                  contract={buyerView.contract}
                  mode="test"
                  emptyMessage={
                    buyerTab === "setup"
                      ? "This agent doesn't need anything from the business yet."
                      : "Nothing measurable yet — add a step that calls, books or saves someone."
                  }
                />
              </div>
            </div>
          ) : productSpec && productPage ? (
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

      {/* Preview is the customer's page, and a customer never sees a word about
          review. The review notice belongs on Build, where it already is — here
          it floated over the product an architect was trying to look at, and
          told them the one thing they could not do anything about.

          An engine snag stays: that is the page failing to answer, which is
          something a customer would see and an architect must. */}
      {engineSnag ? (
        <div
          role="status"
          data-testid="preview-panel-error"
          className="absolute left-1/2 top-4 z-30 flex w-[min(90%,32rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-2.5 text-center text-sm leading-relaxed text-amber-900 shadow-lg backdrop-blur"
        >
          <span>Your agent hit a snag answering. Try again.</span>
        </div>
      ) : null}

      {/* The costume switcher died with the founder's ruling (2026-08-27):
          the agent's real face comes from its graph — never from a toy bar
          a paying customer could mistake for the product. */}

      {/* The AI Builder dock is mounted ONCE at the view level now (the
          founder's ruling, 2026-08-27) — one employee, every tab, no twin. */}
    </div>
  );
}
