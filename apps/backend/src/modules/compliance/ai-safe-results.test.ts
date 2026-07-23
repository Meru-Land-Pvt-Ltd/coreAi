import { describe, expect, it } from "vitest";
import {
  appointmentAiRef,
  resolveAppointmentAiRef,
  toAiSafeAppointmentActionResult,
  toAiSafeAvailabilityResult,
  toAiSafeBookingResult
} from "./ai-safe-results";

/** Every field Google/requirements forbid in AI-facing results. */
const FORBIDDEN_KEYS = [
  "event_id",
  "event_link",
  "htmlLink",
  "calendar_id",
  "calendar_status",
  "test_event_id",
  "event_title",
  "event_status",
  "patient_phone",
  "patient_name",
  "customer_phone",
  "customer_name",
  "email",
  "access_token",
  "refresh_token",
  "appointmentCreated",
  "attendees",
  "description",
  "conferenceData",
  "sms",
  "source",
  "startAt",
  "endAt",
  "messageSid",
  "confirmation"
];

const LEAKY_BOOKING_INTERNAL = {
  success: true,
  appointmentCreated: true,
  event_id: "google-event-abc123",
  event_link: "https://calendar.google.com/event?eid=abc123",
  htmlLink: "https://calendar.google.com/event?eid=abc123",
  calendar_id: "owner@gmail.com",
  calendar_status: "connected",
  source: "google_calendar",
  patient_name: "Jane Caller",
  patient_phone: "+15551234567",
  email: "owner@gmail.com",
  access_token: "ya29.secret",
  attendees: [{ email: "someone@x.com" }],
  description: "Customer: Jane...",
  conferenceData: { id: "meet" },
  startAt: "2026-07-23T17:00:00.000Z",
  endAt: "2026-07-23T17:30:00.000Z",
  service: "Cleaning",
  date: "2026-07-23",
  // Business-local wall clock (America/New_York) — NOT the UTC hour above.
  time: "13:00",
  confirmation: "Perfect — you're booked for Cleaning on July 23 at 1 PM.",
  sms: { attempted: true, sent: true, blocked_reason: null, messageSid: "SM123", status: "queued" }
};

describe("toAiSafeAvailabilityResult", () => {
  it("emits ONLY success, date, availableTimes, message", () => {
    const result = toAiSafeAvailabilityResult({
      available_slots: ["9:00 AM", "2:30 PM"],
      total_free_slots: 7,
      date: "2026-07-23",
      service: "Cleaning",
      duration: "30 minutes",
      open_from: "9:00 AM",
      open_until: "6:00 PM",
      source: "calendar",
      calendar_status: "connected",
      event_id: "should-never-appear",
      message: "These are 2 of 7 free times across the day."
    });

    expect(Object.keys(result).sort()).toEqual(["availableTimes", "date", "message", "success"]);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-07-23");
    expect(result.availableTimes).toEqual(["9:00 AM", "2:30 PM"]);
    expect(result.message).toContain("7 free time(s)");
    expect(JSON.stringify(result)).not.toContain("should-never-appear");
  });

  it("folds exact-time verdicts and alternatives into whitelisted fields", () => {
    const result = toAiSafeAvailabilityResult({
      date: "2026-07-23",
      service: "Cleaning",
      requested_time: "17:00",
      verdict: "occupied",
      open_until: "6:00 PM",
      alternatives: ["4:30 PM", "5:30 PM"],
      calendar_status: "connected",
      message: "That exact time is already taken on the calendar."
    });

    expect(result.success).toBe(true);
    expect(result.availableTimes).toEqual(["4:30 PM", "5:30 PM"]);
    expect(result.message).toContain("Requested time 17:00: occupied.");
    expect(result.message).toContain("already taken");
    expect(Object.keys(result).sort()).toEqual(["availableTimes", "date", "message", "success"]);
  });

  it("reports failure for unreadable/closed calendars", () => {
    expect(toAiSafeAvailabilityResult({ calendar_status: "needs_reconnect", message: "x" }).success).toBe(false);
    expect(toAiSafeAvailabilityResult({ calendar_status: "error", message: "x" }).success).toBe(false);
    expect(toAiSafeAvailabilityResult({ closed: true, calendar_status: "connected", message: "closed" }).success).toBe(false);
    expect(toAiSafeAvailabilityResult({ verdict: "calendar_unavailable", requested_time: "17:00", message: "x" }).success).toBe(false);
  });

  it("restricted and not_connected results carry schedule-based times as SUCCESS", () => {
    // The Limited Use guard excludes the external calendar; hours + platform
    // bookings still answer. Same for a business with no calendar connected.
    const restricted = toAiSafeAvailabilityResult({
      calendar_status: "restricted",
      available_slots: ["9:00 AM", "11:00 AM"],
      message: "x"
    });
    expect(restricted.success).toBe(true);
    expect(restricted.availableTimes).toEqual(["9:00 AM", "11:00 AM"]);
    expect(toAiSafeAvailabilityResult({ calendar_status: "not_connected", message: "x" }).success).toBe(true);
  });
});

describe("toAiSafeBookingResult", () => {
  it("emits ONLY success, status, date, time, service, message", () => {
    const result = toAiSafeBookingResult(LEAKY_BOOKING_INTERNAL);
    expect(Object.keys(result).sort()).toEqual(["date", "message", "service", "status", "success", "time"]);
    expect(result).toMatchObject({
      success: true,
      status: "confirmed",
      date: "2026-07-23",
      time: "13:00",
      service: "Cleaning"
    });
  });

  it("uses the business-local time, never UTC — Asia/Kolkata 3:00 PM is 09:30Z", () => {
    const result = toAiSafeBookingResult({
      success: true,
      // A 3:00 PM IST booking: the UTC timestamp reads 09:30.
      startAt: "2026-07-25T09:30:00.000Z",
      endAt: "2026-07-25T10:00:00.000Z",
      date: "2026-07-25",
      time: "15:00",
      service_type: "Consultation",
      confirmation: "You're booked for July 25 at 3:00 PM."
    });
    expect(result.time).toBe("15:00");
    expect(result.date).toBe("2026-07-25");
    expect(JSON.stringify(result)).not.toContain("09:30");
  });

  it("NEVER derives a time from an ISO/UTC timestamp when no local time field exists", () => {
    const result = toAiSafeBookingResult({
      success: true,
      startAt: "2026-07-25T09:30:00.000Z",
      confirmation: "Booked."
    });
    expect(result).not.toHaveProperty("time");
    expect(result).not.toHaveProperty("date");
    expect(JSON.stringify(result)).not.toContain("09:30");
  });

  it("strips every forbidden field even when the internal result is maximally leaky", () => {
    const result = toAiSafeBookingResult(LEAKY_BOOKING_INTERNAL) as Record<string, unknown>;
    for (const key of FORBIDDEN_KEYS) {
      expect(result).not.toHaveProperty(key === "confirmation" || key === "sms" ? key : key);
    }
    const json = JSON.stringify(result);
    expect(json).not.toContain("google-event-abc123");
    expect(json).not.toContain("calendar.google.com");
    expect(json).not.toContain("+15551234567");
    expect(json).not.toContain("ya29.secret");
    expect(json).not.toContain("owner@gmail.com");
    expect(json).not.toContain("SM123");
    expect(json).not.toContain("someone@x.com");
  });

  it("folds SMS outcome into the message without provider metadata", () => {
    const sent = toAiSafeBookingResult(LEAKY_BOOKING_INTERNAL);
    expect(sent.message).toContain("confirmation text was sent");

    // Consent-blocked → actionable: the model is told to read the disclosure
    // now so the caller is proactively OFFERED texts, not left without them.
    const consentBlocked = toAiSafeBookingResult({
      ...LEAKY_BOOKING_INTERNAL,
      sms: { attempted: true, sent: false, blocked_reason: "SMS_CONSENT_REQUIRED", messageSid: null, status: null }
    });
    expect(consentBlocked.message).toContain("No text was sent");
    expect(consentBlocked.message).toContain("SMS consent disclosure");
    expect(consentBlocked.message).toContain("record_sms_consent");

    // Any other block keeps the generic never-claim-a-text-was-sent line.
    const otherBlocked = toAiSafeBookingResult({
      ...LEAKY_BOOKING_INTERNAL,
      sms: { attempted: true, sent: false, blocked_reason: "SMS_OPTED_OUT", messageSid: null, status: null }
    });
    expect(otherBlocked.message).toContain("No confirmation text was sent");
  });

  it("keeps failure guidance (verdict → status, alternatives → message)", () => {
    const failed = toAiSafeBookingResult({
      success: false,
      verdict: "occupied",
      open_until: "6:00 PM",
      alternatives: ["4:30 PM"],
      calendar_status: "connected",
      message: "That time was just taken on the calendar."
    });
    expect(failed.success).toBe(false);
    expect(failed.status).toBe("occupied");
    expect(failed.message).toContain("4:30 PM");
    expect(failed.message).toContain("Open until 6:00 PM");
  });
});

describe("toAiSafeAppointmentActionResult", () => {
  it("keeps flow-control fields and drops everything else", () => {
    const result = toAiSafeAppointmentActionResult({
      cancelled: false,
      code: "MULTIPLE_APPOINTMENTS",
      appointments: [
        {
          number: 1,
          appointment_id: "ref-abc",
          service: "Cleaning",
          appointment_date: "July 23",
          appointment_time: "5:00 PM",
          customerPhone: "+15551234567",
          calendarEventId: "google-event-1"
        }
      ],
      internal_note: "secret",
      message: "Read the numbered list."
    });

    expect(result.code).toBe("MULTIPLE_APPOINTMENTS");
    expect(result.appointments).toEqual([
      { number: 1, appointment_id: "ref-abc", service: "Cleaning", appointment_date: "July 23", appointment_time: "5:00 PM" }
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("+15551234567");
    expect(json).not.toContain("google-event-1");
    expect(json).not.toContain("secret");
  });
});

describe("appointment AI refs", () => {
  it("is opaque (no substring of the internal id) and stable", () => {
    const id = "cmg7appointment12345";
    const ref = appointmentAiRef(id);
    expect(ref).toHaveLength(12);
    expect(id).not.toContain(ref);
    expect(ref).not.toContain(id);
    expect(appointmentAiRef(id)).toBe(ref);
    expect(appointmentAiRef("other-id")).not.toBe(ref);
  });

  it("resolves refs and raw ids against the caller's verified candidates only", () => {
    const candidates = [{ id: "appt-1" }, { id: "appt-2" }];
    expect(resolveAppointmentAiRef(appointmentAiRef("appt-2"), candidates)?.id).toBe("appt-2");
    expect(resolveAppointmentAiRef("appt-1", candidates)?.id).toBe("appt-1");
    expect(resolveAppointmentAiRef(appointmentAiRef("appt-3"), candidates)).toBeUndefined();
    expect(resolveAppointmentAiRef("garbage", candidates)).toBeUndefined();
  });
});
