import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeUrl, htmlToText, urlSourceAdapter } from "./url-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertSafeUrl (SSRF guard)", () => {
  it("allows normal public http(s) URLs, including explicit :443", () => {
    expect(assertSafeUrl("https://example.com/pricing").hostname).toBe("example.com");
    expect(assertSafeUrl("http://example.com").hostname).toBe("example.com");
    expect(assertSafeUrl("https://example.com:443/x").hostname).toBe("example.com");
    // Boundary check: 172.15.* and 172.32.* are PUBLIC space.
    expect(assertSafeUrl("http://172.15.0.1/").hostname).toBe("172.15.0.1");
    expect(assertSafeUrl("http://172.32.0.1/").hostname).toBe("172.32.0.1");
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of ["ftp://example.com/x", "file:///etc/passwd", "gopher://example.com"]) {
      expect(() => assertSafeUrl(url)).toThrowError(
        expect.objectContaining({ code: "URL_UNSUPPORTED_SCHEME" })
      );
    }
  });

  it("rejects loopback, private, and link-local hostnames", () => {
    const blocked = [
      "http://localhost/admin",
      "http://foo.localhost/",
      "http://127.0.0.1/",
      "http://127.9.9.9/",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://internal.service.local/",
      "http://db.company.internal/"
    ];
    for (const url of blocked) {
      expect(() => assertSafeUrl(url), url).toThrowError(
        expect.objectContaining({ code: "URL_PRIVATE_ADDRESS" })
      );
    }
  });

  it("rejects non-standard ports", () => {
    expect(() => assertSafeUrl("http://example.com:8080/")).toThrowError(
      expect.objectContaining({ code: "URL_BLOCKED_PORT" })
    );
  });
});

describe("htmlToText", () => {
  it("strips scripts/styles/tags and keeps block-element line breaks", () => {
    const html = `
      <html><head><title>Acme Dental</title><style>body{color:red}</style></head>
      <body>
        <script>alert("evil")</script>
        <h1>Our Services</h1>
        <p>Cleaning &amp; polishing from &#36;80.</p>
        <ul><li>Whitening</li><li>Implants</li></ul>
      </body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("<");
    expect(text).toContain("Our Services");
    expect(text).toContain("Cleaning & polishing from $80.");
    // Block elements became separate lines, not one run-on line.
    expect(text).toMatch(/Whitening\n+Implants/);
  });
});

describe("urlSourceAdapter.fetchContent", () => {
  it("fetches an HTML page and returns extracted text with a title-based filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><head><title>Acme Pricing</title></head><body><p>Cleaning $100</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await urlSourceAdapter.fetchContent({ url: "https://example.com/pricing" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("Cleaning $100");
    expect(result.filename).toBe("Acme Pricing.txt");
    expect(result.mimeType).toBe("text/plain");
  });

  it("rejects unsupported content types with 415", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
      )
    );

    await expect(
      urlSourceAdapter.fetchContent({ url: "https://example.com/api" })
    ).rejects.toMatchObject({ status: 415, code: "URL_UNSUPPORTED_CONTENT_TYPE" });
  });

  it("rejects pages whose declared content-length exceeds the 2 MB cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x", {
          status: 200,
          headers: { "content-type": "text/html", "content-length": String(3 * 1024 * 1024) }
        })
      )
    );

    await expect(
      urlSourceAdapter.fetchContent({ url: "https://example.com/huge" })
    ).rejects.toMatchObject({ status: 413, code: "URL_TOO_LARGE" });
  });

  it("re-validates every redirect hop — a redirect into private space is blocked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      urlSourceAdapter.fetchContent({ url: "https://example.com/redirects" })
    ).rejects.toMatchObject({ code: "URL_PRIVATE_ADDRESS" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
