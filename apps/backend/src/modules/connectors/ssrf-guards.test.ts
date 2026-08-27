import { describe, expect, it } from "vitest";
import { checkRecipeUrl } from "./recipe-heart";

/**
 * THE SPELLINGS OF OUR OWN NETWORK (found by the platform audit, 2026-08-27).
 *
 * The blocklist matched hostname strings, and a URL can spell a private
 * address several ways that never look like the patterns: Node normalises
 * "https://[::ffff:127.0.0.1]/" to "[::ffff:7f00:1]", and "2130706433" and
 * "0x7f000001" are both 127.0.0.1. Our own database was one clever spelling
 * away from an architect's connector. A blocklist that knows one spelling is
 * not a blocklist.
 */
describe("what a connector may never reach", () => {
  const mustRefuse = [
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://[::ffff:127.0.0.1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://2130706433/x",
    "https://0x7f000001/x",
    "https://10.0.0.5/x",
    "https://192.168.1.10/x",
    "https://172.17.0.2/x",
    "https://169.254.169.254/latest/meta-data",
    "https://postgres.internal/x",
    "https://redis.local/x",
    "https://[fe80::1]/x",
    "https://[fd00::1]/x"
  ];

  for (const url of mustRefuse) {
    it(`refuses ${url}`, () => {
      expect(checkRecipeUrl(url), url).toBeTruthy();
    });
  }

  it("still allows an ordinary service on the internet", () => {
    expect(checkRecipeUrl("https://api.stripe.com/v1/charges")).toBeNull();
    expect(checkRecipeUrl("https://api.open-meteo.com/v1/forecast")).toBeNull();
  });

  it("refuses anything that is not https — a key must never travel in the clear", () => {
    expect(checkRecipeUrl("http://api.example.com/x")).toBeTruthy();
  });
});
