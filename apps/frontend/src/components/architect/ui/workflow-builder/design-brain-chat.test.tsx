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

const { designChatMock, productChatMock } = vi.hoisted(() => ({
  designChatMock: vi.fn(),
  productChatMock: vi.fn()
}));

vi.mock("@/components/architect/features/api", () => ({
  designChat: designChatMock,
  productChat: productChatMock
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

beforeEach(() => {
  designChatMock.mockReset();
  productChatMock.mockReset();
});
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

/**
 * Build mode — the Product Architect.
 *
 * Style mode restyles the page that exists; Build mode writes the product
 * itself. They are separate endpoints, so the only thing that must never
 * happen is a build instruction reaching the styling endpoint (it would
 * silently repaint instead of building) or the reverse.
 */
describe("DesignBrainChat build mode", () => {
  function productResult(pagesCreated: string[] = []) {
    return {
      success: true,
      data: {
        reply: "Built your booking page.",
        product: { pages: [] },
        pagesCreated,
        legalNote: null
      }
    };
  }

  async function switchToBuild() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId("design-dock-mode-build"));
  }

  it("starts in Style mode so existing behaviour is unchanged", () => {
    renderChat(vi.fn());

    expect(screen.getByTestId("design-dock-mode-style").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("design-dock-mode-build").getAttribute("aria-pressed")).toBe("false");
  });

  it("sends to the product endpoint in Build mode, never the styling one", async () => {
    productChatMock.mockResolvedValue(productResult(["home", "pricing"]));
    const user = userEvent.setup();
    renderChat(vi.fn());
    await switchToBuild();

    await user.type(
      screen.getByTestId("design-dock-input"),
      "a sell page with pricing{enter}"
    );

    await waitFor(() => expect(productChatMock).toHaveBeenCalledTimes(1));
    expect(productChatMock).toHaveBeenCalledWith("wf-1", {
      instruction: "a sell page with pricing"
    });
    expect(designChatMock).not.toHaveBeenCalled();
  });

  it("tells the architect how many pages were created", async () => {
    productChatMock.mockResolvedValue(productResult(["home", "pricing", "contact"]));
    const user = userEvent.setup();
    renderChat(vi.fn());
    await switchToBuild();

    await user.type(screen.getByTestId("design-dock-input"), "a full site{enter}");

    await waitFor(() =>
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toContain(
        "(3 new pages)"
      )
    );
  });

  it("refetches the preview after every build, even with no new page", async () => {
    productChatMock.mockResolvedValue(productResult([]));
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderChat(onApplied);
    await switchToBuild();

    await user.type(screen.getByTestId("design-dock-input"), "rewrite the home page{enter}");

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith({});
  });

  it("offers packaging briefs as the starter chips, not styling dials", async () => {
    renderChat(vi.fn());
    await switchToBuild();

    expect(screen.getByTestId("design-dock-chip-0").textContent).toBe(
      "A sell page with pricing and an FAQ"
    );
  });

  it("says something useful when a build fails", async () => {
    productChatMock.mockResolvedValue({ success: false });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    renderChat(onApplied);
    await switchToBuild();

    await user.type(screen.getByTestId("design-dock-input"), "something impossible{enter}");

    await waitFor(() =>
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toContain(
        "I couldn't build that one"
      )
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("accepts a longer brief than the styling box allows", async () => {
    renderChat(vi.fn());
    await switchToBuild();

    expect(
      (screen.getByTestId("design-dock-input") as HTMLInputElement).maxLength
    ).toBe(800);
  });
});
