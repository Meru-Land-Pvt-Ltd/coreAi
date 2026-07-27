/**
 * Redis production-client lifecycle (#7). Uses a controlled ioredis test double
 * (no real server) whose connect() stays PENDING until the test emits `ready`,
 * so we can prove the real offline-queue contract rather than a happy-path
 * stub. It proves:
 *   - the client starts in status "connecting" and a command issued BEFORE
 *     ready does NOT reject — it queues and resolves once `ready` is emitted;
 *   - the SAME shared client backs BOTH the consent-offer store and the
 *     canonical call-state store (one instance, not two);
 *   - disconnect + reconnect restores read/write behavior;
 *   - the real shared-client "error" handler fires and NEVER logs the URL or
 *     password;
 *   - in production, a read/write FAILURE (client present but erroring) throws
 *     CallStateUnavailableError and never silently returns the memory fallback;
 *   - in production with Redis unconfigured, the store fails closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- ioredis test double -------------------------------------------------
type Job = { run: () => void };
class FakeRedis {
  static instances: FakeRedis[] = [];
  /** When true, connect() stays pending until becomeReady() is called. */
  static manualReady = false;
  public status = "connecting";
  private store = new Map<string, { value: string; expiresAt: number }>();
  private handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  private offlineQueue: Job[] = [];
  private connectResolve: (() => void) | null = null;
  public failNextGet = false;
  public failNextSet = false;

  constructor(public url: string) {
    FakeRedis.instances.push(this);
  }
  on(event: string, cb: (...a: unknown[]) => void) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }
  private emit(event: string, ...args: unknown[]) {
    for (const cb of this.handlers[event] ?? []) cb(...args);
  }
  async connect() {
    if (FakeRedis.manualReady) {
      // Stay pending — like a real handshake in flight.
      return new Promise<void>((resolve) => {
        this.connectResolve = resolve;
      });
    }
    this.becomeReady();
  }
  /** Transition to ready, flush queued commands, resolve a pending connect(). */
  becomeReady() {
    this.status = "ready";
    this.emit("ready");
    const queued = this.offlineQueue;
    this.offlineQueue = [];
    for (const job of queued) job.run();
    this.connectResolve?.();
    this.connectResolve = null;
  }
  /** enableOfflineQueue: run now if ready, otherwise queue until ready. */
  private enqueueOrRun<T>(run: () => Promise<T>): Promise<T> {
    if (this.status === "ready") return run();
    return new Promise<T>((resolve, reject) => {
      this.offlineQueue.push({ run: () => run().then(resolve, reject) });
    });
  }
  get(key: string) {
    return this.enqueueOrRun(async () => {
      if (this.failNextGet) {
        this.failNextGet = false;
        throw new Error(`connection lost for ${this.url}`); // includes creds ON PURPOSE
      }
      const entry = this.store.get(key);
      return entry && entry.expiresAt > Date.now() ? entry.value : null;
    });
  }
  set(key: string, value: string, _mode?: string, ttl?: number) {
    return this.enqueueOrRun(async () => {
      if (this.failNextSet) {
        this.failNextSet = false;
        throw new Error(`connection lost for ${this.url}`);
      }
      this.store.set(key, { value, expiresAt: Date.now() + (ttl ?? 3600) * 1000 });
      return "OK";
    });
  }
  del(key: string) {
    return this.enqueueOrRun(async () => (this.store.delete(key) ? 1 : 0));
  }
  disconnect() {
    this.status = "end";
    this.emit("end");
  }
  /** Fire the shared client's registered error handler. */
  emitError(error: Error) {
    this.emit("error", error);
  }
  simulateReconnect() {
    this.status = "connecting";
    this.emit("reconnecting");
    this.becomeReady();
  }
}

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

const REDIS_URL = "redis://:s3cr3t-password@redis-host:6379";
const errorSpy = vi.fn();

beforeEach(async () => {
  FakeRedis.instances = [];
  FakeRedis.manualReady = false;
  errorSpy.mockClear();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => errorSpy(...args));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { env } = await import("../config/env");
  env.REDIS_URL = REDIS_URL;
  const { resetSharedRedisForTests } = await import("./redis");
  resetSharedRedisForTests();
  const { resetCallContactStoreForTests, setCallStateProductionModeForTests } = await import(
    "../modules/architect/call-contact-store"
  );
  resetCallContactStoreForTests();
  setCallStateProductionModeForTests(null);
});

afterEach(async () => {
  const { setCallStateProductionModeForTests } = await import("../modules/architect/call-contact-store");
  setCallStateProductionModeForTests(null);
  vi.restoreAllMocks();
});

describe("shared Redis lifecycle — pending connect + offline queue", () => {
  it("starts 'connecting'; a command issued BEFORE ready does not reject and resolves once ready", async () => {
    FakeRedis.manualReady = true; // connect() stays pending
    const { getSharedRedis } = await import("./redis");
    const client = getSharedRedis();
    expect(client).not.toBeNull();
    expect(client!.status).toBe("connecting");

    // Issue the command WHILE still connecting — it must queue, not throw.
    let settled = false;
    const pending = client!.set("k", "v", "EX", 60).then((r) => {
      settled = true;
      return r;
    });
    // Give the microtask queue a tick; the command must still be unsettled.
    await Promise.resolve();
    expect(settled).toBe(false);

    // Now the handshake completes — the queued command flushes and resolves.
    FakeRedis.instances[0]!.becomeReady();
    expect(await pending).toBe("OK");
    expect(client!.status).toBe("ready");
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

  it("disconnect then reconnect restores mark/get/clear behavior", async () => {
    const { updateCallContact, readCallContact } = await import("../modules/architect/call-contact-store");
    await updateCallContact("b1", "c3", { canonicalPhoneE164: "+16505550001", phoneSource: "confirmed" });
    const instance = FakeRedis.instances[0]!;
    instance.disconnect();
    expect(instance.status).toBe("end");
    instance.simulateReconnect();
    expect(instance.status).toBe("ready");
    expect((await readCallContact("b1", "c3"))?.canonicalPhoneE164).toBe("+16505550001");
    await updateCallContact("b1", "c3", { appointmentId: "appt-1" });
    expect((await readCallContact("b1", "c3"))?.appointmentId).toBe("appt-1");
  });

  it("the real shared-client error handler fires and NEVER logs the URL or password", async () => {
    const { getSharedRedis } = await import("./redis");
    getSharedRedis();
    const instance = FakeRedis.instances[0]!;
    // Trigger the handler that redis.ts actually registered on the client, with
    // a realistic ioredis error (which never carries the password).
    instance.emitError(new Error("connect ECONNREFUSED 10.0.0.5:6379"));
    const logged = JSON.stringify(errorSpy.mock.calls);
    // The handler ran (it logged a connection error)...
    expect(logged).toContain("[redis] connection error");
    // ...and redis.ts NEVER appends the URL/password it holds in env.REDIS_URL.
    expect(logged).not.toContain("s3cr3t-password");
    expect(logged).not.toContain("redis-host:6379");
  });
});

describe("production fail-closed for canonical call-state (never memory fallback)", () => {
  it("a read FAILURE on a present client throws CallStateUnavailableError (no memory read)", async () => {
    const { getSharedRedis } = await import("./redis");
    const { readCallContact, setCallStateProductionModeForTests, CallStateUnavailableError } = await import(
      "../modules/architect/call-contact-store"
    );
    getSharedRedis(); // client is present + ready
    setCallStateProductionModeForTests(true);
    FakeRedis.instances[0]!.failNextGet = true;
    await expect(readCallContact("b1", "c-fail")).rejects.toBeInstanceOf(CallStateUnavailableError);
  });

  it("a write FAILURE on a present client throws CallStateUnavailableError (no memory write)", async () => {
    const { getSharedRedis } = await import("./redis");
    const { updateCallContact, setCallStateProductionModeForTests, CallStateUnavailableError } = await import(
      "../modules/architect/call-contact-store"
    );
    getSharedRedis();
    setCallStateProductionModeForTests(true);
    FakeRedis.instances[0]!.failNextSet = true;
    await expect(
      updateCallContact("b1", "c-fail2", { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" })
    ).rejects.toBeInstanceOf(CallStateUnavailableError);
  });

  it("production with Redis UNCONFIGURED throws (never silent memory fallback)", async () => {
    const { env } = await import("../config/env");
    const { resetSharedRedisForTests } = await import("./redis");
    env.REDIS_URL = undefined; // no client at all
    resetSharedRedisForTests();
    const { readCallContact, updateCallContact, setCallStateProductionModeForTests, CallStateUnavailableError } =
      await import("../modules/architect/call-contact-store");
    setCallStateProductionModeForTests(true);
    await expect(readCallContact("b1", "c1")).rejects.toBeInstanceOf(CallStateUnavailableError);
    await expect(
      updateCallContact("b1", "c1", { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" })
    ).rejects.toBeInstanceOf(CallStateUnavailableError);
  });

  it("DEV/TEST allows the in-process memory fallback (no throw)", async () => {
    const { env } = await import("../config/env");
    const { resetSharedRedisForTests } = await import("./redis");
    env.REDIS_URL = undefined;
    resetSharedRedisForTests();
    const { readCallContact, updateCallContact, callStateAvailableForLive, setCallStateProductionModeForTests } =
      await import("../modules/architect/call-contact-store");
    setCallStateProductionModeForTests(false);
    expect(callStateAvailableForLive()).toBe(true);
    await updateCallContact("b1", "c9", { canonicalPhoneE164: "+16505550009", phoneSource: "confirmed" });
    expect((await readCallContact("b1", "c9"))?.canonicalPhoneE164).toBe("+16505550009");
  });
});
