import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE FALLBACK ANSWER NOBODY HEARD (2026-08-28).
 *
 * streamPlatformBrain promises words through `onWord`. Three of its four
 * exits do not stream — a brain that is not Mistral, eyes on another
 * service, a refused stream — and each of those only RETURNED the answer.
 * The Builder's own judge listens to `onWord` and nothing else, so on every
 * provider but one it heard silence, tried to parse an empty string, and
 * reported that it could not read its own verdict. The Builder's eyes could
 * never work off Mistral.
 */

const { resolveMock, keyMock, engineMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  keyMock: vi.fn(),
  engineMock: vi.fn()
}));

vi.mock("../ai-provider-engine/llm-credentials", () => ({
  resolveConfiguredLlmProvider: resolveMock,
  llmProviderApiKey: keyMock
}));

vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: engineMock })
}));

vi.mock("../admin/builder-brain-settings", () => ({
  getBuilderBrainConfig: vi.fn(async () => null),
  getBuilderEyesConfig: vi.fn(async () => null),
  serviceCanSee: vi.fn(() => false)
}));

import { streamPlatformBrain } from "./platform-brain";

beforeEach(() => {
  resolveMock.mockReset();
  keyMock.mockReset();
  engineMock.mockReset();
});

describe("the streaming brain keeps its promise", () => {
  it("says the waited-for answer out loud when the brain does not stream", async () => {
    /* Not Mistral, so this is the waited-for path — the one the Builder's
       judge could never hear. */
    resolveMock.mockReturnValue({ providerId: "openai", model: "gpt-test" });
    keyMock.mockReturnValue("test-key");
    engineMock.mockResolvedValue({
      status: "success",
      text: '{"works": true, "problems": []}'
    });

    const heard: string[] = [];
    const returned = await streamPlatformBrain({
      instruction: "judge",
      message: "look at this",
      maxTokens: 100,
      task: "test-fallback",
      onWord: (chunk) => heard.push(chunk)
    });

    expect(engineMock).toHaveBeenCalled();
    expect(returned).toBe('{"works": true, "problems": []}');
    /* The caller that listens only to onWord must hear the same answer the
       return value carries. This is the whole finding. */
    expect(heard.join("")).toBe('{"works": true, "problems": []}');
  });

  it("says nothing when there is no configured brain at all", async () => {
    resolveMock.mockReturnValue(null);

    const heard: string[] = [];
    const returned = await streamPlatformBrain({
      instruction: "judge",
      message: "look at this",
      maxTokens: 100,
      task: "test-no-brain",
      onWord: (chunk) => heard.push(chunk)
    });

    expect(returned).toBeNull();
    expect(heard).toEqual([]);
  });
});
