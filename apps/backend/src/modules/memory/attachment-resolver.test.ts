import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * AN ADDRESS FROM A STRANGER IS NOT A PLACE WE GO (2026-08-27).
 *
 * A public agent page takes an attachment from any visitor, and it arrives
 * here as a string. Fetching it as written let a stranger point our server at
 * anything the server can reach and they cannot — our own database, another
 * container, the cloud's metadata service — and then read the answer back in
 * the model's reply. Every other outbound fetch on this platform already went
 * through the address check. This one did not.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode("picture bytes").buffer,
    headers: { get: () => "image/png" }
  });
});

import { resolveAttachment } from "./attachment-resolver";

const PRIVATE_ADDRESSES = [
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "http://127.0.0.1:5432/",
  "http://localhost/admin",
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://[::1]/",
  "http://0.0.0.0/"
];

describe("an attachment address that points inside", () => {
  for (const address of PRIVATE_ADDRESSES) {
    it(`is never fetched: ${address}`, async () => {
      const result = await resolveAttachment({ data: address, mimeType: "image/png" });

      expect(fetchMock, address).not.toHaveBeenCalled();
      /* It fails quietly and hands back what it was given — one bad
         attachment must not take the whole answer down with it. */
      expect(result.data).toBe(address);
    });
  }

  it("is refused whatever port it names", async () => {
    await resolveAttachment({ data: "http://127.0.0.1:9200/_cluster/health", mimeType: "image/png" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot be reached through a scheme that is not the web", async () => {
    await resolveAttachment({ data: "http://example.com:22/", mimeType: "image/png" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("an ordinary picture on the internet", () => {
  it("is still fetched, and never by following a redirect", async () => {
    const result = await resolveAttachment({
      data: "https://example.com/logo.png",
      mimeType: "image/png"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://example.com/logo.png");
    /* A permitted address is free to redirect to a forbidden one, and the
       check only ever saw the first hop. */
    expect((options as { redirect?: string }).redirect).toBe("manual");
    expect(result.data).not.toBe("https://example.com/logo.png");
  });
});
