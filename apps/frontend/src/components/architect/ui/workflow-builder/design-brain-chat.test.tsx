import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignBrainChat } from "./design-brain-chat";

/**
 * The Packaging chat (formerly the Design Brain's Build tab — Style mode was
 * retired for the Smart Designer). One endpoint, one contract:
 *
 * - every successful build rewrites the saved product -> onApplied({}) fires
 * - a failed/refused build shows the kind fallback     -> onApplied never fires
 * - conversation history threads through on the next send
 * - no workflow id yet -> quiet save-first note, composer disabled
 */

const { productChatMock } = vi.hoisted(() => ({ productChatMock: vi.fn() }));

vi.mock("@/components/architect/features/api", () => ({
  productChat: productChatMock
}));

function buildResult(reply: string, pagesCreated: string[] = []) {
  return { success: true, data: { reply, pagesCreated } };
}

function renderChat(onApplied?: (result: { graphChanged?: boolean }) => void) {
  render(<DesignBrainChat workflowId="wf-1" onApplied={onApplied} />);
}

async function send(instruction: string) {
  const user = userEvent.setup();
  await user.type(screen.getByTestId("design-dock-input"), `${instruction}{enter}`);
  await waitFor(() => expect(productChatMock).toHaveBeenCalled());
}

beforeEach(() => {
  cleanup();
  productChatMock.mockReset();
});

afterEach(() => cleanup());

describe("Packaging chat", () => {
  it("a build lands: reply shows the new page count and onApplied fires", async () => {
    const onApplied = vi.fn();
    productChatMock.mockResolvedValue(buildResult("Pricing page is up.", ["pricing"]));
    renderChat(onApplied);

    await send("a pricing page");

    await waitFor(() => {
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toBe(
        "Pricing page is up. (1 new page)"
      );
    });
    expect(productChatMock).toHaveBeenCalledWith("wf-1", { instruction: "a pricing page" });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith({});
  });

  it("a rewrite with no NEW pages still refreshes (the product was rewritten)", async () => {
    const onApplied = vi.fn();
    productChatMock.mockResolvedValue(buildResult("Rewrote your sell page."));
    renderChat(onApplied);

    await send("make the sell page stronger");

    await waitFor(() => {
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toBe(
        "Rewrote your sell page."
      );
    });
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("a failed build shows the kind fallback and never fires onApplied", async () => {
    const onApplied = vi.fn();
    productChatMock.mockResolvedValue({ success: false });
    renderChat(onApplied);

    await send("add a 3D globe");

    await waitFor(() => {
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toContain(
        "I couldn't build that one"
      );
    });
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("the second send threads the conversation history through", async () => {
    productChatMock.mockResolvedValue(buildResult("Done.", []));
    renderChat();

    await send("a pricing page");
    await waitFor(() => expect(screen.getByTestId("design-dock-message-assistant")).toBeTruthy());
    await send("now add an FAQ");

    await waitFor(() => expect(productChatMock).toHaveBeenCalledTimes(2));
    const secondCall = productChatMock.mock.calls[1];
    expect(secondCall[1].history).toEqual([
      { role: "user", content: "a pricing page" },
      { role: "assistant", content: "Done." }
    ]);
  });

  it("suggestion chips send their brief as an instruction", async () => {
    productChatMock.mockResolvedValue(buildResult("Legal pages added.", ["privacy", "terms"]));
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByTestId("design-dock-chip-1"));

    await waitFor(() => {
      expect(screen.getByTestId("design-dock-message-assistant").textContent).toBe(
        "Legal pages added. (2 new pages)"
      );
    });
    expect(productChatMock).toHaveBeenCalledWith("wf-1", {
      instruction: "Add privacy and terms pages"
    });
  });

  it("without a saved workflow the composer waits politely", () => {
    render(<DesignBrainChat workflowId={null} />);

    expect(screen.getByTestId("design-dock-save-first")).toBeTruthy();
    expect((screen.getByTestId("design-dock-input") as HTMLInputElement).disabled).toBe(true);
  });
});
