import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewPanel, type PreviewPanelProps } from "./preview-panel";

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

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("opens Advanced testing from the quiet toggle", async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);

    await user.click(screen.getByTestId("preview-panel-advanced-toggle"));
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

  it("never raises the snag card for a failed voice start — the Face explains it", async () => {
    const props = makeProps({ hasVoiceNode: true });
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);

    await user.click(screen.getByTestId("agent-page-voice-call"));

    expect(await screen.findByTestId("agent-page-voice-notice")).toBeTruthy();
    expect(screen.queryByTestId("preview-panel-error")).toBeNull();
  });
});
