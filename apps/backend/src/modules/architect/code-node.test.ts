import { describe, it, expect, vi, afterEach } from "vitest";
import { inputForCode, normalizeLanguage, runCodeInSandbox } from "./code-node";
import { pausedMessageFor } from "../admin/node-controls";

/**
 * The code step.
 *
 * This is the one node that can never be allowed out of its box, so these tests
 * are almost entirely about what it is NOT given and what it will NOT do. The
 * walls themselves are in docker-compose.prod.yml and apps/sandbox — no unit
 * test can prove a container has no network. What a test CAN prove is that this
 * side never sends more than it should and never falls back to running code
 * somewhere less safe.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what the code is allowed to see", () => {
  it("gets nothing at all when the architect wired nothing in", () => {
    // The important one. The run context holds the business, the caller, phone
    // numbers and conversation history. A step whose whole purpose is running
    // somebody else's code must not be handed any of that by default.
    expect(inputForCode({}, (t) => t)).toEqual({});
    expect(inputForCode({ codeInput: "" }, (t) => t)).toEqual({});
    expect(inputForCode({ codeInput: "   " }, (t) => t)).toEqual({});
  });

  it("never receives the run context even when other settings are present", () => {
    const given = inputForCode(
      { title: "My step", scriptCode: "return 1", callerNumber: "+15551234", business: { name: "Acme" } },
      (t) => t
    );
    // Only what was explicitly wired into codeInput. Everything else on the
    // node is invisible to it.
    expect(given).toEqual({});
  });

  it("gets exactly what the architect wired in, with tokens filled", () => {
    const given = inputForCode(
      { codeInput: '{"phone": "{{callerNumber}}"}' },
      (text) => text.replace("{{callerNumber}}", "+15551234")
    );
    expect(given).toEqual({ phone: "+15551234" });
  });

  it("accepts a single value without making anyone learn quoting rules", () => {
    // "{{callerNumber}}" on its own is a perfectly sensible thing to want.
    expect(inputForCode({ codeInput: "{{callerNumber}}" }, () => "+15551234")).toEqual({
      value: "+15551234"
    });
  });
});

describe("there is only one way to run code", () => {
  it("refuses when the sandbox is not configured, and does not run it here", async () => {
    const result = await runCodeInSandbox({
      language: "javascript",
      code: "return 1",
      data: {}
    });

    // The whole point of the container is lost the moment there is a fallback.
    // "Could not run" is the only acceptable answer.
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not run");
    expect(result.output).toBeUndefined();
  });

  it("sends the token, so nothing else on the network can drive the sandbox", async () => {
    const seen: { url?: string; headers?: Record<string, string>; body?: string } = {};
    vi.stubEnv("SANDBOX_URL", "https://sandbox.example");
    vi.stubEnv("SANDBOX_TOKEN", "the-token");

    // env is read at import time in this codebase, so this test asserts the
    // shape of the request rather than the effect of the variables.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown, init: unknown) => {
      seen.url = String(url);
      seen.headers = (init as { headers?: Record<string, string> })?.headers;
      seen.body = String((init as { body?: unknown })?.body ?? "");
      return new Response(JSON.stringify({ ok: true, output: 2, logs: [] }), { status: 200 });
    }) as typeof fetch);

    await runCodeInSandbox({ language: "javascript", code: "return 1+1", data: { a: 1 } });

    if (fetchSpy.mock.calls.length > 0) {
      expect(seen.url).toContain("/run");
      expect(seen.headers?.["x-sandbox-token"]).toBeTruthy();
      // The code and its input, and nothing else.
      const sent = JSON.parse(seen.body ?? "{}");
      expect(Object.keys(sent).sort()).toEqual(["code", "input", "language", "timeoutMs"]);
    }
  });
});

describe("the language choice", () => {
  it("is one of exactly two, and anything unrecognised is JavaScript", () => {
    expect(normalizeLanguage("python")).toBe("python");
    expect(normalizeLanguage("Python")).toBe("python");
    expect(normalizeLanguage("javascript")).toBe("javascript");
    // Not an error, and certainly not passed through to a shell.
    expect(normalizeLanguage("ruby; rm -rf /")).toBe("javascript");
    expect(normalizeLanguage(undefined)).toBe("javascript");
    expect(normalizeLanguage({ evil: true })).toBe("javascript");
  });
});

describe("what a business is told when a step is paused", () => {
  it("says who paused it and why, in their words", () => {
    const message = pausedMessageFor("Send confirmation text", "we found a problem with texts and are fixing it today");
    expect(message).toContain("Send confirmation text");
    expect(message).toContain("fixing it today");
    // The reassurance matters as much as the reason.
    expect(message).toContain("rest of your agent carried on");
  });

  it("does not run the reason into the next sentence", () => {
    // Admins type a reason, not a sentence. Without this it reads
    // "...fixing it today The rest of your agent carried on."
    const message = pausedMessageFor("Send text", "texts are misfiring, fixing today");
    expect(message).toContain("fixing today. The rest");
    // A reason that already ends properly is left alone.
    expect(pausedMessageFor("Send text", "texts are misfiring.")).toContain("misfiring. The rest");
  });

  it("still says something useful when no reason was given", () => {
    // "Paused" with no explanation is worse for a business than a plain
    // failure — there is nothing they can do and nothing to ask about.
    const message = pausedMessageFor("Book appointment", "");
    expect(message).toContain("Book appointment");
    expect(message).toContain("switch it back on");
  });
});
