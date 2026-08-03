import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  getActiveEmbeddingProvider,
  getActiveEmbeddingModel,
  embeddingsConfigured
} from "./embeddings";
import { env } from "../../config/env";

describe("dynamic embedding provider selection", () => {
  const originalEnv = { ...process.env };
  const origOpenAi = env.OPENAI_API_KEY;
  const origGoogle = env.GOOGLE_API_KEY;
  const origProvider = env.EMBEDDING_PROVIDER;
  const origModel = env.EMBEDDING_MODEL;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    (env as any).OPENAI_API_KEY = "";
    (env as any).GOOGLE_API_KEY = "";
    (env as any).EMBEDDING_PROVIDER = "auto";
    (env as any).EMBEDDING_MODEL = "";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    (env as any).OPENAI_API_KEY = origOpenAi;
    (env as any).GOOGLE_API_KEY = origGoogle;
    (env as any).EMBEDDING_PROVIDER = origProvider;
    (env as any).EMBEDDING_MODEL = origModel;
  });

  test("returns null when no API keys are present", () => {
    expect(getActiveEmbeddingProvider()).toBeNull();
    expect(embeddingsConfigured()).toBe(false);
  });

  test("auto detects OpenAI when OPENAI_API_KEY is set", () => {
    (env as any).OPENAI_API_KEY = "sk-test-openai";
    expect(getActiveEmbeddingProvider()).toBe("openai");
    expect(getActiveEmbeddingModel()).toBe("text-embedding-3-small");
    expect(embeddingsConfigured()).toBe(true);
  });

  test("auto detects Gemini when only GOOGLE_API_KEY is set", () => {
    (env as any).GOOGLE_API_KEY = "AIzaSyTestGeminiKey";
    expect(getActiveEmbeddingProvider()).toBe("gemini");
    expect(getActiveEmbeddingModel()).toBe("text-embedding-004");
    expect(embeddingsConfigured()).toBe(true);
  });

  test("honors explicit EMBEDDING_PROVIDER=gemini even if OPENAI_API_KEY is also present", () => {
    (env as any).OPENAI_API_KEY = "sk-test-openai";
    (env as any).GOOGLE_API_KEY = "AIzaSyTestGeminiKey";
    (env as any).EMBEDDING_PROVIDER = "gemini";

    expect(getActiveEmbeddingProvider()).toBe("gemini");
    expect(getActiveEmbeddingModel()).toBe("text-embedding-004");
  });

  test("honors custom EMBEDDING_MODEL setting", () => {
    (env as any).GOOGLE_API_KEY = "AIzaSyTestGeminiKey";
    (env as any).EMBEDDING_PROVIDER = "gemini";
    (env as any).EMBEDDING_MODEL = "text-embedding-005-custom";

    expect(getActiveEmbeddingModel()).toBe("text-embedding-005-custom");
  });
});
