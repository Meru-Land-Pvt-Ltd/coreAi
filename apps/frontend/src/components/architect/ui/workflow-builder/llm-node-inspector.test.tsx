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
    renderInspector({ llmProvider: "openai", llmModel: "gpt-4-turbo" });

    expect(screen.getByTestId("llm-provider-select").textContent).toContain("OpenAI");
    expect(screen.getByTestId("llm-model-select").textContent).toContain("gpt-4-turbo");
  });

  it("lists the provider's legacy models alongside the current ones", async () => {
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-model-select"));

    expect(screen.getByTestId("llm-model-option-o4-mini")).toBeDefined();
    expect(screen.getByTestId("llm-model-option-gpt-4o").textContent).toContain("Legacy");
  });
});

describe("providers the backend cannot run", () => {
  it("greys out and blocks a provider whose API key is missing", async () => {
    getProvidersMock.mockResolvedValue(providersResponse(["openai"]));
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector({
      llmProvider: "openai",
      llmModel: "gpt-5.4-mini"
    });

    await user.click(screen.getByTestId("llm-provider-select"));

    const claudeOption = await screen.findByTestId("llm-provider-option-claude");
    expect(claudeOption).toHaveProperty("disabled", true);
    // The disabled state is the whole signal — no key names in the UI.
    expect(claudeOption.textContent).not.toContain("API_KEY");
    expect(claudeOption.getAttribute("title")).toContain("Unavailable");
    expect(screen.getByTestId("llm-provider-option-openai")).toHaveProperty("disabled", false);

    await user.click(claudeOption);
    expect(onUpdateNodeData).not.toHaveBeenCalled();
  });

  it("greys out a provider whose account is out of credit", async () => {
    // Key present, but the last run came back 402 Insufficient Balance.
    getProvidersMock.mockResolvedValue({
      success: true,
      data: {
        providers: [
          { id: "openai", displayName: "OpenAI", envKey: "OPENAI_API_KEY", models: [], configured: true, available: true, unavailableReason: null, unavailableKind: null },
          { id: "claude", displayName: "Anthropic Claude", envKey: "ANTHROPIC_API_KEY", models: [], configured: true, available: false, unavailableReason: "out of credit", unavailableKind: "blocked" }
        ]
      }
    });
    const user = userEvent.setup();
    const { onUpdateNodeData } = renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-provider-select"));
    const claudeOption = await screen.findByTestId("llm-provider-option-claude");

    expect(claudeOption).toHaveProperty("disabled", true);
    expect(claudeOption.getAttribute("title")).toContain("out of credit");

    await user.click(claudeOption);
    expect(onUpdateNodeData).not.toHaveBeenCalled();
  });

  it("greys out the only provider when its account is out of credit", async () => {
    // DeepSeek is the only key on the backend and the last run returned 402 —
    // it must still grey out; "nothing else works" is not a reason to offer it.
    getProvidersMock.mockResolvedValue({
      success: true,
      data: {
        providers: [
          { id: "deepseek", displayName: "DeepSeek", envKey: "DEEPSEEK_API_KEY", models: [], configured: true, available: false, unavailableReason: "out of credit", unavailableKind: "blocked" },
          { id: "openai", displayName: "OpenAI", envKey: "OPENAI_API_KEY", models: [], configured: false, available: false, unavailableReason: "no API key", unavailableKind: "no_key" }
        ]
      }
    });
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-provider-select"));

    const deepseek = await screen.findByTestId("llm-provider-option-deepseek");
    expect(deepseek).toHaveProperty("disabled", true);
    expect(deepseek.getAttribute("title")).toContain("out of credit");
    // The keyless provider stays selectable — nothing else works either.
    expect(screen.getByTestId("llm-provider-option-openai")).toHaveProperty("disabled", false);
  });

  it("refetches availability when the provider list is opened", async () => {
    getProvidersMock.mockResolvedValue(providersResponse(["openai"]));
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    const callsAfterMount = getProvidersMock.mock.calls.length;
    await user.click(screen.getByTestId("llm-provider-select"));

    expect(getProvidersMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("disables nothing when the backend has no keys at all", async () => {
    getProvidersMock.mockResolvedValue(providersResponse([]));
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-provider-select"));

    // Greying out every provider would block workflow design entirely, so the
    // builder only shows the hint.
    const claudeOption = await screen.findByTestId("llm-provider-option-claude");
    expect(claudeOption).toHaveProperty("disabled", false);
  });

  it("leaves every provider usable when the status call fails", async () => {
    getProvidersMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await user.click(screen.getByTestId("llm-provider-select"));

    const claudeOption = await screen.findByTestId("llm-provider-option-claude");
    expect(claudeOption).toHaveProperty("disabled", false);
    expect(claudeOption.textContent).toContain("models");
  });

  it("auto-switches away from disabled default provider (openai) to the first available provider", async () => {
    getProvidersMock.mockResolvedValue(providersResponse(["claude"]));
    const { onUpdateNodeData } = renderInspector({ llmProvider: "openai", llmModel: "gpt-5.4-mini" });

    await waitFor(() => {
      expect(onUpdateNodeData).toHaveBeenCalledWith("llmProvider", "claude");
      expect(onUpdateNodeData).toHaveBeenCalledWith("llmModel", "claude-sonnet-5");
    });
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

describe("AI Memory node inspector", () => {
  function renderMemoryNode(data?: Partial<BuilderNodeData>) {
    const onUpdateNodeData = vi.fn();
    render(
      <NodeInspector
        selectedNode={{
          id: "mem-1",
          type: "coreNode",
          position: { x: 0, y: 0 },
          data: {
            label: "Memory Node",
            title: "Memory Node",
            kind: "AI",
            nodeKind: "ai",
            type: "ai.memory",
            subtitle: "Aggregates memory and documents",
            customMemoryNotes: "Remember patient preferences",
            ...data
          } as BuilderNodeData
        }}
        onClearSelection={vi.fn()}
        onUpdateNodeData={onUpdateNodeData}
        onDeleteNode={vi.fn()}
      />
    );
    return { onUpdateNodeData };
  }

  it("renders Node name, Custom context, Attachments, and Output variable", () => {
    renderMemoryNode();

    expect(screen.getByText("Node name")).toBeDefined();
    expect(screen.getByText("Custom context")).toBeDefined();
    expect(screen.getByText("Memory configuration")).toBeDefined();
    expect(screen.getByText("Attachments")).toBeDefined();
    expect(screen.getByText("Files (Images / PDFs / Docs)")).toBeDefined();
    expect(screen.getByText("Output variable")).toBeDefined();
    expect(screen.getByText("Copy {{memory}}")).toBeDefined();
    expect(screen.queryByText("Description")).toBeNull();
  });
});


