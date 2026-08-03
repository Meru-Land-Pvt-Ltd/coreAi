import { env } from "../../config/env";

export const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_TIMEOUT_MS = 15000;
const BATCH_SIZE = 96;

export type EmbeddingProviderName = "openai" | "gemini";

export function getActiveEmbeddingProvider(): EmbeddingProviderName | null {
  const openAiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const googleKey = env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY;

  if (env.EMBEDDING_PROVIDER === "gemini") return googleKey ? "gemini" : null;
  if (env.EMBEDDING_PROVIDER === "openai") return openAiKey ? "openai" : null;

  if (openAiKey) return "openai";
  if (googleKey) return "gemini";
  return null;
}

export function getActiveEmbeddingModel(): string {
  if (env.EMBEDDING_MODEL && env.EMBEDDING_MODEL.trim()) {
    return env.EMBEDDING_MODEL.trim();
  }
  const provider = getActiveEmbeddingProvider();
  if (provider === "gemini") {
    return "text-embedding-004";
  }
  return "text-embedding-3-small";
}

export function embeddingsConfigured(): boolean {
  return getActiveEmbeddingProvider() !== null;
}

/**
 * Fetch embeddings from OpenAI API (always requesting 1536 dimensions).
 */
async function embedBatchOpenAI(texts: string[], apiKey: string, model: string): Promise<number[][] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS
      })
    });

    const json = (await response.json().catch(() => ({}))) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
      error?: { message?: string };
    };

    if (!response.ok) throw new Error(json.error?.message || `OpenAI returned ${response.status}`);

    const rows = Array.isArray(json.data) ? json.data : [];
    if (rows.length !== texts.length) return null;

    return rows.map((r) => r.embedding as number[]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch embeddings from Google Gemini API (always requesting 1536 dimensions via outputDimensionality).
 */
async function embedBatchGemini(texts: string[], apiKey: string, model: string): Promise<number[][] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  const cleanModel = model.startsWith("models/") ? model.slice(7) : model;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:batchEmbedContents?key=${apiKey}`;
    const requests = texts.map((text) => ({
      model: `models/${cleanModel}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS
    }));

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests })
    });

    const json = (await response.json().catch(() => ({}))) as {
      embeddings?: Array<{ values?: number[] }>;
      error?: { message?: string };
    };

    if (!response.ok) throw new Error(json.error?.message || `Gemini returned ${response.status}`);

    const rows = Array.isArray(json.embeddings) ? json.embeddings : [];
    if (rows.length !== texts.length) return null;

    return rows.map((r) => r.values as number[]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Unified embedding generator for OpenAI and Gemini.
 * Both providers are configured at the API level to return exact 1536-dimension vectors.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];

  const provider = getActiveEmbeddingProvider();
  if (!provider) return null;

  const openAiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const googleKey = env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  const model = env.EMBEDDING_MODEL || (provider === "gemini" ? "text-embedding-004" : "text-embedding-3-small");

  try {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResult = provider === "gemini"
        ? await embedBatchGemini(batch, googleKey, model)
        : await embedBatchOpenAI(batch, openAiKey, model);

      if (!batchResult) return null;
      vectors.push(...batchResult);
    }
    return vectors;
  } catch (error) {
    console.warn(`[embeddings] Embedding request failed (${provider}):`, error instanceof Error ? error.message : error);
    return null;
  }
}
