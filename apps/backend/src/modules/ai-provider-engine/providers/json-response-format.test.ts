import { describe, expect, it } from "vitest";
import { jsonResponseFormat } from "./base-adapter";
import type { AIExecuteRequest } from "../types";

/**
 * Strict JSON mode, the guard around it, and why both exist.
 *
 * Before this, `outputFormat: "json"` never reached the API — we asked for
 * JSON in words and about one reply in five came back with a misplaced
 * bracket that every JSON gate on the platform rejected. The guard exists
 * because OpenAI rejects the whole request when json mode is asked for and
 * the word "json" appears nowhere in the prompt.
 */

function request(overrides: Partial<AIExecuteRequest> = {}): AIExecuteRequest {
  return {
    capability: "llm",
    task: "test",
    ...overrides
  } as AIExecuteRequest;
}

describe("jsonResponseFormat", () => {
  it("asks the API to guarantee JSON when the prompt says json", () => {
    const out = jsonResponseFormat(
      request({ outputFormat: "json", systemPrompt: "Reply with ONLY a JSON object." })
    );
    expect(out).toEqual({ response_format: { type: "json_object" } });
  });

  it("finds the word in messages too, not just the system prompt", () => {
    const out = jsonResponseFormat(
      request({
        outputFormat: "json",
        messages: [{ role: "user", content: "give me json please" }]
      })
    );
    expect(out).toEqual({ response_format: { type: "json_object" } });
  });

  it("finds it in conversation history as well", () => {
    const out = jsonResponseFormat(
      request({
        outputFormat: "json",
        conversationHistory: [{ role: "assistant", content: "Sure — JSON coming up." }]
      })
    );
    expect(out).toEqual({ response_format: { type: "json_object" } });
  });

  it("stays out of the way when the prompt never says json — OpenAI would reject it", () => {
    const out = jsonResponseFormat(
      request({ outputFormat: "json", systemPrompt: "Write a friendly greeting." })
    );
    expect(out).toEqual({});
  });

  it("never touches plain text requests", () => {
    expect(jsonResponseFormat(request({ systemPrompt: "json json json" }))).toEqual({});
    expect(
      jsonResponseFormat(request({ outputFormat: "text", systemPrompt: "json" }))
    ).toEqual({});
  });
});
