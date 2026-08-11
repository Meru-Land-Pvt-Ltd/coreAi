import { describe, expect, it } from "vitest";
import { resolveAppointmentSchedule } from "./scheduling";

const WEDDING_HOURS = [
  { day: "monday", open: "09:00", close: "17:00", closed: false },
  { day: "saturday", open: "10:00", close: "14:00", closed: false }
];

const NAIL_SALON_HOURS = [
  { day: "monday", open: "11:00", close: "20:00", closed: false },
  { day: "saturday", open: "09:00", close: "18:00", closed: false }
];

describe("per-agent appointment hours", () => {
  it("uses the agent's own weekly hours when it owns its context", () => {
    const schedule = resolveAppointmentSchedule({
      configJson: {},
      hoursJson: NAIL_SALON_HOURS
    });

    expect(schedule.days.monday.open).toBe("11:00");
    expect(schedule.days.monday.close).toBe("20:00");
  });

  it("gives two agents genuinely different bookable windows", () => {
    const nail = resolveAppointmentSchedule({ configJson: {}, hoursJson: NAIL_SALON_HOURS });
    const wedding = resolveAppointmentSchedule({ configJson: {}, hoursJson: WEDDING_HOURS });

    expect(nail.days.monday.open).not.toBe(wedding.days.monday.open);
    expect(nail.days.saturday.close).not.toBe(wedding.days.saturday.close);
  });

  it("marks a day closed for one agent while the other stays open", () => {
    const closedSunday = resolveAppointmentSchedule({
      configJson: {},
      hoursJson: [{ day: "sunday", open: "09:00", close: "17:00", closed: true }]
    });
    const openSunday = resolveAppointmentSchedule({
      configJson: {},
      hoursJson: [{ day: "sunday", open: "12:00", close: "16:00", closed: false }]
    });

    expect(closedSunday.days.sunday.closed).toBe(true);
    expect(openSunday.days.sunday.closed).toBe(false);
    expect(openSunday.days.sunday.open).toBe("12:00");
  });
});
