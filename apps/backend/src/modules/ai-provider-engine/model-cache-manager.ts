import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { env } from "../../config/env";
import type { ProviderRegistry } from "./provider-registry";

const CACHE_FILE_PATH = path.join(__dirname, ".model-cache.json");
const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export type PricingEntry = { input: number; output: number };
export type ProviderCacheData = {
  models: string[];
  pricing: Record<string, PricingEntry>;
};
export type CacheSchema = {
  timestamp: number;
  providers: Record<string, ProviderCacheData>;
};

const KNOWN_PRICING: Record<string, PricingEntry> = {
  // OpenAI
  "gpt-4o-mini":   { input: 0.15,  output: 0.60  },
  "gpt-4o":        { input: 2.50,  output: 10.00 },
  "gpt-4-turbo":   { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo": { input: 0.50,  output: 1.50  },
  "o1-preview":    { input: 15.00, output: 60.00 },
  "o1-mini":       { input: 3.00,  output: 12.00 },
  "o1":            { input: 15.00, output: 60.00 },
  "o3-mini":       { input: 1.10,  output: 4.40  },

  // Claude
  "claude-3-opus":     { input: 15.00, output: 75.00 },
  "claude-3-sonnet":   { input: 3.00,  output: 15.00 },
  "claude-3-haiku":    { input: 0.25,  output: 1.25  },
  "claude-3-5-sonnet": { input: 3.00,  output: 15.00 },
  "claude-3-5-haiku":  { input: 0.80,  output: 4.00  },
  "claude-opus-4-5":   { input: 15.00, output: 75.00 },
  "claude-sonnet-4-5": { input: 3.00,  output: 15.00 },
  "claude-haiku-3-5":  { input: 0.80,  output: 4.00  },

  // Gemini
  "gemini-3.5-flash":      { input: 0.075,  output: 0.30  },
  "gemini-2.0-flash-lite": { input: 0.075,  output: 0.30  },
  "gemini-2.0-flash":      { input: 0.075,  output: 0.30  },
  "gemini-3.1-flash-lite": { input: 0.0375, output: 0.15  },
  "gemini-1.5-pro":        { input: 1.25,   output: 5.00  },
  "gemini-1.5-flash":      { input: 0.075,  output: 0.30  },
  "gemini-1.0-pro":        { input: 0.50,   output: 1.50  },

  // Mistral
  "mistral-tiny":         { input: 0.25, output: 0.25 },
  "mistral-small-latest": { input: 1.00, output: 3.00 },
  "mistral-small":        { input: 1.00, output: 3.00 },
  "mistral-medium-latest":{ input: 2.70, output: 8.10 },
  "mistral-medium":       { input: 2.70, output: 8.10 },
  "mistral-large-latest": { input: 4.00, output: 12.00 },
  "mistral-large":        { input: 4.00, output: 12.00 },
  "open-mixtral-8x7b":    { input: 0.70, output: 0.70 },
  "open-mixtral-8x22b":   { input: 2.00, output: 6.00 },
  "codestral-latest":     { input: 1.00, output: 3.00 },
};

// Sort pricing keys by length descending to match longest prefix first during fuzzy matching
const PRICING_KEYS_DESC = Object.keys(KNOWN_PRICING).sort((a, b) => b.length - a.length);

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export class ModelCacheManager {
  static async sync(registry: ProviderRegistry): Promise<void> {
    console.info("[ModelCacheManager] Starting model and pricing sync...");
    let cache: CacheSchema | null = null;

    try {
      if (fs.existsSync(CACHE_FILE_PATH)) {
        const fileContent = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
        try {
          const parsed = JSON.parse(fileContent) as CacheSchema;
          const now = Date.now();
          if (now - parsed.timestamp < CACHE_EXPIRATION_MS) {
            console.info("[ModelCacheManager] Valid cache found. Using cached models and pricing.");
            cache = parsed;
          } else {
            console.info("[ModelCacheManager] Cache is expired. Will fetch fresh data.");
          }
        } catch (parseErr) {
          console.warn("[ModelCacheManager] Cache file is corrupt, deleting to force fresh fetch:", parseErr);
          try {
            fs.unlinkSync(CACHE_FILE_PATH);
          } catch (unlinkErr) {
            // Ignore unlink error
          }
        }
      }
    } catch (err) {
      console.warn("[ModelCacheManager] Failed to read cache file:", err);
    }

    if (!cache) {
      cache = await this.fetchFreshData(registry);
      try {
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), "utf-8");
        console.info("[ModelCacheManager] Saved fresh models and pricing to cache file.");
      } catch (err) {
        console.warn("[ModelCacheManager] Failed to write cache file:", err);
      }
    }

    // Apply cached models & pricing to adapters
    for (const adapter of registry.all()) {
      const data = cache.providers[adapter.providerId];
      if (data && typeof adapter.updateModelsAndPricing === "function") {
        try {
          adapter.updateModelsAndPricing(data.models, data.pricing);
          console.info(`[ModelCacheManager] Updated adapter '${adapter.providerId}' with ${data.models.length} dynamic models.`);
        } catch (err) {
          console.error(`[ModelCacheManager] Failed to update adapter '${adapter.providerId}':`, err);
        }
      }
    }
  }

  private static async fetchFreshData(registry: ProviderRegistry): Promise<CacheSchema> {
    const cacheData: Record<string, ProviderCacheData> = {};

    await Promise.all(
      registry.all().map(async (adapter) => {
        try {
          const fetched = await this.fetchModelsForProvider(adapter.providerId);
          if (fetched) {
            cacheData[adapter.providerId] = fetched;
          }
        } catch (err) {
          console.warn(`[ModelCacheManager] Failed to fetch models for provider '${adapter.providerId}':`, err);
        }
      })
    );

    return {
      timestamp: Date.now(),
      providers: cacheData,
    };
  }

  private static async fetchModelsForProvider(providerId: string): Promise<ProviderCacheData | null> {
    switch (providerId) {
      case "openai":
        return this.fetchOpenAI();
      case "claude":
        return this.fetchClaude();
      case "gemini":
        return this.fetchGemini();
      case "mistral":
        return this.fetchMistral();
      case "elevenlabs":
        return this.fetchElevenLabs();
      case "llama":
        return this.fetchLlama();
      default:
        return null;
    }
  }

  private static resolvePricing(modelId: string, defaultPricing: PricingEntry): PricingEntry {
    const normalized = modelId.toLowerCase();
    
    // 1. Direct match
    if (KNOWN_PRICING[normalized]) {
      return KNOWN_PRICING[normalized]!;
    }

    // 2. Prefix/substring match
    for (const key of PRICING_KEYS_DESC) {
      if (normalized.startsWith(key) || normalized.includes(key)) {
        return KNOWN_PRICING[key]!;
      }
    }

    // 3. Fallback
    return defaultPricing;
  }

  private static async fetchOpenAI(): Promise<ProviderCacheData | null> {
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) return null;

    const client = new OpenAI({ apiKey: key });
    const response = await client.models.list();
    
    // Filter to active chat models (starts with gpt- or o1- or o3-)
    const models = response.data
      .map((m) => m.id)
      .filter((id) => id.startsWith("gpt-") || id.startsWith("o1-") || id.startsWith("o3-"))
      // Exclude text-davinci, instruct models etc.
      .filter((id) => !id.includes("instruct") && !id.includes("realtime") && !id.includes("audio"));

    const pricing: Record<string, PricingEntry> = {};
    const defaultPricing = KNOWN_PRICING["gpt-4o-mini"]!;

    for (const model of models) {
      pricing[model] = this.resolvePricing(model, defaultPricing);
    }

    return { models, pricing };
  }

  private static async fetchClaude(): Promise<ProviderCacheData | null> {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (!key) return null;

    const response = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!response.ok) {
      throw new Error(`Anthropic API returned status ${response.status}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string }> };
    const models = data.data.map((m) => m.id);

    const pricing: Record<string, PricingEntry> = {};
    const defaultPricing = KNOWN_PRICING["claude-3-haiku"]!;

    for (const model of models) {
      pricing[model] = this.resolvePricing(model, defaultPricing);
    }

    return { models, pricing };
  }

  private static async fetchGemini(): Promise<ProviderCacheData | null> {
    const key = env.GOOGLE_AI_API_KEY?.trim();
    if (!key) return null;

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const modelsResponse = await ai.models.list();
    
    const models: string[] = [];
    for await (const m of modelsResponse) {
      if (m.name) {
        const id = m.name.replace(/^models\//, "");
        if (id.startsWith("gemini-") && !id.includes("vision") && !id.includes("embedding")) {
          models.push(id);
        }
      }
    }

    const pricing: Record<string, PricingEntry> = {};
    const defaultPricing = KNOWN_PRICING["gemini-1.5-flash"]!;

    for (const model of models) {
      pricing[model] = this.resolvePricing(model, defaultPricing);
    }

    return { models, pricing };
  }

  private static async fetchMistral(): Promise<ProviderCacheData | null> {
    const key = env.MISTRAL_API_KEY?.trim();
    if (!key) return null;

    const response = await fetchWithTimeout("https://api.mistral.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Mistral API returned status ${response.status}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string }> };
    // Filter to mistral models and codestral
    const models = data.data
      .map((m) => m.id)
      .filter((id) => id.includes("mistral") || id.includes("mixtral") || id.includes("codestral"));

    const pricing: Record<string, PricingEntry> = {};
    const defaultPricing = KNOWN_PRICING["mistral-tiny"]!;

    for (const model of models) {
      pricing[model] = this.resolvePricing(model, defaultPricing);
    }

    return { models, pricing };
  }

  private static async fetchElevenLabs(): Promise<ProviderCacheData | null> {
    const key = env.ELEVENLABS_API_KEY?.trim();
    if (!key) return null;

    const response = await fetchWithTimeout("https://api.elevenlabs.io/v1/models", {
      headers: {
        "xi-api-key": key,
      },
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API returned status ${response.status}`);
    }

    const data = (await response.json()) as Array<{ model_id: string }>;
    const models = data.map((m) => m.model_id);

    return { models, pricing: {} };
  }

  private static async fetchLlama(): Promise<ProviderCacheData | null> {
    const baseUrl = env.LLAMA_BASE_URL?.trim();
    if (!baseUrl) return null;

    // Try fetching from OpenAI compatible model endpoint
    const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
    try {
      const response = await fetchWithTimeout(url, {});
      if (response.ok) {
        const data = (await response.json()) as { data: Array<{ id: string }> };
        const models = data.data.map((m) => m.id);
        return { models, pricing: {} };
      }
    } catch {
      // Try Ollama endpoint /api/tags if standard v1/models failed
      const ollamaUrl = `${baseUrl.replace(/\/$/, "")}/api/tags`;
      try {
        const response = await fetchWithTimeout(ollamaUrl, {});
        if (response.ok) {
          const data = (await response.json()) as { models: Array<{ name: string }> };
          const models = data.models.map((m) => m.name);
          return { models, pricing: {} };
        }
      } catch {
        // Suppress and fallback
      }
    }
    return null;
  }
}
