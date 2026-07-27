import {
  LLM_PROVIDERS,
  defaultLlmModelForProvider,
  findLlmModel,
  getLlmModelsForProvider,
  resolveLlmSelection
} from "@coreai/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { getProviderEngine, initProviderEngine } from "../ai-provider-engine/ai-provider-engine";
import { runWorkflowTest } from "../architect/workflow-runner";

describe("shared LLM catalog", () => {
  it("gives every provider models and a default that exists", () => {
    for (const provider of LLM_PROVIDERS) {
      const models = getLlmModelsForProvider(provider.id);
      expect(models.length).toBeGreaterThan(0);

      const defaultModel = defaultLlmModelForProvider(provider.id);
      expect(defaultModel).not.toBeNull();
      expect(findLlmModel(defaultModel)?.providerId).toBe(provider.id);
    }
  });

  it("keeps a model that belongs to the chosen provider", () => {
    expect(resolveLlmSelection("claude", "claude-opus-5")).toEqual({
      providerId: "claude",
      modelId: "claude-opus-5"
    });
  });

  it("drops a model belonging to a different provider — the provider wins", () => {
    expect(resolveLlmSelection("claude", "gpt-5.5")).toEqual({
      providerId: "claude",
      modelId: null
    });
  });

  it("keeps uncataloged model ids that are still valid at the provider", () => {
    expect(resolveLlmSelection("openai", "gpt-4-turbo")).toEqual({
      providerId: "openai",
      modelId: "gpt-4-turbo"
    });
  });

  it("carries each provider's current and legacy models", () => {
    const openaiIds = getLlmModelsForProvider("openai").map((model) => model.id);
    expect(openaiIds).toEqual(expect.arrayContaining(["gpt-5.5", "o4-mini", "gpt-4o", "gpt-4o-mini"]));

    const claudeIds = getLlmModelsForProvider("claude").map((model) => model.id);
    expect(claudeIds).toEqual(expect.arrayContaining(["claude-opus-5", "claude-sonnet-4-5"]));

    // Every id is unique and owned by exactly one provider.
    const allIds = LLM_PROVIDERS.flatMap((provider) =>
      getLlmModelsForProvider(provider.id).map((model) => model.id)
    );
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("normalizes saved provider aliases", () => {
    expect(resolveLlmSelection("anthropic", "claude-sonnet-5").providerId).toBe("claude");
    expect(resolveLlmSelection("google", "gemini-3.5-flash").providerId).toBe("gemini");
    expect(resolveLlmSelection("", "").providerId).toBe("openai");
  });

  it("leaves uncataloged providers alone", () => {
    expect(resolveLlmSelection("llama", "llama3")).toEqual({
      providerId: "llama",
      modelId: "llama3"
    });
  });
});

describe("AI Brain node provider/model pairing at run time", () => {
  const calls: Array<{ providerId: string; model: string | undefined }> = [];
  const savedKeys = new Map<string, { env: unknown; process: string | undefined }>();

  function setKey(key: string, value: string | undefined): void {
    (env as Record<string, unknown>)[key] = value;
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  beforeAll(async () => {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
      savedKeys.set(key, { env: (env as Record<string, unknown>)[key], process: process.env[key] });
    }
    setKey("OPENAI_API_KEY", "sk-test-openai");
    setKey("ANTHROPIC_API_KEY", "sk-test-anthropic");

    await initProviderEngine().catch(() => {});
    vi.spyOn(getProviderEngine(), "executeWithProvider").mockImplementation(
      async (providerId, request) => {
        calls.push({ providerId, model: request.model });
        return {
          status: "success",
          capability: "llm",
          text: "mock reply",
          structuredOutput: null,
          attachments: [],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          cost: null,
          conversationId: null,
          providerMetadata: {},
          providerId,
          modelName: request.model ?? "mock-model",
          durationMs: 1,
          error: null
        };
      }
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
    for (const [key, previous] of savedKeys) {
      (env as Record<string, unknown>)[key] = previous.env;
      if (previous.process === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous.process;
      }
    }
  });

  function workflowWith(llmProvider: string, llmModel: string) {
    return {
      nodes: [
        { id: "trigger-1", data: { type: "trigger.manual", nodeKind: "trigger", title: "Manual" } },
        {
          id: "brain-1",
          data: {
            type: "ai.llm_call",
            nodeKind: "ai",
            title: "AI Brain",
            llmProvider,
            llmModel,
            llmRequirements: "Say hello."
          }
        }
      ],
      edges: [{ id: "e1", source: "trigger-1", target: "brain-1" }]
    };
  }

  it("sends the model the node picked for its provider", async () => {
    calls.length = 0;

    await runWorkflowTest({
      userId: "user-llm-pairing",
      workflowId: "wf-llm-pairing-match",
      workflowJson: workflowWith("claude", "claude-opus-5")
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ providerId: "claude", model: "claude-opus-5" });
  });

  it("never sends another provider's model — the provider wins", async () => {
    calls.length = 0;

    await runWorkflowTest({
      userId: "user-llm-pairing",
      workflowId: "wf-llm-pairing-mismatch",
      workflowJson: workflowWith("claude", "gpt-5.5")
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerId).toBe("claude");
    expect(calls[0]?.model).toBeUndefined();
  });

  it("substitutes a configured provider when the chosen one has no key", async () => {
    calls.length = 0;
    setKey("OPENAI_API_KEY", undefined);

    await runWorkflowTest({
      userId: "user-llm-pairing",
      workflowId: "wf-llm-pairing-nokey",
      workflowJson: workflowWith("openai", "gpt-5.4-mini")
    });

    setKey("OPENAI_API_KEY", "sk-test-openai");

    expect(calls).toHaveLength(1);
    // Claude stands in, and the OpenAI model name goes with the provider that
    // could not run — the substitute picks its own default.
    expect(calls[0]).toEqual({ providerId: "claude", model: undefined });
  });
});
