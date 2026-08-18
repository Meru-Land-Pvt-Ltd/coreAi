import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SmartDesignerPanel } from "./smart-designer-panel";

/**
 * The Smart Designer contract:
 *
 * - Generate calls smart-compose once and fires the same onApplied refetch
 *   contract the Design Brain uses, so the preview updates in place.
 * - The composer's merge win ("{n} inputs merged") is visible.
 * - A packaging redirect renders as a quiet boundary note — a redirect, not
 *   a failure — and NEVER fires onApplied (nothing changed).
 * - Feedback history is capped at the last 10 turns, design-chat shape.
 * - A not-yet-autosaved workflow (null id) disables everything.
 */

const { smartComposeMock, smartDesignerChatMock, productChatMock } = vi.hoisted(() => ({
  smartComposeMock: vi.fn(),
  smartDesignerChatMock: vi.fn(),
  productChatMock: vi.fn()
}));

vi.mock("@/components/architect/features/api", () => ({
  smartCompose: smartComposeMock,
  smartDesignerChat: smartDesignerChatMock,
  productChat: productChatMock
}));

function composeResult(overrides: Partial<{
  reply: string;
  composed: boolean;
  asksPlaced: number;
  merged: number;
}> = {}) {
  return {
    success: true,
    data: {
      reply: "Designed your interface — three fields and a result card.",
      product: { pages: [] },
      composed: true,
      asksPlaced: 3,
      merged: 0,
      ...overrides
    }
  };
}

function designerResult(overrides: Partial<{ reply: string; boundary: "packaging" | null }> = {}) {
  return {
    success: true,
    data: {
      reply: "Split that box into name and email.",
      product: { pages: [] },
      boundary: null,
      ...overrides
    }
  };
}

beforeEach(() => {
  smartComposeMock.mockReset();
  smartDesignerChatMock.mockReset();
  productChatMock.mockReset();
});
afterEach(() => cleanup());

describe("SmartDesignerPanel generate", () => {
  it("calls smart-compose and fires onApplied so the preview refetches", async () => {
    smartComposeMock.mockResolvedValue(composeResult());
    const onApplied = vi.fn();
    const user = userEvent.setup();
    render(<SmartDesignerPanel workflowId="wf-1" onApplied={onApplied} />);

    await user.click(screen.getByTestId("smart-designer-generate"));

    await waitFor(() => expect(smartComposeMock).toHaveBeenCalledTimes(1));
    expect(smartComposeMock).toHaveBeenCalledWith("wf-1");
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith({});
    expect(screen.getByTestId("smart-designer-message-assistant").textContent).toContain(
      "Designed your interface"
    );
  });

  it("shows honest progress copy while composing — no fake percentages", async () => {
    let resolveCompose: (value: unknown) => void = () => {};
    smartComposeMock.mockReturnValue(new Promise((resolve) => (resolveCompose = resolve)));
    const user = userEvent.setup();
    render(<SmartDesignerPanel workflowId="wf-1" />);

    await user.click(screen.getByTestId("smart-designer-generate"));

    expect(screen.getByTestId("smart-designer-progress").textContent).toContain(
      "Reading your workflow"
    );
    expect(screen.getByTestId("smart-designer-progress").textContent).not.toMatch(/%/);

    resolveCompose(composeResult());
    await waitFor(() =>
      expect(screen.queryByTestId("smart-designer-progress")).toBeNull()
    );
  });

  it("renders the merged count when the composer merged inputs", async () => {
    smartComposeMock.mockResolvedValue(composeResult({ merged: 4 }));
    const user = userEvent.setup();
    render(<SmartDesignerPanel workflowId="wf-1" />);

    await user.click(screen.getByTestId("smart-designer-generate"));

    await waitFor(() =>
      expect(screen.getByTestId("smart-designer-merged").textContent).toBe("4 inputs merged")
    );
  });

  it("stays quiet about merging when nothing merged", async () => {
    smartComposeMock.mockResolvedValue(composeResult({ merged: 0 }));
    const user = userEvent.setup();
    render(<SmartDesignerPanel workflowId="wf-1" />);

    await user.click(screen.getByTestId("smart-designer-generate"));

    await waitFor(() =>
      expect(screen.getByTestId("smart-designer-message-assistant")).toBeDefined()
    );
    expect(screen.queryByTestId("smart-designer-merged")).toBeNull();
  });

  it("says something useful when the compose fails, without firing onApplied", async () => {
    smartComposeMock.mockResolvedValue({ success: false });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    render(<SmartDesignerPanel workflowId="wf-1" onApplied={onApplied} />);

    await user.click(screen.getByTestId("smart-designer-generate"));

    await waitFor(() =>
      expect(screen.getByTestId("smart-designer-message-assistant").textContent).toContain(
        "couldn't design the interface"
      )
    );
    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe("SmartDesignerPanel feedback chat", () => {
  async function sendFeedback(text: string) {
    const user = userEvent.setup();
    await user.type(screen.getByTestId("smart-designer-input"), `${text}{enter}`);
  }

  it("an applied fix renders as a reply and fires onApplied", async () => {
    smartDesignerChatMock.mockResolvedValue(designerResult());
    const onApplied = vi.fn();
    render(<SmartDesignerPanel workflowId="wf-1" hasComposedSpec onApplied={onApplied} />);

    await sendFeedback("this box isn't capturing email separately");

    await waitFor(() => expect(smartDesignerChatMock).toHaveBeenCalledTimes(1));
    expect(smartDesignerChatMock).toHaveBeenCalledWith("wf-1", {
      instruction: "this box isn't capturing email separately"
    });
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith({});
    expect(screen.getByTestId("smart-designer-message-assistant").textContent).toContain(
      "Split that box"
    );
  });

  it("a packaging ask is ROUTED to the packaging brain — one door for the architect", async () => {
    smartDesignerChatMock.mockResolvedValue(
      designerResult({
        reply: "Sell pages live in Packaging — I only shape your product's interface.",
        boundary: "packaging"
      })
    );
    productChatMock.mockResolvedValue({
      success: true,
      data: { reply: "Privacy page added.", pagesCreated: ["privacy"] }
    });
    const onApplied = vi.fn();
    render(<SmartDesignerPanel workflowId="wf-1" hasComposedSpec onApplied={onApplied} />);

    await sendFeedback("add a privacy policy page");

    // The packaging brain got the SAME instruction, and its answer landed in
    // the conversation labeled as packaging work — never a refusal.
    await waitFor(() =>
      expect(screen.getByTestId("smart-designer-boundary").textContent).toContain(
        "Privacy page added. (1 new page)"
      )
    );
    expect(productChatMock).toHaveBeenCalledWith("wf-1", {
      instruction: "add a privacy policy page"
    });
    // Packaging rewrote the saved product, so the preview refetches.
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("a packaging ask whose build fails shows the kind fallback and no refetch", async () => {
    smartDesignerChatMock.mockResolvedValue(
      designerResult({ reply: "Sell pages live in Packaging.", boundary: "packaging" })
    );
    productChatMock.mockResolvedValue({ success: false });
    const onApplied = vi.fn();
    render(<SmartDesignerPanel workflowId="wf-1" hasComposedSpec onApplied={onApplied} />);

    await sendFeedback("add a privacy policy page");

    await waitFor(() =>
      expect(screen.getAllByTestId("smart-designer-message-assistant").length).toBeGreaterThan(0)
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("caps the history it sends at the last 10 turns", async () => {
    smartDesignerChatMock.mockResolvedValue(designerResult());
    render(<SmartDesignerPanel workflowId="wf-1" hasComposedSpec />);

    // 6 completed turns put 12 bubbles on screen; the 7th send must trim.
    for (let turn = 1; turn <= 6; turn += 1) {
      await sendFeedback(`change number ${turn}`);
      await waitFor(() => expect(smartDesignerChatMock).toHaveBeenCalledTimes(turn));
    }
    await sendFeedback("one more change");
    await waitFor(() => expect(smartDesignerChatMock).toHaveBeenCalledTimes(7));

    const lastBody = smartDesignerChatMock.mock.calls[6]?.[1] as {
      instruction: string;
      history?: Array<{ role: string; content: string }>;
    };
    expect(lastBody.history).toHaveLength(10);
    // Newest turns survive the cap; each entry is design-chat shaped.
    expect(lastBody.history?.at(-1)).toEqual({
      role: "assistant",
      content: "Split that box into name and email."
    });
    expect(lastBody.history?.at(-2)).toEqual({ role: "user", content: "change number 6" });
  });

  it("keeps local failure lines out of the history", async () => {
    smartDesignerChatMock.mockResolvedValueOnce({ success: false });
    smartDesignerChatMock.mockResolvedValueOnce(designerResult());
    render(<SmartDesignerPanel workflowId="wf-1" hasComposedSpec />);

    await sendFeedback("first ask");
    await waitFor(() => expect(smartDesignerChatMock).toHaveBeenCalledTimes(1));
    await sendFeedback("second ask");
    await waitFor(() => expect(smartDesignerChatMock).toHaveBeenCalledTimes(2));

    const secondBody = smartDesignerChatMock.mock.calls[1]?.[1] as {
      history?: Array<{ role: string; content: string }>;
    };
    expect(secondBody.history).toEqual([{ role: "user", content: "first ask" }]);
  });
});

describe("SmartDesignerPanel before the workflow has autosaved", () => {
  it("a null workflowId disables everything and says why", () => {
    render(<SmartDesignerPanel workflowId={null} />);

    expect(screen.getByTestId("smart-designer-save-first")).toBeDefined();
    expect(
      (screen.getByTestId("smart-designer-generate") as HTMLButtonElement).disabled
    ).toBe(true);
    expect((screen.getByTestId("smart-designer-input") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("smart-designer-send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("the chat composer waits for a composed spec", () => {
    render(<SmartDesignerPanel workflowId="wf-1" />);

    expect((screen.getByTestId("smart-designer-input") as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByTestId("smart-designer-generate") as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
