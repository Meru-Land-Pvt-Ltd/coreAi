import { describe, expect, it, vi } from "vitest";
import { AIProviderEngine } from "./provider-engine";
import type { AIProviderAdapter } from "./types";
import type { ProviderRegistry } from "./provider-registry";

/**
 * The engine-level Limited Use gate: with the default (all-false) confirmation
 * flags, GOOGLE_WORKSPACE_DERIVED and RAW requests must be blocked BEFORE any
 * adapter/network call, for every provider — including Gemini (no free-tier
 * fallback). GENERAL requests pass through untouched.
 */

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
