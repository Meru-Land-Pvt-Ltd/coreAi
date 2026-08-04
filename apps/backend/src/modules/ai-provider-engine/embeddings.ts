import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { env } from "../../config/env";

export const EMBEDDING_DIMENSIONS = 384;
const BATCH_SIZE = 96;

export type EmbeddingProviderName = "local";

let localExtractor: FeatureExtractionPipeline | null = null;

/**
 * Lazy loads the 100% local ONNX embedding pipeline (Xenova/bge-small-en-v1.5).
 */
async function getLocalExtractor(): Promise<FeatureExtractionPipeline> {
  if (!localExtractor) {
    const modelName = env.LOCAL_EMBEDDING_MODEL || "Xenova/bge-small-en-v1.5";
    localExtractor = await pipeline("feature-extraction", modelName, {
      quantized: true
    });
  }
  return localExtractor;
}

export function getActiveEmbeddingProvider(): EmbeddingProviderName {
  return "local";
}

export function getActiveEmbeddingModel(): string {
  return env.LOCAL_EMBEDDING_MODEL || "Xenova/bge-small-en-v1.5";
}

export function embeddingsConfigured(): boolean {
  return true; // Local ONNX embedding engine is always ready
}

/**
 * Generates 384-dimensional normalized vectors 100% locally on CPU via ONNX Runtime.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];

  try {
    const extractor = await getLocalExtractor();
    const vectors: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      if (batch.length === 1) {
        const output = await extractor(batch[0], { pooling: "mean", normalize: true });
        vectors.push(Array.from(output.data as Float32Array));
      } else {
        const output = await extractor(batch, { pooling: "mean", normalize: true });
        const data = output.data as Float32Array;
        const dims = output.dims;
        const vectorDim = dims ? dims[dims.length - 1] : EMBEDDING_DIMENSIONS;
        for (let b = 0; b < batch.length; b++) {
          const vec = Array.from(data.subarray(b * vectorDim, (b + 1) * vectorDim));
          vectors.push(vec);
        }
      }
    }
    return vectors;
  } catch (error) {
    console.warn("[embeddings] Local ONNX embedding failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

