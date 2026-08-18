import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Claude adapter — the temperature rule for the claude-5 generation.
 *
 * A live probe proved Anthropic answers 400 "temperature is deprecated for
 * this model" when temperature is sent to claude-opus-5. The adapter must
 * therefore (a) never send temperature to a model known to reject it, (b)
 * retry exactly once without temperature when an unknown model rejects it at
 * runtime, and (c) leave older models' behaviour completely unchanged.
 */

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  }
}));

import adapter, { isTemperatureRejection, modelRejectsTemperature } from "./claude.adapter";
import type { AIExecuteRequest } from "../types";

function anthropicMessage(text = "ok") {
  return {
    id: "msg_test",
    content: [{ type: "text", text }],
    usage: { input_tokens: 12, output_tokens: 7 },
    stop_reason: "end_turn"
  };
}

function request(model: string, overrides: Partial<AIExecuteRequest> = {}): AIExecuteRequest {
  return {
    capability: "llm",
    model,
    messages: [{ role: "user", content: "hello" }],
    ...overrides
  } as AIExecuteRequest;
}

/** A 400 shaped like the Anthropic SDK raises it. */
function temperatureRejection(): Error & { status: number } {
  const err = new Error(
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"temperature is deprecated for this model"}}'
  ) as Error & { status: number };
  err.status = 400;
  return err;
}

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue(anthropicMessage());
});

describe("which models reject temperature", () => {
  it("covers the whole claude-5 family and cataloged thinking models", () => {
    expect(modelRejectsTemperature("claude-opus-5")).toBe(true);
    expect(modelRejectsTemperature("claude-fable-5")).toBe(true);
    expect(modelRejectsTemperature("claude-sonnet-5")).toBe(true);
  });

  it("leaves older models alone", () => {
    expect(modelRejectsTemperature("claude-opus-4-5")).toBe(false);
    expect(modelRejectsTemperature("claude-sonnet-4-5")).toBe(false);
    expect(modelRejectsTemperature("claude-haiku-4-5-20251001")).toBe(false);
  });
});

describe("execute", () => {
  it("omits temperature entirely for claude-opus-5", async () => {
    const result = await adapter.execute(request("claude-opus-5", { temperature: 0.4 }));

    expect(result.status).toBe("success");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it("keeps sending temperature to older models exactly as before", async () => {
    await adapter.execute(request("claude-sonnet-4-5", { temperature: 0.4 }));
    expect(createMock.mock.calls[0][0].temperature).toBe(0.4);

    createMock.mockClear();
    createMock.mockResolvedValue(anthropicMessage());
    await adapter.execute(request("claude-sonnet-4-5"));
    // The historical default when the caller says nothing.
    expect(createMock.mock.calls[0][0].temperature).toBe(0.7);
  });

  it("retries ONCE without temperature when an unknown model rejects it", async () => {
    createMock.mockRejectedValueOnce(temperatureRejection());
    createMock.mockResolvedValueOnce(anthropicMessage("recovered"));

    const result = await adapter.execute(request("claude-next-6", { temperature: 0.4 }));

    expect(result.status).toBe("success");
    expect(result.text).toBe("recovered");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].temperature).toBe(0.4);
    expect(createMock.mock.calls[1][0]).not.toHaveProperty("temperature");
  });

  it("does not treat other 400s as a temperature problem", async () => {
    const err = new Error("400 invalid_request_error: max_tokens is too large") as Error & { status: number };
    err.status = 400;
    createMock.mockRejectedValue(err);

    const result = await adapter.execute(request("claude-sonnet-4-5", { temperature: 0.4 }));

    expect(result.status).toBe("error");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("passes a big maxTokens straight through for spec-sized generations", async () => {
    await adapter.execute(request("claude-opus-5", { maxTokens: 16000 }));
    expect(createMock.mock.calls[0][0].max_tokens).toBe(16000);

    createMock.mockClear();
    createMock.mockResolvedValue(anthropicMessage());
    await adapter.execute(request("claude-opus-5"));
    expect(createMock.mock.calls[0][0].max_tokens).toBe(1024);
  });
});

describe("isTemperatureRejection", () => {
  it("matches only the exact deprecation 400", () => {
    expect(isTemperatureRejection(temperatureRejection())).toBe(true);
    expect(isTemperatureRejection(new Error("400 temperature is not supported"))).toBe(true);

    expect(isTemperatureRejection(new Error("429 rate limit — lower temperature of requests"))).toBe(false);
    expect(isTemperatureRejection(new Error("401 invalid api key"))).toBe(false);
    expect(isTemperatureRejection(new Error("400 max_tokens is too large"))).toBe(false);
  });
});
