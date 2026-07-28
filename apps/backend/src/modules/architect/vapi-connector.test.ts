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
const { deployVapiAssistant, extractCallRecordingUrls, isPresignedRecordingUrl, resolveVapiModel, resolveVapiVoice } =
  await import("./vapi-connector");

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

const SKYLAR_FEMALE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";
const RONALD_MALE_ID = "5ee9feff-1265-424a-9d7f-8e4d431a12c7";

describe("resolveVapiVoice", () => {
  it("resolves the ronald preset to its Cartesia id with no explicit id", () => {
    const result = resolveVapiVoice({ voice: "ronald", voiceProvider: "", voiceId: "" });

    expect(result.config).toEqual({
      provider: "cartesia",
      voiceId: RONALD_MALE_ID,
      model: env.CARTESIA_TTS_MODEL
    });
  });

  it("lets the preset's own provider win over a stale stored provider", () => {
    const result = resolveVapiVoice({
      voice: "skylar",
      voiceProvider: "11labs",
      voiceId: FEMALE_DEFAULT_ID
    });

    expect(result.config.provider).toBe("cartesia");
    expect(result.config.voiceId).toBe(SKYLAR_FEMALE_ID);
  });

  it("resolves presets even when the stored provider is missing (legacy configs)", () => {
    const result = resolveVapiVoice({ voice: "skylar", voiceProvider: "", voiceId: FEMALE_DEFAULT_ID });

    expect(result.config.provider).toBe("cartesia");
    expect(result.config.voiceId).toBe(SKYLAR_FEMALE_ID);
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

  it("sends the male Ronald voice and a working LLM even with a stale female id", async () => {
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
      voice: "ronald",
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
      provider: "cartesia",
      voiceId: RONALD_MALE_ID,
      model: env.CARTESIA_TTS_MODEL
    });
    expect(body.model.provider).toBe("openai");
    expect(body.model.model).toBe("gpt-4o-mini");
  });
});

const SIGNED_QS =
  "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=key%2F20260721%2Fauto%2Fs3%2Faws4_request&X-Amz-Signature=abc123";

describe("extractCallRecordingUrls", () => {
  const payload = {
    id: "call-1",
    artifact: {
      recordingUrl: "https://r2.test/hipaa-recordings/call-1-mono.wav",
      stereoRecordingUrl: "https://r2.test/hipaa-recordings/call-1-stereo.wav",
      presignedMonoUrl: `https://r2.test/hipaa-recordings/call-1-mono.wav?${SIGNED_QS}`,
      presignedStereoUrl: `https://r2.test/hipaa-recordings/call-1-stereo.wav?${SIGNED_QS}`,
      presignedAssistantUrl: `https://r2.test/hipaa-recordings/call-1-assistant.wav?${SIGNED_QS}`,
      presignedCustomerUrl: `https://r2.test/hipaa-recordings/call-1-customer.wav?${SIGNED_QS}`,
      transcriptUrl: "https://r2.test/hipaa-recordings/call-1-transcript.json",
      recording: {
        stereoUrl: "https://r2.test/hipaa-recordings/call-1-stereo.wav",
        mono: {
          combinedUrl: "https://r2.test/hipaa-recordings/call-1-mono.wav",
          assistantUrl: "https://r2.test/hipaa-recordings/call-1-assistant.wav",
          customerUrl: "https://r2.test/hipaa-recordings/call-1-customer.wav"
        }
      }
    },
    webhookUrl: "https://api.example.com/webhook"
  };

  it("extracts artifact.presigned*Url fields with their query parameters intact", () => {
    const urls = extractCallRecordingUrls(payload);

    expect(urls).toContain(`https://r2.test/hipaa-recordings/call-1-mono.wav?${SIGNED_QS}`);
    expect(urls).toContain(`https://r2.test/hipaa-recordings/call-1-stereo.wav?${SIGNED_QS}`);
    expect(urls).toContain(`https://r2.test/hipaa-recordings/call-1-assistant.wav?${SIGNED_QS}`);
    expect(urls).toContain(`https://r2.test/hipaa-recordings/call-1-customer.wav?${SIGNED_QS}`);
  });

  it("sorts every presigned URL before every bare URL", () => {
    const urls = extractCallRecordingUrls(payload);
    const flags = urls.map((url) => isPresignedRecordingUrl(url));
    const lastPresigned = flags.lastIndexOf(true);
    const firstBare = flags.indexOf(false);

    expect(lastPresigned).toBeGreaterThanOrEqual(0);
    expect(firstBare).toBeGreaterThan(lastPresigned);
  });

  it("deduplicates without stripping query parameters and skips non-audio artifacts", () => {
    const urls = extractCallRecordingUrls(payload);

    // recording.mono.combinedUrl duplicates artifact.recordingUrl — one entry.
    expect(urls.filter((url) => url === "https://r2.test/hipaa-recordings/call-1-mono.wav")).toHaveLength(1);
    // Bare and presigned variants of the same object are DIFFERENT candidates.
    expect(urls).toContain("https://r2.test/hipaa-recordings/call-1-mono.wav");
    // Transcript and unrelated URLs never become playback candidates.
    expect(urls.some((url) => url.includes("transcript"))).toBe(false);
    expect(urls.some((url) => url.includes("api.example.com"))).toBe(false);
  });
});

describe("isPresignedRecordingUrl", () => {
  it("recognizes any of the SigV4 query markers", () => {
    expect(isPresignedRecordingUrl("https://r2.test/a.wav?X-Amz-Signature=x")).toBe(true);
    expect(isPresignedRecordingUrl("https://r2.test/a.wav?X-Amz-Credential=x")).toBe(true);
    expect(isPresignedRecordingUrl("https://r2.test/a.wav?X-Amz-Algorithm=x")).toBe(true);
    expect(isPresignedRecordingUrl("https://r2.test/a.wav")).toBe(false);
  });
});
