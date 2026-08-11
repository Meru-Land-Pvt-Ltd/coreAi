import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentDemoCall } from "./agent-demo-call";

const mocks = vi.hoisted(() => {
  type Listener = (payload?: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const apiPost = vi.fn();
  const start = vi.fn();
  const stop = vi.fn(async () => {});

  const client = {
    start,
    stop,
    on: vi.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    }),
    removeAllListeners: vi.fn(() => listeners.clear())
  };

  class VapiMock {
    start = client.start;
    stop = client.stop;
    on = client.on;
    off = client.off;
    removeAllListeners = client.removeAllListeners;
  }

  return {
    apiPost,
    client,
    listeners,
    VapiMock,
    emit(event: string, payload?: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
    }
  };
});

vi.mock("@/lib/api", () => ({ apiPost: mocks.apiPost }));
vi.mock("@vapi-ai/web", () => ({ default: mocks.VapiMock }));

beforeEach(() => {
  cleanup();
  mocks.listeners.clear();
  mocks.apiPost.mockReset().mockResolvedValue({
    success: true,
    data: {
      session: {
        publicKey: "public-test-key",
        assistantId: "assistant-1",
        assistantOverrides: {
          firstMessage: "Welcome to the demo.",
          model: { provider: "openai", model: "gpt-4o-mini", messages: [] }
        },
        listingId: "listing-1",
        listingName: "Nail Salon AI Receptionist",
        assistantName: "Ava",
        demoBusinessName: "Demo Nail Salon",
        maxDurationSeconds: 120,
        remainingDemosToday: 1,
        demo: true
      }
    }
  });
  mocks.client.start.mockReset();
  mocks.client.stop.mockClear();
  mocks.client.on.mockClear();
  mocks.client.off.mockClear();
  mocks.client.removeAllListeners.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentDemoCall", () => {
  it("uses Vapi's ended reason instead of replacing it with the generic ejection error", async () => {
    mocks.client.start.mockImplementation(async () => {
      mocks.emit("call-start");
      mocks.emit("message", {
        type: "status-update",
        status: "ended",
        endedReason: "pipeline-error-cartesia-requested-payment"
      });
      // Vapi emits this Daily error after its more useful status update.
      mocks.emit("error", {
        type: "daily-error",
        error: { errorMsg: "Meeting has ended" }
      });
      return { id: "call-1" };
    });

    const user = userEvent.setup();
    render(
      <AgentDemoCall
        listingId="listing-1"
        listingName="Nail Salon AI Receptionist"
        industry="Beauty & Wellness"
        subindustry="Nail Salons"
      />
    );

    await user.click(screen.getByTestId("agent-demo-call-start"));
    await user.click(screen.getByTestId("demo-setup-skip-btn"));

    expect((await screen.findByTestId("agent-demo-call-message")).textContent).toBe(
      "The demo voice service is temporarily unavailable. Please try again shortly."
    );
    expect(mocks.client.start).toHaveBeenCalledWith(
      "assistant-1",
      expect.objectContaining({
        firstMessage: "Welcome to the demo.",
        metadata: { listingId: "listing-1", purpose: "MARKETPLACE_DEMO" }
      })
    );
  });
});
