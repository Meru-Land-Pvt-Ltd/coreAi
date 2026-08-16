import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewPanel, type PreviewPanelProps } from "./preview-panel";

// The floating Design Brain talks to the styling endpoint itself — stub the
// wrapper so no test ever leaves the room.
const { designChatMock } = vi.hoisted(() => ({ designChatMock: vi.fn() }));

vi.mock("@/components/architect/features/api", () => ({
  designChat: designChatMock
}));

function makeProps(overrides?: Partial<PreviewPanelProps>): PreviewPanelProps {
  return {
    workflowId: "wf-1",
    workflowName: "Dental Receptionist",
    hasVoiceNode: false,
    hasMediaNode: false,
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
  designChatMock.mockReset();
});

// Unmount after every test too — a render left mounted past the file's end
// keeps scheduled React work alive into the worker's next test file.
afterEach(() => cleanup());

describe("PreviewPanel", () => {
  it("shows the caption and the real chat Face with the agent's name", () => {
    render(<PreviewPanel {...makeProps()} />);

    expect(screen.getByTestId("preview-panel-caption").textContent).toBe(
      "This is exactly what your customer will see."
    );
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

  it("opens Advanced testing from the quiet toolbar link", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);

    // The link lives inside the floating device toolbar now.
    const toolbar = screen.getByTestId("preview-device-switcher");
    await user.click(within(toolbar).getByTestId("preview-panel-advanced-toggle"));
    expect(props.onOpenAdvanced).toHaveBeenCalledTimes(1);
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
    // The caption and the advanced door stay exactly as before.
    expect(screen.getByTestId("preview-panel-caption").textContent).toBe(
      "This is exactly what your customer will see."
    );
    expect(screen.getByTestId("preview-panel-advanced-toggle")).toBeTruthy();
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

describe("PreviewPanel device switcher", () => {
  it("defaults to desktop: the page runs full-bleed with no frame chrome", () => {
    render(<PreviewPanel {...makeProps()} />);

    const surface = frame();
    expect(surface.getAttribute("data-device")).toBe("desktop");
    // Full-bleed: the surface fills the tab — no width cap, no card chrome.
    expect(surface.className).toContain("h-full w-full");
    expect(surface.className).not.toContain("max-w-");
    expect(surface.className).not.toContain("rounded");
    expect(surface.className).not.toContain("ring-");
    expect(
      screen.getByTestId("preview-device-desktop").getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("tablet wraps the same page in a centered 820px frame", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("preview-device-tablet"));

    const surface = frame();
    expect(surface.getAttribute("data-device")).toBe("tablet");
    expect(surface.className).toContain("max-w-[820px]");
    expect(
      screen.getByTestId("preview-device-tablet").getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("phone wraps the page in a 390px handset frame with a bezel and notch", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("preview-device-phone"));

    const surface = frame();
    expect(surface.getAttribute("data-device")).toBe("phone");
    expect(surface.className).toContain("max-w-[390px]");
    expect(surface.className).toContain("rounded-[2.5rem]");
    expect(screen.getByTestId("preview-panel-phone-notch")).toBeTruthy();

    // Back to desktop: full-bleed again, notch gone.
    await user.click(screen.getByTestId("preview-device-desktop"));
    expect(frame().getAttribute("data-device")).toBe("desktop");
    expect(screen.queryByTestId("preview-panel-phone-notch")).toBeNull();
  });

  it("keeps the chat transcript when switching devices — the Face never remounts", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello there{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    await user.click(screen.getByTestId("preview-device-phone"));
    await user.click(screen.getByTestId("preview-device-desktop"));

    expect(screen.getByTestId("agent-page-assistant-message").textContent).toBe(
      "Happy to help!"
    );
  });
});

describe("PreviewPanel floating Design Brain", () => {
  it("starts closed: only the launcher shows, the panel is tucked away", () => {
    render(<PreviewPanel {...makeProps()} />);

    expect(screen.getByTestId("design-float-toggle")).toBeTruthy();
    const panel = screen.getByTestId("design-dock");
    expect(panel.getAttribute("data-open")).toBe("false");
    expect(panel.className).toContain("opacity-0");
    expect(screen.queryByTestId("design-dock-backdrop")).toBeNull();
  });

  it("the launcher opens the panel: header, quiet line, chat, close all present", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("design-float-toggle"));

    const panel = screen.getByTestId("design-dock");
    expect(panel.getAttribute("data-open")).toBe("true");
    expect(panel.className).toContain("opacity-100");
    expect(within(panel).getByTestId("design-dock-title").textContent).toBe("Design Brain");
    expect(within(panel).getByTestId("design-dock-intro").textContent).toBe(
      "Type how it should look — watch it change."
    );
    expect(within(panel).getByTestId("design-dock-input")).toBeTruthy();
    expect(within(panel).getByTestId("design-dock-send")).toBeTruthy();

    // The close button tucks it away again.
    await user.click(within(panel).getByTestId("design-dock-close"));
    expect(panel.getAttribute("data-open")).toBe("false");
  });

  it("on phones the scrim raises behind the sheet and closes it on tap", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("design-float-toggle"));
    const backdrop = screen.getByTestId("design-dock-backdrop");
    expect(backdrop).toBeTruthy();

    await user.click(backdrop);
    expect(screen.getByTestId("design-dock").getAttribute("data-open")).toBe("false");
    expect(screen.queryByTestId("design-dock-backdrop")).toBeNull();
  });

  it("a send goes through the styling endpoint and refreshes the page", async () => {
    const onDesignApplied = vi.fn();
    designChatMock.mockResolvedValue({
      success: true,
      data: { reply: "Dark and moody now.", patch: { theme: "dark" }, design: null, page: null }
    });
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps({ onDesignApplied })} />);

    await user.click(screen.getByTestId("design-float-toggle"));
    await user.type(screen.getByTestId("design-dock-input"), "dark theme");
    await user.click(screen.getByTestId("design-dock-send"));

    await waitFor(() => {
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toBe(
        "Dark and moody now."
      );
    });
    expect(designChatMock).toHaveBeenCalledTimes(1);
    expect(designChatMock).toHaveBeenCalledWith("wf-1", { instruction: "dark theme" });
    expect(onDesignApplied).toHaveBeenCalledTimes(1);
    // Beside a live page there is no "check the Test tab" note to show.
    expect(screen.queryByTestId("design-dock-applied-note")).toBeNull();
  });

  it("a reply that changed nothing never refreshes the page", async () => {
    const onDesignApplied = vi.fn();
    designChatMock.mockResolvedValue({
      success: true,
      data: { reply: "I can change colors, layout, or wording — not that one.", patch: {}, design: null, page: null }
    });
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps({ onDesignApplied })} />);

    await user.click(screen.getByTestId("design-float-toggle"));
    await user.type(screen.getByTestId("design-dock-input"), "add a 3D globe");
    await user.click(screen.getByTestId("design-dock-send"));

    await waitFor(() =>
      expect(screen.getByTestId("design-dock-message-assistant")).toBeTruthy()
    );
    expect(onDesignApplied).not.toHaveBeenCalled();
  });

  it("Escape inside the panel closes it", async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...makeProps()} />);

    await user.click(screen.getByTestId("design-float-toggle"));
    expect(screen.getByTestId("design-dock").getAttribute("data-open")).toBe("true");

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("design-dock").getAttribute("data-open")).toBe("false");
  });
});
