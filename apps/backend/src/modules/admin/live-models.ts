/**
 * THE MODELS A SERVICE ACTUALLY HAS, ASKED IN REAL TIME.
 *
 * The founder's ruling (2026-08-27), on the same day a hard-coded model name
 * refused every screenshot an architect pasted: a list of models written into
 * our code is out of date the moment a provider ships anything new, and it
 * lies about what THIS platform's key can actually reach. So the admin screen
 * asks the provider itself, with the platform's own key, and shows exactly
 * what comes back.
 *
 * Three rules this file keeps:
 *   - NEVER invent. When the provider cannot be reached, say so and fall back
 *     to the shipped catalogue, clearly labelled as not-live.
 *   - The key never leaves the server, and never appears in a response.
 *   - Cached briefly, because an admin nudging a dropdown must not fire a
 *     provider request per keystroke.
 */

import { getLlmModelsForProvider } from "@coreai/shared";
import { llmProviderApiKey } from "../ai-provider-engine/llm-credentials";

export type LiveModel = { id: string; displayName: string };

export type LiveModelsResult = {
  models: LiveModel[];
  /** True when this list came from the provider just now. */
  live: boolean;
  /** Plain words for the admin when the list is not live. */
  note?: string;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; result: LiveModelsResult }>();

/** Where each provider publishes its model list, and how to read the reply. */
const CATALOGUE_ENDPOINTS: Record<string, { url: string; auth: (key: string) => Record<string, string> }> = {
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    auth: (key) => ({ Authorization: `Bearer ${key}` })
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    auth: (key) => ({ Authorization: `Bearer ${key}` })
  },
  claude: {
    url: "https://api.anthropic.com/v1/models",
    auth: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" })
  }
};

function shipped(providerId: string, note: string): LiveModelsResult {
  return {
    models: getLlmModelsForProvider(providerId).map((model) => ({
      id: model.id,
      displayName: model.displayName
    })),
    live: false,
    note
  };
}

/** A model id turned into something an admin reads without squinting. */
function pretty(id: string, given?: unknown): string {
  if (typeof given === "string" && given.trim()) return given.trim();
  return id
    .replace(/[-_]/g, " ")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export async function liveModelsFor(providerId: string): Promise<LiveModelsResult> {
  const hit = cache.get(providerId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const endpoint = CATALOGUE_ENDPOINTS[providerId];
  if (!endpoint) {
    return shipped(providerId, "This service does not publish a model list — these are the ones we know.");
  }

  const key = llmProviderApiKey(providerId);
  if (!key) {
    return shipped(providerId, "No key for this service yet, so this list is not live.");
  }

  try {
    const response = await fetch(endpoint.url, {
      headers: endpoint.auth(key),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      return shipped(providerId, `That service answered ${response.status}, so this list is not live.`);
    }
    const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(body?.data) ? body.data : [];
    const models = rows
      .map((row) => ({
        id: String(row.id ?? ""),
        displayName: pretty(String(row.id ?? ""), row.display_name ?? row.name)
      }))
      .filter((model) => model.id)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) {
      return shipped(providerId, "That service returned no models, so these are the ones we know.");
    }

    const result: LiveModelsResult = { models, live: true };
    cache.set(providerId, { at: Date.now(), result });
    return result;
  } catch (error) {
    console.warn("[live-models] could not reach provider", providerId, (error as Error).message);
    return shipped(providerId, "That service could not be reached just now, so this list is not live.");
  }
}
