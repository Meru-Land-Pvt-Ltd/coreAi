import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignBrainChat } from "./design-brain-chat";

/**
 * onApplied threading — the graph reload contract for the next fleet:
 *
 * - styling-only patch  -> onApplied({ graphChanged: false })
 * - graphChanged: true  -> onApplied({ graphChanged: true }), even when the
 *   design patch itself is empty (the canvas changed, the dials did not)
 * - nothing applied     -> onApplied never fires
 * - zero-argument callbacks (every existing caller) keep working unchanged.
 */

const { designChatMock } = vi.hoisted(() => ({ designChatMock: vi.fn() }));

vi.mock("@/components/architect/features/api", () => ({
  designChat: designChatMock
}));

function designChatResult(
  patch: Record<string, unknown>,
  extras: { graphChanged?: boolean } = {}
) {
  return {
    success: true,
    data: {
      reply: "Done.",
      patch,
      design: {
        theme: "dark",
        composerPosition: "center",
        density: "cozy",
        bubbleStyle: "bubbles",
        showHistorySidebar: false
      },
      page: null,
      ...extras
    }
  };
}

function renderChat(onApplied: (result: { graphChanged?: boolean }) => void) {
  render(
    <DesignBrainChat variant="docked" workflowId="wf-1" onApplied={onApplied} />
  );
}

async function send(instruction: string) {
  const user = userEvent.setup();
  await user.type(screen.getByTestId("design-dock-input"), `${instruction}{enter}`);
  await waitFor(() => expect(designChatMock).toHaveBeenCalled());
}

beforeEach(() => designChatMock.mockReset());
afterEach(() => cleanup());

describe("DesignBrainChat onApplied threading", () => {
  it("a styling-only patch reports graphChanged: false", async () => {
    designChatMock.mockResolvedValue(designChatResult({ theme: "dark" }));
    const onApplied = vi.fn();
    renderChat(onApplied);

    await send("dark theme");

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith({ graphChanged: false });
  });

  it("graphChanged: true reaches onApplied even with an empty design patch", async () => {
    designChatMock.mockResolvedValue(designChatResult({}, { graphChanged: true }));
    const onApplied = vi.fn();
    renderChat(onApplied);

    await send("add a style gallery");

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith({ graphChanged: true });
  });

  it("patch + graphChanged together report graphChanged: true once", async () => {
    designChatMock.mockResolvedValue(
      designChatResult({ theme: "warm" }, { graphChanged: true })
    );
    const onApplied = vi.fn();
    renderChat(onApplied);

    await send("warm theme with a photo gallery");

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith({ graphChanged: true });
  });

  it("nothing applied (empty patch, no graph change) never fires onApplied", async () => {
    designChatMock.mockResolvedValue(designChatResult({}));
    const onApplied = vi.fn();
    renderChat(onApplied);

    await send("add a 3D globe");

    await waitFor(() =>
      expect(screen.getByTestId("design-dock-message-assistant")).toBeDefined()
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("stays backward compatible with zero-argument callbacks", async () => {
    designChatMock.mockResolvedValue(designChatResult({ theme: "dark" }));
    // The exact shape every existing caller passes today.
    const legacyOnApplied: () => void = vi.fn();
    render(
      <DesignBrainChat variant="docked" workflowId="wf-1" onApplied={legacyOnApplied} />
    );

    await send("dark theme");

    await waitFor(() => expect(legacyOnApplied).toHaveBeenCalledTimes(1));
  });
});
