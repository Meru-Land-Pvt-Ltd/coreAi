/**
 * THE MODELS A PROVIDER ACTUALLY HAS, ASKED FOR DIRECTLY.
 *
 * The first version of this made an admin type a model id by hand, copied out
 * of a provider's documentation. The founder called it useless and was right:
 * the provider already publishes the list, so typing it is work we invented,
 * and one typo produces a model that looks real in a dropdown and fails on the
 * first customer.
 *
 * So the list is fetched. An admin never types an id — they decide which of the
 * models a provider offers are switched on, what an architect sees them called,
 * and what they cost.
 *
 * Adding a whole new PROVIDER is still a release, and that is honest rather
 * than lazy: a provider needs an adapter that speaks its API, which is code
 * somebody writes and tests. A form producing a provider nothing can call would
 * produce a broken agent.
 */

import { llmProviderApiKey } from "./llm-credentials";

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ProviderModel = {
  /** The id sent to the provider's API. */
  id: string;
  /** The provider's own name for it, when it publishes one. */
  providerName?: string;
};

type ModelListRequest = {
  url: string;
  headers: Record<string, string>;
  /** Pull the ids out of whatever shape this provider answers in. */
  read: (body: unknown) => ProviderModel[];
};

/** OpenAI's shape, which most providers copied. */
function readOpenAiShape(body: unknown): ProviderModel[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const models: ProviderModel[] = [];
  for (const entry of data) {
    const row = entry as { id?: unknown; display_name?: unknown };
    if (typeof row.id !== "string") continue;
    models.push({
      id: row.id,
      ...(typeof row.display_name === "string" ? { providerName: row.display_name } : {})
    });
  }
  return models;
}

const LISTS: Record<string, (apiKey: string) => ModelListRequest> = {
  openai: (k) => ({
    url: "https://api.openai.com/v1/models",
    headers: { Authorization: `Bearer ${k}` },
    read: readOpenAiShape
  }),
  claude: (k) => ({
    url: "https://api.anthropic.com/v1/models?limit=100",
    headers: { "x-api-key": k, "anthropic-version": "2023-06-01" },
    read: readOpenAiShape
  }),
  gemini: (k) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}&pageSize=200`,
    headers: {},
    read: (body) => {
      const models = (body as { models?: unknown })?.models;
      if (!Array.isArray(models)) return [];
      const out: ProviderModel[] = [];
      for (const entry of models) {
        const row = entry as { name?: unknown; displayName?: unknown };
        if (typeof row.name !== "string") continue;
        // Google returns "models/gemini-3.5-flash"; the id is the last part.
        out.push({
          id: row.name.replace(/^models\//, ""),
          ...(typeof row.displayName === "string" ? { providerName: row.displayName } : {})
        });
      }
      return out;
    }
  }),
  deepseek: (k) => ({
    url: "https://api.deepseek.com/models",
    headers: { Authorization: `Bearer ${k}` },
    read: readOpenAiShape
  }),
  groq: (k) => ({
    url: "https://api.groq.com/openai/v1/models",
    headers: { Authorization: `Bearer ${k}` },
    read: readOpenAiShape
  }),
  mistral: (k) => ({
    url: "https://api.mistral.ai/v1/models",
    headers: { Authorization: `Bearer ${k}` },
    read: readOpenAiShape
  })
};

export type ProviderModelListing =
  | { ok: true; models: ProviderModel[] }
  | { ok: false; reason: string };

const cache = new Map<string, { at: number; listing: ProviderModelListing }>();

/**
 * Ask one provider what it has.
 *
 * Cached for ten minutes: this is read every time an admin opens the AI Brain
 * page, and a provider's model list does not change between page loads. Pass
 * `force` when an admin has just saved a key and wants to see the effect.
 */
export async function providerModels(providerId: string, force = false): Promise<ProviderModelListing> {
  const cached = cache.get(providerId);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.listing;

  const build = LISTS[providerId];
  if (!build) {
    return { ok: false, reason: "Triven has no adapter for this provider yet." };
  }

  const apiKey = llmProviderApiKey(providerId);
  if (!apiKey) {
    // Not an error, a state — and one an admin fixes on the same screen.
    return { ok: false, reason: "No key saved yet." };
  }

  const { url, headers, read } = build(apiKey);

  let listing: ProviderModelListing;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    if (!response.ok) {
      // The same words the health probe uses, so one vocabulary describes a
      // provider wherever it is shown.
      listing = {
        ok: false,
        reason:
          response.status === 401 || response.status === 403
            ? "Key rejected."
            : response.status === 402
              ? "Out of credit."
              : response.status === 429
                ? "Over quota."
                : `The provider answered ${response.status}.`
      };
    } else {
      const models = read(await response.json());
      listing = models.length > 0 ? { ok: true, models } : { ok: false, reason: "The provider returned no models." };
    }
  } catch (error) {
    const message = (error as Error).message ?? "";
    listing = { ok: false, reason: message.includes("timeout") ? "The provider did not answer in time." : "Could not reach the provider." };
  }

  cache.set(providerId, { at: Date.now(), listing });
  return listing;
}

export function invalidateProviderModelCache(providerId?: string): void {
  if (providerId) cache.delete(providerId);
  else cache.clear();
}
