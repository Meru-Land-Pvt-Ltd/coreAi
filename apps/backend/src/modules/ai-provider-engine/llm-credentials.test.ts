import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import {
  hasAnyLlmCredentials,
  llmCredentialStatus,
  resolveConfiguredLlmProvider
} from "./llm-credentials";

const KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY"
] as const;

const saved = new Map<string, { env: unknown; process: string | undefined }>();

function setKey(key: (typeof KEYS)[number], value: string | undefined): void {
  (env as Record<string, unknown>)[key] = value;
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, { env: (env as Record<string, unknown>)[key], process: process.env[key] });
    setKey(key, undefined);
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const previous = saved.get(key);
    (env as Record<string, unknown>)[key] = previous?.env;
    if (previous?.process === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous.process;
    }
  }
});

describe("llmCredentialStatus", () => {
  it("reports missing when the provider's key is unset", () => {
    expect(llmCredentialStatus("openai")).toBe("missing");
  });

  it("reports configured once the key is set", () => {
    setKey("OPENAI_API_KEY", "sk-test");
    expect(llmCredentialStatus("openai")).toBe("configured");
  });

  it("treats providers it cannot judge as unknown", () => {
    expect(llmCredentialStatus("llama")).toBe("unknown");
  });

  it("accepts groq's own key without OPENAI_API_KEY", () => {
    setKey("GROQ_API_KEY", "gsk-test");
    expect(llmCredentialStatus("groq")).toBe("configured");
  });
});

describe("resolveConfiguredLlmProvider", () => {
  it("keeps the requested provider when it has a key", () => {
    setKey("OPENAI_API_KEY", "sk-test");
    expect(resolveConfiguredLlmProvider("openai")).toEqual({ providerId: "openai" });
  });

  it("substitutes another configured provider when the requested one has no key", () => {
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    expect(resolveConfiguredLlmProvider("openai")).toEqual({
      providerId: "claude",
      fallbackFrom: "openai"
    });
  });

  it("returns null when nothing is configured", () => {
    expect(resolveConfiguredLlmProvider("openai")).toBeNull();
    expect(hasAnyLlmCredentials()).toBe(false);
  });

  it("passes unknown providers through untouched", () => {
    expect(resolveConfiguredLlmProvider("llama")).toEqual({ providerId: "llama" });
  });
});
