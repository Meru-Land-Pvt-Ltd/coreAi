import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  llmProviderBlockReason,
  recordLlmProviderFailure,
  recordLlmProviderSuccess,
  resetLlmProviderHealth
} from "./llm-health";

beforeEach(() => resetLlmProviderHealth());

describe("classifyProviderFailure", () => {
  it("recognises the run-log wording for an empty account", () => {
    // Exactly what the AI Brain node logged: "402 Insufficient Balance".
    expect(classifyProviderFailure("402 Insufficient Balance")).toBe("out of credit");
    expect(classifyProviderFailure("Error: insufficient funds on this account")).toBe("out of credit");
  });

  it("recognises quota and rejected-key failures", () => {
    expect(classifyProviderFailure("429 Too Many Requests: quota exceeded")).toBe("over quota");
    expect(classifyProviderFailure("401 Incorrect API key provided")).toBe("key rejected");
  });

  it("ignores failures that say nothing about the account", () => {
    expect(classifyProviderFailure("model_not_found: gpt-9 does not exist")).toBeNull();
    expect(classifyProviderFailure("Request timed out")).toBeNull();
    expect(classifyProviderFailure("")).toBeNull();
    expect(classifyProviderFailure(null)).toBeNull();
  });
});

describe("provider block lifecycle", () => {
  it("blocks a provider after an account-level failure", () => {
    recordLlmProviderFailure("deepseek", "402 Insufficient Balance");
    expect(llmProviderBlockReason("deepseek")).toBe("out of credit");
  });

  it("leaves a provider usable after an unrelated failure", () => {
    recordLlmProviderFailure("openai", "model_not_found");
    expect(llmProviderBlockReason("openai")).toBeNull();
  });

  it("clears the block on the next success — a top-up needs no redeploy", () => {
    recordLlmProviderFailure("deepseek", "402 Insufficient Balance");
    recordLlmProviderSuccess("deepseek");
    expect(llmProviderBlockReason("deepseek")).toBeNull();
  });

  it("expires the block so a quiet top-up recovers on its own", () => {
    const now = 1_000_000;
    recordLlmProviderFailure("deepseek", "402 Insufficient Balance", now);

    expect(llmProviderBlockReason("deepseek", now + 60_000)).toBe("out of credit");
    expect(llmProviderBlockReason("deepseek", now + 31 * 60 * 1000)).toBeNull();
  });
});
