import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sanitizeProductSpec } from "@coreai/shared";
import { PreviewPanel, type PreviewPanelProps } from "./preview-panel";

// The product site's nav falls back to real router navigation when no
// override is passed — the preview must never take that path, so the spy is
// shared and asserted against.
const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, prefetch: vi.fn(), replace: vi.fn() })
}));

// The floating Packaging chat talks to the product-chat endpoint itself —
// stub the wrapper so no test ever leaves the room.
const { productChatMock } = vi.hoisted(() => ({ productChatMock: vi.fn() }));

vi.mock("@/components/architect/features/api", () => ({
  productChat: productChatMock,
  // The Arrange Editor's layout PATCH — never exercised by these tests, but
  // the panel imports it, so the mocked module must carry it.
  updateAgentPageConfig: vi.fn().mockResolvedValue({ success: true })
}));

function makeProps(overrides?: Partial<PreviewPanelProps>): PreviewPanelProps {
  return {
    workflowId: "wf-1",
    workflowName: "Dental Receptionist",
    hasVoiceNode: false,
    hasMediaNode: false,
    device: "desktop",
    onSendChat: vi
      .fn()
      .mockResolvedValue({ reply: "Happy to help!", sessionId: "session-1" }),
    onStartVoice: vi.fn().mockResolvedValue({ error: "not used in this test" }),
    onRunOnce: vi
      .fn()
      .mockResolvedValue({ output: { text: "Done!", mediaUrls: [] } }),
    onOpenAdvanced: vi.fn(),
    ...overrides
  };
}

function faceSlot(id: "chat" | "media" | "form") {
  return screen.getByTestId(`preview-panel-face-slot-${id}`);
}

function frame() {
  return screen.getByTestId("preview-panel-frame");
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  productChatMock.mockReset();
});

// Unmount after every test too — a render left mounted past the file's end
// keeps scheduled React work alive into the worker's next test file.
afterEach(() => cleanup());

describe("PreviewPanel", () => {
  it("shows the real chat Face with the agent's name — no toolbar chrome above it", () => {
    render(<PreviewPanel {...makeProps()} />);

    // The device switcher lives in the main builder header now — the stage
    // itself is full-bleed with no strip of its own.
    expect(screen.queryByTestId("preview-device-switcher")).toBeNull();
    expect(screen.queryByTestId("preview-panel-caption")).toBeNull();
    const chat = screen.getByTestId("agent-page-chat");
    expect(chat).toBeTruthy();
    expect(screen.getByTestId("agent-page-name").textContent).toBe("Dental Receptionist");
    expect(within(chat).getByTestId("agent-page-headline").textContent).toBe(
      "Dental Receptionist"
    );
    // The Face must look real: the CTA is present even in preview.
    expect(screen.getByTestId("agent-page-cta").tagName).toBe("BUTTON");
  });

  it("sends a typed message through onSendChat and renders the real reply", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello there{Enter}");

    expect(props.onSendChat).toHaveBeenCalledWith("Hello there", [], undefined);
    expect((await screen.findByTestId("agent-page-assistant-message")).textContent).toBe(
      "Happy to help!"
    );
  });

  it("auto-selects the voice Face when the draft can talk", () => {
    render(<PreviewPanel {...makeProps({ hasVoiceNode: true })} />);
    expect(screen.getByTestId("agent-page-voice")).toBeTruthy();
  });

  it("auto-selects the create Face when the draft makes media (voice still wins)", () => {
    render(<PreviewPanel {...makeProps({ hasMediaNode: true })} />);
    expect(faceSlot("media").hasAttribute("hidden")).toBe(false);

    cleanup();
    render(<PreviewPanel {...makeProps({ hasMediaNode: true, hasVoiceNode: true })} />);
    expect(screen.getByTestId("agent-page-voice")).toBeTruthy();
    expect(faceSlot("media").hasAttribute("hidden")).toBe(true);
  });

  it("switches Faces locally through the pills", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("preview-panel-face-form"));
    expect(faceSlot("form").hasAttribute("hidden")).toBe(false);
    expect(faceSlot("chat").hasAttribute("hidden")).toBe(true);

    await user.click(screen.getByTestId("preview-panel-face-chat"));
    expect(faceSlot("chat").hasAttribute("hidden")).toBe(false);
  });

  it("keeps the chat transcript when switching Faces and back", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello there{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    await user.click(screen.getByTestId("preview-panel-face-form"));
    await user.click(screen.getByTestId("preview-panel-face-chat"));

    expect(screen.getByTestId("agent-page-assistant-message").textContent).toBe(
      "Happy to help!"
    );
  });

  it("renders the saved page design verbatim — template, headline, welcome, prompts", () => {
    render(
      <PreviewPanel
        {...makeProps()}
        page={{
          slug: "smile-studio",
          template: "form",
          headline: "Book your visit",
          welcomeMessage: "We usually reply in seconds.",
          suggestedPrompts: ["Prices", "Opening hours"],
          accentColor: "#2563eb",
          status: "LIVE"
        }}
      />
    );

    // The saved template wins over the node heuristic.
    expect(faceSlot("form").hasAttribute("hidden")).toBe(false);
    const form = screen.getByTestId("agent-page-form");
    expect(within(form).getByTestId("agent-page-headline").textContent).toBe(
      "Book your visit"
    );
  });

  it("shows the architect byline in the footer when provided", () => {
    render(<PreviewPanel {...makeProps({ architectName: "Haridas M." })} />);
    expect(screen.getByTestId("agent-page-footer").textContent).toContain(
      "Built by Haridas M."
    );
  });

  it("explains the pause while the agent is under review", () => {
    render(<PreviewPanel {...makeProps({ underReview: true })} />);
    expect(screen.getByTestId("preview-panel-review-lock").textContent).toContain(
      "Testing is paused while your agent is under review."
    );
    expect(screen.queryByTestId("preview-panel-error")).toBeNull();
  });

  it("turns an engine crash into a friendly snag card — never a raw error", async () => {
    const props = makeProps({
      onSendChat: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:5432"))
    });
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");

    const snag = await screen.findByTestId("preview-panel-error");
    expect(snag.textContent).toContain("Your agent hit a snag answering.");
    expect(document.body.textContent).not.toContain("ECONNREFUSED");
    // The Face shows its own retry affordance alongside.
    expect(screen.getByTestId("agent-page-error")).toBeTruthy();

    await user.click(screen.getByTestId("preview-panel-error-advanced"));
    expect(props.onOpenAdvanced).toHaveBeenCalledTimes(1);
  });

  it("clears the snag card after the next successful reply", async () => {
    const onSendChat = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ reply: "Back on track", sessionId: "session-2" });
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps({ onSendChat })} />);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");
    await screen.findByTestId("preview-panel-error");

    await user.click(screen.getByTestId("agent-page-retry"));
    await screen.findByTestId("agent-page-assistant-message");

    expect(screen.queryByTestId("preview-panel-error")).toBeNull();
  });

  it("assembles the page from product blocks when a blueprint arrives — pills step aside", () => {
    render(
      <PreviewPanel
        {...makeProps()}
        blueprint={{
          blocks: [
            { type: "block.prompt_composer", config: { placeholder: "Describe it" } },
            { type: "block.output_stage", config: { kind: "auto" } }
          ]
        }}
      />
    );

    // The block-assembled page replaces the template switch entirely.
    expect(screen.getByTestId("agent-page-face")).toBeTruthy();
    expect(screen.getByTestId("agent-block-prompt-composer")).toBeTruthy();
    expect(screen.queryByTestId("preview-panel-face-slot-chat")).toBeNull();
    // The graph decides the product now — no look pills.
    expect(screen.queryByTestId("preview-panel-face-switcher")).toBeNull();
  });

  it("never raises the snag card for a failed voice start — the Face explains it", async () => {
    const props = makeProps({ hasVoiceNode: true });
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);

    await user.click(screen.getByTestId("agent-page-voice-call"));

    expect(await screen.findByTestId("agent-page-voice-notice")).toBeTruthy();
    expect(screen.queryByTestId("preview-panel-error")).toBeNull();
  });
});

describe("PreviewPanel device frames", () => {
  // The switcher itself lives in the main builder header (builder-header
  // tests cover it) — the panel just renders whichever device it is handed.

  it("desktop runs the page full-bleed with no frame chrome", () => {
    render(<PreviewPanel {...makeProps({ device: "desktop" })} />);

    const surface = frame();
    expect(surface.getAttribute("data-device")).toBe("desktop");
    // Full-bleed: the surface fills the tab — no width cap, no card chrome.
    expect(surface.className).toContain("h-full w-full");
    expect(surface.className).not.toContain("max-w-");
    expect(surface.className).not.toContain("rounded");
    expect(surface.className).not.toContain("ring-");
  });

  it("tablet wraps the same page in a centered 820px frame", () => {
    render(<PreviewPanel {...makeProps({ device: "tablet" })} />);

    const surface = frame();
    expect(surface.getAttribute("data-device")).toBe("tablet");
    expect(surface.className).toContain("max-w-[820px]");
  });

  it("phone wraps the page in a 390px handset frame with a bezel and notch", () => {
    const props = makeProps();
    const { rerender } = render(<PreviewPanel {...props} device="phone" />);

    const surface = frame();
    expect(surface.getAttribute("data-device")).toBe("phone");
    expect(surface.className).toContain("max-w-[390px]");
    expect(surface.className).toContain("rounded-[2.5rem]");
    expect(screen.getByTestId("preview-panel-phone-notch")).toBeTruthy();

    // Back to desktop: full-bleed again, notch gone.
    rerender(<PreviewPanel {...props} device="desktop" />);
    expect(frame().getAttribute("data-device")).toBe("desktop");
    expect(screen.queryByTestId("preview-panel-phone-notch")).toBeNull();
  });

  it("keeps the chat transcript when the device prop changes — the Face never remounts", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    const { rerender } = render(<PreviewPanel {...props} device="desktop" />);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello there{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    rerender(<PreviewPanel {...props} device="phone" />);
    rerender(<PreviewPanel {...props} device="desktop" />);

    expect(screen.getByTestId("agent-page-assistant-message").textContent).toBe(
      "Happy to help!"
    );
  });
});

describe("PreviewPanel design corner", () => {
  it("one launcher owns the corner: Smart Designer only, no second pill, no old dock", () => {
    render(<PreviewPanel {...makeProps()} />);

    expect(screen.getByTestId("smart-designer-toggle")).toBeTruthy();
    // The old Design Brain / Packaging launcher and dock are gone for good.
    expect(screen.queryByTestId("design-float-toggle")).toBeNull();
    expect(screen.queryByTestId("design-dock")).toBeNull();
  });

  it("the launcher opens the Smart Designer panel and close hands the corner back", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("smart-designer-toggle"));
    const panel = screen.getByTestId("smart-designer-dock");
    expect(panel.getAttribute("data-open")).toBe("true");

    await user.click(screen.getByTestId("smart-designer-close"));
    expect(panel.getAttribute("data-open")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// A BUILT product (Design Brain "Build" mode) must be visible in the preview.
// This is the regression that shipped once: product-chat saved a whole
// multi-page product, the chat said "done", and no builder surface rendered
// it — the architect saw nothing change.
// ---------------------------------------------------------------------------
describe("PreviewPanel with a built product", () => {
  const spec = sanitizeProductSpec({
    version: 1,
    theme: { accent: "#f59e0b", mode: "light", font: "sans" },
    nav: {
      brand: { text: "Weather Outlook" },
      links: [
        { label: "Home", pageId: "home" },
        { label: "Pricing", pageId: "pricing" }
      ]
    },
    pages: [
      {
        id: "home",
        path: "",
        title: "Home",
        blocks: [
          {
            id: "hero",
            type: "section",
            children: [
              { id: "h1", type: "heading", text: "Seven-day outlook, instantly", level: 1 }
            ]
          }
        ]
      },
      {
        id: "pricing",
        path: "pricing",
        title: "Pricing",
        blocks: [
          {
            id: "p1",
            type: "section",
            children: [{ id: "ph", type: "heading", text: "Simple pricing", level: 1 }]
          }
        ]
      }
    ]
  });

  beforeEach(() => routerPushMock.mockReset());

  it("sanity: the fixture survives the shared sanitizer", () => {
    expect(spec).not.toBeNull();
    expect(spec?.pages.length).toBe(2);
  });

  it("shows the built product site instead of the single Face", () => {
    render(<PreviewPanel {...makeProps({ product: spec })} />);

    expect(screen.getByTestId("preview-panel-product-site")).toBeTruthy();
    expect(screen.getByText("Seven-day outlook, instantly")).toBeTruthy();
    // The single-widget Face and its look pills step aside.
    expect(screen.queryByTestId("agent-page-chat")).toBeNull();
    expect(screen.queryByTestId("preview-panel-face-switcher")).toBeNull();
  });

  it("nav clicks switch pages in place — the builder never navigates away", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps({ product: spec })} />);

    await user.click(screen.getAllByRole("link", { name: "Pricing" })[0]);

    expect(await screen.findByText("Simple pricing")).toBeTruthy();
    expect(screen.queryByText("Seven-day outlook, instantly")).toBeNull();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("a product with no pages changes nothing — the Face stays", () => {
    const empty = sanitizeProductSpec({ version: 1, nav: { links: [] }, pages: [] });
    render(<PreviewPanel {...makeProps({ product: empty })} />);

    expect(screen.queryByTestId("preview-panel-product-site")).toBeNull();
    expect(screen.getByTestId("agent-page-chat")).toBeTruthy();
  });
});
