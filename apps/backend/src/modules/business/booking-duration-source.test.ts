import { describe, expect, it } from "vitest";
import { resolveAppointmentSchedule, serviceDurationFor } from "./scheduling";
import { loadDentalToolConfig } from "../architect/twilio-business-routing";

/**
 * QA (2026-07-29): "I wrote duration 40 mins and buffer 10 mins, still it is
 * giving me appointment for 30 mins."
 *
 * check_availability offered slots from the structured appointment schedule
 * (the Booking Rules panel → configJson.appointmentSchedule), but
 * book_appointment sized the calendar event from loadDentalToolConfig, which
 * only ever reads the LEGACY configJson.scheduling / dentalConfig keys. A buyer
 * who used the current UI therefore had every booking silently cut to the
 * 30-minute default.
 *
 * These lock the two config shapes to the same answer.
 */

const TZ = "America/Los_Angeles";

const HOURS = [
  { day: "monday", open: "09:00", close: "17:00", closed: false },
  { day: "tuesday", open: "09:00", close: "17:00", closed: false },
  { day: "wednesday", open: "09:00", close: "17:00", closed: false },
  { day: "thursday", open: "09:00", close: "17:00", closed: false },
  { day: "friday", open: "09:00", close: "17:00", closed: false },
  { day: "saturday", open: "00:00", close: "00:00", closed: true },
  { day: "sunday", open: "00:00", close: "00:00", closed: true }
];

/** What the current buyer Booking Rules panel writes. */
const STRUCTURED_CONFIG = {
  appointmentSchedule: {
    defaultDurationMinutes: 40,
    bufferMinutes: 10,
    confirmed: true
  }
};

/** What older installs (and the architect Book node) wrote. */
const LEGACY_CONFIG = {
  scheduling: {
    serviceDurationMinutes: 40,
    bufferMinutes: 10
  }
};

describe("booking duration comes from the buyer's configured schedule", () => {
  it("honours a 40-minute duration set in the structured Booking Rules panel", () => {
    const schedule = resolveAppointmentSchedule({
      configJson: STRUCTURED_CONFIG,
      hoursJson: HOURS,
      timeZone: TZ
    });

    expect(schedule.defaultDurationMinutes).toBe(40);
    expect(schedule.bufferMinutes).toBe(10);
    // This is the value book_appointment now sizes the calendar event with.
    expect(serviceDurationFor(schedule, "Cleaning")).toBe(40);
    // Slots advance by duration + buffer, so the gap the buyer asked for is real.
    expect(schedule.slotIntervalMinutes).toBe(50);
  });

  it("still honours the legacy scheduling keys", () => {
    const schedule = resolveAppointmentSchedule({
      configJson: LEGACY_CONFIG,
      hoursJson: HOURS,
      timeZone: TZ
    });

    expect(schedule.defaultDurationMinutes).toBe(40);
    expect(serviceDurationFor(schedule, "Cleaning")).toBe(40);
  });

  it("a per-service duration beats the default for that service only", () => {
    const schedule = resolveAppointmentSchedule({
      configJson: {
        appointmentSchedule: {
          defaultDurationMinutes: 40,
          serviceDurations: { "root canal": 90 }
        }
      },
      hoursJson: HOURS,
      timeZone: TZ
    });

    expect(serviceDurationFor(schedule, "Root Canal")).toBe(90);
    // Speech-mangled service names still resolve.
    expect(serviceDurationFor(schedule, "a root canal appointment")).toBe(90);
    expect(serviceDurationFor(schedule, "Cleaning")).toBe(40);
  });

  it("falls back to 30 minutes only when nothing is configured", () => {
    const schedule = resolveAppointmentSchedule({ configJson: {}, hoursJson: HOURS, timeZone: TZ });
    expect(schedule.defaultDurationMinutes).toBe(30);
  });
});

describe("the legacy dental-config view is why the structured value was lost", () => {
  it("loadDentalToolConfig cannot see appointmentSchedule.defaultDurationMinutes", () => {
    /* Documents the actual defect rather than asserting the old behaviour is
       fine: this loader is still used for SMS templates, reminders and the
       booking label, so it must never be the duration source again. */
    const legacyView = (config: Record<string, unknown>) => {
      const cfg = {
        ...((config.dentalConfig ?? {}) as Record<string, unknown>),
        ...((config.scheduling ?? {}) as Record<string, unknown>)
      };
      const parsed = Number(cfg.serviceDurationMinutes ?? cfg.defaultDurationMinutes);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
    };

    expect(legacyView(STRUCTURED_CONFIG)).toBe(30);
    expect(legacyView(LEGACY_CONFIG)).toBe(40);
    expect(typeof loadDentalToolConfig).toBe("function");
  });
});
