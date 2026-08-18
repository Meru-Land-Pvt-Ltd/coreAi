import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NodeInspector } from "./node-inspector";
import type { BuilderNode, BuilderNodeData } from "./types";

/**
 * Design Brain chat panel — rendered through NodeInspector so the dispatch is
 * covered too: a "design.brain" node opens a chat in the properties sidebar,
 * sends instruction + history to the designChat wrapper, renders the reply,
 * and triggers the Test-preview refresh when a patch was applied.
 */

const { designChatMock } = vi.hoisted(() => ({ designChatMock: vi.fn() }));

vi.mock("@/components/architect/features/api", () => ({
  designChat: designChatMock,
  disconnectCalendlyConnector: vi.fn(),
  getArchitectAiProviders: vi.fn().mockResolvedValue({ success: true, data: { providers: [] } }),
  getCalendlyConnectorStatus: vi.fn(),
  getCalendlyOAuthUrl: vi.fn(),
  getModelStatusesFromBackend: vi.fn().mockResolvedValue({ success: true, data: {} }),
  listWhatsAppConnections: vi.fn()
}));

function designChatSuccess(reply: string, patch: Record<string, unknown>) {
  return {
    success: true,
    data: {
      reply,
      patch,
      design: {
        theme: "dark",
        composerPosition: "center",
        density: "cozy",
        bubbleStyle: "bubbles",
        showHistorySidebar: false
      },
      page: null
    }
  };
}

function designBrainNode(): BuilderNode {
  return {
    id: "design-brain-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      label: "Design Brain",
      title: "Design Brain",
      kind: "DESIGN",
      nodeKind: "block",
      icon: "wand",
      accent: "rose",
      type: "design.brain"
    } as BuilderNodeData
  } as BuilderNode;
}

function renderInspector(overrides?: { workflowId?: string | null; previewVisible?: boolean }) {
  const onDesignApplied = vi.fn();
  render(
    <NodeInspector
      selectedNode={designBrainNode()}
      onClearSelection={vi.fn()}
      onUpdateNodeData={vi.fn()}
      onDeleteNode={vi.fn()}
      workflowId={overrides?.workflowId === undefined ? "wf-1" : overrides.workflowId}
      previewVisible={overrides?.previewVisible ?? false}
      onDesignApplied={onDesignApplied}
    />
  );
  return { onDesignApplied };
}

beforeEach(() => {
  designChatMock.mockReset();
});

afterEach(() => cleanup());

describe("Design Brain node inspector chat", () => {
  it("renders the chat panel: intro, starter chips, input, and send", () => {
    renderInspector();

    expect(screen.getByTestId("design-brain-panel")).toBeDefined();
    expect(screen.getByTestId("design-brain-intro")).toBeDefined();
    expect(screen.getByTestId("design-brain-empty")).toBeDefined();
    expect(screen.getByTestId("design-brain-chip-0").textContent).toBe("Dark theme");
    expect(screen.getByTestId("design-brain-chip-1").textContent).toBe("Pin the box at the bottom");
    expect(screen.getByTestId("design-brain-chip-2").textContent).toBe(
      "Make it feel warm and welcoming"
    );
    expect(screen.getByTestId("design-brain-input")).toBeDefined();
    expect(screen.getByTestId("design-brain-send")).toBeDefined();

    // Chat frame, not builder jargon: no variable drawer, no step overview.
    expect(screen.queryByTestId("node-step-overview")).toBeNull();
  });

  it("Enter sends the instruction (no history on the first turn) and renders the reply", async () => {
    const user = userEvent.setup();
    designChatMock.mockResolvedValue(designChatSuccess("Done — dark and moody.", { theme: "dark" }));
    const { onDesignApplied } = renderInspector();

    await user.type(screen.getByTestId("design-brain-input"), "dark theme{enter}");

    await waitFor(() => {
      expect(screen.getByTestId("design-brain-message-assistant").textContent).toBe(
        "Done — dark and moody."
      );
    });

    expect(designChatMock).toHaveBeenCalledTimes(1);
    expect(designChatMock).toHaveBeenCalledWith("wf-1", { instruction: "dark theme" });
    expect(screen.getByTestId("design-brain-message-user").textContent).toBe("dark theme");
    expect(onDesignApplied).toHaveBeenCalledTimes(1);
    // On the Build tab the change is applied but not visible — say where it is.
    expect(screen.getByTestId("design-brain-applied-note").textContent).toBe(
      "Applied — check the Test tab"
    );
  });

  it("sends the conversation so far as history on the next turn", async () => {
    const user = userEvent.setup();
    designChatMock.mockResolvedValue(designChatSuccess("Done.", { theme: "dark" }));
    renderInspector();

    await user.type(screen.getByTestId("design-brain-input"), "dark theme{enter}");
    await waitFor(() => expect(screen.getByTestId("design-brain-message-assistant")).toBeDefined());

    designChatMock.mockResolvedValue(designChatSuccess("Greener now.", { accentColor: "#16a34a" }));
    await user.type(screen.getByTestId("design-brain-input"), "green accent{enter}");

    await waitFor(() => expect(designChatMock).toHaveBeenCalledTimes(2));
    expect(designChatMock).toHaveBeenLastCalledWith("wf-1", {
      instruction: "green accent",
      history: [
        { role: "user", content: "dark theme" },
        { role: "assistant", content: "Done." }
      ]
    });
  });

  it("a starter chip sends its text as the instruction", async () => {
    const user = userEvent.setup();
    designChatMock.mockResolvedValue(designChatSuccess("Cozy and warm now.", { theme: "warm" }));
    renderInspector();

    await user.click(screen.getByTestId("design-brain-chip-2"));

    await waitFor(() => expect(designChatMock).toHaveBeenCalledTimes(1));
    expect(designChatMock).toHaveBeenCalledWith("wf-1", {
      instruction: "Make it feel warm and welcoming"
    });
    await waitFor(() => {
      expect(screen.getByTestId("design-brain-message-assistant").textContent).toBe(
        "Cozy and warm now."
      );
    });
  });

  it("an empty patch renders the reply without the applied note or a preview refresh", async () => {
    const user = userEvent.setup();
    designChatMock.mockResolvedValue(
      designChatSuccess("I can change colors, theme, layout, or wording — not that one.", {})
    );
    const { onDesignApplied } = renderInspector();

    await user.type(screen.getByTestId("design-brain-input"), "add a 3D globe{enter}");

    await waitFor(() => expect(screen.getByTestId("design-brain-message-assistant")).toBeDefined());
    expect(screen.queryByTestId("design-brain-applied-note")).toBeNull();
    expect(onDesignApplied).not.toHaveBeenCalled();
  });

  it("a failed send shows a gentle retry line and never refreshes the preview", async () => {
    const user = userEvent.setup();
    designChatMock.mockRejectedValue(new Error("network down"));
    const { onDesignApplied } = renderInspector();

    await user.type(screen.getByTestId("design-brain-input"), "dark theme{enter}");

    await waitFor(() => {
      expect(screen.getByTestId("design-brain-message-assistant").textContent).toBe(
        "That one didn't go through — give it another try in a moment."
      );
    });
    expect(onDesignApplied).not.toHaveBeenCalled();
  });

  it("waits politely when the workflow has not saved yet (no id, input disabled)", () => {
    renderInspector({ workflowId: null });

    expect(screen.getByTestId("design-brain-save-first")).toBeDefined();
    expect((screen.getByTestId("design-brain-input") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("design-brain-chip-0") as HTMLButtonElement).disabled).toBe(true);
  });
});
