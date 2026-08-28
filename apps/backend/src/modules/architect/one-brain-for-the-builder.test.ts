import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE EMPLOYEE, ONE BRAIN (2026-08-28).
 *
 * The admin screen carries a Builder Brain slot, and it chose the MODEL
 * only — the SERVICE was hardcoded to Mistral in both doors of
 * platform-brain.ts. So the Builder ran on two brains at once: compose and
 * repair on whatever the admin picked, chat and explain always on Mistral.
 *
 * The founder set the Builder to Claude and watched the chat keep answering
 * from somewhere else; then set it to OpenAI and watched the same thing. An
 * admin switch that controls half of a thing is worse than no switch, because
 * it is believed.
 */

const { resolveMock, keyMock, engineMock, brainConfigMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  keyMock: vi.fn(),
  engineMock: vi.fn(),
  brainConfigMock: vi.fn()
}));

vi.mock("../ai-provider-engine/llm-credentials", () => ({
  resolveConfiguredLlmProvider: resolveMock,
  llmProviderApiKey: keyMock
}));

vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: engineMock })
}));

vi.mock("../admin/builder-brain-settings", () => ({
  getBuilderBrainConfig: brainConfigMock,
  getBuilderEyesConfig: vi.fn(async () => null),
  serviceCanSee: vi.fn(() => false)
}));

import { askPlatformBrain, streamPlatformBrain } from "./platform-brain";

beforeEach(() => {
  resolveMock.mockReset();
  keyMock.mockReset().mockReturnValue("test-key");
  engineMock.mockReset().mockResolvedValue({ status: "success", text: "answered" });
  brainConfigMock.mockReset();
});

describe("the whole Builder obeys the admin's choice", () => {
  it("asks the service the admin picked, not a hardcoded one", async () => {
    brainConfigMock.mockResolvedValue({ providerId: "openai", modelId: "gpt-4.1-mini" });
    resolveMock.mockImplementation((id: string) =>
      id === "openai" ? { providerId: "openai" } : null
    );

    await askPlatformBrain({ instruction: "x", message: "y", maxTokens: 50, task: "t" });

    expect(engineMock).toHaveBeenCalledTimes(1);
    expect(engineMock.mock.calls[0][0]).toBe("openai");
    expect(engineMock.mock.calls[0][1].model).toBe("gpt-4.1-mini");
  });

  it("the streaming door obeys it too — the chat is the same employee", async () => {
    brainConfigMock.mockResolvedValue({ providerId: "openai", modelId: "gpt-4.1-mini" });
    resolveMock.mockImplementation((id: string) =>
      id === "openai" ? { providerId: "openai" } : null
    );

    const heard: string[] = [];
    await streamPlatformBrain({
      instruction: "x",
      message: "y",
      maxTokens: 50,
      task: "t",
      onWord: (chunk) => heard.push(chunk)
    });

    /* Only Mistral speaks the streaming shape, so a non-Mistral choice must
       reach the SAME service through the waited-for path — never fall back to
       Mistral behind the admin's back. */
    expect(engineMock).toHaveBeenCalledTimes(1);
    expect(engineMock.mock.calls[0][0]).toBe("openai");
    expect(heard.join("")).toBe("answered");
  });

  it("falls back honestly when the admin's service has no key", async () => {
    brainConfigMock.mockResolvedValue({ providerId: "openai", modelId: "gpt-4.1-mini" });
    resolveMock.mockImplementation((id: string) =>
      id === "mistral" ? { providerId: "mistral" } : null
    );

    await askPlatformBrain({ instruction: "x", message: "y", maxTokens: 50, task: "t" });

    /* A missing key is a reason to degrade, never a reason to go silent. */
    expect(engineMock.mock.calls[0][0]).toBe("mistral");
  });
});
