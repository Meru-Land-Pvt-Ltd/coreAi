import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentPageShell } from "./agent-page-shell";
import type { AgentPageData, AgentPageRuntime } from "./types";

function pageData(): AgentPageData {
  return {
    page: {
      slug: "helpful-agent-abc123",
      template: "chat",
      headline: null,
      welcomeMessage: null,
      suggestedPrompts: [],
      accentColor: null,
      status: "LIVE"
    },
    listing: {
      id: "listing-1",
      name: "Helpful Agent",
      tagline: "Answers in seconds",
      shortDescription: "A helpful agent.",
      iconUrl: null,
      category: null,
      pricingModel: "FREE",
      priceCents: 0,
      freeTrialEnabled: false,
      trialDays: 0
    },
    architect: { displayName: "Ada", photoUrl: null },
    limits: { remainingToday: 20 }
  };
}

function runtimeWithMode(mode: AgentPageRuntime["mode"]): AgentPageRuntime {
  return {
    mode,
    sendChat: vi.fn().mockResolvedValue({ error: "unused" }),
    startVoiceSession: vi.fn().mockResolvedValue({ error: "unused" }),
    runOnce: vi.fn().mockResolvedValue({ error: "unused" })
  };
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentPageShell", () => {
  it("live mode renders the CTA as a link to the listing", () => {
    render(
      <AgentPageShell data={pageData()} runtime={runtimeWithMode("live")}>
        <div />
      </AgentPageShell>
    );

    const cta = screen.getByTestId("agent-page-cta");
    expect(cta.tagName).toBe("A");
    expect(cta.getAttribute("href")).toBe("/agent/listing-1");
    expect(cta.textContent).toBe("Get this agent");
  });

  it("preview mode keeps the CTA visible but a click only shows the publish note", async () => {
    const user = userEvent.setup();
    render(
      <AgentPageShell data={pageData()} runtime={runtimeWithMode("preview")}>
        <div />
      </AgentPageShell>
    );

    const cta = screen.getByTestId("agent-page-cta");
    expect(cta.tagName).toBe("BUTTON");
    expect(cta.textContent).toBe("Get this agent");
    expect(screen.queryByTestId("agent-page-preview-cta-note")).toBeNull();

    await user.click(cta);

    expect(screen.getByTestId("agent-page-preview-cta-note").textContent).toBe(
      "This button goes live when you publish."
    );
  });
});
