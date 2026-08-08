import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { rawEnv, setPlatformSettingResolver } from "../../config/env";

/**
 * Platform API credentials managed from Admin → Manage API.
 *
 * Resolution order is ALWAYS: admin value first, environment variable second.
 * Keeping the .env fallback means shipping this never takes a provider offline —
 * existing deployments keep working untouched, and each key migrates to the
 * database the moment an admin saves it.
 *
 * Values are cached in-process because these are read on every LLM call, voice
 * deploy and embedding request. The cache is invalidated on save, so rotating a
 * key takes effect without a redeploy — the whole point of moving off .env.
 */

export type PlatformApiSettingKey = (typeof PLATFORM_API_SETTING_KEYS)[number];

/** Non-secret settings are returned to the admin UI in full; the rest are masked. */
const NON_SECRET_KEYS = new Set([
  "CARTESIA_TTS_MODEL",
  "CARTESIA_DEFAULT_VOICE_ID",
  "CARTESIA_VOICE_SKYLAR_ID",
  "CARTESIA_VOICE_ELLA_ID",
  "CARTESIA_VOICE_JACQUELINE_ID",
  "CARTESIA_VOICE_BLAKE_ID",
  "CARTESIA_VOICE_RONALD_ID",
  "ELEVENLABS_DEFAULT_VOICE_ID",
  "ELEVENLABS_VOICE_SARAH_ID",
  "ELEVENLABS_VOICE_ARIA_ID",
  "ELEVENLABS_VOICE_RACHEL_ID",
  "ELEVENLABS_VOICE_ADAM_ID",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "VAPI_PUBLIC_KEY"
]);

export const PLATFORM_API_SETTING_GROUPS = [
  {
    id: "ai",
    title: "AI API keys",
    description: "Model providers used by AI Brain, context replies and agent testing.",
    fields: [
      { key: "OPENAI_API_KEY", label: "OpenAI" },
      { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)" },
      { key: "GEMINI_API_KEY", label: "Google Gemini" },
      { key: "MISTRAL_API_KEY", label: "Mistral" },
      { key: "DEEPSEEK_API_KEY", label: "DeepSeek" },
      { key: "GROQ_API_KEY", label: "Groq" }
    ]
  },
  {
    id: "vapi",
    title: "Vapi",
    description: "Voice platform. The public key is used by the browser test call.",
    fields: [
      { key: "VAPI_API_KEY", label: "Vapi API key" },
      { key: "VAPI_PUBLIC_KEY", label: "Vapi public key" }
    ]
  },
  {
    id: "elevenlabs",
    title: "Voice — ElevenLabs",
    description: "Voice ids back the presets architects choose. A blank id falls back to the platform default voice.",
    fields: [
      { key: "ELEVENLABS_API_KEY", label: "ElevenLabs API key" },
      { key: "ELEVENLABS_DEFAULT_VOICE_ID", label: "Default voice id" },
      { key: "ELEVENLABS_VOICE_SARAH_ID", label: "Sarah voice id" },
      { key: "ELEVENLABS_VOICE_ARIA_ID", label: "Aria voice id" },
      { key: "ELEVENLABS_VOICE_RACHEL_ID", label: "Rachel voice id" },
      { key: "ELEVENLABS_VOICE_ADAM_ID", label: "Adam voice id" }
    ]
  },
  {
    id: "cartesia",
    title: "Voice — Cartesia",
    description: "Voice ids were previously hardcoded in the node registry and are now editable here.",
    fields: [
      { key: "CARTESIA_API_KEY", label: "Cartesia API key" },
      { key: "CARTESIA_TTS_MODEL", label: "TTS model" },
      { key: "CARTESIA_DEFAULT_VOICE_ID", label: "Default voice id" },
      { key: "CARTESIA_VOICE_SKYLAR_ID", label: "Skylar voice id" },
      { key: "CARTESIA_VOICE_ELLA_ID", label: "Ella voice id" },
      { key: "CARTESIA_VOICE_JACQUELINE_ID", label: "Jacqueline voice id" },
      { key: "CARTESIA_VOICE_BLAKE_ID", label: "Blake voice id" },
      { key: "CARTESIA_VOICE_RONALD_ID", label: "Ronald voice id" }
    ]
  },
  {
    id: "other",
    title: "Other API keys",
    description: "Smart Memory embeddings and speech-to-text.",
    fields: [
      { key: "PINECONE_API_KEY", label: "Pinecone API key" },
      { key: "EMBEDDING_PROVIDER", label: "Embedding provider (auto | openai | gemini)" },
      { key: "EMBEDDING_MODEL", label: "Embedding model override" },
      { key: "DEEPGRAM_API_KEY", label: "Deepgram API key" }
    ]
  }
] as const;

export const PLATFORM_API_SETTING_KEYS = PLATFORM_API_SETTING_GROUPS.flatMap((group) =>
  group.fields.map((field) => field.key)
) as unknown as readonly string[];

const MANAGED_KEYS = new Set<string>(PLATFORM_API_SETTING_KEYS);

export function isManagedPlatformApiKey(key: string): boolean {
  return MANAGED_KEYS.has(key);
}

export function isSecretPlatformApiKey(key: string): boolean {
  return !NON_SECRET_KEYS.has(key);
}

/* ------------------------------- cache ---------------------------------- */

let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

/** Drop the cache so the next read reflects a just-saved value. */
export function invalidatePlatformApiSettingsCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

async function loadCache(): Promise<Map<string, string>> {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;

  const next = new Map<string, string>();
  try {
    const rows = await prisma.platformApiSetting.findMany({
      select: { key: true, valueEncrypted: true }
    });
    for (const row of rows) {
      try {
        const value = decryptSecret(row.valueEncrypted).trim();
        if (value) next.set(row.key, value);
      } catch {
        // A row encrypted under a rotated ENCRYPTION_KEY must not take the
        // whole platform down — skip it and fall back to the env value.
        console.warn("[platform-api-settings] could not decrypt", { key: row.key });
      }
    }
  } catch (error) {
    // Before the migration runs the table does not exist. Falling back to env
    // keeps the app fully functional instead of failing every provider call.
    console.warn("[platform-api-settings] falling back to environment", {
      error: error instanceof Error ? error.message : String(error)
    });
    return cache ?? new Map();
  }

  cache = next;
  cacheLoadedAt = Date.now();
  return next;
}

/** Warm the cache once at boot so the first request is not slower than the rest. */
export async function preloadPlatformApiSettings(): Promise<void> {
  await loadCache().catch(() => undefined);
}

function envValue(key: string): string {
  // rawEnv, never env — reading env here would re-enter this resolver.
  const value = (rawEnv as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/* Registering here (not in config/env) keeps the dependency one-directional.
   Only managed keys are answered, so every other env read is untouched. */
setPlatformSettingResolver((key) => (MANAGED_KEYS.has(key) ? cache?.get(key) : undefined));

/**
 * The admin-managed value for `key`, or the environment variable when unset.
 * Synchronous so it can be dropped into existing call sites; relies on the
 * cache being warm (preloaded at boot, refreshed on save and every 60s).
 */
export function platformApiSetting(key: string): string {
  const cached = cache?.get(key);
  if (cached) return cached;
  return envValue(key);
}

/** Async variant for call sites that can await — guarantees a fresh cache. */
export async function platformApiSettingAsync(key: string): Promise<string> {
  const loaded = await loadCache();
  return loaded.get(key) || envValue(key);
}

/* ------------------------------- admin API ------------------------------- */

export type PlatformApiSettingView = {
  key: string;
  label: string;
  /** Masked for secrets, full value for non-secret settings. Empty when unset. */
  value: string;
  secret: boolean;
  /** "admin" when stored here, "env" when inherited, "unset" when neither. */
  source: "admin" | "env" | "unset";
  updatedAt: string | null;
};

function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function listPlatformApiSettings(): Promise<
  Array<{ id: string; title: string; description: string; fields: PlatformApiSettingView[] }>
> {
  const rows = await prisma.platformApiSetting.findMany({
    select: { key: true, valueEncrypted: true, updatedAt: true }
  });
  const stored = new Map(rows.map((row) => [row.key, row]));

  return PLATFORM_API_SETTING_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    fields: group.fields.map((field) => {
      const secret = isSecretPlatformApiKey(field.key);
      const row = stored.get(field.key);
      let raw = "";
      if (row) {
        try {
          raw = decryptSecret(row.valueEncrypted).trim();
        } catch {
          raw = "";
        }
      }
      const fromEnv = raw ? "" : envValue(field.key);
      const effective = raw || fromEnv;
      return {
        key: field.key,
        label: field.label,
        value: effective ? (secret ? maskSecret(effective) : effective) : "",
        secret,
        source: raw ? "admin" : fromEnv ? "env" : "unset",
        updatedAt: row?.updatedAt.toISOString() ?? null
      } satisfies PlatformApiSettingView;
    })
  }));
}

/**
 * Save admin-entered values. An empty string DELETES the row, which restores the
 * .env fallback rather than storing a blank that would disable the provider.
 */
export async function savePlatformApiSettings(
  updates: Array<{ key: string; value: string }>,
  updatedByUserId: string
): Promise<{ saved: number; cleared: number }> {
  let saved = 0;
  let cleared = 0;

  for (const update of updates) {
    if (!isManagedPlatformApiKey(update.key)) continue;
    const value = update.value.trim();

    if (!value) {
      await prisma.platformApiSetting.deleteMany({ where: { key: update.key } });
      cleared += 1;
      continue;
    }

    await prisma.platformApiSetting.upsert({
      where: { key: update.key },
      update: {
        valueEncrypted: encryptSecret(value),
        secret: isSecretPlatformApiKey(update.key),
        updatedByUserId
      },
      create: {
        key: update.key,
        valueEncrypted: encryptSecret(value),
        secret: isSecretPlatformApiKey(update.key),
        updatedByUserId
      }
    });
    saved += 1;
  }

  invalidatePlatformApiSettingsCache();
  return { saved, cleared };
}
