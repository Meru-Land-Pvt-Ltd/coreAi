import {
  findLlmModel,
  getLlmProvider,
  LLM_PROVIDERS,
  normalizeLlmProviderId
} from "@coreai/shared";
import { llmProviderApiKey } from "./llm-credentials";
import type { ApiErrorStatus } from "../../lib/error-utils";

type ProviderModelEndpoint = {
  url: (apiKey: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  pageSize?: number;
};

export type AiProviderSummary = {
  id: string;
  displayName: string;
  envKey: string;
  configured: boolean;
};

export type AiProviderModel = {
  modelId: string;
  displayName: string;
  providerId: string;
  inputPricePer1MToken: number | null;
  outputPricePer1MToken: number | null;
  source: "api";
};

export class ProviderModelDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly status: ApiErrorStatus = 503,
    public readonly code = "MODEL_DISCOVERY_FAILED"
  ) {
    super(message);
    this.name = "ProviderModelDiscoveryError";
  }
}

const PROVIDER_MODEL_ENDPOINTS: Record<string, ProviderModelEndpoint> = {
  openai: {
    url: () => "https://api.openai.com/v1/models",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`
    })
  },
  claude: {
    url: () => "https://api.anthropic.com/v1/models",
    headers: (apiKey) => ({
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey
    })
  },
  gemini: {
    url: (apiKey) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    headers: () => ({}),
    pageSize: 1000
  },
  deepseek: {
    url: () => "https://api.deepseek.com/models",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`
    })
  },
  groq: {
    url: () => "https://api.groq.com/openai/v1/models",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`
    })
  },
  mistral: {
    url: () => "https://api.mistral.ai/v1/models",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`
    })
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) return [];

  const candidates = [payload.data, payload.models, payload.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
}

function extractNextPageToken(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const candidates = [payload.nextPageToken, payload.next_page_token, payload.next_page];
  for (const candidate of candidates) {
    const token = toText(candidate);
    if (token) return token;
  }

  return null;
}

function extractModelId(providerId: string, entry: Record<string, unknown>): string {
  const candidates = [
    entry.id,
    entry.modelId,
    entry.baseModelId,
    entry.name
  ];

  for (const candidate of candidates) {
    const value = toText(candidate);
    if (!value) continue;

    if (providerId === "gemini" && value.startsWith("models/")) {
      return value.slice("models/".length).trim();
    }

    if (value.startsWith("models/")) {
      return value.slice("models/".length).trim();
    }

    return value;
  }

  return "";
}

function extractDisplayName(providerId: string, modelId: string, entry: Record<string, unknown>): string {
  const candidates = [entry.displayName, entry.display_name, entry.title, entry.name];
  for (const candidate of candidates) {
    const value = toText(candidate);
    if (!value) continue;

    if (providerId === "gemini" && value.startsWith("models/")) {
      continue;
    }

    return value;
  }

  const catalogModel = findLlmModel(modelId);
  return catalogModel?.displayName ?? modelId;
}

function mapPricing(modelId: string) {
  const catalogModel = findLlmModel(modelId);
  return {
    inputPricePer1MToken: catalogModel?.inputPricePer1M ?? null,
    outputPricePer1MToken: catalogModel?.outputPricePer1M ?? null
  };
}

function sortModelsForDisplay(left: AiProviderModel, right: AiProviderModel): number {
  const leftPriced = left.inputPricePer1MToken !== null || left.outputPricePer1MToken !== null;
  const rightPriced = right.inputPricePer1MToken !== null || right.outputPricePer1MToken !== null;

  if (leftPriced !== rightPriced) return leftPriced ? -1 : 1;
  return left.displayName.localeCompare(right.displayName, "en");
}

function getProviderSummary(providerId: string, apiKey?: string): AiProviderSummary {
  const provider = getLlmProvider(providerId);
  if (!provider) {
    throw new ProviderModelDiscoveryError(`Unsupported AI provider: ${providerId}`, 422, "UNSUPPORTED_PROVIDER");
  }

  return {
    id: provider.id,
    displayName: provider.displayName,
    envKey: provider.envKey,
    configured: Boolean((apiKey ?? llmProviderApiKey(provider.id)).trim())
  };
}

async function fetchProviderModels(providerId: string, apiKey: string): Promise<unknown> {
  const endpoint = PROVIDER_MODEL_ENDPOINTS[providerId];
  if (!endpoint) {
    throw new ProviderModelDiscoveryError(`Unsupported AI provider: ${providerId}`, 422, "UNSUPPORTED_PROVIDER");
  }

  const response = await fetch(
    providerId === "gemini"
      ? `${endpoint.url(apiKey)}${endpoint.pageSize ? `&pageSize=${endpoint.pageSize}` : ""}`
      : endpoint.url(apiKey),
    {
      method: "GET",
      headers: endpoint.headers(apiKey),
      signal: AbortSignal.timeout(15_000)
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (isRecord(body) && (toText(body.error) || toText(body.message) || toText(body.detail))) ||
      `${getLlmProvider(providerId)?.displayName ?? providerId} model lookup failed (${response.status}).`;

    const status: ApiErrorStatus =
      response.status === 401 ||
      response.status === 402 ||
      response.status === 403 ||
      response.status === 429
        ? response.status
        : 503;
    throw new ProviderModelDiscoveryError(message, status, "MODEL_DISCOVERY_FAILED");
  }

  return response.json().catch(() => null);
}

async function fetchGeminiModels(apiKey: string): Promise<Record<string, unknown>[]> {
  const endpoint = PROVIDER_MODEL_ENDPOINTS.gemini;
  const collected: Record<string, unknown>[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(endpoint.url(apiKey));
    if (endpoint.pageSize) {
      url.searchParams.set("pageSize", String(endpoint.pageSize));
    }
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: endpoint.headers(apiKey),
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        (isRecord(body) && (toText(body.error) || toText(body.message) || toText(body.detail))) ||
        "Gemini model lookup failed.";
      const status: ApiErrorStatus =
        response.status === 401 ||
        response.status === 402 ||
        response.status === 403 ||
        response.status === 429
          ? response.status
          : 503;
      throw new ProviderModelDiscoveryError(message, status, "MODEL_DISCOVERY_FAILED");
    }

    const body = await response.json().catch(() => null);
    collected.push(...extractRecords(body));
    pageToken = extractNextPageToken(body);
  } while (pageToken);

  return collected;
}

async function fetchModelRecords(providerId: string, apiKey: string): Promise<Record<string, unknown>[]> {
  if (providerId === "gemini") {
    return fetchGeminiModels(apiKey);
  }

  const payload = await fetchProviderModels(providerId, apiKey);
  return extractRecords(payload);
}

export function listAiProviderSummaries(): AiProviderSummary[] {
  return LLM_PROVIDERS.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    envKey: provider.envKey,
    configured: Boolean(llmProviderApiKey(provider.id))
  }));
}

export async function listAiProviderModels(
  rawProviderId: string,
  options: { apiKey?: string } = {}
): Promise<{ provider: AiProviderSummary; models: AiProviderModel[] }> {
  const providerId = normalizeLlmProviderId(rawProviderId);
  const provider = getProviderSummary(providerId, options.apiKey);
  const apiKey = (options.apiKey ?? llmProviderApiKey(provider.id)).trim();

  if (!apiKey) {
    throw new ProviderModelDiscoveryError(
      `${provider.displayName} API key is not configured.`,
      422,
      "MISSING_API_KEY"
    );
  }

  const rawModels = await fetchModelRecords(provider.id, apiKey);
  const seen = new Set<string>();
  const models: AiProviderModel[] = [];

  for (const entry of rawModels) {
    const modelId = extractModelId(provider.id, entry);
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);

    models.push({
      modelId,
      displayName: extractDisplayName(provider.id, modelId, entry),
      providerId: provider.id,
      ...mapPricing(modelId),
      source: "api"
    });
  }

  models.sort(sortModelsForDisplay);

  return {
    provider,
    models
  };
}
