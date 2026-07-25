/**
 * Regression suite for the production-critical after-hours booking / phone /
 * consent hardening. Pure and near-pure assertions (no live Vapi/Twilio/Stripe):
 * business-hours authority, canonical-phone precedence with FULL E.164 identity,
 * spoken-date output, and the per-call canonical contact state.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spokenDateInTimeZone, ordinalDayWord } from "@coreai/shared";
import {
  resolveAppointmentSchedule,
  computeDayAvailability,
  checkExactTime
} from "../business/scheduling";
import {
  rememberCallContact,
  recallCallContact,
  resetCallContactCacheForTests
} from "./twilio-business-routing";

const TZ = "America/Los_Angeles";

// Better White: Mon–Fri 05:00–21:00, Saturday & Sunday closed.
const BETTER_WHITE_HOURS = [
  { day: "monday", open: "05:00", close: "21:00", closed: false },
  { day: "tuesday", open: "05:00", close: "21:00", closed: false },
  { day: "wednesday", open: "05:00", close: "21:00", closed: false },
  { day: "thursday", open: "05:00", close: "21:00", closed: false },
  { day: "friday", open: "05:00", close: "21:00", closed: false },
  { day: "saturday", open: "00:00", close: "00:00", closed: true },
  { day: "sunday", open: "00:00", close: "00:00", closed: true }
];

function betterWhiteSchedule() {
  // configJson empty → confirmed BusinessProfile.hoursJson is authoritative; no
  // template/workflow day overrides present.
  return resolveAppointmentSchedule({ configJson: {}, hoursJson: BETTER_WHITE_HOURS, timeZone: TZ });
}

const SATURDAY = "2026-07-25"; // a Saturday
const MONDAY = "2026-07-27"; // the next open weekday
// A fixed "after-hours call time": Friday night, well before the Monday slot.
const CALL_TIME = new Date("2026-07-24T05:00:00.000Z");

describe("#1 authoritative business hours (Better White)", () => {
  const schedule = betterWhiteSchedule();

  it("J: check_availability for a closed Saturday returns ZERO slots", () => {
    const day = computeDayAvailability({ schedule, date: SATURDAY, busy: [], now: CALL_TIME });
    expect(day.closed).toBe(true);
    expect(day.allSlots).toHaveLength(0);
    expect(day.spokenSlots).toHaveLength(0);
  });

  it("J: a direct booking for Saturday 09:00 is rejected as closed_day", () => {
    const verdict = checkExactTime({ schedule, date: SATURDAY, hour: 9, minute: 0, busy: [], now: CALL_TIME });
    expect(verdict.verdict).toBe("closed_day");
    expect(verdict.startAt).toBeNull();
  });

  it("J: an after-hours caller can book the next valid Monday slot", () => {
    const day = computeDayAvailability({ schedule, date: MONDAY, busy: [], now: CALL_TIME });
    expect(day.closed).toBe(false);
    expect(day.allSlots.length).toBeGreaterThan(0);
    const nineAm = checkExactTime({ schedule, date: MONDAY, hour: 9, minute: 0, busy: [], now: CALL_TIME });
    expect(nineAm.verdict).toBe("available");
    expect(nineAm.startAt).not.toBeNull();
  });

  it("J: the after-hours call time is NEVER the appointment time", () => {
    const nineAm = checkExactTime({ schedule, date: MONDAY, hour: 9, minute: 0, busy: [], now: CALL_TIME });
    // The booked instant is the requested Monday 09:00 local, not `now`.
    expect(nineAm.startAt).not.toBeNull();
    expect(new Date(nineAm.startAt as string).getTime()).not.toBe(CALL_TIME.getTime());
    expect(new Date(nineAm.startAt as string).getTime()).toBeGreaterThan(CALL_TIME.getTime());
  });

  it("closed weekend days yield no bookable exact time at any hour", () => {
    for (const hour of [6, 12, 18]) {
      expect(checkExactTime({ schedule, date: SATURDAY, hour, minute: 0, busy: [], now: CALL_TIME }).verdict).toBe(
        "closed_day"
      );
    }
  });
});

describe("#2 canonical phone precedence — FULL E.164 identity only", () => {
  afterEach(() => resetCallContactCacheForTests());

  it("J: a confirmed canonical number wins over a later malformed/supplied argument", () => {
    const callId = "call-canon-1";
    rememberCallContact(callId, { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" });
    // A later, model-transcribed "supplied" number must NOT overwrite it.
    rememberCallContact(callId, { phone: "+16505559999", phoneSource: "supplied" });
    expect(recallCallContact(callId).canonicalPhoneE164).toBe("+16505551234");
    expect(recallCallContact(callId).phoneSource).toBe("confirmed");
  });

  it("J: two DIFFERENT full numbers that share the last four are NOT treated as equal", () => {
    const callId = "call-canon-2";
    rememberCallContact(callId, { canonicalPhoneE164: "+916396039675", phoneSource: "confirmed" });
    // Same last-4 (9675) but a different full number, "supplied": must be ignored.
    rememberCallContact(callId, { phone: "+916316039675", phoneSource: "supplied" });
    const state = recallCallContact(callId);
    expect(state.canonicalPhoneE164).toBe("+916396039675");
    expect(state.canonicalPhoneE164).not.toBe("+916316039675");
    // Full-string inequality is what identity is based on — never last-4.
    expect("+916396039675".slice(-4)).toBe("+916316039675".slice(-4)); // last-4 collide…
    expect("+916396039675").not.toBe("+916316039675"); // …but the numbers are different.
  });

  it("a genuine correction (higher-or-equal source) does replace the canonical + moves the recipient", () => {
    const callId = "call-canon-3";
    rememberCallContact(callId, { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" });
    rememberCallContact(callId, {
      canonicalPhoneE164: "+16505550000",
      phoneSource: "confirmed",
      smsRecipientE164: "+16505550000"
    });
    const state = recallCallContact(callId);
    expect(state.canonicalPhoneE164).toBe("+16505550000");
    expect(state.smsRecipientE164).toBe("+16505550000");
  });
});

describe("#7 natural spoken date", () => {
  it("J: 2026-07-25 speaks as 'Saturday, July twenty-fifth' (never 'July 20 fifth')", () => {
    const spoken = spokenDateInTimeZone("2026-07-25T16:00:00.000Z", TZ);
    expect(spoken).toBe("Saturday, July twenty-fifth");
    expect(spoken).not.toContain("20 fifth");
    expect(spoken).not.toContain("Jul 25");
  });

  it("ordinal words are correct across the month boundary", () => {
    expect(ordinalDayWord(1)).toBe("first");
    expect(ordinalDayWord(2)).toBe("second");
    expect(ordinalDayWord(3)).toBe("third");
    expect(ordinalDayWord(21)).toBe("twenty-first");
    expect(ordinalDayWord(25)).toBe("twenty-fifth");
    expect(ordinalDayWord(31)).toBe("thirty-first");
  });

  it("resolves the spoken day in the given time zone", () => {
    // 2026-07-26 06:00 UTC is still Saturday July 25 in Los Angeles.
    expect(spokenDateInTimeZone("2026-07-26T06:00:00.000Z", TZ)).toBe("Saturday, July twenty-fifth");
  });
});
