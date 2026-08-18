import {
  getLlmModelsForProvider,
  isCatalogedLlmProvider,
  normalizeLlmProviderId,
  findLlmModel,
  LLM_PROVIDERS
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret } from "../../lib/crypto";

/**
 * The door battery — one model, swappable forever.
 *
 * Every AI door built inside a node (entry, exit, presentation) runs on the ONE
 * provider/model an admin picks here. There is deliberately no per-node model
 * setting anywhere: the doors belong to the platform, and swapping the battery
 * on this screen changes every door on every agent instantly.
 *
 * Storage reuses the existing PlatformApiSetting key/value table — the same
 * store behind Admin → Manage API and the Design Brain rules — under the keys
 * "doorBrainProvider" and "doorBrainModel". No new table, no migration. Neither
 * value is a credential (`secret: false`) but the column is `valueEncrypted`,
 * so both are stored encrypted at rest like every other row.
 *
 * With nothing saved the safe default applies (provider "gemini", the
 * provider's own default model), so doors are never model-less. Saving blank
 * deletes the row, which restores the default.
 *
 * {@link getDoorBrainConfig} is what the door engine calls on every run: cached
 * for 60s and guaranteed never to throw, so a database hiccup can never take a
 * customer's run down — the engine simply proceeds with the last known battery.
 */

export const DOOR_BRAIN_PROVIDER_KEY = "doorBrainProvider";
export const DOOR_BRAIN_MODEL_KEY = "doorBrainModel";

/**
 * Safe default battery. Gemini's fast tier is the cheapest capable option for
 * the small, high-volume translation work doors do.
 */
export const DEFAULT_DOOR_BRAIN_PROVIDER = "gemini";

/** Longest model id an admin can save (generous; ids are short). */
export const DOOR_BRAIN_MODEL_MAX_LENGTH = 120;

export type DoorBrainConfig = {
  providerId: string;
  /** null means "let the provider pick its own default model". */
  modelId: string | null;
};

/** The provider ids an admin may choose — the engine's known providers. */
export function doorBrainProviderOptions(): Array<{ id: string; displayName: string }> {
  return LLM_PROVIDERS.map((provider) => ({ id: provider.id, displayName: provider.displayName }));
}

/**
 * True for provider ids the AI provider engine knows how to run. Validated at
 * save time so a typo can never silently disable every door on the platform.
 */
export function isSupportedDoorBrainProvider(providerId: string): boolean {
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
export function doorBrainModelMismatch(providerId: string, modelId: string): boolean {
  const model = findLlmModel(modelId);
  return Boolean(model && model.providerId !== normalizeLlmProviderId(providerId));
}

/** The models the admin screen offers for a provider (may be empty). */
export function doorBrainModelOptions(providerId: string): Array<{ id: string; displayName: string }> {
  return getLlmModelsForProvider(normalizeLlmProviderId(providerId)).map((model) => ({
    id: model.id,
    displayName: model.displayName
  }));
}

/* --------------------------------- cache --------------------------------- */

let cachedConfig: DoorBrainConfig | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

/** Drop the cache so the next door run reflects a just-saved battery. */
export function invalidateDoorBrainConfigCache(): void {
  cachedConfig = null;
  cacheLoadedAt = 0;
}

type StoredRow = { value: string; updatedAt: Date | null };

function decodeRow(row: { valueEncrypted: string; updatedAt: Date } | undefined): StoredRow {
  if (!row) return { value: "", updatedAt: null };
  try {
    return { value: decryptSecret(row.valueEncrypted).trim(), updatedAt: row.updatedAt };
  } catch {
    // A row encrypted under a rotated ENCRYPTION_KEY must never break the doors —
    // behave as unset so the safe default applies.
    console.warn("[door-brain-settings] could not decrypt a stored value — using default");
    return { value: "", updatedAt: null };
  }
}

async function readStoredRows(): Promise<{ provider: StoredRow; model: StoredRow }> {
  const rows = await prisma.platformApiSetting.findMany({
    where: { key: { in: [DOOR_BRAIN_PROVIDER_KEY, DOOR_BRAIN_MODEL_KEY] } },
    select: { key: true, valueEncrypted: true, updatedAt: true }
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));
  return {
    provider: decodeRow(byKey.get(DOOR_BRAIN_PROVIDER_KEY)),
    model: decodeRow(byKey.get(DOOR_BRAIN_MODEL_KEY))
  };
}

/** A stored provider value that is no longer supported falls back to the default. */
function effectiveProvider(stored: string): string {
  const normalized = normalizeLlmProviderId(stored || DEFAULT_DOOR_BRAIN_PROVIDER);
  return isCatalogedLlmProvider(normalized) ? normalized : DEFAULT_DOOR_BRAIN_PROVIDER;
}

/** A stored model belonging to another provider is dropped, never sent. */
function effectiveModel(providerId: string, stored: string): string | null {
  const modelId = stored.trim();
  if (!modelId) return null;
  return doorBrainModelMismatch(providerId, modelId) ? null : modelId;
}

/**
 * The battery every door runs on. Cached for 60s.
 *
 * Never throws. On a database error it returns the last cached value when one
 * exists, otherwise the platform default — a door must always be able to try.
 */
export async function getDoorBrainConfig(): Promise<DoorBrainConfig> {
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
    console.warn("[door-brain-settings] falling back", {
      error: error instanceof Error ? error.message : String(error)
    });
    return cachedConfig ?? { providerId: DEFAULT_DOOR_BRAIN_PROVIDER, modelId: null };
  }
}

/* ------------------------------- admin API -------------------------------- */

export type DoorBrainSetting = {
  /** The effective provider (saved value, or the default when unset). */
  providerId: string;
  /** The effective model, or null for "the provider's own default". */
  modelId: string | null;
  /** True while no admin override is stored for either key. */
  isDefault: boolean;
  updatedAt: string | null;
};

/** Uncached read for the admin screen — always reflects the database. */
export async function getDoorBrainSetting(): Promise<DoorBrainSetting> {
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

export type SaveDoorBrainInput = {
  /** Blank/undefined clears the override and restores the default provider. */
  provider?: string | null;
  /** Blank/undefined clears the override and lets the provider choose. */
  model?: string | null;
};

export type SaveDoorBrainResult = DoorBrainConfig & {
  /** True when nothing is stored any more and the platform default applies. */
  restoredDefault: boolean;
};

/**
 * Save the platform door battery. A field left out of the payload is untouched;
 * a field sent blank deletes its row so the default applies again.
 *
 * Switching providers drops a saved model that belonged to the old provider —
 * shipping "gemini" + "gpt-4o" would fail on every door until someone noticed.
 */
export async function saveDoorBrainConfig(
  input: SaveDoorBrainInput,
  updatedByUserId: string
): Promise<SaveDoorBrainResult> {
  if (input.provider !== undefined) {
    const value = (input.provider ?? "").trim();
    await writeKey(
      DOOR_BRAIN_PROVIDER_KEY,
      value ? normalizeLlmProviderId(value) : "",
      updatedByUserId
    );
  }

  if (input.model !== undefined) {
    await writeKey(
      DOOR_BRAIN_MODEL_KEY,
      (input.model ?? "").trim().slice(0, DOOR_BRAIN_MODEL_MAX_LENGTH),
      updatedByUserId
    );
  }

  // A model that no longer matches the stored provider is cleared rather than
  // left to fail on every door.
  const afterWrite = await readStoredRows();
  const providerId = effectiveProvider(afterWrite.provider.value);
  if (afterWrite.model.value && doorBrainModelMismatch(providerId, afterWrite.model.value)) {
    await writeKey(DOOR_BRAIN_MODEL_KEY, "", updatedByUserId);
  }

  invalidateDoorBrainConfigCache();

  const setting = await getDoorBrainSetting();
  return {
    providerId: setting.providerId,
    modelId: setting.modelId,
    restoredDefault: setting.isDefault
  };
}
