import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LlmNodeInspector } from "./llm-node-inspector";
import { NodeInspector } from "./node-inspector";
import { resetLlmAvailabilityCache } from "./use-llm-availability";
import type { BuilderNode, BuilderNodeData } from "./types";

const { getProvidersMock } = vi.hoisted(() => ({ getProvidersMock: vi.fn() }));

vi.mock("../../features/api", () => ({ getArchitectAiProviders: getProvidersMock }));

/** Backend availability payload: which provider keys are present. */
function providersResponse(configuredIds: string[]) {
  return {
    success: true,
    data: {
      providers: [
        { id: "openai", displayName: "OpenAI", envKey: "OPENAI_API_KEY" },
        { id: "claude", displayName: "Anthropic Claude", envKey: "ANTHROPIC_API_KEY" },
        { id: "gemini", displayName: "Google Gemini", envKey: "GEMINI_API_KEY" }
      ].map((provider) => ({
        ...provider,
        models: [],
        configured: configuredIds.includes(provider.id),
        available: configuredIds.includes(provider.id),
        unavailableReason: configuredIds.includes(provider.id) ? null : "no API key",
        unavailableKind: configuredIds.includes(provider.id) ? null : "no_key"
      }))
    }
  };
}

beforeEach(() => {
  resetLlmAvailabilityCache();
  getProvidersMock.mockReset();
  getProvidersMock.mockResolvedValue(providersResponse([]));
});

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

/**
 * THE AI BRAIN.
 *
 * Rewritten when the panel was, because the old tests described a design that
 * no longer exists: two dropdowns, provider then model. There is one picker
 * now, and these hold the things that actually matter about it.
 */

describe("choosing a brain", () => {
  it("says which brain is doing the work, in one line", () => {
    renderInspector({ llmProvider: "claude", llmModel: "claude-opus-5" });

    const line = screen.getByTestId("llm-model-line").textContent ?? "";
    expect(line).toContain("Claude Opus 5");
    expect(line).toContain("Anthropic Claude");
  });

  it("offers every provider's models in one list, not a provider step first", async () => {
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-model-line"));

    // One click to any brain — the provider is a heading, not a gate.
    expect(screen.getByTestId("llm-model-option-gpt-5.5")).toBeDefined();
    expect(screen.getByTestId("llm-model-option-claude-opus-5")).toBeDefined();
  });

  it("picking a brain sets its provider too, so the two can never disagree", async () => {
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector({ llmProvider: "openai", llmModel: "gpt-5.5" });

    await user.click(screen.getByTestId("llm-model-line"));
    await user.click(screen.getByTestId("llm-model-option-claude-opus-5"));

    expect(onUpdateNodeData).toHaveBeenCalledWith("llmProvider", "claude");
    expect(onUpdateNodeData).toHaveBeenCalledWith("llmModel", "claude-opus-5");
  });
});

describe("the dials belong to the model, not the node", () => {
  it("a thinking model has no freedom dial, because it refuses one", async () => {
    // Anthropic rejects temperature on thinking models and claude.adapter.ts
    // has always thrown the value away. A slider here was the screen lying.
    const user = userEvent.setup();
    renderInspector({ llmProvider: "claude", llmModel: "claude-opus-5" });

    await user.click(screen.getByTestId("llm-settings-toggle"));

    expect(screen.queryByTestId("llm-dial-llmTemperature")).toBeNull();
    expect(screen.getByTestId("llm-dial-llmReasoningEffort")).toBeDefined();
  });

  it("an ordinary model has the freedom dial and no thinking dial", async () => {
    const user = userEvent.setup();
    renderInspector({ llmProvider: "claude", llmModel: "claude-sonnet-5" });

    await user.click(screen.getByTestId("llm-settings-toggle"));

    expect(screen.getByTestId("llm-dial-llmTemperature")).toBeDefined();
    expect(screen.queryByTestId("llm-dial-llmReasoningEffort")).toBeNull();
  });

  it("a dial that moves the bill says so before anything is published", async () => {
    const user = userEvent.setup();
    renderInspector({ llmProvider: "claude", llmModel: "claude-sonnet-5" });

    await user.click(screen.getByTestId("llm-settings-toggle"));

    expect(screen.getByTestId("llm-dial-cost-llmMaxTokens").textContent).toContain("costs more");
  });

  it("dials are written in words, never the provider's parameter names", async () => {
    const user = userEvent.setup();
    renderInspector({ llmProvider: "claude", llmModel: "claude-sonnet-5" });

    await user.click(screen.getByTestId("llm-settings-toggle"));

    const settings = screen.getByTestId("llm-settings").textContent ?? "";
    expect(settings).toContain("How much freedom");
    expect(settings).toContain("Longest answer");
    expect(settings).not.toContain("temperature");
    expect(settings).not.toContain("max_tokens");
  });
});

describe("the prompt", () => {
  it("is a page, not a four-row box", () => {
    renderInspector({ llmProvider: "claude", llmModel: "claude-sonnet-5" });

    // Somebody pasting two A4 pages should be able to read them.
    const prompt = screen.getByTestId("llm-prompt") as HTMLTextAreaElement;
    expect(Number(prompt.rows)).toBeGreaterThanOrEqual(12);
  });

  it("lets a variable be clicked in rather than typed from memory", async () => {
    // A typo'd variable is silence at run time with nothing on screen saying why.
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector({
      llmProvider: "claude",
      llmModel: "claude-sonnet-5",
      llmRequirements: "Reply to: "
    } as Partial<BuilderNodeData>);

    await user.click(screen.getByTestId("llm-insert-text"));

    expect(onUpdateNodeData).toHaveBeenCalledWith("llmRequirements", expect.stringContaining("{{text}}"));
  });
});

describe("what is no longer on this panel", () => {
  it("shows one name for its output, not three", () => {
    // {{ai.output}}, {{node.ai-1787399665497.output}} and {{node.thinker.output}}
    // were the same value spelled three ways, one carrying a raw timestamp.
    render(
      <NodeInspector
        selectedNode={node({ llmProvider: "claude", llmModel: "claude-sonnet-5" })}
        onUpdateNodeData={vi.fn()}
        onClearSelection={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    );

    const panel = document.body.textContent ?? "";
    expect(panel).not.toContain("{{ai.output}}");
    expect(panel).not.toContain("Output mapping");
    expect(panel).not.toContain("Input mapping");
  });

  it("does not show the node's internal id to somebody building a receptionist", () => {
    render(
      <NodeInspector
        selectedNode={node({ llmProvider: "claude", llmModel: "claude-sonnet-5" })}
        onUpdateNodeData={vi.fn()}
        onClearSelection={vi.fn()}
        onDeleteNode={vi.fn()}
      />
    );

    expect(screen.queryByTestId("node-advanced-developer")).toBeNull();
  });
});
