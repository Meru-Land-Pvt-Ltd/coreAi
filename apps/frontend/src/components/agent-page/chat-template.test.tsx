import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatTemplate } from "./chat-template";
import type { AgentPageData } from "./types";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn()
}));

vi.mock("@/lib/api", () => ({ apiPost: mocks.apiPost }));

function pageData(overrides?: Partial<AgentPageData["limits"]>): AgentPageData {
  return {
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
    render(<ChatTemplate data={pageData()} slug="helpful-agent-abc123" />);

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
    render(<ChatTemplate data={pageData()} slug="helpful-agent-abc123" />);

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
    render(<ChatTemplate data={pageData()} slug="helpful-agent-abc123" />);

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
    render(<ChatTemplate data={pageData()} slug="helpful-agent-abc123" />);

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
    render(<ChatTemplate data={pageData()} slug="helpful-agent-abc123" />);

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
});
