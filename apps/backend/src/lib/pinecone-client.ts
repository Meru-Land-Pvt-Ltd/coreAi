import { Pinecone, type Index } from "@pinecone-database/pinecone";
import { env } from "../config/env";
import { EMBEDDING_DIMENSIONS } from "../modules/ai-provider-engine/embeddings";

let pineconeInstance: Pinecone | null = null;
let indexInitialized = false;
let detectedDimension: number | null = null;

export function isPineconeConfigured(): boolean {
  return Boolean(env.PINECONE_API_KEY || process.env.PINECONE_API_KEY);
}

let pineconeKey: string | undefined;

export function getPineconeClient(): Pinecone | null {
  const apiKey = env.PINECONE_API_KEY || process.env.PINECONE_API_KEY;
  if (!apiKey) return null;

  /* Same as the Gemini adapter: the first key won for the life of the process,
     so rotating it in the admin screen changed nothing until a deploy — and a
     revoked old key meant every memory lookup failed silently. */
  if (!pineconeInstance || pineconeKey !== apiKey) {
    pineconeInstance = new Pinecone({ apiKey });
    pineconeKey = apiKey;
    indexInitialized = false;
    detectedDimension = null;
  }
  return pineconeInstance;
}

export function getPineconeTargetIndexName(): string {
  return env.PINECONE_INDEX_NAME || process.env.PINECONE_INDEX_NAME || "memory";
}

/**
 * Get or initialize the Pinecone index for hybrid vector search.
 * Ensures the index exists with matching dimension (creates serverless index if absent).
 */
export async function getPineconeIndex(): Promise<Index | null> {
  const client = getPineconeClient();
  if (!client) return null;

  const indexName = getPineconeTargetIndexName();
  const targetDimension = EMBEDDING_DIMENSIONS; // 384 dimensions for local BGE model

  if (!indexInitialized) {
    try {
      const existingIndexes = await client.listIndexes();
      const existingInfo = existingIndexes.indexes?.find((idx) => idx.name === indexName);

      if (!existingInfo) {
        console.log(`[pinecone] Index '${indexName}' not found. Creating serverless index (dim=${targetDimension})...`);
        await client.createIndex({
          name: indexName,
          dimension: targetDimension,
          metric: "dotproduct", // Dotproduct metric required for Pinecone hybrid search (dense + sparse)
          spec: {
            serverless: {
              cloud: "aws",
              region: "us-east-1"
            }
          }
        });
        console.log(`[pinecone] Index '${indexName}' created successfully.`);
        detectedDimension = targetDimension;
      } else {
        if (typeof existingInfo.dimension === "number") {
          detectedDimension = existingInfo.dimension;
        }
      }
      indexInitialized = true;
    } catch (error) {
      console.warn(`[pinecone] Index initialization/verification failed:`, error instanceof Error ? error.message : error);
    }
  }

  return client.index(indexName);
}

/**
 * Dynamically get the vector dimension of the target Pinecone index.
 */
export async function getPineconeIndexDimension(): Promise<number> {
  if (detectedDimension) return detectedDimension;

  const client = getPineconeClient();
  if (!client) return EMBEDDING_DIMENSIONS;

  const indexName = getPineconeTargetIndexName();
  try {
    const desc = await client.describeIndex(indexName);
    if (typeof desc.dimension === "number") {
      detectedDimension = desc.dimension;
      return desc.dimension;
    }
  } catch {
    // Default fallback if index check fails
  }

  return EMBEDDING_DIMENSIONS;
}

/**
 * Safely format and return a tenant-isolated Pinecone namespace handle.
 */
export function formatTenantNamespace(tenantId: string): string {
  if (!tenantId) return "default";
  const clean = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return clean.startsWith("biz_") || clean.startsWith("arch_") ? clean : `tenant_${clean}`;
}

