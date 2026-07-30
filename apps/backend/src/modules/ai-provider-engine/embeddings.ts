import { env } from "../../config/env";

export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDING_BATCH_SIZE = 96;
const EMBEDDING_TIMEOUT_MS = 15000;

export function embeddingsConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][] | null> {
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
        model: env.MEMORY_EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS
      })
    });

    const json = (await response.json().catch(() => ({}))) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(json.error?.message || `OpenAI embeddings returned ${response.status}`);
    }

    const rows = Array.isArray(json.data) ? json.data : [];
    if (rows.length !== texts.length) return null;

    // fill(null) so the post-loop check sees holes left by bad/out-of-range indexes
    // (Array.prototype.every skips holes in a sparse array).
    const vectors: Array<number[] | null> = new Array(texts.length).fill(null);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const embedding = Array.isArray(row?.embedding) ? row.embedding : null;
      if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) return null;
      const slot = typeof row.index === "number" ? row.index : i;
      if (slot < 0 || slot >= texts.length || vectors[slot] !== null) return null;
      vectors[slot] = embedding;
    }
    return vectors.every((v) => Array.isArray(v)) ? (vectors as number[][]) : null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  try {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      const batchVectors = await embedBatch(batch, apiKey);
      if (!batchVectors) return null;
      vectors.push(...batchVectors);
    }
    return vectors;
  } catch (error) {
    console.warn("[embeddings] embedding request failed, degrading to non-vector path:", error);
    return null;
  }
}
