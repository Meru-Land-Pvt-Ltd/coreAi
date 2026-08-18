import { API_CALL_MAX_PER_RUN, API_CALL_NODE_TYPE } from "@coreai/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SSRF-hardened fetch and the secret locker so this is a true unit
// test of the API Call node runtime — no network, no database.
vi.mock("../../lib/safe-fetch", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/safe-fetch")>();
  return { ...actual, safeFetch: vi.fn() };
});
vi.mock("./architect-secrets", () => ({
  getArchitectSecretValue: vi.fn(),
  getPlatformYouTubeKey: vi.fn()
}));

import { safeFetch, type SafeFetchResult, SafeFetchError } from "../../lib/safe-fetch";
import { getArchitectSecretValue, getPlatformYouTubeKey } from "./architect-secrets";
import { executeApiCallNode, type WorkflowRunLog } from "./workflow-runner";

const mockSafeFetch = vi.mocked(safeFetch);
const mockGetSecret = vi.mocked(getArchitectSecretValue);
const mockGetYouTube = vi.mocked(getPlatformYouTubeKey);

function okJson(body: unknown): SafeFetchResult {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    url: "https://api.example.com/",
    bodyText: text,
    bytesRead: text.length
  };
}

function makeNode(data: Record<string, unknown>) {
  return { id: "api-1", data: { type: API_CALL_NODE_TYPE, ...data } };
}

async function run(node: ReturnType<typeof makeNode>, context: Record<string, unknown>) {
  const logs: WorkflowRunLog[] = [];
  // Cast: executeApiCallNode takes the runner's internal node/context types,
  // which are structurally compatible with these plain test objects.
  await executeApiCallNode({ userId: "arch-1", node: node as never, context: context as never, logs });
  return logs;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API Call node runtime", () => {
  it("resolves a templated URL, injects the platform YouTube key as a query param, and stores parsed JSON", async () => {
    mockGetYouTube.mockReturnValue("YT_KEY_123");
    mockSafeFetch.mockResolvedValue(
      okJson({ items: [{ statistics: { subscriberCount: "42" } }] })
    );

    const context: Record<string, unknown> = { handle: "@MrBeast" };
    const logs = await run(
      makeNode({
        apiMethod: "GET",
        apiUrl: "https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle={{handle}}",
        apiKeySource: "platform_youtube",
        apiKeyInjection: "query",
        apiKeyParam: "key",
        apiOutputKey: "api.response"
      }),
      context
    );

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = mockSafeFetch.mock.calls[0];
    // Template resolved and the key was injected as ?key=...
    expect(calledUrl).toContain("forHandle=%40MrBeast");
    expect(calledUrl).toContain("key=YT_KEY_123");
    expect((calledOpts as { method?: string }).method).toBe("GET");

    // Structured value nested for deep refs; string mirror at the literal key
    // so a downstream AI Brain reading {{api.response}} gets usable text.
    expect((context.api as { response?: unknown }).response).toEqual({
      items: [{ statistics: { subscriberCount: "42" } }]
    });
    expect(typeof context["api.response"]).toBe("string");
    expect(String(context["api.response"])).toContain("subscriberCount");

    expect(logs.at(-1)?.status).toBe("success");
    // The key must never appear in the run log message.
    expect(logs.map((l) => l.message).join("\n")).not.toContain("YT_KEY_123");
  });

  it("injects a My Key as a header with a value prefix", async () => {
    mockGetSecret.mockResolvedValue("sk-abc");
    mockSafeFetch.mockResolvedValue(okJson({ ok: true }));

    await run(
      makeNode({
        apiMethod: "GET",
        apiUrl: "https://api.openai.com/v1/models",
        apiKeySource: "my_key",
        apiKeyName: "openai",
        apiKeyInjection: "header",
        apiKeyParam: "Authorization",
        apiKeyPrefix: "Bearer "
      }),
      {}
    );

    expect(mockGetSecret).toHaveBeenCalledWith("arch-1", "openai");
    const opts = mockSafeFetch.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(opts.headers?.Authorization).toBe("Bearer sk-abc");
  });

  it("sends a JSON body on POST and defaults the content-type header", async () => {
    mockSafeFetch.mockResolvedValue(okJson({ created: true }));

    await run(
      makeNode({
        apiMethod: "POST",
        apiUrl: "https://api.example.com/things",
        apiBody: '{"name":"{{who}}"}',
        apiKeySource: "none"
      }),
      { who: "Ada" }
    );

    const opts = mockSafeFetch.mock.calls[0][1] as {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    };
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe('{"name":"Ada"}');
    expect(opts.headers?.["Content-Type"]).toBe("application/json");
  });

  it("enforces the per-run cap of 5 executions on the shared context", async () => {
    mockGetYouTube.mockReturnValue("YT_KEY");
    mockSafeFetch.mockResolvedValue(okJson({ ok: true }));

    const context: Record<string, unknown> = {};
    const node = makeNode({
      apiUrl: "https://api.example.com/data",
      apiKeySource: "platform_youtube",
      apiKeyInjection: "query",
      apiKeyParam: "key"
    });

    // Six executions against the SAME context object.
    let lastLogs: WorkflowRunLog[] = [];
    for (let i = 0; i < API_CALL_MAX_PER_RUN + 1; i += 1) {
      lastLogs = await run(node, context);
    }

    // The 6th never reaches the network.
    expect(mockSafeFetch).toHaveBeenCalledTimes(API_CALL_MAX_PER_RUN);
    expect(lastLogs.at(-1)?.status).toBe("error");
    expect(String(context["api.response_error"])).toContain(String(API_CALL_MAX_PER_RUN));
  });

  it("fails gracefully (never throws) when safeFetch blocks the request", async () => {
    mockSafeFetch.mockRejectedValue(new SafeFetchError("BLOCKED_HOST", "blocked private ip"));

    const context: Record<string, unknown> = {};
    const logs = await run(
      makeNode({ apiUrl: "http://169.254.169.254/latest/meta-data", apiKeySource: "none" }),
      context
    );

    expect(logs.at(-1)?.status).toBe("error");
    expect(String(context["api.response_error"])).toContain("isn't allowed");
    // No successful data stored.
    expect(context["api.response"]).toBeUndefined();
  });

  it("records a missing-URL error without calling the network", async () => {
    const context: Record<string, unknown> = {};
    const logs = await run(makeNode({ apiUrl: "   ", apiKeySource: "none" }), context);

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(logs.at(-1)?.status).toBe("error");
    expect(String(context["api.response_error"])).toContain("URL");
  });

  it("surfaces a non-2xx reply as an error while still saving the body", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "application/json" },
      url: "https://api.example.com/",
      bodyText: '{"error":"nope"}',
      bytesRead: 15
    });

    const context: Record<string, unknown> = {};
    const logs = await run(
      makeNode({ apiUrl: "https://api.example.com/missing", apiKeySource: "none" }),
      context
    );

    expect(logs.at(-1)?.status).toBe("error");
    expect(String(context["api.response_error"])).toContain("404");
    // Body still available for the AI Brain to inspect.
    expect((context.api as { response?: unknown }).response).toEqual({ error: "nope" });
  });

  it("never pollutes a prototype through a hostile output key", async () => {
    mockSafeFetch.mockResolvedValue(okJson({ hijacked: true }));

    const context: Record<string, unknown> = {};
    await run(
      makeNode({
        apiUrl: "https://api.example.com/data",
        apiKeySource: "none",
        // A malicious free-typed output key that tries to reach the prototype.
        apiOutputKey: "__proto__.polluted"
      }),
      context
    );

    // The global prototype is untouched: no leaked property on a fresh object.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("errors clearly when a named My Key is missing", async () => {
    mockGetSecret.mockResolvedValue(null);

    const context: Record<string, unknown> = {};
    const logs = await run(
      makeNode({
        apiUrl: "https://api.example.com/data",
        apiKeySource: "my_key",
        apiKeyName: "ghost"
      }),
      context
    );

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(logs.at(-1)?.status).toBe("error");
    expect(String(context["api.response_error"])).toContain("ghost");
  });
});
