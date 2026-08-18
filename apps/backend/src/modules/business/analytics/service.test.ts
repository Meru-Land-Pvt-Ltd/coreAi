import { describe, expect, it } from "vitest";
import {
  defaultAnalyticsPeriod,
  outcomeLabel,
  parseAnalyticsPeriod,
  resolveCallOutcome,
  resolveGranularity,
  sentimentLabel
} from "./service";

describe("parseAnalyticsPeriod", () => {
  const now = new Date("2026-08-13T15:30:00.000Z");

  it("defaults to the current month when nothing is supplied", () => {
    const period = parseAnalyticsPeriod(null, null, now);
    expect(period.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(period.to).toEqual(now);
  });

  it("anchors a bare date to the whole UTC day so a single-day range is not empty", () => {
    const period = parseAnalyticsPeriod("2026-08-13", "2026-08-13", now);
    expect(period.from.toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-08-13T23:59:59.999Z");
  });

  it("accepts exact instants so the caller's local day survives the round trip", () => {
    const period = parseAnalyticsPeriod(
      "2026-08-13T04:00:00.000Z",
      "2026-08-14T03:59:59.999Z",
      now
    );
    expect(period.from.toISOString()).toBe("2026-08-13T04:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-08-14T03:59:59.999Z");
  });

  it("falls back to the current month for garbage or reversed input", () => {
    const fallback = defaultAnalyticsPeriod(now);

    expect(parseAnalyticsPeriod("not-a-date", "2026-08-13", now).from).toEqual(fallback.from);
    // Reversed range would otherwise return zero rows with no explanation.
    expect(parseAnalyticsPeriod("2026-08-13", "2026-08-01", now).from).toEqual(fallback.from);
  });
});

describe("resolveGranularity", () => {
  it("buckets a single day by hour", () => {
    const granularity = resolveGranularity({
      from: new Date("2026-08-13T00:00:00.000Z"),
      to: new Date("2026-08-13T23:59:59.999Z")
    });
    expect(granularity).toBe("hour");
  });

  it("buckets a multi-day range by day", () => {
    const granularity = resolveGranularity({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-13T23:59:59.999Z")
    });
    expect(granularity).toBe("day");
  });
});

describe("resolveCallOutcome", () => {
  it("prefers the stored classifier verdict", () => {
    expect(resolveCallOutcome({ status: "ENDED", outcome: "BOOKED" })).toBe("BOOKED");
    // A MISSED verdict on an ENDED call is exactly the case the transport
    // status alone would get wrong.
    expect(resolveCallOutcome({ status: "ENDED", outcome: "MISSED" })).toBe("MISSED");
  });

  it("falls back to transport status when the call was never classified", () => {
    expect(resolveCallOutcome({ status: "FAILED", outcome: null })).toBe("FAILED");
    expect(resolveCallOutcome({ status: "STARTED", outcome: null })).toBe("IN_PROGRESS");
    expect(resolveCallOutcome({ status: "ENDED", outcome: null })).toBe("UNKNOWN");
  });
});

describe("labels", () => {
  it("maps known keys to buyer-readable text", () => {
    expect(outcomeLabel("BOOKED")).toBe("Appointment booked");
    expect(sentimentLabel("FRUSTRATED")).toBe("Frustrated");
  });

  it("never renders a blank cell", () => {
    expect(outcomeLabel(null)).toBe("Call completed");
    expect(sentimentLabel(null)).toBe("Not classified");
    // Unknown future values pass through rather than disappearing.
    expect(outcomeLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
