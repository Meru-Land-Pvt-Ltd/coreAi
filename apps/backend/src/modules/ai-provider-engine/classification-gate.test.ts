import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AIProviderEngine } from "./provider-engine";
import type { AIProviderAdapter } from "./types";
import type { ProviderRegistry } from "./provider-registry";
import { env } from "../../config/env";

const GUARD_FLAGS = [
  "GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED",
  "VAPI_WORKSPACE_NO_TRAINING_CONFIRMED",
  "VAPI_HIPAA_OR_ZDR_CONFIRMED",
  "OPENAI_NO_TRAINING_CONFIRMED",
  "OPENAI_DATA_SHARING_DISABLED_CONFIRMED",
  "ANTHROPIC_NO_TRAINING_CONFIRMED",
  "ANTHROPIC_FEEDBACK_SHARING_DISABLED_CONFIRMED",
  "GEMINI_PAID_SERVICE_CONFIRMED",
  "GEMINI_DATASET_SHARING_DISABLED_CONFIRMED",
  "DEEPGRAM_MIP_OPT_OUT_CONFIRMED",
  "ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED"
] as const;
const savedFlags = new Map<string, unknown>();

beforeAll(() => {
  for (const flag of GUARD_FLAGS) {
    savedFlags.set(flag, (env as Record<string, unknown>)[flag]);
    (env as Record<string, unknown>)[flag] = false;
  }
});

afterAll(() => {
  for (const flag of GUARD_FLAGS) {
    (env as Record<string, unknown>)[flag] = savedFlags.get(flag);
  }
});

function fakeAdapter(providerId: string): AIProviderAdapter {
  return {
    providerId,
    displayName: providerId,
    capabilities: ["llm"],
    scores: {},
    models: ["model-1"],
    validate: vi.fn(async () => ({ valid: true })),
    execute: vi.fn(async () => ({
      status: "success",
      capability: "llm",
      text: "ok",
      structuredOutput: null,
      attachments: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, model: "model-1" },
      conversationId: null,
      providerMetadata: {},
      providerId,
      modelName: "model-1",
      durationMs: 1,
      error: null
    })),
    continueConversation: vi.fn(),
    estimateCost: vi.fn()
  } as unknown as AIProviderAdapter;
}

function engineWith(adapter: AIProviderAdapter): AIProviderEngine {
  const registry = {
    all: () => [adapter],
    resolve: () => adapter,
    list: () => [adapter.providerId],
    has: () => true
  } as unknown as ProviderRegistry;
  return new AIProviderEngine(registry);
}

describe("provider-engine classification gate", () => {
  it("blocks GOOGLE_WORKSPACE_DERIVED for every provider under default (unconfirmed) flags", async () => {
    for (const providerId of ["gemini", "openai", "claude", "mistral", "llama"]) {
      const adapter = fakeAdapter(providerId);
      const engine = engineWith(adapter);
      await expect(
        engine.executeWithProvider(providerId, {
          messages: [{ role: "user", content: "derived slot data" }],
          classification: "GOOGLE_WORKSPACE_DERIVED"
        })
      ).rejects.toThrow(/Limited Use guard/);
      expect(adapter.execute).not.toHaveBeenCalled();
    }
  });

  it("blocks GOOGLE_WORKSPACE_RAW unconditionally", async () => {
    const adapter = fakeAdapter("openai");
    const engine = engineWith(adapter);
    await expect(
      engine.executeWithProvider("openai", { classification: "GOOGLE_WORKSPACE_RAW" })
    ).rejects.toThrow(/RAW_WORKSPACE_DATA_NEVER_AI_ELIGIBLE/);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("gemini derived-data block names the paid-service confirmation chain (no free fallback path)", async () => {
    const adapter = fakeAdapter("gemini");
    const engine = engineWith(adapter);
    await expect(
      engine.executeWithProvider("gemini", { classification: "GOOGLE_WORKSPACE_DERIVED" })
    ).rejects.toThrow(/GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED/);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("GENERAL requests (the default) pass through to the adapter", async () => {
    const adapter = fakeAdapter("gemini");
    const engine = engineWith(adapter);
    await expect(engine.executeWithProvider("gemini", { messages: [] })).resolves.toMatchObject({ text: "ok" });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });
});
