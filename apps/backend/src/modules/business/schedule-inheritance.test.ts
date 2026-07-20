import { describe, expect, it } from "vitest";
import {
  checkExactTime,
  computeDayAvailability,
  effectiveScheduleDayHours,
  resolveAppointmentSchedule
} from "./scheduling";

/**
 * Appointment-schedule inheritance: "Use Business Hours" derives days LIVE
 * from the structured Business Hours (edits propagate), custom schedules are
 * preserved untouched, and special-date closures reach availability only when
 * inheriting.
 */

const TZ = "UTC";

// Mirrored legacy rows exactly as toStoredHoursJson writes them.
const HOURS_JSON = [
  { day: "monday", closed: false, open: "08:00", close: "18:00", periods: [{ open: "08:00", close: "18:00" }] },
  { day: "tuesday", closed: false, open: "08:00", close: "18:00", periods: [{ open: "08:00", close: "18:00" }] },
  { day: "saturday", closed: false, open: "10:00", close: "14:00", periods: [{ open: "10:00", close: "14:00" }] }
];

const CUSTOM_DAYS = {
  monday: { open: "11:00", close: "15:00", closed: false },
  tuesday: { open: "11:00", close: "15:00", closed: false },
  sunday: { open: "11:00", close: "15:00", closed: true }
};

describe("resolveAppointmentSchedule inheritance", () => {
  it("useBusinessHours=true derives days from Business Hours even when custom days are stored", () => {
    const schedule = resolveAppointmentSchedule({
      configJson: { appointmentSchedule: { useBusinessHours: true, days: CUSTOM_DAYS } },
      hoursJson: HOURS_JSON,
      timeZone: TZ
    });

    expect(schedule.source).toBe("business_hours");
    expect(schedule.useBusinessHours).toBe(true);
    expect(schedule.days.monday).toEqual({ open: "08:00", close: "18:00", closed: false });
    expect(schedule.days.saturday).toEqual({ open: "10:00", close: "14:00", closed: false });
    // Days the business never listed are closed.
    expect(schedule.days.sunday.closed).toBe(true);
  });

  it("Business Hours edits propagate to an inherited schedule automatically", () => {
    const config = { appointmentSchedule: { useBusinessHours: true, days: CUSTOM_DAYS } };
    const before = resolveAppointmentSchedule({ configJson: config, hoursJson: HOURS_JSON, timeZone: TZ });
    const after = resolveAppointmentSchedule({
      configJson: config,
      hoursJson: [{ day: "monday", closed: false, open: "07:30", close: "12:00" }],
      timeZone: TZ
    });

    expect(before.days.monday.open).toBe("08:00");
    expect(after.days.monday).toEqual({ open: "07:30", close: "12:00", closed: false });
    expect(after.days.tuesday.closed).toBe(true);
  });

  it("custom schedules (useBusinessHours=false) ignore Business Hours edits entirely", () => {
    const config = { appointmentSchedule: { useBusinessHours: false, days: CUSTOM_DAYS } };
    const schedule = resolveAppointmentSchedule({ configJson: config, hoursJson: HOURS_JSON, timeZone: TZ });
    const afterHoursChange = resolveAppointmentSchedule({
      configJson: config,
      hoursJson: [{ day: "monday", closed: false, open: "07:30", close: "12:00" }],
      timeZone: TZ
    });

    expect(schedule.source).toBe("configured");
    expect(schedule.useBusinessHours).toBe(false);
    expect(schedule.days.monday).toEqual({ open: "11:00", close: "15:00", closed: false });
    expect(afterHoursChange.days.monday).toEqual({ open: "11:00", close: "15:00", closed: false });
  });

  it("legacy configs without the flag keep their stored days exactly as before", () => {
    const schedule = resolveAppointmentSchedule({
      configJson: { appointmentSchedule: { days: CUSTOM_DAYS } },
      hoursJson: HOURS_JSON,
      timeZone: TZ
    });

    expect(schedule.source).toBe("configured");
    expect(schedule.useBusinessHours).toBe(false);
    expect(schedule.days.monday.open).toBe("11:00");
  });

  it("no custom days at all inherits Business Hours (useBusinessHours=true)", () => {
    const schedule = resolveAppointmentSchedule({ configJson: {}, hoursJson: HOURS_JSON, timeZone: TZ });
    expect(schedule.source).toBe("business_hours");
    expect(schedule.useBusinessHours).toBe(true);
  });
});

describe("special-date overrides in availability", () => {
  const NOW = new Date("2099-06-01T00:00:00Z");
  // 2099-06-08 is a Monday.
  const MONDAY = "2099-06-08";

  function inheritedSchedule() {
    const schedule = resolveAppointmentSchedule({
      configJson: { appointmentSchedule: { useBusinessHours: true, maxAdvanceDays: 365 } },
      hoursJson: HOURS_JSON,
      timeZone: TZ
    });
    return schedule;
  }

  it("a holiday closure closes the whole day for availability and exact-time checks", () => {
    const schedule = inheritedSchedule();
    schedule.specialDates = [{ date: MONDAY, closed: true }];

    expect(effectiveScheduleDayHours(schedule, MONDAY).closed).toBe(true);

    const day = computeDayAvailability({ schedule, date: MONDAY, busy: [], now: NOW });
    expect(day.closed).toBe(true);
    expect(day.allSlots).toHaveLength(0);

    const verdict = checkExactTime({ schedule, date: MONDAY, hour: 10, minute: 0, busy: [], now: NOW });
    expect(verdict.verdict).toBe("closed_day");
  });

  it("special shortened hours override the weekly pattern for that date only", () => {
    const schedule = inheritedSchedule();
    schedule.specialDates = [{ date: MONDAY, closed: false, open: "10:00", close: "12:00" }];

    expect(effectiveScheduleDayHours(schedule, MONDAY)).toEqual({ open: "10:00", close: "12:00", closed: false });
    // A normal Monday elsewhere keeps the weekly 08:00 opening.
    expect(effectiveScheduleDayHours(schedule, "2099-06-15")).toEqual({
      open: "08:00",
      close: "18:00",
      closed: false
    });

    const verdict = checkExactTime({ schedule, date: MONDAY, hour: 8, minute: 30, busy: [], now: NOW });
    expect(verdict.verdict).toBe("outside_hours");
  });

  it("schedules without specialDates behave exactly as before", () => {
    const schedule = inheritedSchedule();
    const verdict = checkExactTime({ schedule, date: MONDAY, hour: 10, minute: 0, busy: [], now: NOW });
    expect(verdict.verdict).toBe("available");
  });
});
