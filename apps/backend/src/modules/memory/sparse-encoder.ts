/**
 * Sparse Vector Encoder for Pinecone Hybrid Search.
 * Uses FNV-1a hashing for term-to-index mapping and term-frequency (TF) weighting.
 * Produces sparse vector format compatible with Pinecone vector search: { indices: number[], values: number[] }.
 */

export type SparseVector = {
  indices: number[];
  values: number[];
};

/**
 * FNV-1a 32-bit hash function mapping a token string to a positive integer index.
 * Pinecone sparse vector indices must be non-negative integers (0 to 2^31 - 1).
 */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

/**
 * Stop words filter for common English words to reduce noise in sparse term matching.
 */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
  "in", "is", "it", "its", "of", "on", "that", "the", "to", "was", "were",
  "will", "with", "this", "but", "they", "have", "had", "what", "when", "where",
  "who", "which", "why", "how", "all", "any", "both", "each", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "can", "just", "should", "now"
]);

/**
 * Tokenize string into clean words/tokens.
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Generate a sparse vector from text for indexing or querying.
 */
export function buildSparseVector(text: string): SparseVector {
  const tokens = tokenizeText(text);
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }

  // Count term frequencies
  const tfMap = new Map<number, number>();
  for (const token of tokens) {
    const idx = fnv1a32(token);
    tfMap.set(idx, (tfMap.get(idx) ?? 0) + 1);
  }

  // Calculate TF weights (sublinear TF scaling: 1 + log(tf))
  const rawIndices: number[] = [];
  const rawValues: number[] = [];

  for (const [idx, count] of tfMap.entries()) {
    rawIndices.push(idx);
    rawValues.push(1 + Math.log(count));
  }

  // Sort by index as required by Pinecone API
  const paired = rawIndices.map((idx, i) => ({ idx, val: rawValues[i] }));
  paired.sort((a, b) => a.idx - b.idx);

  return {
    indices: paired.map((p) => p.idx),
    values: paired.map((p) => p.val)
  };
}

/**
 * Scale dense and sparse query vectors by alpha for Pinecone dotproduct metric hybrid search.
 * alpha = 1.0 -> Pure dense (semantic search)
 * alpha = 0.0 -> Pure sparse (lexical keyword search)
 * alpha = 0.75 -> Recommended default (dense-leaning hybrid search)
 */
export function prepareHybridQueryVectors(
  denseVector: number[],
  sparseVector: SparseVector,
  alpha = 0.75
): { denseQuery: number[]; sparseQuery: SparseVector } {
  const denseQuery = denseVector.map((val) => val * alpha);
  const sparseQuery = {
    indices: sparseVector.indices,
    values: sparseVector.values.map((val) => val * (1 - alpha))
  };

  return { denseQuery, sparseQuery };
}
