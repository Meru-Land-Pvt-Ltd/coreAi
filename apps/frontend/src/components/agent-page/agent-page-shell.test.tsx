import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentPageShell } from "./agent-page-shell";
import {
  AGENT_PAGE_DESIGN_DEFAULTS,
  type AgentPageData,
  type AgentPageRuntime,
  type DesignConfig
} from "./types";

function pageData(design?: Partial<DesignConfig>): AgentPageData {
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
    ...(design ? { design: { ...AGENT_PAGE_DESIGN_DEFAULTS, ...design } } : {}),
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

  it("defaults to the light theme when no design is present", () => {
    render(
      <AgentPageShell data={pageData()} runtime={runtimeWithMode("live")}>
        <div />
      </AgentPageShell>
    );

    const root = screen.getByTestId("agent-page");
    expect(root.getAttribute("data-design-theme")).toBe("light");
    expect(root.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(root.style.color).toBe("rgb(15, 23, 42)");
  });

  it("dark theme paints the slate ground and light ink at the shell root", () => {
    render(
      <AgentPageShell data={pageData({ theme: "dark" })} runtime={runtimeWithMode("live")}>
        <div />
      </AgentPageShell>
    );

    const root = screen.getByTestId("agent-page");
    expect(root.getAttribute("data-design-theme")).toBe("dark");
    // slate-900 ground, slate-100 ink — legible, not a naive inversion.
    expect(root.style.backgroundColor).toBe("rgb(15, 23, 42)");
    expect(root.style.color).toBe("rgb(241, 245, 249)");
  });

  it("warm theme paints the cream ground with warm-stone ink", () => {
    render(
      <AgentPageShell data={pageData({ theme: "warm" })} runtime={runtimeWithMode("preview")}>
        <div />
      </AgentPageShell>
    );

    const root = screen.getByTestId("agent-page");
    expect(root.getAttribute("data-design-theme")).toBe("warm");
    expect(root.style.backgroundColor).toBe("rgb(250, 246, 239)");
    expect(root.style.color).toBe("rgb(41, 37, 36)");
  });
});
