import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  composeEngineInstructions,
  FaceRenderer,
  type FaceArrangeHandlers
} from "./face-renderer";
import {
  AGENT_PAGE_DESIGN_DEFAULTS,
  type AgentPageData,
  type AgentPageRuntime,
  type DesignConfig,
  type FaceBlueprint,
  type FaceLayoutMap
} from "./types";

vi.mock("@/lib/api", () => ({ apiPost: vi.fn() }));

function pageData(): AgentPageData {
  return {
    page: {
      slug: "dream-studio-abc123",
      template: "media",
      headline: "Create anything you can imagine",
      welcomeMessage: "Pick a style, describe your idea, and go.",
      suggestedPrompts: [],
      accentColor: null,
      status: "LIVE"
    },
    listing: {
      id: "listing-1",
      name: "Dream Studio",
      tagline: "Images in seconds",
      shortDescription: "An image agent.",
      iconUrl: null,
      category: "Creative",
      pricingModel: "SUBSCRIPTION",
      priceCents: 4900,
      freeTrialEnabled: true,
      trialDays: 7
    },
    architect: { displayName: "Ada", photoUrl: null },
    limits: { remainingToday: 20 }
  };
}

function fullBlueprint(): FaceBlueprint {
  return {
    blocks: [
      {
        type: "block.preset_gallery",
        config: {
          presets: [
            { id: "anime", title: "Anime", emoji: "🎌", promptFragment: "in a vibrant anime style" },
            { id: "noir", title: "Noir", emoji: "🎞️", promptFragment: "as moody film noir" }
          ]
        }
      },
      { type: "block.prompt_composer", config: { placeholder: "Describe your scene…" } },
      {
        type: "block.model_picker",
        config: { options: [{ id: "fast", label: "Fast" }, { id: "best", label: "Best" }] }
      },
      { type: "block.output_stage", config: { kind: "auto" } },
      { type: "block.continue_chain", config: { label: "Keep going" } },
      { type: "block.history_shelf", config: {} }
    ]
  };
}

function previewRuntime(overrides?: Partial<AgentPageRuntime>): AgentPageRuntime {
  return {
    mode: "preview",
    sendChat: vi.fn().mockResolvedValue({ error: "not used in this test" }),
    startVoiceSession: vi.fn().mockResolvedValue({ error: "not used in this test" }),
    runOnce: vi
      .fn()
      .mockResolvedValue({ output: { text: "Here you go", mediaUrls: [] } }),
    ...overrides
  };
}

function renderFace(runtime: AgentPageRuntime, blueprint: FaceBlueprint = fullBlueprint()) {
  return render(
    <FaceRenderer
      data={pageData()}
      slug="dream-studio-abc123"
      runtime={runtime}
      blueprint={blueprint}
    />
  );
}

function runOnceMock(runtime: AgentPageRuntime): Mock {
  return runtime.runOnce as Mock;
}

/** True when `first` appears before `second` in the document. */
function precedes(first: HTMLElement, second: HTMLElement): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The instruction block's closing line — every composed engine prompt ends with it. */
const ANSWER_NOW =
  "Answer now using ALL of the information above. Do not ask again for anything the customer already provided.";

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FaceRenderer", () => {
  it("renders the blocks in blueprint order with their configured content", () => {
    renderFace(previewRuntime());

    const gallery = screen.getByTestId("agent-block-preset-gallery");
    const composer = screen.getByTestId("agent-block-prompt-composer");
    const picker = screen.getByTestId("agent-block-model-picker");
    const stage = screen.getByTestId("agent-block-output-stage");

    expect(precedes(gallery, composer)).toBe(true);
    expect(precedes(composer, picker)).toBe(true);
    expect(precedes(picker, stage)).toBe(true);

    expect(screen.getByTestId("agent-page-headline").textContent).toBe(
      "Create anything you can imagine"
    );
    expect(
      screen.getByTestId("agent-block-prompt-input").getAttribute("placeholder")
    ).toBe("Describe your scene…");
    expect(screen.getAllByTestId("agent-block-preset")).toHaveLength(2);
    expect(screen.getAllByTestId("agent-block-model-pill")).toHaveLength(2);

    // Continue and history only exist after a successful run.
    expect(screen.queryByTestId("agent-block-continue")).toBeNull();
    expect(screen.queryByTestId("agent-block-history-shelf")).toBeNull();
  });

  it("threads the selected style into the engine prompt as an instruction block", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime);

    await user.click(screen.getAllByTestId("agent-block-preset")[0]);
    await user.type(screen.getByTestId("agent-block-prompt-input"), "A cat on a rooftop");
    await user.click(screen.getByTestId("agent-block-generate"));

    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe(
      [
        "The customer selected style: 'Anime' — in a vibrant anime style.",
        "The customer wrote: A cat on a rooftop",
        ANSWER_NOW
      ].join("\n")
    );
    expect((await screen.findByTestId("agent-block-output-text")).textContent).toContain(
      "Here you go"
    );
  });

  it("threads the picked model's human label as an instruction line; untouched picker stays bare", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime);

    await user.type(screen.getByTestId("agent-block-prompt-input"), "First idea");
    await user.click(screen.getByTestId("agent-block-generate"));
    await screen.findByTestId("agent-block-output-text");

    await user.click(screen.getAllByTestId("agent-block-model-pill")[1]);
    await user.type(screen.getByTestId("agent-block-prompt-input"), "Second idea");
    await user.click(screen.getByTestId("agent-block-generate"));

    const calls = runOnceMock(runtime).mock.calls;
    // Plain typed text with nothing else selected travels as-is — no scaffold.
    expect(calls[0][0].prompt).toBe("First idea");
    // The label ("Best"), never the generated id ("best") — an id the
    // architect can't see means nothing to the AI.
    expect(calls[1][0].prompt).toBe(
      [
        "The customer selected option: 'Best'.",
        "The customer wrote: Second idea",
        ANSWER_NOW
      ].join("\n")
    );
  });

  it("tapping the selected model pill again clears the choice", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime);

    const pill = screen.getAllByTestId("agent-block-model-pill")[0];
    await user.click(pill);
    expect(pill.getAttribute("data-selected")).toBe("true");
    await user.click(pill);
    expect(pill.getAttribute("data-selected")).toBe("false");

    await user.type(screen.getByTestId("agent-block-prompt-input"), "Plain");
    await user.click(screen.getByTestId("agent-block-generate"));
    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe("Plain");
  });

  it("never shows the customer the augmented engine prompt — only their own words", async () => {
    const runtime = previewRuntime({
      runOnce: vi
        .fn()
        .mockResolvedValue({ output: { text: null, mediaUrls: ["data:image/png;base64,x"] } })
    });
    const user = userEvent.setup();
    renderFace(runtime);

    await user.click(screen.getAllByTestId("agent-block-preset")[0]);
    await user.click(screen.getAllByTestId("agent-block-model-pill")[0]);
    await user.type(screen.getByTestId("agent-block-prompt-input"), "A fox");
    await user.click(screen.getByTestId("agent-block-generate"));
    await screen.findByTestId("agent-block-output-tile");

    // The engine got the full instruction block…
    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe(
      [
        "The customer selected style: 'Anime' — in a vibrant anime style.",
        "The customer selected option: 'Fast'.",
        "The customer wrote: A fox",
        ANSWER_NOW
      ].join("\n")
    );
    // …but the page shows only what the customer typed: no instruction lines,
    // no hidden style instructions — anywhere, including image alts.
    const page = document.body.textContent ?? "";
    expect(page).toContain("A fox");
    expect(page).not.toContain("The customer");
    expect(page).not.toContain("anime style");
    expect(page).not.toContain("Answer now using");
    expect(screen.getByTestId("agent-block-output-tile").querySelector("img")?.alt).toBe("A fox");
  });

  it("continue re-runs from the previous result on the same session", async () => {
    const runtime = previewRuntime({
      runOnce: vi
        .fn()
        .mockResolvedValue({ output: { text: "A rooftop cat at dusk", mediaUrls: [] } })
    });
    const user = userEvent.setup();
    renderFace(runtime);

    await user.type(screen.getByTestId("agent-block-prompt-input"), "A cat");
    await user.click(screen.getByTestId("agent-block-generate"));
    await screen.findByTestId("agent-block-output-text");

    await user.click(screen.getByTestId("agent-block-continue"));

    const calls = runOnceMock(runtime).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].prompt).toBe(
      "Continue from the previous result:\nA rooftop cat at dusk"
    );
    expect(calls[0][0].sessionId).toBeTruthy();
    expect(calls[1][0].sessionId).toBe(calls[0][0].sessionId);
  });

  it("repeated Continues never nest scaffolding or hidden instructions", async () => {
    // Media-only output: no text to chain from, so Continue falls back to the
    // prompt — which must stay the customer's original words, run after run.
    const runtime = previewRuntime({
      runOnce: vi
        .fn()
        .mockResolvedValue({ output: { text: null, mediaUrls: ["data:image/png;base64,x"] } })
    });
    const user = userEvent.setup();
    renderFace(runtime);

    await user.click(screen.getAllByTestId("agent-block-preset")[0]);
    await user.type(screen.getByTestId("agent-block-prompt-input"), "A fox");
    await user.click(screen.getByTestId("agent-block-generate"));
    await screen.findByTestId("agent-block-continue");

    await user.click(screen.getByTestId("agent-block-continue"));
    await user.click(screen.getByTestId("agent-block-continue"));

    const calls = runOnceMock(runtime).mock.calls;
    expect(calls[1][0].prompt).toBe("Continue from the previous result:\nA fox");
    // The third run is identical — no "Continue from…" pile-up, no re-appended
    // style fragment.
    expect(calls[2][0].prompt).toBe("Continue from the previous result:\nA fox");
  });

  it("restores an earlier result onto the stage from the history shelf", async () => {
    const runtime = previewRuntime({
      runOnce: vi
        .fn()
        .mockResolvedValueOnce({ output: { text: "First result", mediaUrls: [] } })
        .mockResolvedValueOnce({ output: { text: "Second result", mediaUrls: [] } })
    });
    const user = userEvent.setup();
    renderFace(runtime);

    await user.type(screen.getByTestId("agent-block-prompt-input"), "First");
    await user.click(screen.getByTestId("agent-block-generate"));
    await screen.findByTestId("agent-block-output-text");

    await user.type(screen.getByTestId("agent-block-prompt-input"), "Second");
    await user.click(screen.getByTestId("agent-block-generate"));
    expect((await screen.findByTestId("agent-block-output-text")).textContent).toContain(
      "Second result"
    );

    // Newest first — the older run is the second shelf item.
    const items = screen.getAllByTestId("agent-block-history-item");
    expect(items).toHaveLength(2);
    await user.click(items[1]);

    expect(screen.getByTestId("agent-block-output-text").textContent).toContain(
      "First result"
    );
  });

  it("shows placeholders for empty gallery/picker in the builder preview only", () => {
    const emptyBlocks: FaceBlueprint = {
      blocks: [
        { type: "block.preset_gallery", config: { presets: [] } },
        { type: "block.model_picker", config: { options: [] } }
      ]
    };

    renderFace(previewRuntime(), emptyBlocks);
    expect(screen.getByTestId("agent-block-preset-gallery-empty-hint")).toBeTruthy();
    expect(screen.getByTestId("agent-block-model-picker-empty-hint")).toBeTruthy();

    cleanup();

    // On the live customer page an empty section simply doesn't exist.
    renderFace(previewRuntime({ mode: "live" }), emptyBlocks);
    expect(screen.queryByTestId("agent-block-preset-gallery")).toBeNull();
    expect(screen.queryByTestId("agent-block-model-picker")).toBeNull();
  });

  // ----------------------------- Button block -----------------------------

  it("a Button press sends an instruction block that never reaches the DOM", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime, {
      blocks: [
        { type: "block.prompt_composer", config: {} },
        { type: "block.action_button", config: { label: "Plan my yatra" } },
        { type: "block.output_stage", config: { kind: "auto" } }
      ]
    });

    // Empty composer — button-only intent is a valid product.
    await user.click(screen.getByTestId("agent-block-button-0"));
    await screen.findByTestId("agent-block-output-text");

    const calls = runOnceMock(runtime).mock.calls;
    expect(calls[0][0].prompt).toBe(
      ["The customer pressed the button: 'Plan my yatra'.", ANSWER_NOW].join("\n")
    );
    // The customer sees the button's words as their prompt — never the scaffold.
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("The customer pressed");
    expect(page).not.toContain("Answer now using");
    expect(page).toContain("Plan my yatra");
  });

  it("a Button press threads composer text, style, and model into the instruction block", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime, {
      blocks: [
        {
          type: "block.preset_gallery",
          config: {
            presets: [{ id: "anime", title: "Anime", emoji: "🎌", promptFragment: "in anime style" }]
          }
        },
        { type: "block.prompt_composer", config: {} },
        {
          type: "block.model_picker",
          config: { options: [{ id: "best", label: "Best" }] }
        },
        { type: "block.action_button", config: { label: "Make it" } },
        { type: "block.output_stage", config: { kind: "auto" } }
      ]
    });

    await user.click(screen.getAllByTestId("agent-block-preset")[0]);
    await user.click(screen.getAllByTestId("agent-block-model-pill")[0]);
    await user.type(screen.getByTestId("agent-block-prompt-input"), "A red fort at dawn");
    await user.click(screen.getByTestId("agent-block-button-0"));
    await screen.findByTestId("agent-block-output-text");

    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe(
      [
        "The customer pressed the button: 'Make it'.",
        "The customer selected style: 'Anime' — in anime style.",
        "The customer selected option: 'Best'.",
        "The customer wrote: A red fort at dawn",
        ANSWER_NOW
      ].join("\n")
    );
    // Their own words are the shown prompt, not the button label.
    const page = document.body.textContent ?? "";
    expect(page).toContain("A red fort at dawn");
    expect(page).not.toContain("The customer pressed");
    expect(page).not.toContain("The customer selected");
    expect(page).not.toContain("Answer now using");
  });

  it("a maximum-length draft never costs the closing answer-now instruction", () => {
    // The engine prompt is capped at 4000 chars. The block must fit by
    // trimming the tail of the WRITTEN text — a blunt slice at the call site
    // would cut the block from the bottom and lose the answer-now order.
    const prompt = composeEngineInstructions({
      buttonLabel: "Plan my yatra",
      written: "x".repeat(4000)
    });

    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(prompt.startsWith("The customer pressed the button: 'Plan my yatra'.")).toBe(true);
    expect(prompt).toContain("The customer wrote: xxx");
    expect(prompt.endsWith(ANSWER_NOW)).toBe(true);
  });

  it("typed details plus a Button press reach the engine together (never re-ask)", async () => {
    // The founder's live repro: the customer typed "7 days with my family",
    // pressed 'Plan my yatra', and the brain asked "How many days?" — the
    // engine prompt must carry the typed words with the pressed button.
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime, {
      blocks: [
        { type: "block.prompt_composer", config: {} },
        { type: "block.action_button", config: { label: "Plan my yatra" } },
        { type: "block.output_stage", config: { kind: "auto" } }
      ]
    });

    await user.type(screen.getByTestId("agent-block-prompt-input"), "7 days with my family");
    await user.click(screen.getByTestId("agent-block-button-0"));
    await screen.findByTestId("agent-block-output-text");

    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe(
      [
        "The customer pressed the button: 'Plan my yatra'.",
        "The customer wrote: 7 days with my family",
        ANSWER_NOW
      ].join("\n")
    );
    // The page shows the customer their own words, never the scaffold.
    const page = document.body.textContent ?? "";
    expect(page).toContain("7 days with my family");
    expect(page).not.toContain("The customer wrote");
    expect(page).not.toContain("Answer now using");
  });

  it("multiple Buttons render as one row and run independently", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime, {
      blocks: [
        { type: "block.action_button", config: { label: "Plan my trip" } },
        { type: "block.output_stage", config: { kind: "auto" } },
        { type: "block.action_button", config: { label: "Surprise me" } }
      ]
    });

    // One row, both buttons in it — the second block adds nothing extra.
    expect(screen.getAllByTestId("agent-block-action-buttons")).toHaveLength(1);

    await user.click(screen.getByTestId("agent-block-button-0"));
    await screen.findByTestId("agent-block-output-text");
    await user.click(screen.getByTestId("agent-block-button-1"));

    const calls = runOnceMock(runtime).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].prompt).toContain("The customer pressed the button: 'Plan my trip'.");
    expect(calls[1][0].prompt).toContain("The customer pressed the button: 'Surprise me'.");
    // Same page session, like every other block.
    expect(calls[1][0].sessionId).toBe(calls[0][0].sessionId);
  });

  it("Buttons are disabled while a run is in flight", async () => {
    let release: (value: { output: { text: string; mediaUrls: string[] } }) => void = () => {};
    const runtime = previewRuntime({
      runOnce: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        })
      )
    });
    const user = userEvent.setup();
    renderFace(runtime, {
      blocks: [
        { type: "block.action_button", config: { label: "Go" } },
        { type: "block.output_stage", config: { kind: "auto" } }
      ]
    });

    const button = screen.getByTestId("agent-block-button-0");
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);
    await user.click(button);
    expect(runOnceMock(runtime).mock.calls).toHaveLength(1);

    release({ output: { text: "Done", mediaUrls: [] } });
    await screen.findByTestId("agent-block-output-text");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("skips unknown block types so future blocks never break older pages", () => {
    renderFace(previewRuntime(), {
      blocks: [
        { type: "block.something_new", config: {} },
        { type: "block.prompt_composer", config: {} }
      ]
    });

    expect(screen.getByTestId("agent-block-prompt-composer")).toBeTruthy();
    // Default placeholder when the config omits one.
    expect(
      screen.getByTestId("agent-block-prompt-input").getAttribute("placeholder")
    ).toBe("Describe what you want…");
  });
});

// ---------------------------------------------------------------------------
// Free-position layout (Arrange Editor)
// ---------------------------------------------------------------------------

function layoutPageData(layout: FaceLayoutMap): AgentPageData {
  return { ...pageData(), design: { ...AGENT_PAGE_DESIGN_DEFAULTS, layout } };
}

function arrangedBlueprint(): FaceBlueprint {
  return {
    blocks: [
      { type: "block.prompt_composer", nodeId: "node-composer", config: {} },
      { type: "block.output_stage", nodeId: "node-stage", config: { kind: "auto" } },
      {
        type: "block.model_picker",
        nodeId: "node-picker",
        config: { options: [{ id: "fast", label: "Fast" }] }
      }
    ]
  };
}

function arrangeHandlers(): FaceArrangeHandlers {
  return { onCommit: vi.fn(), onReset: vi.fn(), onExit: vi.fn() };
}

function renderArranged(options: {
  layout?: FaceLayoutMap;
  layoutViewport?: "auto" | "desktop" | "stacked";
  arrange?: FaceArrangeHandlers | null;
  blueprint?: FaceBlueprint;
}) {
  return render(
    <FaceRenderer
      data={layoutPageData(options.layout ?? {})}
      slug="dream-studio-abc123"
      runtime={previewRuntime()}
      blueprint={options.blueprint ?? arrangedBlueprint()}
      layoutViewport={options.layoutViewport}
      arrange={options.arrange ?? null}
    />
  );
}

/** Pointer events via MouseEvent — deterministic across jsdom versions. */
function pointer(target: Element | Window, type: string, init?: MouseEventInit) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

describe("FaceRenderer free-position layout", () => {
  it("positions blocks with layout entries on desktop; the rest flow below", () => {
    renderArranged({
      layout: { "node-composer": { x: 16, y: 24, w: 480 } },
      layoutViewport: "desktop"
    });

    const artboard = screen.getByTestId("agent-face-artboard");
    const positioned = screen.getAllByTestId("agent-face-positioned-block");
    expect(positioned).toHaveLength(1);
    expect(positioned[0].style.left).toBe("16px");
    expect(positioned[0].style.top).toBe("24px");
    expect(positioned[0].style.width).toBe("480px");
    expect(within(positioned[0]).getByTestId("agent-block-prompt-composer")).toBeTruthy();
    // The artboard clears the lowest positioned block (fallback height in jsdom).
    expect(artboard.style.minHeight).not.toBe("");

    // Blocks without entries keep the stacked flow, below the artboard.
    const picker = screen.getByTestId("agent-block-model-picker");
    expect(precedes(artboard, picker)).toBe(true);
    expect(artboard.contains(picker)).toBe(false);
  });

  it("small screens always keep the clean stacked flow, ignoring layout", () => {
    renderArranged({
      layout: { "node-composer": { x: 16, y: 24, w: 480 } },
      layoutViewport: "stacked"
    });

    expect(screen.queryByTestId("agent-face-artboard")).toBeNull();
    expect(screen.queryByTestId("agent-face-positioned-block")).toBeNull();
    // Natural blueprint order: composer before stage.
    expect(
      precedes(
        screen.getByTestId("agent-block-prompt-composer"),
        screen.getByTestId("agent-block-output-stage")
      )
    ).toBe(true);
  });

  it("defaults to the stacked flow when the viewport is unknown (SSR-safe)", () => {
    // jsdom has no matchMedia — exactly the SSR/first-paint situation, which
    // must read as stacked so a custom desktop layout never breaks phones.
    renderArranged({ layout: { "node-composer": { x: 16, y: 24 } } });
    expect(screen.queryByTestId("agent-face-artboard")).toBeNull();
  });

  it("dragging a positioned block snaps to the 8px grid and commits the full map", () => {
    const arrange = arrangeHandlers();
    renderArranged({
      layout: { "node-composer": { x: 8, y: 16, w: 400 } },
      layoutViewport: "desktop",
      arrange
    });

    const positioned = screen.getByTestId("agent-face-positioned-block");
    const handle = within(positioned).getByTestId("agent-face-arrange-block");

    pointer(handle, "pointerdown", { clientX: 100, clientY: 100 });
    pointer(window, "pointermove", { clientX: 153, clientY: 217 });
    // 8+53=61 → 64; 16+117=133 → 136 (nearest 8px gridline).
    pointer(window, "pointerup");

    expect(arrange.onCommit).toHaveBeenCalledTimes(1);
    expect(arrange.onCommit).toHaveBeenCalledWith({
      "node-composer": { x: 64, y: 136, w: 400 }
    });
    // Optimistic: the block sits at the dropped spot before any refetch.
    expect(positioned.style.left).toBe("64px");
    expect(positioned.style.top).toBe("136px");
  });

  it("dragging a flow block gives it an entry and preserves its siblings' spots", () => {
    const arrange = arrangeHandlers();
    renderArranged({
      layout: { "node-composer": { x: 8, y: 16, w: 400 } },
      layoutViewport: "desktop",
      arrange
    });

    // The stage has no entry yet — it flows, wrapped in a drag surface.
    const stage = screen.getByTestId("agent-block-output-stage");
    const handle = stage.closest("[data-testid='agent-face-arrange-block']") as HTMLElement;
    expect(handle).toBeTruthy();

    pointer(handle, "pointerdown", { clientX: 0, clientY: 0 });
    pointer(window, "pointermove", { clientX: 41, clientY: 79 });
    pointer(window, "pointerup");

    expect(arrange.onCommit).toHaveBeenCalledWith({
      "node-composer": { x: 8, y: 16, w: 400 },
      "node-stage": { x: 40, y: 80 }
    });
  });

  it("a plain click never pins a block — no movement, no save", () => {
    const arrange = arrangeHandlers();
    renderArranged({ layoutViewport: "desktop", arrange });

    const handles = screen.getAllByTestId("agent-face-arrange-block");
    pointer(handles[0], "pointerdown", { clientX: 50, clientY: 50 });
    pointer(window, "pointerup");

    expect(arrange.onCommit).not.toHaveBeenCalled();
  });

  it("arrange mode shows the reset button and makes block controls inert", async () => {
    const arrange = arrangeHandlers();
    const user = userEvent.setup();
    renderArranged({ layoutViewport: "desktop", arrange });

    // Inner controls sit behind pointer-events-none, so drags never Generate.
    expect(
      screen.getByTestId("agent-block-prompt-input").closest(".pointer-events-none")
    ).not.toBeNull();

    await user.click(screen.getByTestId("preview-arrange-reset"));
    expect(arrange.onReset).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(arrange.onExit).toHaveBeenCalledTimes(1);
  });

  it("with arrange off, no drag surfaces exist and blocks stay interactive", () => {
    renderArranged({
      layout: { "node-composer": { x: 16, y: 24, w: 480 } },
      layoutViewport: "desktop"
    });

    expect(screen.queryByTestId("agent-face-arrange-block")).toBeNull();
    expect(screen.queryByTestId("preview-arrange-reset")).toBeNull();
    expect(
      screen.getByTestId("agent-block-prompt-input").closest(".pointer-events-none")
    ).toBeNull();
  });
});

/**
 * The width dial (`design.contentWidth`).
 *
 * Two promises are worth a test each: the dial reaches the content column,
 * and it can never narrow a phone or a tablet — every cap is `lg:`-prefixed,
 * so below 1024px the page always uses the width it has, minus the gutter.
 */
describe("FaceRenderer — how wide the product runs", () => {
  function renderAtWidth(contentWidth: DesignConfig["contentWidth"]) {
    cleanup();
    return render(
      <FaceRenderer
        data={{ ...pageData(), design: { ...AGENT_PAGE_DESIGN_DEFAULTS, contentWidth } }}
        slug="dream-studio-abc123"
        runtime={previewRuntime()}
        blueprint={fullBlueprint()}
      />
    );
  }

  it("caps the content column at the width the architect picked", () => {
    for (const [contentWidth, cap] of [
      ["compact", "lg:max-w-2xl"],
      ["standard", "lg:max-w-4xl"],
      ["wide", "lg:max-w-6xl"],
      ["full", "lg:max-w-none"]
    ] as const) {
      renderAtWidth(contentWidth);
      expect(screen.getByTestId("agent-page-face-column").className).toContain(cap);
    }
  });

  it("falls back to the standard width when no dial is stored", () => {
    cleanup();
    renderFace(previewRuntime());
    expect(screen.getByTestId("agent-page-face-column").className).toContain("lg:max-w-4xl");
  });

  it("never narrows a phone or a tablet: every cap waits for lg", () => {
    for (const contentWidth of ["compact", "standard", "wide", "full"] as const) {
      renderAtWidth(contentWidth);
      const column = screen.getByTestId("agent-page-face-column").className;
      // No unprefixed or small-screen cap — only the lg: one.
      expect(column).not.toMatch(/(^|\s)max-w-/);
      expect(column).not.toContain("sm:max-w-");
      expect(column).not.toContain("md:max-w-");
      // ...and the content still keeps its distance from the screen edge.
      expect(column).toContain("px-4");
      expect(column).toContain("w-full");
    }
  });

  it("lines the docked composer up with the column above it", () => {
    cleanup();
    render(
      <FaceRenderer
        data={{
          ...pageData(),
          design: {
            ...AGENT_PAGE_DESIGN_DEFAULTS,
            contentWidth: "wide",
            composerPosition: "bottom"
          }
        }}
        slug="dream-studio-abc123"
        runtime={previewRuntime()}
        blueprint={fullBlueprint()}
      />
    );

    expect(screen.getByTestId("agent-page-face-composer-column").className).toContain(
      "lg:max-w-6xl"
    );
  });
});
