import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FaceRenderer } from "./face-renderer";
import type { AgentPageData, AgentPageRuntime, FaceBlueprint } from "./types";

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

  it("appends the selected style's hidden instructions to the prompt on run", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    renderFace(runtime);

    await user.click(screen.getAllByTestId("agent-block-preset")[0]);
    await user.type(screen.getByTestId("agent-block-prompt-input"), "A cat on a rooftop");
    await user.click(screen.getByTestId("agent-block-generate"));

    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe(
      "A cat on a rooftop\nin a vibrant anime style"
    );
    expect((await screen.findByTestId("agent-block-output-text")).textContent).toContain(
      "Here you go"
    );
  });

  it("prefixes the picked model's human label as prompt context; untouched picker adds nothing", async () => {
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
    expect(calls[0][0].prompt).toBe("First idea");
    // The label ("Best"), never the generated id ("best") — an id the
    // architect can't see means nothing to the AI.
    expect(calls[1][0].prompt).toBe("[model: Best]\nSecond idea");
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

    // The engine got the full augmented prompt…
    expect(runOnceMock(runtime).mock.calls[0][0].prompt).toBe(
      "[model: Fast]\nA fox\nin a vibrant anime style"
    );
    // …but the page shows only what the customer typed: no hidden style
    // instructions, no [model:] context — anywhere, including image alts.
    const page = document.body.textContent ?? "";
    expect(page).toContain("A fox");
    expect(page).not.toContain("[model:");
    expect(page).not.toContain("anime style");
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

  it("a Button press runs with the hidden [button:] prefix that never reaches the DOM", async () => {
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
    expect(calls[0][0].prompt).toContain("[button: Plan my yatra]");
    // The customer sees the button's words as their prompt — never the prefix.
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("[button:");
    expect(page).toContain("Plan my yatra");
  });

  it("a Button press includes composer text, style, and model context in the engine prompt", async () => {
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
      "[button: Make it]\n[model: Best]\nA red fort at dawn\nin anime style"
    );
    // Their own words are the shown prompt, not the button label.
    const page = document.body.textContent ?? "";
    expect(page).toContain("A red fort at dawn");
    expect(page).not.toContain("[button:");
    expect(page).not.toContain("[model:");
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
    expect(calls[0][0].prompt).toContain("[button: Plan my trip]");
    expect(calls[1][0].prompt).toContain("[button: Surprise me]");
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
