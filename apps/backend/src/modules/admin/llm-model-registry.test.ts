import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADDING A MODEL WITHOUT WAITING FOR A RELEASE.
 *
 * Providers publish new models constantly. Before this, offering one meant a
 * code edit and a deploy — so an architect building today was offered whatever
 * was current the last time we shipped.
 *
 * The two limits matter as much as the feature: a provider needs an adapter
 * (code), and a shipped model's name and price are ours.
 */

const findMany = vi.fn();
vi.mock("../../lib/prisma", () => ({
  prisma: { adminLlmModel: { findMany: (...a: unknown[]) => findMany(...a) } }
}));

import { allLlmModels, invalidateLlmModelCache, whatIsWrongWith, offerableProviderIds } from "./llm-model-registry";
import { LLM_MODELS } from "@coreai/shared";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateLlmModelCache();
});

describe("what an admin is allowed to add", () => {
  it("refuses a provider Triven has no adapter for, and says why", () => {
    const problem = whatIsWrongWith({
      modelId: "some-model",
      providerId: "cohere",
      displayName: "Some Model",
      category: "flagship"
    });
    // Not "invalid provider". The reason, and what to do instead.
    expect(problem).toContain("no adapter");
    expect(problem).toContain("release");
  });

  it("accepts a model on a provider we already speak to", () => {
    expect(
      whatIsWrongWith({
        modelId: "gpt-5.6",
        providerId: offerableProviderIds()[0],
        displayName: "GPT-5.6",
        category: "flagship"
      })
    ).toBeNull();
  });

  it("refuses a blank model id, because that is what gets sent to the provider", () => {
    const problem = whatIsWrongWith({ modelId: "  ", providerId: "openai", displayName: "X", category: "fast" });
    expect(problem).toContain("cannot be blank");
  });

  it("lets a price be unknown, but not nonsense", () => {
    const base = { modelId: "m", providerId: "openai", displayName: "M", category: "fast" };
    expect(whatIsWrongWith({ ...base, inputPricePer1M: null })).toBeNull();
    expect(whatIsWrongWith({ ...base, inputPricePer1M: -3 })).toContain("Input price");
  });
});

describe("the list an architect actually sees", () => {
  it("is the shipped list plus whatever an admin added", async () => {
    findMany.mockResolvedValue([
      {
        modelId: "gpt-5.6",
        providerId: "openai",
        displayName: "GPT-5.6",
        category: "flagship",
        inputPricePer1M: 4,
        outputPricePer1M: 40,
        multimodal: true,
        enabled: true
      }
    ]);

    const models = await allLlmModels(true);
    expect(models.length).toBe(LLM_MODELS.length + 1);
    expect(models.find((m) => m.id === "gpt-5.6")?.badge).toBe("Flagship");
  });

  it("drops a shipped model an admin switched off", async () => {
    // The other half of the feature: a model that starts refusing calls has to
    // be removable today, not at the next release.
    const victim = LLM_MODELS[0]!.id;
    findMany.mockResolvedValue([
      { modelId: victim, providerId: "openai", displayName: "x", category: "fast", inputPricePer1M: null, outputPricePer1M: null, multimodal: false, enabled: false }
    ]);

    const models = await allLlmModels(true);
    expect(models.some((m) => m.id === victim)).toBe(false);
  });

  it("an admin row replaces a shipped one rather than showing it twice", async () => {
    const victim = LLM_MODELS[0]!;
    findMany.mockResolvedValue([
      { modelId: victim.id, providerId: victim.providerId, displayName: "Renamed", category: "fast", inputPricePer1M: 1, outputPricePer1M: 2, multimodal: false, enabled: true }
    ]);

    const models = await allLlmModels(true);
    expect(models.filter((m) => m.id === victim.id)).toHaveLength(1);
    expect(models.find((m) => m.id === victim.id)?.displayName).toBe("Renamed");
  });

  it("falls back to the shipped list when the database cannot be read", async () => {
    // An empty model dropdown on a node somebody is halfway through building
    // is far worse than a list one release out of date.
    findMany.mockRejectedValue(new Error("db is down"));
    await expect(allLlmModels(true)).resolves.toEqual(LLM_MODELS);
  });
});
