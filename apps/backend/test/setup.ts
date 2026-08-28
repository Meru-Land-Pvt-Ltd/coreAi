// Load the backend .env first (real DATABASE_URL for integration tests), then
// fill anything still missing with dummies so src/config/env.ts parses.
// SES always stays in dry-run here — no AWS call is ever made from tests.
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-24-chars";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "test-encryption-key-24-chars!";
process.env.SES_DRY_RUN = "true";
// Tests never talk to Redis — email jobs dispatch inline.
process.env.REDIS_URL = "";

/**
 * NO TEST SPENDS THE FOUNDER'S MONEY.
 *
 * This file loads the real .env, which carries real provider keys. A test
 * whose mock path is one character wrong runs the REAL module, and the real
 * module calls a real API on a real card. That happened on 2026-08-28: two
 * test cases with a mistyped mock path reached a live LLM. The bill was
 * pennies; the principle is not. His credit is his, and no test of mine gets
 * to decide otherwise.
 *
 * Everything outside this machine is refused, by name, with the address that
 * was attempted — so a broken mock fails loudly in one second instead of
 * quietly costing money. A test that means to exercise a network path stubs
 * fetch itself, which replaces this and is the honest way to say so.
 */
const realFetch = globalThis.fetch;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

globalThis.fetch = (async (input: any, init?: any) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof input?.url === "string"
          ? input.url
          : "";

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }

  if (host && !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[test] refused to call ${host} — tests never reach the outside world. ` +
        `Mock the module that makes this call. (attempted: ${url.slice(0, 200)})`
    );
  }

  return realFetch(input, init);
}) as typeof fetch;
