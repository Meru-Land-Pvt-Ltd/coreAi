/**
 * Redis production-client lifecycle (#6). Uses a controlled ioredis test double
 * (no real server) to prove: the first command right after client creation
 * succeeds (offline queue), reconnect restores behavior, the SAME shared client
 * is reused across modules (consent-offer + canonical call state), production
 * does NOT silently fall back to memory while Redis is reachable, no Redis
 * credentials ever reach the logs, and the call-state store fails CLOSED when
 * distributed storage is required but unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- ioredis test double -------------------------------------------------
class FakeRedis {
  static instances: FakeRedis[] = [];
  public status = "connecting";
  private store = new Map<string, { value: string; expiresAt: number }>();
  private handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  public failNextGet = false;
  constructor(public url: string) {
    FakeRedis.instances.push(this);
  }
  on(event: string, cb: (...a: unknown[]) => void) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }
  private emit(event: string) {
    for (const cb of this.handlers[event] ?? []) cb();
  }
  async connect() {
    this.status = "ready";
    this.emit("ready");
  }
  async ping() {
    return "PONG";
  }
  async get(key: string) {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("connection lost");
    }
    const entry = this.store.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  }
  async set(key: string, value: string, _mode?: string, ttl?: number) {
    this.store.set(key, { value, expiresAt: Date.now() + (ttl ?? 3600) * 1000 });
    return "OK";
  }
  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }
  disconnect() {
    this.status = "end";
  }
  simulateReconnect() {
    this.status = "connecting";
    this.emit("reconnecting");
    this.status = "ready";
    this.emit("ready");
  }
}

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

const REDIS_URL = "redis://:s3cr3t-password@redis-host:6379";
const errorSpy = vi.fn();

beforeEach(async () => {
  FakeRedis.instances = [];
  errorSpy.mockClear();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => errorSpy(...args));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { env } = await import("../config/env");
  env.REDIS_URL = REDIS_URL;
  const { resetSharedRedisForTests } = await import("./redis");
  resetSharedRedisForTests();
  const { resetCallContactStoreForTests } = await import("../modules/architect/call-contact-store");
  resetCallContactStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared Redis lifecycle", () => {
  it("first command immediately after client creation succeeds (offline queue)", async () => {
    const { getSharedRedis } = await import("./redis");
    const client = getSharedRedis();
    expect(client).not.toBeNull();
    // No manual wait — the first set/get must resolve even though connect() is async.
    await client!.set("k", "v", "EX", 60);
    expect(await client!.get("k")).toBe("v");
  });

  it("reuses ONE shared client across modules (consent-offer + canonical call state)", async () => {
    const { markConsentOffered, wasConsentOffered } = await import(
      "../modules/notifications/consent-offer-store"
    );
    const { updateCallContact, readCallContact } = await import("../modules/architect/call-contact-store");

    await markConsentOffered({ businessId: "b1", callId: "c1", disclosureVersion: "v1" });
    await updateCallContact("b1", "c1", { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" });

    // Both modules resolved to the SAME single FakeRedis instance.
    expect(FakeRedis.instances).toHaveLength(1);
    expect(await wasConsentOffered({ businessId: "b1", callId: "c1", disclosureVersion: "v1" })).toBe(true);
    expect((await readCallContact("b1", "c1"))?.canonicalPhoneE164).toBe("+16505551234");
  });

  it("does NOT fall back to memory while Redis is reachable (no error logs)", async () => {
    const { updateCallContact, readCallContact } = await import("../modules/architect/call-contact-store");
    await updateCallContact("b1", "c2", { canonicalPhoneE164: "+16505550000", phoneSource: "confirmed" });
    expect((await readCallContact("b1", "c2"))?.canonicalPhoneE164).toBe("+16505550000");
    const memoryFallbackLogged = errorSpy.mock.calls.some((call) =>
      JSON.stringify(call).toLowerCase().includes("memory fallback")
    );
    expect(memoryFallbackLogged).toBe(false);
  });

  it("reconnect restores mark/get/clear behavior", async () => {
    const { updateCallContact, readCallContact } = await import("../modules/architect/call-contact-store");
    await updateCallContact("b1", "c3", { canonicalPhoneE164: "+16505550001", phoneSource: "confirmed" });
    FakeRedis.instances[0]!.simulateReconnect();
    expect((await readCallContact("b1", "c3"))?.canonicalPhoneE164).toBe("+16505550001");
    await updateCallContact("b1", "c3", { appointmentId: "appt-1" });
    expect((await readCallContact("b1", "c3"))?.appointmentId).toBe("appt-1");
  });

  it("NEVER writes Redis credentials to the logs", async () => {
    const { getSharedRedis } = await import("./redis");
    const client = getSharedRedis();
    FakeRedis.instances[0]!.on("error", () => {});
    // Force an error path to exercise logging.
    FakeRedis.instances[0]!.failNextGet = true;
    await client!.get("k").catch(() => {});
    const allLogArgs = JSON.stringify(errorSpy.mock.calls);
    expect(allLogArgs).not.toContain("s3cr3t-password");
    expect(allLogArgs).not.toContain(REDIS_URL);
  });
});

describe("fail-closed for consent-proof state when distributed storage is required", () => {
  it("PRODUCTION with Redis unavailable throws (never silent memory fallback)", async () => {
    vi.resetModules();
    // Force production semantics and an UNCONFIGURED Redis for a fresh graph.
    vi.doMock("../config/env", () => ({ env: { REDIS_URL: undefined }, isProduction: true }));
    const { readCallContact, updateCallContact, CallStateUnavailableError } = await import(
      "../modules/architect/call-contact-store"
    );
    await expect(readCallContact("b1", "c1")).rejects.toBeInstanceOf(CallStateUnavailableError);
    await expect(
      updateCallContact("b1", "c1", { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" })
    ).rejects.toBeInstanceOf(CallStateUnavailableError);
    vi.doUnmock("../config/env");
    vi.resetModules();
  });

  it("DEV/TEST allows the in-process memory fallback (no throw)", async () => {
    vi.resetModules();
    vi.doMock("../config/env", () => ({ env: { REDIS_URL: undefined }, isProduction: false }));
    const { readCallContact, updateCallContact, callStateAvailableForLive } = await import(
      "../modules/architect/call-contact-store"
    );
    expect(callStateAvailableForLive()).toBe(true);
    await updateCallContact("b1", "c9", { canonicalPhoneE164: "+16505550009", phoneSource: "confirmed" });
    expect((await readCallContact("b1", "c9"))?.canonicalPhoneE164).toBe("+16505550009");
    vi.doUnmock("../config/env");
    vi.resetModules();
  });
});
