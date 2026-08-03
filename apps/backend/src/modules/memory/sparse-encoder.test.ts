import { describe, expect, test } from "vitest";
import { buildSparseVector, prepareHybridQueryVectors, tokenizeText } from "./sparse-encoder";

describe("sparse encoder", () => {
  test("tokenizes text removing stop words and punctuation", () => {
    const text = "The quick brown fox jumps over the lazy dog! Contact us at test@example.com for pricing.";
    const tokens = tokenizeText(text);
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
    expect(tokens).toContain("pricing");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("at");
  });

  test("builds sorted sparse vectors with non-negative integer indices", () => {
    const text = "Implant pricing details and dental consult options.";
    const sparse = buildSparseVector(text);

    expect(sparse.indices.length).toBeGreaterThan(0);
    expect(sparse.values.length).toEqual(sparse.indices.length);

    // Pinecone index requirement: indices must be sorted ascending
    for (let i = 1; i < sparse.indices.length; i++) {
      expect(sparse.indices[i]).toBeGreaterThan(sparse.indices[i - 1]);
      expect(sparse.indices[i]).toBeGreaterThanOrEqual(0);
    }
  });

  test("prepareHybridQueryVectors scales dense by alpha and sparse by 1 - alpha", () => {
    const dense = [1.0, 2.0, 3.0];
    const sparse = { indices: [10, 20], values: [1.0, 1.0] };

    const { denseQuery, sparseQuery } = prepareHybridQueryVectors(dense, sparse, 0.75);

    expect(denseQuery).toEqual([0.75, 1.5, 2.25]);
    expect(sparseQuery.indices).toEqual([10, 20]);
    expect(sparseQuery.values).toEqual([0.25, 0.25]);
  });
});
