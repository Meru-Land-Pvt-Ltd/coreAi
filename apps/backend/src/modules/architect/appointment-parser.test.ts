import { describe, expect, it } from "vitest";
import { parseRequestedAppointment } from "./appointment-parser";

describe("parsed appointment wall-time parts (slot-lock key)", () => {
  it("exposes the same date/hour/minute the lock and calendar write use", () => {
    const parsed = parseRequestedAppointment("book me monday 3pm", "America/New_York");
    expect(parsed).not.toBeNull();
    expect(parsed!.hour).toBe(15);
    expect(parsed!.minute).toBe(0);
    expect(parsed!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The UTC instant re-rendered in the business zone matches the wall parts.
    const backInZone = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23"
    }).format(parsed!.startAt);
    expect(Number(backInZone)).toBe(15);
  });

  it("requires both a date and a time before treating a text as a booking", () => {
    expect(parseRequestedAppointment("book me at 3pm", "America/New_York")).toBeNull();
    expect(parseRequestedAppointment("book me monday", "America/New_York")).toBeNull();
  });
});
