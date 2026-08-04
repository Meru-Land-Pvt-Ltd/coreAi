import { describe, expect, test } from "vitest";
import {
  getActiveEmbeddingProvider,
  getActiveEmbeddingModel,
  embeddingsConfigured,
  EMBEDDING_DIMENSIONS
} from "./embeddings";

describe("local embedding engine", () => {
  test("returns local provider and correct model defaults", () => {
    expect(getActiveEmbeddingProvider()).toBe("local");
    expect(getActiveEmbeddingModel()).toBe("Xenova/bge-small-en-v1.5");
    expect(embeddingsConfigured()).toBe(true);
    expect(EMBEDDING_DIMENSIONS).toBe(384);
  });
});
