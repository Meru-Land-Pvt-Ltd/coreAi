import { Pinecone, type Index } from "@pinecone-database/pinecone";
import { env } from "../config/env";

let pineconeInstance: Pinecone | null = null;
let indexInitialized = false;
let detectedDimension: number | null = null;

export function isPineconeConfigured(): boolean {
  return Boolean(env.PINECONE_API_KEY || process.env.PINECONE_API_KEY);
}

export function getPineconeClient(): Pinecone | null {
  const apiKey = env.PINECONE_API_KEY || process.env.PINECONE_API_KEY;
  if (!apiKey) return null;

  if (!pineconeInstance) {
    pineconeInstance = new Pinecone({ apiKey });
  }
  return pineconeInstance;
}

/**
 * Get or initialize the Pinecone index for hybrid vector search.
 * Ensures the index exists (creates serverless index if absent).
 */
export async function getPineconeIndex(): Promise<Index | null> {
  const client = getPineconeClient();
  if (!client) return null;

  const indexName = env.PINECONE_INDEX_NAME || "memory";

  if (!indexInitialized) {
    try {
      const existingIndexes = await client.listIndexes();
      const existingInfo = existingIndexes.indexes?.find((idx) => idx.name === indexName);

      if (!existingInfo) {
        console.log(`[pinecone] Index '${indexName}' not found. Creating serverless index...`);
        await client.createIndex({
          name: indexName,
          dimension: 1536, // Standard 1536 default dimension
          metric: "dotproduct", // Dotproduct metric required for Pinecone hybrid search (dense + sparse)
          spec: {
            serverless: {
              cloud: "aws",
              region: "us-east-1"
            }
          }
        });
        console.log(`[pinecone] Index '${indexName}' created successfully.`);
        detectedDimension = 1536;
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
 * Dynamically get the vector dimension of the target Pinecone index (e.g., 1536, 3072, 768).
 */
export async function getPineconeIndexDimension(): Promise<number> {
  if (detectedDimension) return detectedDimension;

  const client = getPineconeClient();
  if (!client) return 1536;

  const indexName = env.PINECONE_INDEX_NAME || "memory";
  try {
    const desc = await client.describeIndex(indexName);
    if (typeof desc.dimension === "number") {
      detectedDimension = desc.dimension;
      return desc.dimension;
    }
  } catch {
    // Default fallback if index check fails
  }

  return 1536;
}
