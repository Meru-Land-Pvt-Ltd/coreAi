/**
 * THE MODEL LIST, WITH A DOOR AN ADMIN CAN OPEN.
 *
 * `LLM_MODELS` in packages/shared ships with the code, so adding a model meant
 * an edit, a review and a deploy. Providers publish new models constantly, and
 * an architect who cannot pick this week's model is building on last month's
 * platform. So admins add models here and every AI Brain sees them at once.
 *
 * MODELS ONLY, and deliberately. A new provider needs an adapter that speaks
 * its API, which is code somebody has to write and test. A new model on a
 * provider the engine already speaks to is data. Pretending otherwise would
 * hand an admin a form that produces a model nothing can call.
 */

import { LLM_MODELS, LLM_PROVIDERS, type LlmModelMeta, type LlmTaskCategory } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { providerModels } from "../ai-provider-engine/provider-models";

const BADGE_BY_CATEGORY: Record<LlmTaskCategory, LlmModelMeta["badge"]> = {
  thinking: "Thinking",
  flagship: "Flagship",
  fast: "Fast",
  code: "Coding",
  legacy: "Legacy"
};

const CATEGORIES = Object.keys(BADGE_BY_CATEGORY) as LlmTaskCategory[];

export function isKnownLlmCategory(value: string): value is LlmTaskCategory {
  return (CATEGORIES as string[]).includes(value);
}

/** The providers the engine actually has an adapter for. Nothing else is offerable. */
export function offerableProviderIds(): string[] {
  return LLM_PROVIDERS.map((provider) => provider.id);
}

/**
 * Every model an architect may pick: the shipped list plus whatever an admin
 * has added, minus anything an admin has switched off.
 *
 * Cached briefly. This is read on every builder page load and every composer
 * run, and a model list one minute out of date has never hurt anybody — but a
 * query per page load, per architect, forever, would.
 */
let cache: { at: number; models: LlmModelMeta[] } | null = null;
const CACHE_MS = 30_000;

export async function allLlmModels(force = false): Promise<LlmModelMeta[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  try {
    const [rows, providerRows] = await Promise.all([
      prisma.adminLlmModel.findMany(),
      prisma.adminLlmProvider.findMany()
    ]);

    const overrides = new Map(rows.map((row) => [row.modelId, row]));
    const shipped = new Map(LLM_MODELS.map((model) => [model.id, model]));

    /* A provider switched off takes all of its models with it. Reaching for one
       switch when a provider is down beats switching off eleven models and
       remembering to switch them back. */
    const offProviders = new Set(
      providerRows.filter((row) => !row.enabled).map((row) => row.providerId)
    );

    const models: LlmModelMeta[] = [];

    for (const provider of LLM_PROVIDERS) {
      if (offProviders.has(provider.id)) continue;

      /* THE SAME LIST THE ADMIN PAGE SHOWS.
         This used to be built from LLM_MODELS, the list compiled into the
         platform — while the admin page listed what the provider actually
         publishes. Those are not the same models: Anthropic returns
         "claude-opus-4-5-20251101" and our shipped list said
         "claude-opus-4-5". So an admin toggled one model and an architect was
         offered a different one, and the switches appeared to do nothing.
         One fact, one home: the provider's list is the fact. */
      const listing = await providerModels(provider.id, force);
      if (!listing.ok) {
        // The provider could not be asked — its shipped models are better than
        // nothing while its key is being fixed.
        for (const model of LLM_MODELS) {
          if (model.providerId !== provider.id) continue;
          if (overrides.get(model.id)?.enabled === false) continue;
          models.push(model);
        }
        continue;
      }

      for (const listed of listing.models) {
        const override = overrides.get(listed.id);
        const built = shipped.get(listed.id);

        /* A model nobody has decided about is OFF. A provider lists dozens —
           embeddings, moderation, old snapshots — and offering an architect all
           of them is worse than offering none. */
        const on = override?.enabled ?? Boolean(built);
        if (!on) continue;

        const category = isKnownLlmCategory(override?.category ?? "")
          ? (override!.category as LlmTaskCategory)
          : (built?.category ?? "flagship");

        models.push({
          id: listed.id,
          providerId: provider.id,
          displayName: override?.displayName || built?.displayName || listed.providerName || listed.id,
          category,
          badge: BADGE_BY_CATEGORY[category],
          inputPricePer1M: override?.inputPricePer1M ?? built?.inputPricePer1M ?? null,
          outputPricePer1M: override?.outputPricePer1M ?? built?.outputPricePer1M ?? null,
          multimodal: override?.multimodal ?? built?.multimodal ?? false
        });
      }
    }

    cache = { at: Date.now(), models };
    return models;
  } catch (error) {
    // The shipped list is the floor. A database blip must never leave an
    // architect with an empty model dropdown on a node they are mid-way
    // through building.
    console.warn("[llm-models] could not build the model list", (error as Error).message);
    return LLM_MODELS;
  }
}

export function invalidateLlmModelCache(): void {
  cache = null;
}

export type AdminLlmModelInput = {
  modelId: string;
  providerId: string;
  displayName: string;
  category: string;
  inputPricePer1M?: number | null;
  outputPricePer1M?: number | null;
  multimodal?: boolean;
  enabled?: boolean;
};

/**
 * What is wrong with this model, in words an admin can act on.
 *
 * Returns null when it is fine. Checked here rather than in the route so the
 * same answer is given wherever a model is added from.
 */
export function whatIsWrongWith(input: AdminLlmModelInput): string | null {
  const modelId = input.modelId?.trim() ?? "";
  if (!modelId) return "The model id is what gets sent to the provider — it cannot be blank.";
  if (modelId.length > 120) return "That model id is longer than any provider uses. Check it for a stray paste.";

  if (!offerableProviderIds().includes(input.providerId)) {
    return `Triven has no adapter for "${input.providerId}", so nothing could call this model. Adding a new provider needs a release, not this form.`;
  }

  if (!input.displayName?.trim()) return "Give it a name an architect will recognise in the dropdown.";
  if (!isKnownLlmCategory(input.category)) {
    return `"${input.category}" is not one of: ${CATEGORIES.join(", ")}.`;
  }

  for (const [label, price] of [
    ["Input price", input.inputPricePer1M],
    ["Output price", input.outputPricePer1M]
  ] as const) {
    if (price === null || price === undefined) continue;
    if (!Number.isFinite(price) || price < 0) return `${label} has to be a number, or left empty if you do not know it.`;
  }

  return null;
}

export async function listAdminLlmModels() {
  return prisma.adminLlmModel.findMany({ orderBy: [{ providerId: "asc" }, { displayName: "asc" }] });
}

export async function saveAdminLlmModel(input: AdminLlmModelInput, addedByUserId: string) {
  const data = {
    providerId: input.providerId,
    displayName: input.displayName.trim(),
    category: input.category,
    inputPricePer1M: input.inputPricePer1M ?? null,
    outputPricePer1M: input.outputPricePer1M ?? null,
    multimodal: input.multimodal ?? false,
    enabled: input.enabled ?? true
  };

  const saved = await prisma.adminLlmModel.upsert({
    where: { modelId: input.modelId.trim() },
    update: data,
    create: { ...data, modelId: input.modelId.trim(), addedByUserId }
  });

  invalidateLlmModelCache();
  return saved;
}

export async function removeAdminLlmModel(modelId: string) {
  await prisma.adminLlmModel.delete({ where: { modelId } }).catch(() => null);
  invalidateLlmModelCache();
}
