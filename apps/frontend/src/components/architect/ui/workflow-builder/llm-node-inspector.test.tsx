import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LlmNodeInspector } from "./llm-node-inspector";
import { NodeInspector } from "./node-inspector";
import type { BuilderNode, BuilderNodeData } from "./types";

afterEach(() => cleanup());

function node(data: Partial<BuilderNodeData>): BuilderNode {
  return {
    id: "brain-1",
    type: "coreNode",
    position: { x: 0, y: 0 },
    data: {
      label: "AI Brain",
      title: "AI Brain",
      kind: "AI Brain",
      nodeKind: "ai",
      type: "ai.llm_call",
      ...data
    } as BuilderNodeData
  } as BuilderNode;
}

function renderInspector(data: Partial<BuilderNodeData>) {
  const onUpdateNodeData = vi.fn();
  render(<LlmNodeInspector selectedNode={node(data)} onUpdateNodeData={onUpdateNodeData} />);
  return { onUpdateNodeData };
}

describe("AI Brain provider then model selection", () => {
  it("shows the node's provider and its model", () => {
    renderInspector({ llmProvider: "claude", llmModel: "claude-opus-5" });

    expect(screen.getByTestId("llm-provider-select").textContent).toContain("Anthropic Claude");
    expect(screen.getByTestId("llm-model-select").textContent).toContain("Claude Opus 5");
  });

  it("lists only the selected provider's models", async () => {
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-model-select"));

    expect(screen.getByTestId("llm-model-option-gpt-5.5")).toBeDefined();
    expect(screen.queryByTestId("llm-model-option-claude-opus-5")).toBeNull();
    expect(screen.queryByTestId("llm-model-option-gemini-3.5-flash")).toBeNull();
  });

  it("switching provider also switches to that provider's default model", async () => {
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector({
      llmProvider: "openai",
      llmModel: "gpt-5.4-mini"
    });

    await user.click(screen.getByTestId("llm-provider-select"));
    await user.click(screen.getByTestId("llm-provider-option-gemini"));

    expect(onUpdateNodeData).toHaveBeenCalledWith("llmProvider", "gemini");
    expect(onUpdateNodeData).toHaveBeenCalledWith("llmModel", "gemini-3.5-flash");
  });

  it("picking a model keeps the provider in step with it", async () => {
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector({
      llmProvider: "claude",
      llmModel: "claude-sonnet-5"
    });

    await user.click(screen.getByTestId("llm-model-select"));
    await user.click(screen.getByTestId("llm-model-option-claude-haiku-4-5-20251001"));

    expect(onUpdateNodeData).toHaveBeenCalledWith("llmModel", "claude-haiku-4-5-20251001");
    expect(onUpdateNodeData).toHaveBeenCalledWith("llmProvider", "claude");
  });

  it("falls back to the provider's default when the saved model belongs elsewhere", () => {
    // Left over from the old single-list dropdown.
    renderInspector({ llmProvider: "claude", llmModel: "gpt-5.5" });

    expect(screen.getByTestId("llm-provider-select").textContent).toContain("Anthropic Claude");
    expect(screen.getByTestId("llm-model-select").textContent).toContain("Claude Sonnet 5");
  });

  it("shows an uncataloged saved model as-is instead of a different one", () => {
    renderInspector({ llmProvider: "openai", llmModel: "gpt-4o" });

    expect(screen.getByTestId("llm-provider-select").textContent).toContain("OpenAI");
    expect(screen.getByTestId("llm-model-select").textContent).toContain("gpt-4o");
  });
});

describe("AI Step node provider then model selection", () => {
  function renderAiStep(data: Partial<BuilderNodeData>) {
    const onUpdateNodeData = vi.fn();
    render(
      <NodeInspector
        selectedNode={node({ type: "ai.context_reply", kind: "AI", label: "AI Step", ...data })}
        onClearSelection={vi.fn()}
        onUpdateNodeData={onUpdateNodeData}
        onDeleteNode={vi.fn()}
      />
    );
    return { onUpdateNodeData };
  }

  it("offers only the selected provider's models", () => {
    renderAiStep({ provider: "claude", model: "claude-sonnet-5" });

    const modelSelect = screen.getByTestId("node-inspector-model-select") as HTMLSelectElement;
    const modelIds = Array.from(modelSelect.options).map((option) => option.value);

    expect(screen.getByTestId("node-inspector-provider-select")).toHaveProperty("value", "claude");
    expect(modelIds).toContain("claude-opus-5");
    expect(modelIds).not.toContain("gpt-5.5");
  });

  it("switching provider also switches to that provider's default model", async () => {
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderAiStep({ provider: "openai", model: "gpt-5.4-mini" });

    await user.selectOptions(screen.getByTestId("node-inspector-provider-select"), "claude");

    expect(onUpdateNodeData).toHaveBeenCalledWith("provider", "claude");
    expect(onUpdateNodeData).toHaveBeenCalledWith("model", "claude-sonnet-5");
  });
});
