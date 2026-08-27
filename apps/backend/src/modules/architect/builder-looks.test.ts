import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * THE BUILDER'S OWN EYES, UNDER LAW (2026-08-27).
 *
 * The founder's ruling: the Builder must check its own work the way a person
 * does — open it, look, judge, fix, look again — and only then say done.
 * These pin the parts that would rot silently: the looking room may only see
 * OUR pages, a failure to look is never a silent pass, and the mechanical
 * evidence (a page that threw, a page speaking our jargon, a page that is
 * empty) is judged without a model at all, so it can never be hallucinated
 * away.
 */

const { eyesConfigMock, streamMock } = vi.hoisted(() => ({
  eyesConfigMock: vi.fn(),
  streamMock: vi.fn()
}));

vi.mock("../admin/builder-brain-settings", () => ({
  getBuilderEyesConfig: eyesConfigMock,
  serviceCanSee: (id: string) => ["claude", "openai", "gemini"].includes((id ?? "").toLowerCase())
}));

vi.mock("./platform-brain", () => ({
  streamPlatformBrain: streamMock
}));

vi.mock("../../config/env", () => ({ env: { NODE_ENV: "test" } }));

import { judgeLook, lookAt } from "./builder-looks";

const cleanLook = { image: "data:image/png;base64,AAA", text: "Paste your contract clause here", consoleErrors: [] };

beforeEach(() => {
  vi.clearAllMocks();
  eyesConfigMock.mockResolvedValue({ providerId: "openai", modelId: "gpt-4.1" });
  streamMock.mockImplementation(async (args: { onWord: (chunk: string) => void }) => {
    args.onWord(JSON.stringify({ works: true, problems: [] }));
    return "";
  });
});

describe("the looking room", () => {
  it("asks only for pages on our own frontend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, image: "data:image/png;base64,AAA", text: "hi", consoleErrors: [] })
    });
    vi.stubGlobal("fetch", fetchMock);

    await lookAt({ path: "/a/some-agent" });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/look");
    const body = JSON.parse((options as { body: string }).body);
    /* The room refuses anything that is not our origin; the caller must not
       be able to name an outside address in the first place. */
    expect(body.url).toContain("/a/some-agent");
    expect(body.url.startsWith("http://frontend:3000")).toBe(true);
  });

  it("returns an honest failure instead of a blank picture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ ok: false, error: "The page answered 500." }) })
    );
    const look = await lookAt({ path: "/a/broken" });
    expect("failed" in look).toBe(true);
    expect((look as { failed: string }).failed).toContain("500");
  });

  it("never throws when the room is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const look = await lookAt({ path: "/a/x" });
    expect("failed" in look).toBe(true);
  });
});

describe("the judgement", () => {
  it("fails a page that threw while rendering, with no model needed", async () => {
    eyesConfigMock.mockResolvedValue({ providerId: "mistral", modelId: "" });
    const verdict = await judgeLook({
      ask: "a box to paste a clause",
      look: { ...cleanLook, consoleErrors: ["TypeError: undefined is not a function"] }
    });
    expect(verdict.works).toBe(false);
    expect(verdict.problems[0]).toContain("threw an error");
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("fails a screen that speaks our jargon to a customer", async () => {
    const verdict = await judgeLook({
      ask: "a simple page",
      look: { ...cleanLook, text: "Enter the webhook value to continue" }
    });
    expect(verdict.works).toBe(false);
    expect(verdict.problems.join(" ")).toContain("our own word");
  });

  it("fails a leaked token and an empty page", async () => {
    const leaked = await judgeLook({ ask: "x", look: { ...cleanLook, text: "We reply to {{customer.email}}" } });
    expect(leaked.works).toBe(false);
    const empty = await judgeLook({ ask: "x", look: { ...cleanLook, text: "  " } });
    expect(empty.works).toBe(false);
    expect(empty.problems.join(" ")).toContain("empty");
  });

  it("passes a clean page when the seeing brain agrees", async () => {
    const verdict = await judgeLook({ ask: "a box to paste a clause", look: cleanLook });
    expect(verdict.works).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  it("never passes silently when its own verdict cannot be read", async () => {
    streamMock.mockImplementation(async (args: { onWord: (chunk: string) => void }) => {
      args.onWord("I think it looks quite nice actually");
      return "";
    });
    const verdict = await judgeLook({ ask: "a box", look: cleanLook });
    expect(verdict.works).toBe(false);
    expect(verdict.problems.join(" ")).toContain("look again");
  });

  it("keeps judging mechanically when no seeing brain is switched on", async () => {
    eyesConfigMock.mockResolvedValue({ providerId: "mistral", modelId: "" });
    const clean = await judgeLook({ ask: "x", look: cleanLook });
    expect(clean.works).toBe(true);
    expect(streamMock).not.toHaveBeenCalled();
  });
});
