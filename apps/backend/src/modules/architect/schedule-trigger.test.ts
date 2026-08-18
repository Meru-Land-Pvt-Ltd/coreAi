import { describe, expect, it } from "vitest";
import { computeNextRunAt, scheduleNodesOf } from "./schedule-trigger";

/**
 * The clock's arithmetic — the part that must never drift.
 *
 * A schedule is a promise in the business's own wall-clock ("every day at 9"),
 * so every case here is checked in a real zone, including the two days a year
 * that break naive "+24 hours" maths.
 */

/** What the given instant reads as on a wall clock in that zone. */
function wallClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function weekdayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
}

describe("computeNextRunAt", () => {
  it("daily lands on the asked-for wall clock time, in the business's zone", () => {
    const next = computeNextRunAt(
      { cadence: "daily", hourLocal: 9, minuteLocal: 0, weekdayLocal: null, timeZone: "Asia/Kolkata" },
      new Date("2026-08-18T02:00:00Z")
    );
    expect(wallClock(next, "Asia/Kolkata")).toBe("09:00");
    expect(next.getTime()).toBeGreaterThan(new Date("2026-08-18T02:00:00Z").getTime());
  });

  it("moves to tomorrow when today's slot has already passed", () => {
    // 09:30 IST on the 18th is 04:00 UTC; asking at 05:00 UTC must give the 19th.
    const next = computeNextRunAt(
      { cadence: "daily", hourLocal: 9, minuteLocal: 30, weekdayLocal: null, timeZone: "Asia/Kolkata" },
      new Date("2026-08-18T05:00:00Z")
    );
    expect(wallClock(next, "Asia/Kolkata")).toBe("09:30");
    expect(next.toISOString().slice(0, 10)).toBe("2026-08-19");
  });

  it("holds the wall clock across a daylight-saving change (New York, spring)", () => {
    // 8 March 2026 is the US spring-forward. A naive +24h would return 10:00.
    const next = computeNextRunAt(
      { cadence: "daily", hourLocal: 9, minuteLocal: 0, weekdayLocal: null, timeZone: "America/New_York" },
      new Date("2026-03-07T15:00:00Z")
    );
    expect(wallClock(next, "America/New_York")).toBe("09:00");
  });

  it("weekly lands on the asked-for weekday at the asked-for time", () => {
    const next = computeNextRunAt(
      { cadence: "weekly", hourLocal: 8, minuteLocal: 15, weekdayLocal: 1, timeZone: "Asia/Kolkata" },
      new Date("2026-08-18T02:00:00Z")
    );
    expect(weekdayIn(next, "Asia/Kolkata")).toBe("Mon");
    expect(wallClock(next, "Asia/Kolkata")).toBe("08:15");
  });

  it("hourly keeps a one-hour floor — a tighter clock would burn money unwatched", () => {
    const from = new Date("2026-08-18T02:10:30Z");
    const next = computeNextRunAt(
      { cadence: "hourly", hourLocal: 0, minuteLocal: 0, weekdayLocal: null, timeZone: "Asia/Kolkata" },
      from
    );
    expect(next.getTime() - from.getTime()).toBeGreaterThanOrEqual(59 * 60_000);
    expect(next.getTime() - from.getTime()).toBeLessThanOrEqual(61 * 60_000);
  });

  it("never returns a time in the past, whatever it is asked", () => {
    const now = new Date("2026-12-31T18:45:00Z");
    for (const cadence of ["hourly", "daily", "weekly"] as const) {
      const next = computeNextRunAt(
        { cadence, hourLocal: 23, minuteLocal: 59, weekdayLocal: 6, timeZone: "Asia/Kolkata" },
        now
      );
      expect(next.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("survives nonsense config instead of spinning", () => {
    const now = new Date("2026-08-18T02:00:00Z");
    const next = computeNextRunAt(
      // hour 99 / weekday 42 / unknown zone — all clamped, never hung.
      { cadence: "weekly", hourLocal: 99, minuteLocal: -5, weekdayLocal: 42, timeZone: "Not/AZone" },
      now
    );
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("scheduleNodesOf", () => {
  const graph = {
    nodes: [
      { id: "n1", data: { type: "trigger.schedule", cadence: "weekly", hour: 8, minute: 30, weekday: 3 } },
      { id: "n2", data: { type: "ai.llm_call" } },
      { id: "n3", data: { type: "trigger.schedule" } }
    ],
    edges: []
  };

  it("finds every schedule node and reads its dial settings", () => {
    const found = scheduleNodesOf(graph);
    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({
      nodeId: "n1",
      cadence: "weekly",
      hourLocal: 8,
      minuteLocal: 30,
      weekdayLocal: 3
    });
  });

  it("gives an unconfigured schedule node a sane daily default", () => {
    const found = scheduleNodesOf(graph);
    expect(found[1]).toEqual({
      nodeId: "n3",
      cadence: "daily",
      hourLocal: 9,
      minuteLocal: 0,
      weekdayLocal: null
    });
  });

  it("returns nothing for a graph with no timer", () => {
    expect(scheduleNodesOf({ nodes: [{ id: "a", data: { type: "trigger.manual" } }], edges: [] })).toEqual([]);
  });
});
