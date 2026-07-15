/**
 * Voice + LLM resolution tests for Vapi assistant deployment.
 *
 * Voice preset env ids are frozen into voice-presets.ts at import time, so
 * they are set on process.env BEFORE the connector is imported. Model/env
 * flags are read at call time and are toggled per test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const ADAM_MALE_ID = "pNInz6obpgDQGcFmaJgB";
const FEMALE_DEFAULT_ID = "FD17pMswbbEnsVYS0L7P";
const CUSTOM_ID = "CusTomVoice1234567890";

// Static imports are hoisted, so the voice env ids (frozen at module load in
// voice-presets.ts) must be set before the connector is dynamically imported.
process.env.ELEVENLABS_VOICE_ADAM_ID = ADAM_MALE_ID;
process.env.ELEVENLABS_VOICE_SARAH_ID = FEMALE_DEFAULT_ID;
process.env.ELEVENLABS_DEFAULT_VOICE_ID = FEMALE_DEFAULT_ID;

const { env } = await import("../../config/env");
const { deployVapiAssistant, resolveVapiModel, resolveVapiVoice } = await import("./vapi-connector");

const originalEnv = {
  VAPI_API_KEY: env.VAPI_API_KEY,
  VAPI_DEFAULT_LLM_PROVIDER: env.VAPI_DEFAULT_LLM_PROVIDER,
  VAPI_DEFAULT_LLM_MODEL: env.VAPI_DEFAULT_LLM_MODEL,
  VAPI_ANTHROPIC_ENABLED: env.VAPI_ANTHROPIC_ENABLED,
  VAPI_ANTHROPIC_MODEL: env.VAPI_ANTHROPIC_MODEL,
  VAPI_ELEVENLABS_MODEL: env.VAPI_ELEVENLABS_MODEL
};

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("resolveVapiVoice", () => {
  it("resolves the adam preset to the male ElevenLabs id with no explicit id", () => {
    const result = resolveVapiVoice({ voice: "adam", voiceProvider: "11labs", voiceId: "" });

    expect(result.config).toEqual({
      provider: "11labs",
      voiceId: ADAM_MALE_ID,
      model: env.VAPI_ELEVENLABS_MODEL
    });
  });

  it("lets the adam preset win over a stale female fallback id", () => {
    const result = resolveVapiVoice({
      voice: "adam",
      voiceProvider: "11labs",
      voiceId: FEMALE_DEFAULT_ID
    });

    expect(result.config).toEqual({
      provider: "11labs",
      voiceId: ADAM_MALE_ID,
      model: env.VAPI_ELEVENLABS_MODEL
    });
  });

  it("resolves presets even when the stored provider is missing (legacy configs)", () => {
    const result = resolveVapiVoice({ voice: "adam", voiceProvider: "", voiceId: FEMALE_DEFAULT_ID });

    expect(result.config.provider).toBe("11labs");
    expect(result.config.voiceId).toBe(ADAM_MALE_ID);
  });

  it("preserves an explicit custom voice id", () => {
    const result = resolveVapiVoice({ voice: "custom", voiceProvider: "11labs", voiceId: CUSTOM_ID });

    expect(result.config).toEqual({
      provider: "11labs",
      voiceId: CUSTOM_ID,
      model: env.VAPI_ELEVENLABS_MODEL
    });
  });

  it("resolves triven-default to the configured platform default voice", () => {
    const result = resolveVapiVoice({ voice: "triven-default", voiceProvider: "11labs", voiceId: "" });

    expect(result.config.provider).toBe("11labs");
    expect(result.config.voiceId).toBe(FEMALE_DEFAULT_ID);
  });

  it("keeps Vapi built-in voices on provider vapi", () => {
    const result = resolveVapiVoice({ voice: "Savannah", voiceProvider: "vapi", voiceId: "" });

    expect(result.config).toEqual({ provider: "vapi", voiceId: "Savannah" });
  });

  it("matches built-in voice names without an explicit provider", () => {
    const result = resolveVapiVoice({ voice: "kylie", voiceProvider: "", voiceId: "" });

    expect(result.config).toEqual({ provider: "vapi", voiceId: "Kylie" });
  });

  it("falls back to the platform default preset when nothing usable is given", () => {
    const result = resolveVapiVoice({ voice: "", voiceProvider: "", voiceId: "" });

    expect(result.config.provider).toBe("11labs");
    expect(result.config.voiceId).toBe(FEMALE_DEFAULT_ID);
  });
});

describe("resolveVapiModel", () => {
  it("falls back to the working default provider when Anthropic is not enabled", () => {
    env.VAPI_ANTHROPIC_ENABLED = false;
    env.VAPI_DEFAULT_LLM_PROVIDER = "openai";
    env.VAPI_DEFAULT_LLM_MODEL = "gpt-4o-mini";

    const result = resolveVapiModel("claude-sonnet");

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.fallbackNotice).toContain("Anthropic voice-test model is unavailable");
  });

  it("never deploys the retired claude-3-5-sonnet id even when Anthropic is enabled", () => {
    env.VAPI_ANTHROPIC_ENABLED = true;
    env.VAPI_ANTHROPIC_MODEL = "claude-sonnet-4-6";

    const result = resolveVapiModel("claude-3-5-sonnet-20241022");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.fallbackNotice).toContain("retired");
  });

  it("preserves a supported Anthropic model when Anthropic is enabled", () => {
    env.VAPI_ANTHROPIC_ENABLED = true;

    const result = resolveVapiModel("claude-sonnet-4-6");

    expect(result).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("keeps the working OpenAI models unchanged", () => {
    expect(resolveVapiModel("gpt-4o-mini")).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(resolveVapiModel("gpt-4o")).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("uses the env default for empty or unknown model values", () => {
    env.VAPI_DEFAULT_LLM_PROVIDER = "openai";
    env.VAPI_DEFAULT_LLM_MODEL = "gpt-4o-mini";

    expect(resolveVapiModel("")).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(resolveVapiModel("llama-3.1-70b")).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });
});

describe("deployVapiAssistant payload", () => {
  function stubVapiCreate() {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: "assistant-test-id" })
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("clamps assistant names to Vapi's 40-character limit", async () => {
    env.VAPI_API_KEY = "test-key";

    const fetchMock = stubVapiCreate();

    await deployVapiAssistant({
      name: "Marketplace Demo — Some Extremely Long Listing Name That Overflows",
      firstMessage: "Hello",
      systemPrompt: "test",
      voice: "adam",
      voiceProvider: "11labs",
      voiceId: "",
      serverUrl: "https://example.com/webhook"
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as { name: string };

    expect(body.name.length).toBeLessThanOrEqual(40);
    expect(body.name).toBe("Marketplace Demo — Some Extremely Long L");
  });

  it("sends the male Adam voice and a working LLM even with a stale female id", async () => {
    env.VAPI_API_KEY = "test-key";
    env.VAPI_ANTHROPIC_ENABLED = false;
    env.VAPI_DEFAULT_LLM_PROVIDER = "openai";
    env.VAPI_DEFAULT_LLM_MODEL = "gpt-4o-mini";

    const fetchMock = stubVapiCreate();

    const result = await deployVapiAssistant({
      name: "Test Assistant",
      firstMessage: "Hello",
      systemPrompt: "You are a test assistant.",
      model: "claude-sonnet",
      voice: "adam",
      voiceProvider: "11labs",
      voiceId: FEMALE_DEFAULT_ID,
      serverUrl: "https://example.com/webhook"
    });

    expect(result.id).toBe("assistant-test-id");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as {
      model: { provider: string; model: string };
      voice: { provider: string; voiceId: string; model?: string };
    };

    expect(body.voice).toMatchObject({
      provider: "11labs",
      voiceId: ADAM_MALE_ID,
      model: env.VAPI_ELEVENLABS_MODEL
    });
    expect(body.model.provider).toBe("openai");
    expect(body.model.model).toBe("gpt-4o-mini");
  });
});
