import { describe, expect, test } from "vitest";
import {
  getLastEmbeddingError,
  EMBEDDING_DIMENSIONS
} from "./embeddings";

describe("local embedding engine", () => {
  test("defines embedding dimension of 384", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(384);
  });

  test("starts with null last error", () => {
    expect(getLastEmbeddingError()).toBeNull();
  });
});
