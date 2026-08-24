/**
 * THE AI BRAIN'S CONTROL PANEL, IN ONE ANSWER.
 *
 * Everything an admin needs to decide about an LLM lives here: whether the key
 * works, whether the provider is on, which models it actually has, which of
 * them architects may use, and what each one costs us.
 *
 * It replaced a form that made an admin type a model id out of a provider's
 * documentation. The provider already publishes that list, so typing it was
 * work we invented, and one typo produced a model that looked real in a
 * dropdown and failed on the first customer.
 */

import { LLM_MODELS, LLM_PROVIDERS } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { llmProviderApiKey } from "../ai-provider-engine/llm-credentials";
import { probeLlmProvider } from "../ai-provider-engine/llm-probe";
import { invalidateProviderModelCache, providerModels } from "../ai-provider-engine/provider-models";
import { invalidateLlmModelCache } from "./llm-model-registry";

/** What an admin sees in the status column, in words rather than codes. */
export type ProviderHealth =
  | { state: "working"; detail: null }
  | { state: "no-key"; detail: "No key saved yet." }
  | { state: "problem"; detail: string };

export type AdminLlmModelRow = {
  /** The id sent to the provider. Never typed by a human. */
  modelId: string;
  /** What the provider calls it. */
  providerName: string | null;
  /** What an architect sees. Blank means we have not renamed it. */
  displayName: string;
  /** Available: may an architect choose it in something new. */
  enabled: boolean;
  /** Running: may it run at all, including in agents already bought. */
  runningEnabled: boolean;
  inputPricePer1M: number | null;
  outputPricePer1M: number | null;
  /** True when this model shipped with the platform, so we know its price. */
  shipped: boolean;
};

export type AdminLlmProviderView = {
  providerId: string;
  displayName: string;
  /** The env key its key is stored under, so the page can save it. */
  envKey: string;
  hasKey: boolean;
  enabled: boolean;
  health: ProviderHealth;
  /** Null when the provider could not be asked — the reason is in health. */
  models: AdminLlmModelRow[] | null;
  modelsProblem: string | null;
};

async function healthOf(providerId: string): Promise<ProviderHealth> {
  if (!llmProviderApiKey(providerId)) return { state: "no-key", detail: "No key saved yet." };

  const verdict = await probeLlmProvider(providerId).catch(() => null);
  if (!verdict) return { state: "working", detail: null };
  if (verdict.usable) return { state: "working", detail: null };

  // "out of credit" reads better as a sentence than as a state name — this is
  // the column an admin scans when a customer says the agent stopped answering.
  return { state: "problem", detail: `${verdict.reason ?? "not usable"}.` };
}

/**
 * Everything about every provider, assembled in parallel.
 *
 * One provider being slow or down must not stop the others being shown: an
 * admin opening this page during an outage is opening it BECAUSE of the outage.
 */
export async function llmControlPanel(force = false): Promise<AdminLlmProviderView[]> {
  const [providerRows, modelRows] = await Promise.all([
    prisma.adminLlmProvider.findMany().catch(() => []),
    prisma.adminLlmModel.findMany().catch(() => [])
  ]);

  const providerEnabled = new Map(providerRows.map((row) => [row.providerId, row.enabled]));
  const overrides = new Map(modelRows.map((row) => [row.modelId, row]));
  const shipped = new Map(LLM_MODELS.map((model) => [model.id, model]));

  return Promise.all(
    LLM_PROVIDERS.map(async (provider) => {
      const [health, listing] = await Promise.all([
        healthOf(provider.id),
        providerModels(provider.id, force)
      ]);

      let models: AdminLlmModelRow[] | null = null;
      let modelsProblem: string | null = null;

      if (listing.ok) {
        models = listing.models.map((model) => {
          const override = overrides.get(model.id);
          const built = shipped.get(model.id);

          return {
            modelId: model.id,
            providerName: model.providerName ?? null,
            displayName: override?.displayName ?? built?.displayName ?? "",
            /* A model nobody has decided about is OFF. The provider lists
               dozens — embeddings, moderation, old snapshots — and offering an
               architect all of them by default would be worse than offering
               none. */
            enabled: override?.enabled ?? Boolean(built),
            runningEnabled: override?.runningEnabled ?? true,
            inputPricePer1M: override?.inputPricePer1M ?? built?.inputPricePer1M ?? null,
            outputPricePer1M: override?.outputPricePer1M ?? built?.outputPricePer1M ?? null,
            shipped: Boolean(built)
          };
        });
      } else {
        modelsProblem = listing.reason;
      }

      return {
        providerId: provider.id,
        displayName: provider.displayName,
        envKey: provider.envKey,
        hasKey: Boolean(llmProviderApiKey(provider.id)),
        enabled: providerEnabled.get(provider.id) ?? true,
        health,
        models,
        modelsProblem
      };
    })
  );
}

export async function setProviderEnabled(providerId: string, enabled: boolean) {
  await prisma.adminLlmProvider.upsert({
    where: { providerId },
    update: { enabled },
    create: { providerId, enabled }
  });
  invalidateLlmModelCache();
}

export type ModelPatch = {
  displayName?: string;
  enabled?: boolean;
  runningEnabled?: boolean;
  inputPricePer1M?: number | null;
  outputPricePer1M?: number | null;
};

/**
 * Change one model.
 *
 * `providerId` comes from the caller rather than the row, because the first
 * time a model is touched there is no row — an admin switching on a model the
 * provider listed is creating our record of it, not editing one.
 */
export async function patchModel(modelId: string, providerId: string, patch: ModelPatch) {
  const shipped = LLM_MODELS.find((model) => model.id === modelId);

  const saved = await prisma.adminLlmModel.upsert({
    where: { modelId },
    update: {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.runningEnabled !== undefined ? { runningEnabled: patch.runningEnabled } : {}),
      ...(patch.inputPricePer1M !== undefined ? { inputPricePer1M: patch.inputPricePer1M } : {}),
      ...(patch.outputPricePer1M !== undefined ? { outputPricePer1M: patch.outputPricePer1M } : {})
    },
    create: {
      modelId,
      providerId,
      displayName: patch.displayName?.trim() || shipped?.displayName || modelId,
      category: shipped?.category ?? "flagship",
      enabled: patch.enabled ?? true,
      runningEnabled: patch.runningEnabled ?? true,
      inputPricePer1M: patch.inputPricePer1M ?? shipped?.inputPricePer1M ?? null,
      outputPricePer1M: patch.outputPricePer1M ?? shipped?.outputPricePer1M ?? null,
      multimodal: shipped?.multimodal ?? false
    }
  });

  invalidateLlmModelCache();
  return saved;
}

/** After a key changes, the old answer about that provider is worthless. */
export function forgetProvider(providerId: string): void {
  invalidateProviderModelCache(providerId);
  invalidateLlmModelCache();
}
