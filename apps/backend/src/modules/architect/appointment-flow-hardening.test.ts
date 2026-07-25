import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  spokenDateInTimeZone,
  ordinalDayWord,
  deriveLiveAfterHoursCallState,
  evaluateAfterHoursToolGate,
  DEFAULT_DENTAL_AFTER_HOURS_POLICY,
  type AfterHoursCallTurn
} from "@coreai/shared";
import { env } from "../../config/env";
import { resetSharedRedisForTests } from "../../lib/redis";
import {
  resolveAppointmentSchedule,
  computeDayAvailability,
  checkExactTime
} from "../business/scheduling";
import {
  updateCallContact,
  readCallContact,
  resetCallContactStoreForTests
} from "./call-contact-store";

// Force deterministic memory-fallback mode for the distributed call-state store
// (no live Redis in unit tests); config/env re-imports dotenv so REDIS_URL can
// leak back — clear it and rebuild the shared client each run.
const originalRedisUrl = env.REDIS_URL;
beforeAll(() => {
  env.REDIS_URL = undefined;
  resetSharedRedisForTests();
  resetCallContactStoreForTests();
});
afterAll(() => {
  env.REDIS_URL = originalRedisUrl;
  resetSharedRedisForTests();
});

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

  it("J: confirmed business hours WIN over unconfirmed workflow/config/template days (Saturday 09:00-18:00)", () => {
    const withTemplateSaturday = resolveAppointmentSchedule({
      configJson: {
        appointmentSchedule: {
          // Template/workflow default (NOT buyer-confirmed) tries to open Saturday.
          days: { saturday: { open: "09:00", close: "18:00", closed: false } }
        }
      },
      hoursJson: BETTER_WHITE_HOURS, // Saturday closed — confirmed business hours.
      timeZone: TZ
    });
    expect(withTemplateSaturday.source).toBe("business_hours");
    const saturday = computeDayAvailability({ schedule: withTemplateSaturday, date: SATURDAY, busy: [], now: CALL_TIME });
    expect(saturday.closed).toBe(true);
    expect(saturday.allSlots).toHaveLength(0);
    expect(
      checkExactTime({ schedule: withTemplateSaturday, date: SATURDAY, hour: 9, minute: 0, busy: [], now: CALL_TIME }).verdict
    ).toBe("closed_day");
    // …and the next valid Monday still books.
    expect(
      checkExactTime({ schedule: withTemplateSaturday, date: MONDAY, hour: 9, minute: 0, busy: [], now: CALL_TIME }).verdict
    ).toBe("available");
  });
});

describe("#2 distributed canonical phone state — FULL E.164 identity only", () => {
  const BIZ = "biz-canon";
  afterEach(() => resetCallContactStoreForTests());

  it("J: a confirmed canonical number wins over a later malformed/supplied argument", async () => {
    const callId = "call-canon-1";
    await updateCallContact(BIZ, callId, { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" });
    // A later, model-transcribed "supplied" number must NOT overwrite it.
    await updateCallContact(BIZ, callId, { canonicalPhoneE164: "+16505559999", phoneSource: "supplied" });
    const state = await readCallContact(BIZ, callId);
    expect(state?.canonicalPhoneE164).toBe("+16505551234");
    expect(state?.phoneSource).toBe("confirmed");
  });

  it("J: two DIFFERENT full numbers that share the last four are NOT treated as equal", async () => {
    const callId = "call-canon-2";
    await updateCallContact(BIZ, callId, { canonicalPhoneE164: "+916396039675", phoneSource: "confirmed" });
    // Same last-4 (9675) but a different full number, "supplied": must be ignored.
    await updateCallContact(BIZ, callId, { canonicalPhoneE164: "+916316039675", phoneSource: "supplied" });
    const state = await readCallContact(BIZ, callId);
    expect(state?.canonicalPhoneE164).toBe("+916396039675");
    expect(state?.canonicalPhoneE164).not.toBe("+916316039675");
    // Full-string inequality is what identity is based on — never last-4.
    expect("+916396039675".slice(-4)).toBe("+916316039675".slice(-4)); // last-4 collide…
    expect("+916396039675").not.toBe("+916316039675"); // …but the numbers are different.
  });

  it("state is scoped by businessId + callId (no cross-call/cross-business bleed)", async () => {
    await updateCallContact(BIZ, "call-x", { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" });
    expect((await readCallContact(BIZ, "call-y"))?.canonicalPhoneE164).toBeUndefined();
    expect((await readCallContact("biz-other", "call-x"))?.canonicalPhoneE164).toBeUndefined();
    expect((await readCallContact(BIZ, "call-x"))?.canonicalPhoneE164).toBe("+16505551234");
  });

  it("a genuine correction (equal source) replaces the canonical + moves the recipient", async () => {
    const callId = "call-canon-3";
    await updateCallContact(BIZ, callId, { canonicalPhoneE164: "+16505551234", phoneSource: "confirmed" });
    await updateCallContact(BIZ, callId, {
      canonicalPhoneE164: "+16505550000",
      phoneSource: "confirmed",
      smsRecipientE164: "+16505550000"
    });
    const state = await readCallContact(BIZ, callId);
    expect(state?.canonicalPhoneE164).toBe("+16505550000");
    expect(state?.smsRecipientE164).toBe("+16505550000");
  });

  it("pending corrected number round-trips and clears", async () => {
    const callId = "call-canon-4";
    await updateCallContact(BIZ, callId, { pendingCorrectedPhoneE164: "+16505550001" });
    expect((await readCallContact(BIZ, callId))?.pendingCorrectedPhoneE164).toBe("+16505550001");
    await updateCallContact(BIZ, callId, { pendingCorrectedPhoneE164: null });
    expect((await readCallContact(BIZ, callId))?.pendingCorrectedPhoneE164).toBeUndefined();
  });
});

describe("#4 emergency screening order — booking tools gated until screening", () => {
  const GREETING =
    "Thank you for calling. Our office is currently closed. Are you calling about a dental emergency, or would you like help scheduling the next available appointment?";
  const bot = (content: string): AfterHoursCallTurn => ({ role: "assistant", content });
  const user = (content: string): AfterHoursCallTurn => ({ role: "user", content });
  const route = (turns: AfterHoursCallTurn[]) =>
    deriveLiveAfterHoursCallState({ turns, policy: DEFAULT_DENTAL_AFTER_HOURS_POLICY, businessHoursState: "CLOSED" });
  const gate = (turns: AfterHoursCallTurn[], action: "check_availability" | "book_appointment") => {
    const s = route(turns);
    return evaluateAfterHoursToolGate({ route: s.route, emergencyInstructionStatus: s.emergencyInstructionStatus, action });
  };

  it("routine cleaning bypasses screening — both check and book are allowed", () => {
    const turns = [bot(GREETING), user("I'd like to book a routine cleaning please")];
    expect(gate(turns, "check_availability").allowed).toBe(true);
    expect(gate(turns, "book_appointment").allowed).toBe(true);
  });

  it("before the caller answers, BOTH check_availability and book_appointment are blocked (no data committed before screening)", () => {
    const turns = [bot(GREETING)];
    expect(gate(turns, "check_availability").allowed).toBe(false);
    expect(gate(turns, "book_appointment").allowed).toBe(false);
  });

  it("reported symptoms require screening — booking stays blocked", () => {
    const turns = [bot(GREETING), user("my tooth is bleeding and won't stop")];
    expect(route(turns).route).not.toBe("STANDARD_BOOKING");
    expect(gate(turns, "book_appointment").allowed).toBe(false);
  });

  it("a later emergency symptom re-enters the emergency route after a routine start", () => {
    const turns = [
      bot(GREETING),
      user("just a cleaning please"),
      bot("Great, may I have your name?"),
      user("actually my face is really swollen and I can't swallow")
    ];
    expect(route(turns).route).toBe("RED_FLAG_DETECTED");
    expect(gate(turns, "book_appointment").allowed).toBe(false);
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
