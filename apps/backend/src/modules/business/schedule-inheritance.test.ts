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

  it("custom Appointment Hours are INDEPENDENT of Business Hours — never clamped to them", () => {
    // Appointment hours are a separate schedule: business Monday 08:00-18:00
    // does not reshape a custom Monday 11:00-15:00.
    const config = { appointmentSchedule: { useBusinessHours: false, days: CUSTOM_DAYS } };
    const schedule = resolveAppointmentSchedule({ configJson: config, hoursJson: HOURS_JSON, timeZone: TZ });
    expect(schedule.source).toBe("configured");
    expect(schedule.useBusinessHours).toBe(false);
    expect(schedule.days.monday).toEqual({ open: "11:00", close: "15:00", closed: false });
    // A weekday the custom schedule never lists is not bookable, even though
    // the business is open then (Saturday 10:00-14:00).
    expect(schedule.days.saturday.closed).toBe(true);
  });

  it("`confirmed` alone does not grant independence — it confirms the booking rules", () => {
    // The setup page's confirm box covers duration/buffer/notice, which apply
    // to BOTH sources. Only the "Use custom Appointment Hours" radio
    // (useBusinessHours: false) makes the days authoritative.
    const config = { appointmentSchedule: { confirmed: true, days: CUSTOM_DAYS } };
    const schedule = resolveAppointmentSchedule({ configJson: config, hoursJson: HOURS_JSON, timeZone: TZ });
    expect(schedule.source).toBe("business_hours");
    expect(schedule.days.saturday).toEqual({ open: "10:00", close: "14:00", closed: false });
  });

  it("custom Appointment Hours may EXTEND beyond business hours in both directions", () => {
    // Business Monday 08:00-18:00; buyer-chosen Monday 06:00-22:00 stands as
    // written — a practice can take bookings before it opens the doors and
    // after it closes.
    const config = {
      appointmentSchedule: {
        useBusinessHours: false,
        days: { monday: { open: "06:00", close: "22:00", closed: false } }
      }
    };
    const schedule = resolveAppointmentSchedule({ configJson: config, hoursJson: HOURS_JSON, timeZone: TZ });
    expect(schedule.days.monday).toEqual({ open: "06:00", close: "22:00", closed: false });
  });

  it("custom Appointment Hours can open a day the business hours mark closed", () => {
    // HOURS_JSON never lists Sunday, so the business is closed then.
    const config = {
      appointmentSchedule: {
        useBusinessHours: false,
        days: { sunday: { open: "09:00", close: "13:00", closed: false } }
      }
    };
    const schedule = resolveAppointmentSchedule({ configJson: config, hoursJson: HOURS_JSON, timeZone: TZ });
    expect(schedule.days.sunday).toEqual({ open: "09:00", close: "13:00", closed: false });
  });

  it("UNCONFIRMED template days nobody opted into may still only narrow Business Hours", () => {
    // No useBusinessHours flag and no confirmation → a workflow/template
    // default, not a buyer decision. It cannot widen or reopen a day.
    const schedule = resolveAppointmentSchedule({
      configJson: { appointmentSchedule: { days: CUSTOM_DAYS } },
      hoursJson: HOURS_JSON,
      timeZone: TZ
    });
    expect(schedule.source).toBe("business_hours");
    expect(schedule.days.monday.open).toBe("11:00");
    expect(schedule.days.sunday.closed).toBe(true);
  });

  it("no custom days at all inherits Business Hours (useBusinessHours=true)", () => {
    const schedule = resolveAppointmentSchedule({ configJson: {}, hoursJson: HOURS_JSON, timeZone: TZ });
    expect(schedule.source).toBe("business_hours");
    expect(schedule.useBusinessHours).toBe(true);
  });
});

describe("booking from an after-hours call", () => {
  // 2099-06-08 is a Monday. Business hours close at 18:00; the buyer's
  // appointment hours run 07:00-20:00 every weekday.
  const MONDAY = "2099-06-08";
  // The caller phones at 21:30 on the Sunday — the office is long closed.
  const AFTER_HOURS_NOW = new Date("2099-06-07T21:30:00Z");

  const schedule = resolveAppointmentSchedule({
    configJson: {
      appointmentSchedule: {
        useBusinessHours: false,
        maxAdvanceDays: 365,
        days: Object.fromEntries(
          ["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => [
            day,
            { open: "07:00", close: "20:00", closed: false }
          ])
        )
      }
    },
    hoursJson: HOURS_JSON,
    timeZone: TZ
  });

  it("a caller outside business hours can book a slot inside appointment hours", () => {
    const day = computeDayAvailability({ schedule, date: MONDAY, busy: [], now: AFTER_HOURS_NOW });
    expect(day.closed).toBe(false);
    expect(day.allSlots.length).toBeGreaterThan(0);
    expect(day.openLabel).toBe("7:00 AM");
    expect(day.closeLabel).toBe("8:00 PM");
  });

  it("times outside BUSINESS hours but inside APPOINTMENT hours are bookable", () => {
    // Business Monday is 08:00-18:00; 07:30 and 19:00 fall outside it.
    for (const [hour, minute] of [
      [7, 30],
      [19, 0]
    ] as const) {
      expect(
        checkExactTime({ schedule, date: MONDAY, hour, minute, busy: [], now: AFTER_HOURS_NOW }).verdict
      ).toBe("available");
    }
  });

  it("times outside APPOINTMENT hours are still refused", () => {
    expect(checkExactTime({ schedule, date: MONDAY, hour: 6, minute: 0, busy: [], now: AFTER_HOURS_NOW }).verdict).toBe(
      "outside_hours"
    );
    expect(checkExactTime({ schedule, date: MONDAY, hour: 21, minute: 0, busy: [], now: AFTER_HOURS_NOW }).verdict).toBe(
      "outside_hours"
    );
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

  function customSchedule() {
    return resolveAppointmentSchedule({
      configJson: {
        appointmentSchedule: {
          useBusinessHours: false,
          maxAdvanceDays: 365,
          days: { monday: { open: "07:00", close: "20:00", closed: false } }
        }
      },
      hoursJson: HOURS_JSON,
      timeZone: TZ
    });
  }

  it("a holiday closure still closes a CUSTOM appointment schedule", () => {
    const schedule = customSchedule();
    schedule.specialDates = [{ date: MONDAY, closed: true }];

    expect(effectiveScheduleDayHours(schedule, MONDAY).closed).toBe(true);
    expect(computeDayAvailability({ schedule, date: MONDAY, busy: [], now: NOW }).allSlots).toHaveLength(0);
  });

  it("special shortened business hours do NOT reshape a custom appointment schedule", () => {
    const schedule = customSchedule();
    schedule.specialDates = [{ date: MONDAY, closed: false, open: "10:00", close: "12:00" }];

    // The business opened late that day; the independent appointment window
    // (07:00-20:00) is unchanged, so 08:30 is still bookable.
    expect(effectiveScheduleDayHours(schedule, MONDAY)).toEqual({
      open: "07:00",
      close: "20:00",
      closed: false
    });
    expect(checkExactTime({ schedule, date: MONDAY, hour: 8, minute: 30, busy: [], now: NOW }).verdict).toBe(
      "available"
    );
  });
});
