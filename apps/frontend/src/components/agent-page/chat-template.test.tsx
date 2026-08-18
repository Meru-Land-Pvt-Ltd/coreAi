import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatTemplate } from "./chat-template";
import {
  AGENT_PAGE_DESIGN_DEFAULTS,
  createPublicAgentPageRuntime,
  type AgentPageData,
  type AgentPageRuntime,
  type DesignConfig
} from "./types";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn()
}));

vi.mock("@/lib/api", () => ({ apiPost: mocks.apiPost }));

function pageData(
  overrides?: Partial<AgentPageData["limits"]>,
  design?: Partial<DesignConfig>
): AgentPageData {
  return {
    ...(design ? { design: { ...AGENT_PAGE_DESIGN_DEFAULTS, ...design } } : {}),
    page: {
      slug: "helpful-agent-abc123",
      template: "chat",
      headline: "Ask me anything about your bookings",
      welcomeMessage: "Hi! I can answer questions and help you get set up.",
      suggestedPrompts: ["What can you do?", "Help me get started"],
      accentColor: null,
      status: "LIVE"
    },
    listing: {
      id: "listing-1",
      name: "Helpful Agent",
      tagline: "Answers in seconds",
      shortDescription: "A helpful agent.",
      iconUrl: null,
      category: "Customer Service",
      pricingModel: "SUBSCRIPTION",
      priceCents: 4900,
      freeTrialEnabled: true,
      trialDays: 7
    },
    architect: { displayName: "Ada", photoUrl: null },
    limits: { remainingToday: 20, ...overrides }
  };
}

/** The live runtime over the mocked apiPost — the pre-runtime wire behavior. */
function liveRuntime(): AgentPageRuntime {
  return createPublicAgentPageRuntime("helpful-agent-abc123");
}

function previewRuntime(overrides?: Partial<AgentPageRuntime>): AgentPageRuntime {
  return {
    mode: "preview",
    sendChat: vi
      .fn()
      .mockResolvedValue({ reply: "Preview reply", sessionId: "preview-session" }),
    startVoiceSession: vi.fn().mockResolvedValue({ error: "not used in this test" }),
    runOnce: vi.fn().mockResolvedValue({ error: "not used in this test" }),
    ...overrides
  };
}

beforeEach(() => {
  cleanup();
  mocks.apiPost.mockReset().mockResolvedValue({
    success: true,
    data: { reply: "Happy to help!", sessionId: "session-1", remainingToday: 19 }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatTemplate", () => {
  it("shows the empty state and sends a typed message, then renders the reply", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );

    expect(screen.getByTestId("agent-page-headline").textContent).toBe(
      "Ask me anything about your bookings"
    );
    expect(screen.getByTestId("agent-page-welcome").textContent).toBe(
      "Hi! I can answer questions and help you get set up."
    );

    await user.type(screen.getByTestId("agent-page-composer"), "Hello there{Enter}");

    expect(mocks.apiPost).toHaveBeenCalledWith("/agent-pages/helpful-agent-abc123/chat", {
      message: "Hello there"
    });
    expect((await screen.findByTestId("agent-page-assistant-message")).textContent).toBe(
      "Happy to help!"
    );
    expect(screen.getByTestId("agent-page-user-message").textContent).toBe("Hello there");
  });

  it("sends history and the sessionId from the first reply on the second turn", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );

    await user.type(screen.getByTestId("agent-page-composer"), "First{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    await user.type(screen.getByTestId("agent-page-composer"), "Second{Enter}");

    expect(mocks.apiPost).toHaveBeenLastCalledWith("/agent-pages/helpful-agent-abc123/chat", {
      message: "Second",
      history: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Happy to help!" }
      ],
      sessionId: "session-1"
    });
  });

  it("sends a suggested prompt when its chip is tapped", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );

    await user.click(screen.getAllByTestId("agent-page-suggested-prompt")[0]);

    expect(mocks.apiPost).toHaveBeenCalledWith("/agent-pages/helpful-agent-abc123/chat", {
      message: "What can you do?"
    });
  });

  it("shows the limit card with a purchase CTA when the daily preview runs out", async () => {
    mocks.apiPost.mockResolvedValue({
      success: false,
      error: "This agent's free preview is done for today",
      code: "PAGE_LIMIT_REACHED",
      status: 429
    });

    const user = userEvent.setup();
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );

    await user.type(screen.getByTestId("agent-page-composer"), "One more{Enter}");

    await screen.findByTestId("agent-page-limit-card");
    expect(screen.getByTestId("agent-page-limit-cta").getAttribute("href")).toBe(
      "/agent/listing-1"
    );
    expect(screen.queryByTestId("agent-page-composer")).toBeNull();
  });

  it("offers a retry after a network failure and resends the same message", async () => {
    mocks.apiPost.mockResolvedValueOnce({
      success: false,
      error: "Something went wrong while connecting to server",
      code: "API_ERROR"
    });

    const user = userEvent.setup();
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");
    await screen.findByTestId("agent-page-error");

    await user.click(screen.getByTestId("agent-page-retry"));

    expect(mocks.apiPost).toHaveBeenLastCalledWith("/agent-pages/helpful-agent-abc123/chat", {
      message: "Hello"
    });
    expect((await screen.findByTestId("agent-page-assistant-message")).textContent).toBe(
      "Happy to help!"
    );
    expect(screen.queryByTestId("agent-page-error")).toBeNull();
  });

  it("preview mode talks to the runtime, not the public API", async () => {
    const runtime = previewRuntime();
    const user = userEvent.setup();
    render(<ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={runtime} />);

    await user.type(screen.getByTestId("agent-page-composer"), "Testing my draft{Enter}");

    expect(runtime.sendChat).toHaveBeenCalledWith({
      message: "Testing my draft",
      history: [],
      sessionId: undefined
    });
    expect((await screen.findByTestId("agent-page-assistant-message")).textContent).toBe(
      "Preview reply"
    );
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("preview mode never shows the limit card — not for zero remaining, not for limit errors", async () => {
    const runtime = previewRuntime({
      sendChat: vi
        .fn()
        .mockResolvedValue({ error: "limited", code: "PAGE_LIMIT_REACHED" })
    });
    const user = userEvent.setup();
    render(
      <ChatTemplate
        data={pageData({ remainingToday: 0 })}
        slug="helpful-agent-abc123"
        runtime={runtime}
      />
    );

    // remainingToday: 0 shows the limit card on the live page — not in preview.
    expect(screen.queryByTestId("agent-page-limit-card")).toBeNull();

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");
    await screen.findByTestId("agent-page-error");

    expect(screen.queryByTestId("agent-page-limit-card")).toBeNull();
  });

  it("default design centers the composer with the hero, then docks it after the first message", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );

    // ChatGPT feel: the composer starts inside the centered empty state.
    const centered = screen.getByTestId("agent-page-composer-centered");
    expect(centered.contains(screen.getByTestId("agent-page-composer"))).toBe(true);

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    // After the first message it docks to the bottom bar.
    expect(screen.queryByTestId("agent-page-composer-centered")).toBeNull();
    expect(screen.getByTestId("agent-page-composer")).toBeTruthy();
  });

  it('composerPosition "bottom" always docks the composer (Claude feel)', () => {
    render(
      <ChatTemplate
        data={pageData(undefined, { composerPosition: "bottom" })}
        slug="helpful-agent-abc123"
        runtime={liveRuntime()}
      />
    );

    expect(screen.queryByTestId("agent-page-composer-centered")).toBeNull();
    expect(screen.getByTestId("agent-page-empty-state")).toBeTruthy();
    expect(screen.getByTestId("agent-page-composer")).toBeTruthy();
  });

  it('bubbleStyle "flat" renders an editorial thread with left rules instead of bubbles', async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate
        data={pageData(undefined, { bubbleStyle: "flat" })}
        slug="helpful-agent-abc123"
        runtime={liveRuntime()}
      />
    );

    await user.type(screen.getByTestId("agent-page-composer"), "Hello there{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    expect(document.querySelector('[data-bubble-style="flat"]')).toBeTruthy();
    const userRow = screen.getByTestId("agent-page-user-message")
      .firstElementChild as HTMLElement;
    const assistantRow = screen.getByTestId("agent-page-assistant-message")
      .firstElementChild as HTMLElement;
    expect(userRow.className).toContain("border-l-2");
    expect(userRow.className).not.toContain("rounded-2xl");
    // The visitor's rule takes the accent; the agent's stays a hairline.
    expect(userRow.style.borderLeftColor).not.toBe(assistantRow.style.borderLeftColor);
    expect(assistantRow.className).toContain("border-l-2");
  });

  it("dark theme colors the bubbles from the theme tokens", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate
        data={pageData(undefined, { theme: "dark" })}
        slug="helpful-agent-abc123"
        runtime={liveRuntime()}
      />
    );

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    const userBubble = screen.getByTestId("agent-page-user-message")
      .firstElementChild as HTMLElement;
    const assistantBubble = screen.getByTestId("agent-page-assistant-message")
      .firstElementChild as HTMLElement;
    // slate-700 visitor bubble on slate-800 agent cards — never amber-on-white.
    expect(userBubble.style.backgroundColor).toBe("rgb(51, 65, 85)");
    expect(assistantBubble.style.backgroundColor).toBe("rgb(30, 41, 59)");
    expect(assistantBubble.style.color).toBe("rgb(241, 245, 249)");
  });

  it("compact density tightens the transcript spacing", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate
        data={pageData(undefined, { density: "compact" })}
        slug="helpful-agent-abc123"
        runtime={liveRuntime()}
      />
    );

    await user.type(screen.getByTestId("agent-page-composer"), "Hello{Enter}");
    await screen.findByTestId("agent-page-assistant-message");

    const list = document.querySelector('[data-bubble-style="bubbles"]') as HTMLElement;
    expect(list.className).toContain("space-y-2.5");
    const bubble = screen.getByTestId("agent-page-user-message")
      .firstElementChild as HTMLElement;
    expect(bubble.className).toContain("text-sm");
  });

  it("history sidebar lists this session's conversations and switches between them", async () => {
    const user = userEvent.setup();
    render(
      <ChatTemplate
        data={pageData(undefined, { showHistorySidebar: true })}
        slug="helpful-agent-abc123"
        runtime={previewRuntime()}
      />
    );

    expect(screen.getByTestId("agent-page-history-sidebar")).toBeTruthy();
    expect(screen.getAllByTestId("agent-page-history-item")).toHaveLength(1);

    await user.type(screen.getByTestId("agent-page-composer"), "Book me a cleaning{Enter}");
    await screen.findByTestId("agent-page-assistant-message");
    expect(screen.getAllByTestId("agent-page-history-item")[0].textContent).toBe(
      "Book me a cleaning"
    );

    // New chat: fresh empty state, second sidebar entry, active highlight moves.
    await user.click(screen.getByTestId("agent-page-new-chat"));
    expect(screen.getByTestId("agent-page-empty-state")).toBeTruthy();
    const items = screen.getAllByTestId("agent-page-history-item");
    expect(items).toHaveLength(2);
    expect(items[1].getAttribute("aria-current")).toBe("true");

    // Switching back restores the first conversation's transcript.
    await user.click(items[0]);
    expect(screen.getByTestId("agent-page-user-message").textContent).toBe(
      "Book me a cleaning"
    );
    expect(
      screen.getAllByTestId("agent-page-history-item")[0].getAttribute("aria-current")
    ).toBe("true");
  });

  it("hides the history sidebar when the dial is off", () => {
    render(
      <ChatTemplate data={pageData()} slug="helpful-agent-abc123" runtime={liveRuntime()} />
    );
    expect(screen.queryByTestId("agent-page-history-sidebar")).toBeNull();
  });
});
