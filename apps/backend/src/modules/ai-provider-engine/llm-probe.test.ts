import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { recordLlmProviderFailure, recordLlmProviderSuccess, resetLlmProviderHealth } from "./llm-health";
import {
  llmProviderAvailability,
  probeLlmProvider,
  resetLlmProbeCache,
  verdictFromDeepSeekBalance,
  verdictFromStatus
} from "./llm-probe";

const KEYS = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"] as const;
const saved = new Map<string, { env: unknown; process: string | undefined }>();

function setKey(key: string, value: string | undefined): void {
  (env as Record<string, unknown>)[key] = value;
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  resetLlmProbeCache();
  resetLlmProviderHealth();
  for (const key of KEYS) {
    saved.set(key, { env: (env as Record<string, unknown>)[key], process: process.env[key] });
    setKey(key, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of KEYS) {
    const previous = saved.get(key);
    (env as Record<string, unknown>)[key] = previous?.env;
    if (previous?.process === undefined) delete process.env[key];
    else process.env[key] = previous.process;
  }
});

describe("verdictFromStatus", () => {
  it("treats a definite rejection as unusable", () => {
    expect(verdictFromStatus(402)).toEqual({ usable: false, reason: "out of credit" });
    expect(verdictFromStatus(401)).toEqual({ usable: false, reason: "key rejected" });
    expect(verdictFromStatus(403)).toEqual({ usable: false, reason: "key rejected" });
    expect(verdictFromStatus(429)).toEqual({ usable: false, reason: "over quota" });
  });

  it("keeps a provider usable on success or a server-side blip", () => {
    // A 500 at the provider says nothing about this account's credit.
    expect(verdictFromStatus(200).usable).toBe(true);
    expect(verdictFromStatus(500).usable).toBe(true);
    expect(verdictFromStatus(503).usable).toBe(true);
  });
});

describe("verdictFromDeepSeekBalance", () => {
  it("reads an exhausted balance that arrives with HTTP 200", () => {
    expect(verdictFromDeepSeekBalance({ is_available: false })).toEqual({
      usable: false,
      reason: "out of credit"
    });
    expect(verdictFromDeepSeekBalance({ is_available: true }).usable).toBe(true);
    expect(verdictFromDeepSeekBalance(null).usable).toBe(true);
  });
});

describe("probeLlmProvider", () => {
  it("reports no key without calling out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(probeLlmProvider("openai")).resolves.toEqual({
      usable: false,
      reason: "no API key"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("greys out an account with no credit", async () => {
    setKey("OPENAI_API_KEY", "sk-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 402 }));

    await expect(probeLlmProvider("openai")).resolves.toEqual({
      usable: false,
      reason: "out of credit"
    });
  });

  it("greys out DeepSeek on a zero balance even though the call succeeds", async () => {
    setKey("DEEPSEEK_API_KEY", "sk-ds-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ is_available: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(probeLlmProvider("deepseek")).resolves.toEqual({
      usable: false,
      reason: "out of credit"
    });
  });

  it("keeps a provider usable when the probe itself fails", async () => {
    setKey("OPENAI_API_KEY", "sk-test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(probeLlmProvider("openai")).resolves.toEqual({ usable: true, reason: null });
  });

  it("caches so opening the builder repeatedly does not hammer the API", async () => {
    setKey("OPENAI_API_KEY", "sk-test");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    await probeLlmProvider("openai");
    await probeLlmProvider("openai");
    await probeLlmProvider("openai");

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A forced probe bypasses the cache — used after a top-up.
    await probeLlmProvider("openai", { force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("evidence from a real run outranks the probe", () => {
  it("keeps OpenAI greyed out after a 429, even though /v1/models answers 200", async () => {
    setKey("OPENAI_API_KEY", "sk-test");
    recordLlmProviderFailure(
      "openai",
      "429 You exceeded your current quota, please check your plan and billing details."
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

    await expect(llmProviderAvailability("openai")).resolves.toEqual({
      usable: false,
      reason: "over quota"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes generation for OpenAI, since a models list cannot see quota", async () => {
    setKey("OPENAI_API_KEY", "sk-test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));

    await expect(probeLlmProvider("openai")).resolves.toEqual({
      usable: false,
      reason: "over quota"
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/chat/completions");
    expect(init.method).toBe("POST");
  });

  it("re-enables once a real run succeeds", async () => {
    setKey("OPENAI_API_KEY", "sk-test");
    recordLlmProviderFailure("openai", "429 quota exceeded");
    recordLlmProviderSuccess("openai");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

    await expect(llmProviderAvailability("openai")).resolves.toEqual({ usable: true, reason: null });
  });
});
