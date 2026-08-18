/**
 * SSRF guard tests. No real network and no real DNS are ever touched — both the
 * fetch and the DNS lookup are injected seams. Every dangerous target
 * (localhost, loopback, RFC-1918 private ranges, link-local incl. the cloud
 * metadata IP, IPv6 loopback/ULA, IPv4-mapped IPv6, a public hostname that
 * RESOLVES to a private IP, an http->internal redirect, an oversize body, a bad
 * scheme, a bad port) is proven rejected; a normal public https GET is proven
 * to pass through with no ambient credentials added.
 */
import { describe, it, expect, vi } from "vitest";
import {
  safeFetch,
  assertUrlSafe,
  isBlockedIp,
  SafeFetchError,
  type DnsLookupAll,
  type FetchLike
} from "./safe-fetch";

/** DNS seam that always resolves to a single public IPv4 (example.com). */
const publicLookup: DnsLookupAll = async () => [{ address: "93.184.216.34", family: 4 }];

/** A fetch seam that must never be called (used to prove pre-flight rejects). */
const explodingFetch: FetchLike = () => {
  throw new Error("fetch must not be called after a guard rejection");
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A body stream with NO content-length, to exercise the streaming cap path. */
function streamingResponse(chunkSizes: number[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunkSizes) controller.enqueue(new Uint8Array(size));
      controller.close();
    }
  });
  return new Response(stream, { status });
}

/* -------------------------------------------------------------------------- */
/*                              isBlockedIp matrix                            */
/* -------------------------------------------------------------------------- */

describe("isBlockedIp", () => {
  const blocked = [
    "0.0.0.0",
    "127.0.0.1",
    "127.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    "169.254.0.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "192.0.2.1", // TEST-NET-1
    "198.51.100.1", // TEST-NET-2
    "203.0.113.1", // TEST-NET-3
    "224.0.0.1", // multicast
    "255.255.255.255", // broadcast
    "::1", // IPv6 loopback
    "::", // IPv6 unspecified
    "fd00::1", // ULA (fc00::/7)
    "fc00::1",
    "fe80::1", // link-local
    "ff02::1", // multicast
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    "64:ff9b::10.0.0.1", // NAT64 over private
    "not-an-ip"
  ];
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.0.1", // just below the private /12
    "172.32.0.1", // just above the private /12
    "11.0.0.1",
    "2606:4700:4700::1111", // public IPv6 (Cloudflare)
    "::ffff:8.8.8.8" // IPv4-mapped public
  ];

  for (const ip of blocked) {
    it(`blocks ${ip}`, () => {
      expect(isBlockedIp(ip)).toBe(true);
    });
  }
  for (const ip of allowed) {
    it(`allows ${ip}`, () => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  }
});

/* -------------------------------------------------------------------------- */
/*                          assertUrlSafe rejections                         */
/* -------------------------------------------------------------------------- */

describe("assertUrlSafe rejects", () => {
  const codeOf = async (url: string, lookup: DnsLookupAll = publicLookup) => {
    try {
      await assertUrlSafe(url, lookup);
      return "NO_ERROR";
    } catch (e) {
      return e instanceof SafeFetchError ? e.code : "WRONG_ERROR";
    }
  };

  it("rejects non-http(s) schemes", async () => {
    expect(await codeOf("ftp://example.com/")).toBe("BLOCKED_SCHEME");
    expect(await codeOf("file:///etc/passwd")).toBe("BLOCKED_SCHEME");
    expect(await codeOf("gopher://example.com/")).toBe("BLOCKED_SCHEME");
  });

  it("rejects non-standard ports", async () => {
    expect(await codeOf("http://example.com:22/")).toBe("BLOCKED_PORT");
    expect(await codeOf("http://example.com:8080/")).toBe("BLOCKED_PORT");
    expect(await codeOf("http://example.com:6379/")).toBe("BLOCKED_PORT");
  });

  it("rejects localhost and internal hostnames without resolving them", async () => {
    const lookup = vi.fn<DnsLookupAll>();
    expect(await codeOf("http://localhost/", lookup)).toBe("BLOCKED_HOST");
    expect(await codeOf("http://foo.localhost/", lookup)).toBe("BLOCKED_HOST");
    expect(await codeOf("http://db.internal/", lookup)).toBe("BLOCKED_HOST");
    expect(await codeOf("http://printer.local/", lookup)).toBe("BLOCKED_HOST");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects literal private/loopback/link-local IPv4", async () => {
    expect(await codeOf("http://127.0.0.1/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://10.0.0.5/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://172.16.9.9/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://192.168.1.1/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://169.254.169.254/latest/meta-data/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://0.0.0.0/")).toBe("BLOCKED_HOST");
  });

  it("rejects literal private/loopback IPv6 (incl. IPv4-mapped)", async () => {
    expect(await codeOf("http://[::1]/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://[fd00::1]/")).toBe("BLOCKED_HOST");
    expect(await codeOf("http://[::ffff:127.0.0.1]/")).toBe("BLOCKED_HOST");
  });

  it("rejects a public hostname that RESOLVES to a private IP (DNS-rebind pre-check)", async () => {
    // The URL host looks public, but DNS points it at the metadata service.
    // Pre-resolution catches it; see the module's note on the residual TOCTOU
    // window that name-pinning would be required to fully close.
    const rebindLookup: DnsLookupAll = async () => [{ address: "169.254.169.254", family: 4 }];
    expect(await codeOf("https://totally-legit.example/", rebindLookup)).toBe("BLOCKED_HOST");
  });

  it("rejects when ANY resolved address is private (mixed answers)", async () => {
    const mixedLookup: DnsLookupAll = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.2.3", family: 4 }
    ];
    expect(await codeOf("https://mixed.example/", mixedLookup)).toBe("BLOCKED_HOST");
  });

  it("rejects when DNS returns nothing", async () => {
    const emptyLookup: DnsLookupAll = async () => [];
    expect(await codeOf("https://ghost.example/", emptyLookup)).toBe("DNS_ERROR");
  });

  it("rejects an unparseable URL", async () => {
    expect(await codeOf("not a url")).toBe("INVALID_URL");
  });
});

/* -------------------------------------------------------------------------- */
/*                           assertUrlSafe allowances                        */
/* -------------------------------------------------------------------------- */

describe("assertUrlSafe allows", () => {
  it("allows a normal public https hostname", async () => {
    const url = await assertUrlSafe("https://api.example.com/v1/data?q=1", publicLookup);
    expect(url.hostname).toBe("api.example.com");
  });

  it("allows a public literal IP without a DNS lookup", async () => {
    const lookup = vi.fn<DnsLookupAll>();
    const url = await assertUrlSafe("https://8.8.8.8/", lookup);
    expect(url.hostname).toBe("8.8.8.8");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("allows addresses just outside the private 172.16/12 block", async () => {
    await expect(assertUrlSafe("http://172.15.0.1/")).resolves.toBeInstanceOf(URL);
    await expect(assertUrlSafe("http://172.32.0.1/")).resolves.toBeInstanceOf(URL);
  });
});

/* -------------------------------------------------------------------------- */
/*                                 safeFetch                                  */
/* -------------------------------------------------------------------------- */

describe("safeFetch", () => {
  it("returns a parsed result for a public https GET and adds NO ambient credentials", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ ok: true, n: 42 }));
    const result = await safeFetch("https://api.example.com/stats", {
      headers: { accept: "application/json" },
      lookup: publicLookup,
      fetchImpl
    });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.bodyText)).toEqual({ ok: true, n: 42 });
    expect(result.headers["content-type"]).toContain("application/json");

    // Exactly the headers we passed — nothing from the environment injected.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1];
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ accept: "application/json" });
    expect(init.redirect).toBe("manual");
  });

  it("passes method, headers and body through unchanged (key injection is the caller's job)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ created: true }, 201));
    const result = await safeFetch("https://api.example.com/items", {
      method: "POST",
      headers: { authorization: "Bearer architect-supplied-key", "content-type": "application/json" },
      body: JSON.stringify({ title: "hi" }),
      lookup: publicLookup,
      fetchImpl
    });

    expect(result.status).toBe(201);
    const init = fetchImpl.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "hi" }));
    expect(init.headers).toEqual({
      authorization: "Bearer architect-supplied-key",
      "content-type": "application/json"
    });
  });

  it("rejects a bad scheme before any fetch is attempted", async () => {
    await expect(
      safeFetch("file:///etc/passwd", { lookup: publicLookup, fetchImpl: explodingFetch })
    ).rejects.toMatchObject({ code: "BLOCKED_SCHEME" });
  });

  it("rejects a bad port before any fetch is attempted", async () => {
    await expect(
      safeFetch("http://example.com:22/", { lookup: publicLookup, fetchImpl: explodingFetch })
    ).rejects.toMatchObject({ code: "BLOCKED_PORT" });
  });

  it("rejects a redirect to an internal address (re-validates each hop)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      redirectResponse("http://169.254.169.254/latest/meta-data/")
    );
    await expect(
      safeFetch("https://api.example.com/go", { lookup: publicLookup, fetchImpl })
    ).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    // The internal hop is never actually fetched: first call = original URL only.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect between two public hosts", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url === "https://api.example.com/go") return redirectResponse("https://cdn.example.net/final");
      return jsonResponse({ landed: url });
    });
    const result = await safeFetch("https://api.example.com/go", { lookup: publicLookup, fetchImpl });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.bodyText)).toEqual({ landed: "https://cdn.example.net/final" });
    expect(result.url).toBe("https://cdn.example.net/final");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("strips credentials when a redirect crosses to a different origin", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      seen.push(init.headers);
      if (url === "https://api.example.com/go") {
        return redirectResponse("https://evil.example.net/steal");
      }
      return jsonResponse({ ok: true });
    });

    await safeFetch("https://api.example.com/go", {
      headers: {
        authorization: "Bearer architect-secret",
        "x-api-key": "architect-secret",
        accept: "application/json"
      },
      sensitiveHeaders: ["x-api-key"],
      lookup: publicLookup,
      fetchImpl
    });

    // First hop (same origin as the request) still carries the credentials.
    expect(seen[0]).toMatchObject({
      authorization: "Bearer architect-secret",
      "x-api-key": "architect-secret"
    });
    // Second hop (cross-origin) has BOTH the default and the named credential
    // stripped, but keeps the non-sensitive header.
    expect(seen[1]?.authorization).toBeUndefined();
    expect(seen[1]?.["x-api-key"]).toBeUndefined();
    expect(seen[1]?.accept).toBe("application/json");
  });

  it("keeps credentials across a SAME-origin redirect", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      seen.push(init.headers);
      if (url === "https://api.example.com/go") {
        return redirectResponse("https://api.example.com/final");
      }
      return jsonResponse({ ok: true });
    });

    await safeFetch("https://api.example.com/go", {
      headers: { authorization: "Bearer architect-secret" },
      lookup: publicLookup,
      fetchImpl
    });

    expect(seen[1]?.authorization).toBe("Bearer architect-secret");
  });

  it("cancels a redirect response body instead of buffering it (no cap bypass)", async () => {
    let canceled = false;
    const streamingRedirect = () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Would stream forever if fully read; cancel() is the only way out.
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          canceled = true;
        }
      });
      return new Response(stream, {
        status: 302,
        headers: { location: "https://cdn.example.net/final" }
      });
    };
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url === "https://api.example.com/go") return streamingRedirect();
      return jsonResponse({ ok: true });
    });

    const result = await safeFetch("https://api.example.com/go", {
      lookup: publicLookup,
      fetchImpl
    });
    expect(result.ok).toBe(true);
    expect(canceled).toBe(true);
  });

  it("rejects after too many redirects", async () => {
    let n = 0;
    const fetchImpl = vi.fn<FetchLike>(async () => {
      n += 1;
      return redirectResponse(`https://hop-${n}.example.com/`);
    });
    await expect(
      safeFetch("https://start.example.com/", { lookup: publicLookup, fetchImpl, maxRedirects: 3 })
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("rejects an oversize response declared by content-length", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        new Response("small", {
          status: 200,
          headers: { "content-length": String(5 * 1024 * 1024) }
        })
    );
    await expect(
      safeFetch("https://api.example.com/big", { lookup: publicLookup, fetchImpl })
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rejects an oversize streamed response (no content-length, stream-abort)", async () => {
    // 3 x 1 MB = 3 MB streamed with no declared length → cap trips mid-stream.
    const fetchImpl = vi.fn<FetchLike>(async () =>
      streamingResponse([1024 * 1024, 1024 * 1024, 1024 * 1024])
    );
    await expect(
      safeFetch("https://api.example.com/stream", {
        lookup: publicLookup,
        fetchImpl,
        maxBytes: 2 * 1024 * 1024
      })
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("allows a streamed response under the cap", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => streamingResponse([1000, 2000, 3000]));
    const result = await safeFetch("https://api.example.com/ok", {
      lookup: publicLookup,
      fetchImpl,
      maxBytes: 2 * 1024 * 1024
    });
    expect(result.bytesRead).toBe(6000);
  });

  it("maps a timeout/abort to a TIMEOUT error", async () => {
    const hangingFetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    await expect(
      safeFetch("https://slow.example.com/", { lookup: publicLookup, fetchImpl: hangingFetch, timeoutMs: 20 })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps a transport failure to a NETWORK_ERROR", async () => {
    const failingFetch: FetchLike = async () => {
      throw new TypeError("connection refused");
    };
    await expect(
      safeFetch("https://api.example.com/", { lookup: publicLookup, fetchImpl: failingFetch })
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("surfaces a non-2xx status without throwing", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: "nope" }, 404));
    const result = await safeFetch("https://api.example.com/missing", { lookup: publicLookup, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(JSON.parse(result.bodyText)).toEqual({ error: "nope" });
  });
});
