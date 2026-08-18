import {
  getLlmModelsForProvider,
  isCatalogedLlmProvider,
  normalizeLlmProviderId,
  findLlmModel,
  LLM_PROVIDERS
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { resolveConfiguredLlmProvider } from "../ai-provider-engine/llm-credentials";

/**
 * Swappable batteries — one shared mechanism, one slot per platform brain.
 *
 * The doors were the first battery: one provider/model an admin picks, powering
 * every AI door on every agent. The Design Brain is the second, and the same
 * three rules hold for both, which is why they share this factory rather than
 * two near-identical files that drift apart:
 *
 *   1. Never hardcoded — the value comes from the admin screen, and swapping it
 *      there changes every use instantly.
 *   2. Never model-less — with nothing saved, the slot's own safe default runs.
 *   3. Never fatal — a database hiccup returns the last known battery instead of
 *      taking a customer's run (or an architect's design) down.
 *
 * Storage reuses the PlatformApiSetting key/value table: no new table, no
 * migration. Neither value is a credential (`secret: false`) but the column is
 * `valueEncrypted`, so both are stored encrypted at rest like every other row.
 * Saving blank deletes the row, which restores the default.
 */

/** Longest model id an admin can save (generous; ids are short). */
export const BRAIN_MODEL_MAX_LENGTH = 120;

export type BrainSlotConfig = {
  providerId: string;
  /** null means "let the provider pick its own default model". */
  modelId: string | null;
};

export type BrainSlotSetting = {
  /** The effective provider (saved value, or the default when unset). */
  providerId: string;
  /** The effective model, or null for "the provider's own default". */
  modelId: string | null;
  /** True while no admin override is stored for either key. */
  isDefault: boolean;
  updatedAt: string | null;
};

export type SaveBrainSlotInput = {
  /** Blank/undefined clears the override and restores the default provider. */
  provider?: string | null;
  /** Blank/undefined clears the override and lets the slot default apply. */
  model?: string | null;
};

export type SaveBrainSlotResult = BrainSlotConfig & {
  /** True when nothing is stored any more and the platform default applies. */
  restoredDefault: boolean;
};

/* ------------------------- provider/model vocabulary ----------------------- */

/** The provider ids an admin may choose — the engine's known providers. */
export function brainProviderOptions(): Array<{ id: string; displayName: string }> {
  return LLM_PROVIDERS.map((provider) => ({ id: provider.id, displayName: provider.displayName }));
}

/**
 * True for provider ids the AI provider engine knows how to run. Validated at
 * save time so a typo can never silently disable a whole platform brain.
 */
export function isSupportedBrainProvider(providerId: string): boolean {
  // Blank is not a choice — `normalizeLlmProviderId` would answer with the
  // catalog's own default and quietly wave an empty value through.
  if (!providerId.trim()) return false;
  return isCatalogedLlmProvider(normalizeLlmProviderId(providerId));
}

/**
 * True when the model id belongs to a DIFFERENT provider than the one chosen
 * (e.g. provider "gemini" with model "gpt-4o") — a guaranteed API rejection, so
 * it is refused at save time. Model ids the catalog has never heard of pass:
 * providers ship new models faster than this catalog is updated.
 */
export function brainModelMismatch(providerId: string, modelId: string): boolean {
  const model = findLlmModel(modelId);
  return Boolean(model && model.providerId !== normalizeLlmProviderId(providerId));
}

/** The models the admin screen offers for a provider (may be empty). */
export function brainModelOptions(providerId: string): Array<{ id: string; displayName: string }> {
  return getLlmModelsForProvider(normalizeLlmProviderId(providerId)).map((model) => ({
    id: model.id,
    displayName: model.displayName
  }));
}

/**
 * A saved battery turned into the two things an LLM call needs.
 *
 * The provider still goes through the engine's own fallback chain, so a slot
 * pointing at a service whose key was removed keeps working. But a fallback
 * lands on a DIFFERENT service, and a model id from the old one would be a
 * guaranteed API rejection — so the model is dropped whenever that happens and
 * the substitute provider chooses its own.
 *
 * Returns null only when no LLM service is configured at all.
 */
export function resolveBrainSlot(
  config: BrainSlotConfig
): { providerId: string; model?: string } | null {
  const resolved = resolveConfiguredLlmProvider(config.providerId);
  if (!resolved) return null;

  const sameService = normalizeLlmProviderId(resolved.providerId) === normalizeLlmProviderId(config.providerId);
  const model = sameService ? config.modelId : null;
  return { providerId: resolved.providerId, ...(model ? { model } : {}) };
}

/* --------------------------------- factory -------------------------------- */

export type BrainSlot = {
  readonly providerKey: string;
  readonly modelKey: string;
  readonly defaultProvider: string;
  readonly defaultModel: string | null;
  /** Cached (60s), never throws — what the engine calls on every run. */
  getConfig(): Promise<BrainSlotConfig>;
  /** Uncached read for the admin screen — always reflects the database. */
  getSetting(): Promise<BrainSlotSetting>;
  save(input: SaveBrainSlotInput, updatedByUserId: string): Promise<SaveBrainSlotResult>;
  invalidateCache(): void;
};

const CACHE_TTL_MS = 60_000;

type StoredRow = { value: string; updatedAt: Date | null };

export function createBrainSlot(options: {
  /** Used only in log lines, e.g. "door-brain" / "design-brain". */
  name: string;
  providerKey: string;
  modelKey: string;
  defaultProvider: string;
  /** null lets the provider adapter choose its own default model. */
  defaultModel?: string | null;
}): BrainSlot {
  const { name, providerKey, modelKey, defaultProvider } = options;
  const defaultModel = options.defaultModel ?? null;

  let cachedConfig: BrainSlotConfig | null = null;
  let cacheLoadedAt = 0;

  function decodeRow(row: { valueEncrypted: string; updatedAt: Date } | undefined): StoredRow {
    if (!row) return { value: "", updatedAt: null };
    try {
      return { value: decryptSecret(row.valueEncrypted).trim(), updatedAt: row.updatedAt };
    } catch {
      // A row encrypted under a rotated ENCRYPTION_KEY must never break the
      // platform — behave as unset so the safe default applies.
      console.warn(`[${name}] could not decrypt a stored value — using default`);
      return { value: "", updatedAt: null };
    }
  }

  async function readStoredRows(): Promise<{ provider: StoredRow; model: StoredRow }> {
    const rows = await prisma.platformApiSetting.findMany({
      where: { key: { in: [providerKey, modelKey] } },
      select: { key: true, valueEncrypted: true, updatedAt: true }
    });

    const byKey = new Map(rows.map((row) => [row.key, row]));
    return {
      provider: decodeRow(byKey.get(providerKey)),
      model: decodeRow(byKey.get(modelKey))
    };
  }

  /** A stored provider value that is no longer supported falls back to the default. */
  function effectiveProvider(stored: string): string {
    const normalized = normalizeLlmProviderId(stored || defaultProvider);
    return isCatalogedLlmProvider(normalized) ? normalized : defaultProvider;
  }

  /**
   * A stored model belonging to another provider is dropped, never sent. With
   * nothing stored the slot's own default model applies — but only while the
   * provider is still the slot's default one, since a model id is meaningless
   * to a different service.
   */
  function effectiveModel(providerId: string, stored: string): string | null {
    const modelId = stored.trim();
    if (!modelId) {
      return providerId === normalizeLlmProviderId(defaultProvider) ? defaultModel : null;
    }
    return brainModelMismatch(providerId, modelId) ? null : modelId;
  }

  async function writeKey(key: string, value: string, updatedByUserId: string): Promise<void> {
    const trimmed = value.trim();

    if (!trimmed) {
      await prisma.platformApiSetting.deleteMany({ where: { key } });
      return;
    }

    await prisma.platformApiSetting.upsert({
      where: { key },
      update: { valueEncrypted: encryptSecret(trimmed), secret: false, updatedByUserId },
      create: { key, valueEncrypted: encryptSecret(trimmed), secret: false, updatedByUserId }
    });
  }

  async function getSetting(): Promise<BrainSlotSetting> {
    const stored = await readStoredRows();
    const providerId = effectiveProvider(stored.provider.value);
    const updatedAts = [stored.provider.updatedAt, stored.model.updatedAt].filter(
      (value): value is Date => value instanceof Date
    );
    const newest = updatedAts.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      providerId,
      modelId: effectiveModel(providerId, stored.model.value),
      isDefault: !stored.provider.value && !stored.model.value,
      updatedAt: newest?.toISOString() ?? null
    };
  }

  return {
    providerKey,
    modelKey,
    defaultProvider,
    defaultModel,

    invalidateCache() {
      cachedConfig = null;
      cacheLoadedAt = 0;
    },

    async getConfig(): Promise<BrainSlotConfig> {
      if (cachedConfig !== null && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
        return cachedConfig;
      }
      try {
        const stored = await readStoredRows();
        const providerId = effectiveProvider(stored.provider.value);
        cachedConfig = { providerId, modelId: effectiveModel(providerId, stored.model.value) };
        cacheLoadedAt = Date.now();
        return cachedConfig;
      } catch (error) {
        console.warn(`[${name}] falling back`, {
          error: error instanceof Error ? error.message : String(error)
        });
        return cachedConfig ?? { providerId: defaultProvider, modelId: defaultModel };
      }
    },

    getSetting,

    /**
     * A field left out of the payload is untouched; a field sent blank deletes
     * its row so the default applies again.
     *
     * Switching providers drops a saved model that belonged to the old provider —
     * shipping "gemini" + "gpt-4o" would fail on every call until someone noticed.
     */
    async save(input: SaveBrainSlotInput, updatedByUserId: string): Promise<SaveBrainSlotResult> {
      if (input.provider !== undefined) {
        const value = (input.provider ?? "").trim();
        await writeKey(providerKey, value ? normalizeLlmProviderId(value) : "", updatedByUserId);
      }

      if (input.model !== undefined) {
        await writeKey(
          modelKey,
          (input.model ?? "").trim().slice(0, BRAIN_MODEL_MAX_LENGTH),
          updatedByUserId
        );
      }

      // A model that no longer matches the stored provider is cleared rather
      // than left to fail on every call.
      const afterWrite = await readStoredRows();
      const providerId = effectiveProvider(afterWrite.provider.value);
      if (afterWrite.model.value && brainModelMismatch(providerId, afterWrite.model.value)) {
        await writeKey(modelKey, "", updatedByUserId);
      }

      cachedConfig = null;
      cacheLoadedAt = 0;

      const setting = await getSetting();
      return {
        providerId: setting.providerId,
        modelId: setting.modelId,
        restoredDefault: setting.isDefault
      };
    }
  };
}
