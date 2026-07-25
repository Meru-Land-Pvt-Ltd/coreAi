/**
 * Live after-hours machinery (pure): structured Vapi turn parsing, the live
 * route derivation (RED_FLAG_CHECK_ASKED, spoken-instruction verification),
 * the server-side tool-gate matrix, staff-alert templates, and the
 * distributed-store safety rule. No DB, no Redis, no mocks — fixtures mirror
 * real Vapi webhook shapes (message.artifact.messages with bot/user roles).
 */

import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import {
  AFTER_HOURS_GATE_CODES,
  buildRedFlagStaffAlert,
  buildUrgentStaffAlert,
  containsEmergencyDirection,
  deriveLiveAfterHoursCallState,
  evaluateAfterHoursToolGate,
  type AfterHoursCallTurn,
  type AfterHoursPolicy
} from "@coreai/shared";
import { extractStructuredCallTurns, gateLiveAfterHoursAction } from "./after-hours-live-gate";
import {
  clearAfterHoursCallState,
  isAfterHoursStoreSafeForLive,
  readAfterHoursCallState,
  resetAfterHoursCallStateStore,
  writeAfterHoursCallState
} from "../business/after-hours-call-state";

const GREETING =
  "Thank you for calling California Family Dental Center. Our office is currently closed. I hope everything is okay. Are you calling about a dental emergency, or would you like help scheduling the next available appointment?";
const RED_FLAG_QUESTION =
  "Are you having difficulty breathing, speaking, or swallowing, severe or rapidly increasing swelling around your mouth or neck, heavy bleeding that will not stop, or a serious injury to your face or jaw?";

function policy(overrides: Partial<AfterHoursPolicy> = {}): AfterHoursPolicy {
  return {
    enabled: true,
    emergencyScreeningEnabled: true,
    emergencyCategory: "DENTAL",
    emergencyContactMethod: "SMS",
    offerAppointmentBooking: true,
    preferEarliestAvailableSlot: true,
    allowUrgentCallbackRequest: true,
    includeCallbackInStaffAlert: true,
    ...overrides
  };
}

const bot = (content: string): AfterHoursCallTurn => ({ role: "assistant", content });
const user = (content: string): AfterHoursCallTurn => ({ role: "user", content });

function derive(turns: AfterHoursCallTurn[], p: AfterHoursPolicy = policy()) {
  return deriveLiveAfterHoursCallState({ turns, policy: p, businessHoursState: "CLOSED" });
}

// config/env re-imports dotenv, so REDIS_URL can leak back in after the test
// setup deletes it — force deterministic memory mode for this suite.
const originalRedisUrl = env.REDIS_URL;

beforeAll(() => {
  env.REDIS_URL = undefined;
  resetAfterHoursCallStateStore();
});

afterAll(() => {
  env.REDIS_URL = originalRedisUrl;
  resetAfterHoursCallStateStore();
});

afterEach(() => {
  resetAfterHoursCallStateStore();
});

describe("extractStructuredCallTurns — real Vapi payload shapes", () => {
  it("prefers role-tagged artifact messages and never treats caller text as assistant speech", () => {
    const turns = extractStructuredCallTurns({
      message: {
        type: "tool-calls",
        artifact: {
          messages: [
            { role: "system", message: "SYSTEM PROMPT — contains call 911 wording that was never spoken" },
            { role: "bot", message: GREETING, time: 1 },
            { role: "user", message: "yes I think so", time: 2 },
            { role: "tool_calls", message: "check_availability(...)" },
            { role: "tool_call_result", message: "{}" }
          ]
        }
      }
    });

    expect(turns).toEqual([
      { role: "assistant", content: GREETING },
      { role: "user", content: "yes I think so" }
    ]);
  });

  it("falls back to the role-marked running transcript only when no structured array exists", () => {
    const turns = extractStructuredCallTurns({
      message: { type: "status-update", transcript: `AI: ${GREETING}\nUser: no, just an appointment` }
    });
    expect(turns).toHaveLength(2);
    expect(turns[0]?.role).toBe("assistant");
    expect(turns[1]?.role).toBe("user");
    expect(turns[1]?.content).toContain("just an appointment");
  });

  it("returns nothing for partial/streaming events with no finalized content", () => {
    expect(extractStructuredCallTurns({ message: { type: "speech-update" } })).toEqual([]);
  });
});

describe("deriveLiveAfterHoursCallState — live routes", () => {
  it("only the greeting spoken → EMERGENCY_QUESTION_ASKED (nothing bookable yet)", () => {
    const state = derive([bot(GREETING)]);
    expect(state.route).toBe("EMERGENCY_QUESTION_ASKED");
    expect(state.emergencyInstructionStatus).toBe("NOT_REQUIRED");
  });

  it("'yes' to the greeting → POSSIBLE_EMERGENCY; unanswered warning-sign question → RED_FLAG_CHECK_ASKED", () => {
    expect(derive([bot(GREETING), user("yes")]).route).toBe("POSSIBLE_EMERGENCY");
    expect(derive([bot(GREETING), user("yes"), bot(RED_FLAG_QUESTION)]).route).toBe("RED_FLAG_CHECK_ASKED");
  });

  it("a stale earlier 'yes' does not control routing once a newer question is pending", () => {
    const state = derive([bot(GREETING), user("yes"), bot(RED_FLAG_QUESTION)]);
    // The pending warning-sign question governs — not the old affirmative.
    expect(state.route).toBe("RED_FLAG_CHECK_ASKED");
    expect(state.emergencyInstructionStatus).toBe("NOT_REQUIRED");
  });

  it("negated symptoms are not red flags; combined symptoms are", () => {
    expect(derive([bot(GREETING), user("no difficulty breathing, just checking hours")]).route).not.toBe(
      "RED_FLAG_DETECTED"
    );
    expect(derive([bot(GREETING), user("the bleeding has stopped, but my tooth aches")]).route).not.toBe(
      "RED_FLAG_DETECTED"
    );
    expect(derive([bot(GREETING), user("my face is swollen and I cannot swallow")]).route).toBe("RED_FLAG_DETECTED");
  });

  it("symptoms introduced during booking re-enter emergency routing", () => {
    const state = derive([
      bot(GREETING),
      user("no, just an appointment please"),
      bot("Happy to help — what day works for you?"),
      user("actually my mouth is bleeding and it will not stop")
    ]);
    expect(state.route).toBe("RED_FLAG_DETECTED");
  });

  it("a later denial resolves ambiguity but never erases a confirmed red flag", () => {
    const ambiguous = derive([
      bot(GREETING),
      user("yes"),
      bot("I'm sorry to hear that — can you tell me more?"),
      user("no, actually it's not an emergency, just a checkup")
    ]);
    expect(ambiguous.route).toBe("STANDARD_BOOKING");

    const confirmed = derive([
      bot(GREETING),
      user("I can't breathe properly"),
      bot("This may require immediate medical attention. Please call 911 now or go to the nearest emergency department."),
      user("never mind, it's fine, book me a cleaning")
    ]);
    expect(confirmed.route).toBe("RED_FLAG_DETECTED");
  });
});

describe("routine-scheduling backstop (requirement A) — clear routine intent bypasses screening", () => {
  const allowsBooking = (turns: AfterHoursCallTurn[]) => {
    const state = derive(turns);
    return {
      route: state.route,
      check: evaluateAfterHoursToolGate({
        route: state.route,
        emergencyInstructionStatus: state.emergencyInstructionStatus,
        action: "check_availability"
      })
    };
  };

  it("J1: a clear routine cleaning request bypasses emergency screening", () => {
    const { route, check } = allowsBooking([bot(GREETING), user("I'd like to book a cleaning appointment please")]);
    expect(route).toBe("STANDARD_BOOKING");
    expect(check.allowed).toBe(true);
  });

  it("J1: routine checkup / consultation / scheduling wording also bypasses", () => {
    for (const message of [
      "I want a routine dental checkup",
      "just here to schedule a consultation",
      "can I schedule the next available appointment",
      "no emergency, I just need a cleaning"
    ]) {
      const { route, check } = allowsBooking([bot(GREETING), user(message)]);
      expect(route, message).toBe("STANDARD_BOOKING");
      expect(check.allowed, message).toBe(true);
    }
  });

  it("J1: bypass survives the name/phone-collection turns that follow a routine request", () => {
    const { route, check } = allowsBooking([
      bot(GREETING),
      user("I want to book a cleaning for the next available business hours"),
      bot("Did you mean a dental cleaning appointment?"),
      user("yes, a cleaning"),
      bot("Great. May I have your full name?"),
      user("Jim"),
      bot("Thanks Jim. And your phone number?"),
      user("plus one six five zero five five five one two three four"),
      bot("Just to confirm, that's plus 1 650 555 1234, correct?"),
      user("yeah")
    ]);
    expect(route).toBe("STANDARD_BOOKING");
    expect(check.allowed).toBe(true);
  });

  it("J2: reported symptoms (bleeding/swelling) still require screening and block booking", () => {
    const { route, check } = allowsBooking([bot(GREETING), user("my tooth is bleeding heavily and my face is swollen")]);
    expect(route).not.toBe("STANDARD_BOOKING");
    expect(check.allowed).toBe(false);
  });

  it("J2: an affirmed life-threatening warning sign blocks booking (emergency instruction required)", () => {
    const { route, check } = allowsBooking([
      bot(GREETING),
      user("yes it might be an emergency"),
      bot(RED_FLAG_QUESTION),
      user("yes, I can't stop the bleeding")
    ]);
    expect(route).toBe("RED_FLAG_DETECTED");
    expect(check.allowed).toBe(false);
    expect((check as { code: string }).code).toBe(AFTER_HOURS_GATE_CODES.emergencyInstructionRequired);
  });

  it("J2: severe-pain urgent symptom during a booking request still routes to screening, not STANDARD_BOOKING", () => {
    const { route } = allowsBooking([bot(GREETING), user("I need an appointment, I have severe unbearable tooth pain")]);
    expect(route).not.toBe("STANDARD_BOOKING");
  });

  it("J2: a genuinely ambiguous answer is NOT auto-routed to booking", () => {
    const { route, check } = allowsBooking([bot(GREETING), user("um, I'm not sure, maybe")]);
    expect(route).not.toBe("STANDARD_BOOKING");
    expect(check.allowed).toBe(false);
  });

  it("the backstop never fires once a symptom appeared, even if a later turn asks to book", () => {
    const { route } = allowsBooking([
      bot(GREETING),
      user("I have some swelling in my jaw"),
      bot(RED_FLAG_QUESTION),
      user("actually can you just book me a cleaning")
    ]);
    expect(route).not.toBe("STANDARD_BOOKING");
  });
});

describe("emergency-instruction verification (assistant-spoken only)", () => {
  const RED_FLAG_TURNS = [bot(GREETING), user("the bleeding will not stop")];

  it("REQUIRED after a red flag with no assistant instruction", () => {
    const state = derive(RED_FLAG_TURNS);
    expect(state.route).toBe("RED_FLAG_DETECTED");
    expect(state.emergencyInstructionStatus).toBe("REQUIRED");
  });

  it("caller speech mentioning 911 never satisfies the requirement", () => {
    const state = derive([...RED_FLAG_TURNS, user("should I call 911?")]);
    expect(state.emergencyInstructionStatus).toBe("REQUIRED");
  });

  it("assistant-spoken direction satisfies it (call 911 / nearest emergency department)", () => {
    const spoken = derive([
      ...RED_FLAG_TURNS,
      bot("This may require immediate medical attention. Please call 911 now or go to the nearest emergency department.")
    ]);
    expect(spoken.emergencyInstructionStatus).toBe("GIVEN");

    expect(containsEmergencyDirection("Please call 911 now.")).toBe("call_911");
    expect(containsEmergencyDirection("Please go to the nearest emergency department.")).toBe("emergency_department");
    expect(containsEmergencyDirection("Let me book that for you.")).toBeNull();
  });

  it("a staff alert never counts as the emergency instruction", () => {
    const state = derive([...RED_FLAG_TURNS, bot("I've let the team know and they will follow up soon.")]);
    expect(state.emergencyInstructionStatus).toBe("REQUIRED");
  });
});

describe("evaluateAfterHoursToolGate — the §5 matrix", () => {
  const gate = (route: Parameters<typeof evaluateAfterHoursToolGate>[0]["route"], instruction: "NOT_REQUIRED" | "REQUIRED" | "GIVEN", action: Parameters<typeof evaluateAfterHoursToolGate>[0]["action"]) =>
    evaluateAfterHoursToolGate({ route, emergencyInstructionStatus: instruction, action });

  it("blocks booking during screening and while the warning-sign answer is pending", () => {
    expect(gate("EMERGENCY_QUESTION_ASKED", "NOT_REQUIRED", "book_appointment")).toMatchObject({
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.screeningRequired
    });
    expect(gate("POSSIBLE_EMERGENCY", "NOT_REQUIRED", "check_availability")).toMatchObject({
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.screeningRequired
    });
    expect(gate("RED_FLAG_CHECK_ASKED", "NOT_REQUIRED", "book_appointment")).toMatchObject({
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.redFlagResponseRequired
    });
    expect(gate("POSSIBLE_EMERGENCY", "NOT_REQUIRED", "customer_sms").allowed).toBe(false);
    expect(gate("POSSIBLE_EMERGENCY", "NOT_REQUIRED", "customer_email").allowed).toBe(false);
  });

  it("red flag: everything ordinary is blocked until the instruction is spoken — and booking stays blocked after", () => {
    expect(gate("RED_FLAG_DETECTED", "REQUIRED", "book_appointment")).toMatchObject({
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.emergencyInstructionRequired
    });
    expect(gate("RED_FLAG_DETECTED", "REQUIRED", "customer_sms").allowed).toBe(false);
    expect(gate("RED_FLAG_DETECTED", "GIVEN", "book_appointment")).toMatchObject({
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.bookingBlocked
    });
    expect(gate("RED_FLAG_DETECTED", "GIVEN", "customer_email").allowed).toBe(false);
    // The minimum internal staff alert is always permitted.
    expect(gate("RED_FLAG_DETECTED", "REQUIRED", "staff_alert").allowed).toBe(true);
  });

  it("urgent and standard routes allow real availability/booking; human review does not", () => {
    expect(gate("URGENT_DENTAL", "NOT_REQUIRED", "check_availability").allowed).toBe(true);
    expect(gate("URGENT_DENTAL", "NOT_REQUIRED", "book_appointment").allowed).toBe(true);
    expect(gate("STANDARD_BOOKING", "NOT_REQUIRED", "book_appointment").allowed).toBe(true);
    expect(gate("HUMAN_REVIEW", "NOT_REQUIRED", "book_appointment")).toMatchObject({
      allowed: false,
      code: AFTER_HOURS_GATE_CODES.humanReviewRequired
    });
  });

  it("store unavailable fails safely with AFTER_HOURS_STATE_STORE_UNAVAILABLE — never prompt-only booking", () => {
    const blocked = gateLiveAfterHoursAction({ active: true, storeUnavailable: true }, "book_appointment");
    expect(blocked).toMatchObject({ allowed: false, code: AFTER_HOURS_GATE_CODES.stateStoreUnavailable });
    // Inactive gate (open hours / policy off) never blocks.
    expect(gateLiveAfterHoursAction({ active: false }, "book_appointment").allowed).toBe(true);
  });

  it("production requires a genuinely READY distributed store; dev/test may use memory", () => {
    // Redis missing in production → fail closed.
    expect(isAfterHoursStoreSafeForLive({ distributed: false, production: true, ready: false })).toBe(false);
    // Redis configured but UNREACHABLE in production → fail closed.
    // Boolean(REDIS_URL) is configuration, not a health check.
    expect(isAfterHoursStoreSafeForLive({ distributed: true, production: true, ready: false })).toBe(false);
    // Redis genuinely READY → distributed state permitted.
    expect(isAfterHoursStoreSafeForLive({ distributed: true, production: true, ready: true })).toBe(true);
    // Memory fallback exists only outside production.
    expect(isAfterHoursStoreSafeForLive({ distributed: false, production: false, ready: false })).toBe(true);
  });
});

describe("call-state store isolation", () => {
  const state = (route: "STANDARD_BOOKING" | "RED_FLAG_DETECTED") => ({
    businessHoursState: "CLOSED" as const,
    route,
    emergencyInstructionStatus: "NOT_REQUIRED" as const,
    staffNotificationStatus: "NOT_REQUESTED" as const,
    redFlags: [],
    policyVersion: "test",
    updatedAt: new Date().toISOString()
  });

  it("Business A / Call A state never affects Business B / Call B, and clearing removes state", async () => {
    await writeAfterHoursCallState("biz-a", "call-1", state("RED_FLAG_DETECTED"));
    await writeAfterHoursCallState("biz-b", "call-1", state("STANDARD_BOOKING"));
    await writeAfterHoursCallState("biz-a", "call-2", state("STANDARD_BOOKING"));

    expect((await readAfterHoursCallState("biz-a", "call-1"))?.route).toBe("RED_FLAG_DETECTED");
    expect((await readAfterHoursCallState("biz-b", "call-1"))?.route).toBe("STANDARD_BOOKING");
    expect((await readAfterHoursCallState("biz-a", "call-2"))?.route).toBe("STANDARD_BOOKING");

    await clearAfterHoursCallState("biz-a", "call-1");
    expect(await readAfterHoursCallState("biz-a", "call-1")).toBeNull();
    expect((await readAfterHoursCallState("biz-b", "call-1"))?.route).toBe("STANDARD_BOOKING");
  });
});

describe("staff alert templates — minimum information only", () => {
  it("renders the urgent and red-flag alerts with the callback setting honored", () => {
    const urgent = buildUrgentStaffAlert({
      businessName: "California Family Dental Center",
      callerName: "Alex Doe",
      callbackNumber: "+15555550123",
      callId: "call_abc",
      includeCallback: true
    });
    expect(urgent).toContain("URGENT after-hours call for California Family Dental Center.");
    expect(urgent).toContain("Caller: Alex Doe.");
    expect(urgent).toContain("Callback: +15555550123.");
    expect(urgent).toContain("Reference: call_abc.");
    expect(urgent).toContain("Please review and follow up as soon as possible.");

    const noCallback = buildUrgentStaffAlert({
      businessName: "X",
      callerName: "Alex",
      callbackNumber: "+15555550123",
      callId: "call_abc",
      includeCallback: false
    });
    expect(noCallback).not.toContain("+15555550123");

    const redFlag = buildRedFlagStaffAlert({
      businessName: "X",
      callerName: null,
      callbackNumber: null,
      callId: "call_abc",
      includeCallback: true
    });
    expect(redFlag).toContain("EMERGENCY after-hours call for X.");
    expect(redFlag).toContain("The caller was instructed to call 911 or go to the nearest emergency department.");
    expect(redFlag).toContain("Please review.");
    // No symptom narrative, no diagnosis, no transcript.
    expect(redFlag).not.toMatch(/bleed|swell|breath|diagnos/i);
  });
});
