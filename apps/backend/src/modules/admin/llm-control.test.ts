import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE AI BRAIN'S CONTROL PANEL.
 *
 * The first version made an admin type a model id copied out of a provider's
 * documentation. The provider already publishes that list, so typing it was
 * work we invented — and one typo produced a model that looked real in a
 * dropdown and failed on the first customer.
 */

const modelFindMany = vi.fn();
const providerFindMany = vi.fn();
const upsert = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    adminLlmModel: { findMany: (...a: unknown[]) => modelFindMany(...a), upsert: (...a: unknown[]) => upsert(...a) },
    adminLlmProvider: { findMany: (...a: unknown[]) => providerFindMany(...a), upsert: (...a: unknown[]) => upsert(...a) }
  }
}));
vi.mock("../ai-provider-engine/llm-credentials", () => ({ llmProviderApiKey: () => "a-key" }));
vi.mock("../ai-provider-engine/llm-probe", () => ({
  probeLlmProvider: async () => ({ usable: true, reason: null })
}));
vi.mock("../ai-provider-engine/provider-models", () => ({
  providerModels: async (providerId: string) =>
    providerId === "openai"
      ? { ok: true, models: [{ id: "gpt-5.5" }, { id: "gpt-brand-new" }] }
      : { ok: false, reason: "Out of credit." },
  invalidateProviderModelCache: () => undefined
}));

import { llmControlPanel } from "./llm-control";

beforeEach(() => {
  vi.clearAllMocks();
  modelFindMany.mockResolvedValue([]);
  providerFindMany.mockResolvedValue([]);
});

describe("what an admin is shown", () => {
  it("lists the models a provider actually has, not a list somebody typed", async () => {
    const panel = await llmControlPanel(true);
    const openai = panel.find((p) => p.providerId === "openai");

    expect(openai?.models?.map((m) => m.modelId)).toEqual(["gpt-5.5", "gpt-brand-new"]);
  });

  it("a model nobody has decided about is OFF", async () => {
    // A provider lists dozens — embeddings, moderation, old snapshots. Offering
    // an architect all of them by default is worse than offering none.
    const panel = await llmControlPanel(true);
    const models = panel.find((p) => p.providerId === "openai")?.models ?? [];

    expect(models.find((m) => m.modelId === "gpt-brand-new")?.enabled).toBe(false);
    // ...but one that shipped with the platform is on, because we already chose it.
    expect(models.find((m) => m.modelId === "gpt-5.5")?.enabled).toBe(true);
  });

  it("a provider that cannot be asked says why, and does not pretend to have no models", async () => {
    const panel = await llmControlPanel(true);
    const claude = panel.find((p) => p.providerId === "claude");

    // null, not [] — "we could not ask" and "it has none" are different, and an
    // admin acts differently on each.
    expect(claude?.models).toBeNull();
    expect(claude?.modelsProblem).toBe("Out of credit.");
  });

  it("an admin's own name and price win over what shipped", async () => {
    modelFindMany.mockResolvedValue([
      {
        modelId: "gpt-5.5",
        providerId: "openai",
        displayName: "Our Fast One",
        category: "flagship",
        enabled: true,
        runningEnabled: false,
        inputPricePer1M: 9.99,
        outputPricePer1M: null,
        multimodal: false
      }
    ]);

    const models = (await llmControlPanel(true)).find((p) => p.providerId === "openai")?.models ?? [];
    const row = models.find((m) => m.modelId === "gpt-5.5");

    expect(row?.displayName).toBe("Our Fast One");
    expect(row?.inputPricePer1M).toBe(9.99);
    // The two switches are independent, exactly like the node switches.
    expect(row?.enabled).toBe(true);
    expect(row?.runningEnabled).toBe(false);
  });

  it("one provider being down never hides the others", async () => {
    // An admin opening this page during an outage is opening it BECAUSE of the
    // outage. Every provider still gets a row.
    const panel = await llmControlPanel(true);
    expect(panel.length).toBeGreaterThan(2);
    expect(panel.every((p) => typeof p.displayName === "string")).toBe(true);
  });
});
