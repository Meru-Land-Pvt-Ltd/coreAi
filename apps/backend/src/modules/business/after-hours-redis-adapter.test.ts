/**
 * After-hours call-state store: operational readiness + failure paths through
 * the injectable Redis adapter (no real Redis, no DB).
 *
 * Production must FAIL CLOSED — a missing, connecting, or failing store throws
 * AfterHoursStateStoreUnavailableError and never degrades to per-process
 * memory. Non-production keeps the memory fallback.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AfterHoursLiveCallState } from "@coreai/shared";
import {
  AfterHoursStateStoreUnavailableError,
  afterHoursStateStoreAvailableForLive,
  probeAfterHoursStateStore,
  readAfterHoursCallState,
  resetAfterHoursCallStateStore,
  setAfterHoursProductionModeForTests,
  setAfterHoursRedisAdapterForTests,
  writeAfterHoursCallState,
  type AfterHoursRedisAdapter
} from "./after-hours-call-state";

function liveState(route: AfterHoursLiveCallState["route"] = "STANDARD_BOOKING"): AfterHoursLiveCallState {
  return {
    businessHoursState: "CLOSED",
    route,
    emergencyInstructionStatus: "NOT_REQUIRED",
    staffNotificationStatus: "NOT_REQUESTED",
    redFlags: [],
    policyVersion: "test",
    updatedAt: new Date().toISOString()
  };
}

function fakeAdapter(overrides: Partial<AfterHoursRedisAdapter> = {}): AfterHoursRedisAdapter {
  const store = new Map<string, string>();
  return {
    status: "ready",
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    ping: vi.fn(async () => "PONG"),
    ...overrides
  };
}

afterEach(() => {
  resetAfterHoursCallStateStore();
});

describe("production fail-closed", () => {
  it("store not configured → not available for live; reads throw AfterHoursStateStoreUnavailableError", async () => {
    setAfterHoursRedisAdapterForTests(null);
    setAfterHoursProductionModeForTests(true);

    expect(afterHoursStateStoreAvailableForLive()).toBe(false);
    await expect(readAfterHoursCallState("biz-1", "call-1")).rejects.toBeInstanceOf(
      AfterHoursStateStoreUnavailableError
    );
    await expect(writeAfterHoursCallState("biz-1", "call-1", liveState())).rejects.toBeInstanceOf(
      AfterHoursStateStoreUnavailableError
    );
  });

  it("connection still 'connecting' → available for live via offline queue; health probe reports not-ready", async () => {
    setAfterHoursRedisAdapterForTests(fakeAdapter({ status: "connecting" }));
    setAfterHoursProductionModeForTests(true);

    // A configured store is usable for LIVE even mid-connect — the client's
    // offline queue resolves commands once connected, and a genuine failure
    // fails closed at read/write time. Requiring status==="ready" here wrongly
    // blocked every after-hours call during the normal connection window.
    expect(afterHoursStateStoreAvailableForLive()).toBe(true);

    // The health PROBE is a stricter diagnostic and still reports not-ready.
    const probe = await probeAfterHoursStateStore();
    expect(probe).toMatchObject({
      distributed: true,
      production: true,
      connectionReady: false,
      pingOk: false,
      ready: false,
      safeForLive: false
    });
  });

  it("configured store whose reads SUCCEED while connecting round-trips (offline queue)", async () => {
    // A working client that has not flipped to "ready" must still serve reads
    // and writes — this is the exact production case my earlier strict gate broke.
    setAfterHoursRedisAdapterForTests(fakeAdapter({ status: "connecting" }));
    setAfterHoursProductionModeForTests(true);

    await writeAfterHoursCallState("biz-1", "call-1", liveState("URGENT_DENTAL"));
    const read = await readAfterHoursCallState("biz-1", "call-1");
    expect(read?.route).toBe("URGENT_DENTAL");
  });

  it("ready + PONG → safe for live, and write/read round-trips through the adapter", async () => {
    const adapter = fakeAdapter();
    setAfterHoursRedisAdapterForTests(adapter);
    setAfterHoursProductionModeForTests(true);

    const probe = await probeAfterHoursStateStore();
    expect(probe).toMatchObject({ connectionReady: true, pingOk: true, ready: true, safeForLive: true });
    expect(afterHoursStateStoreAvailableForLive()).toBe(true);

    await writeAfterHoursCallState("biz-1", "call-1", liveState("RED_FLAG_DETECTED"));
    const read = await readAfterHoursCallState("biz-1", "call-1");
    expect(read?.route).toBe("RED_FLAG_DETECTED");
    expect(adapter.set).toHaveBeenCalledTimes(1);
    expect(adapter.get).toHaveBeenCalledTimes(1);
  });

  it("read failure AFTER readiness fails closed — no memory fallback in production", async () => {
    setAfterHoursRedisAdapterForTests(
      fakeAdapter({
        get: vi.fn(async () => {
          throw new Error("connection reset");
        })
      })
    );
    setAfterHoursProductionModeForTests(true);

    await expect(readAfterHoursCallState("biz-1", "call-1")).rejects.toBeInstanceOf(
      AfterHoursStateStoreUnavailableError
    );
  });

  it("write failure AFTER readiness fails closed", async () => {
    setAfterHoursRedisAdapterForTests(
      fakeAdapter({
        set: vi.fn(async () => {
          throw new Error("READONLY You can't write against a read only replica");
        })
      })
    );
    setAfterHoursProductionModeForTests(true);

    await expect(writeAfterHoursCallState("biz-1", "call-1", liveState())).rejects.toBeInstanceOf(
      AfterHoursStateStoreUnavailableError
    );
  });
});

describe("non-production memory fallback", () => {
  it("no store configured outside production → memory fallback still works", async () => {
    setAfterHoursRedisAdapterForTests(null);
    setAfterHoursProductionModeForTests(false);

    expect(afterHoursStateStoreAvailableForLive()).toBe(true);
    await writeAfterHoursCallState("biz-1", "call-1", liveState("URGENT_DENTAL"));
    const read = await readAfterHoursCallState("biz-1", "call-1");
    expect(read?.route).toBe("URGENT_DENTAL");
  });
});
