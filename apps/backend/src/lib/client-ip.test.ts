import { describe, it, expect } from "vitest";
import { getClientIp } from "./client-ip";

/**
 * Every free limit on this platform is keyed on the caller's identity, so a
 * caller who can choose their own identity has no limit at all. Two separate
 * routes each trusted a header the client sets, which bought unlimited free AI
 * runs and unlimited demo phone calls. These lock the fix in.
 */
const request = (headers: Record<string, string>) =>
  ({ req: { header: (name: string) => headers[name.toLowerCase()] } }) as never;

describe("who is actually calling", () => {
  it("trusts x-real-ip, which our nginx replaces on every request", () => {
    expect(getClientIp(request({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("ignores cf-connecting-ip — we are not behind Cloudflare, so anyone can set it", () => {
    expect(
      getClientIp(request({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "203.0.113.9" }))
    ).toBe("203.0.113.9");
  });

  it("takes the RIGHTMOST forwarded hop, the one our proxy appended", () => {
    // nginx uses $proxy_add_x_forwarded_for, which appends the real address to
    // whatever the caller already sent — so the leftmost entry is the
    // attacker's invention.
    expect(getClientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("rejects junk rather than turning it into a rate-limit key", () => {
    expect(getClientIp(request({ "x-real-ip": "not-an-address; rm -rf /" }))).toBe("unknown");
  });

  it("says unknown rather than inventing a default", () => {
    // A fabricated 127.0.0.1 would put every caller in the same bucket while
    // looking like a real address. "unknown" is one visible shared bucket.
    expect(getClientIp(request({}))).toBe("unknown");
  });
});
