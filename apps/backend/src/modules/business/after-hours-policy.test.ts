import { describe, expect, it } from "vitest";
import {
  AFTER_HOURS_CLARIFY_QUESTION,
  AFTER_HOURS_RED_FLAG_QUESTION,
  asksEmergencyQuestion,
  asksRedFlagQuestion,
  buildAfterHoursPromptSection,
  buildAfterHoursSnapshot,
  defaultAfterHoursGreeting,
  deriveAfterHoursState,
  detectRedFlags,
  detectUrgentSymptoms,
  gaveEmergencyInstruction,
  normalizeAfterHoursPolicy,
  policyScreensForEmergencies,
  resolveAfterHoursGreeting,
  resolveLifeThreateningInstruction,
  resolveSimulatedHoursState,
  type AfterHoursPolicy,
  type WeeklyHours
} from "@coreai/shared";

const LA = "America/Los_Angeles";

function atUtc(iso: string): Date {
  return new Date(iso);
}

/** Mon–Fri 09:00–17:00 in the business timezone; Sat/Sun closed. */
function weekdayNineToFive(): WeeklyHours {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  return days.map((day) => ({
    day,
    closed: day === "saturday" || day === "sunday",
    periods: day === "saturday" || day === "sunday" ? [] : [{ open: "09:00", close: "17:00" }]
  }));
}

function dentalPolicy(overrides: Partial<AfterHoursPolicy> = {}): AfterHoursPolicy {
  return {
    enabled: true,
    emergencyScreeningEnabled: true,
    emergencyCategory: "DENTAL",
    emergencyContactMethod: "SMS",
    offerAppointmentBooking: true,
    preferEarliestAvailableSlot: false,
    allowUrgentCallbackRequest: true,
    includeCallbackInStaffAlert: true,
    ...overrides
  };
}

const GREETING = defaultAfterHoursGreeting({
  businessName: "California Family Dental Center",
  emergencyNoun: "a dental emergency",
  offerAppointmentBooking: true
});

describe("normalizeAfterHoursPolicy", () => {
  it("returns null for non-objects and normalizes a partial object with safe defaults", () => {
    expect(normalizeAfterHoursPolicy(null)).toBeNull();
    expect(normalizeAfterHoursPolicy("yes")).toBeNull();
    expect(normalizeAfterHoursPolicy([])).toBeNull();

    const policy = normalizeAfterHoursPolicy({ enabled: true });
    expect(policy).not.toBeNull();
    expect(policy?.enabled).toBe(true);
    expect(policy?.emergencyScreeningEnabled).toBe(false);
    expect(policy?.emergencyCategory).toBe("NONE");
    expect(policy?.offerAppointmentBooking).toBe(true);
    expect(policy?.allowUrgentCallbackRequest).toBe(true);
  });

  it("keeps valid categories/contact methods and drops an invalid timezone", () => {
    const policy = normalizeAfterHoursPolicy({
      enabled: true,
      emergencyScreeningEnabled: true,
      emergencyCategory: "dental",
      emergencyContactMethod: "sms",
      timezone: "Not/AZone"
    });
    expect(policy?.emergencyCategory).toBe("DENTAL");
    expect(policy?.emergencyContactMethod).toBe("SMS");
    expect(policy?.timezone).toBeUndefined();
    expect(policyScreensForEmergencies(policy)).toBe(true);
  });
});

describe("buildAfterHoursSnapshot — deterministic business-hours detection", () => {
  const weekly = weekdayNineToFive();

  it("is OPEN during configured hours (Monday 1 PM in the business timezone)", () => {
    const snapshot = buildAfterHoursSnapshot({ weekly, timeZone: LA, now: atUtc("2026-07-20T20:00:00Z") });
    expect(snapshot.state).toBe("OPEN");
    expect(snapshot.localDate).toBe("2026-07-20");
    expect(snapshot.weekday).toBe("monday");
  });

  it("is CLOSED before opening and after closing", () => {
    // Monday 8:00 AM PT — before the 9 AM open.
    expect(
      buildAfterHoursSnapshot({ weekly, timeZone: LA, now: atUtc("2026-07-20T15:00:00Z") }).state
    ).toBe("CLOSED");
    // Monday 7:30 PM PT — after the 5 PM close.
    const evening = buildAfterHoursSnapshot({ weekly, timeZone: LA, now: atUtc("2026-07-21T02:30:00Z") });
    expect(evening.state).toBe("CLOSED");
    expect(evening.nextOpenText).toContain("9 AM");
  });

  it("is CLOSED on a configured closed day and across midnight", () => {
    // Saturday 00:30 AM PT (just past Friday midnight).
    const snapshot = buildAfterHoursSnapshot({ weekly, timeZone: LA, now: atUtc("2026-07-25T07:30:00Z") });
    expect(snapshot.state).toBe("CLOSED");
    expect(snapshot.weekday).toBe("saturday");
    // Next opening is Monday.
    expect(snapshot.nextOpenText).toContain("Monday");
  });

  it("uses the BUSINESS timezone — the same instant differs across zones and an India server clock never flips a US clinic decision", () => {
    const instant = atUtc("2026-07-20T15:00:00Z"); // 11 AM New York, 8 AM Los Angeles
    expect(buildAfterHoursSnapshot({ weekly, timeZone: "America/New_York", now: instant }).state).toBe("OPEN");
    expect(buildAfterHoursSnapshot({ weekly, timeZone: LA, now: instant }).state).toBe("CLOSED");

    const eveningPt = buildAfterHoursSnapshot({ weekly, timeZone: LA, now: atUtc("2026-07-21T02:30:00Z") });
    expect(eveningPt.state).toBe("CLOSED");
    expect(eveningPt.localDate).toBe("2026-07-20");
    expect(eveningPt.weekday).toBe("monday");
  });

  it("evaluates correctly across the fall-back DST boundary", () => {
    const everyDay: WeeklyHours = (
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const
    ).map((day) => ({ day, closed: false, periods: [{ open: "09:00", close: "17:00" }] }));

    expect(buildAfterHoursSnapshot({ weekly: everyDay, timeZone: LA, now: atUtc("2026-11-01T08:30:00Z") }).state).toBe(
      "CLOSED"
    );
    expect(buildAfterHoursSnapshot({ weekly: everyDay, timeZone: LA, now: atUtc("2026-11-01T09:30:00Z") }).state).toBe(
      "CLOSED"
    );
    expect(buildAfterHoursSnapshot({ weekly: everyDay, timeZone: LA, now: atUtc("2026-11-01T17:30:00Z") }).state).toBe(
      "OPEN"
    );
  });

  it("reports UNKNOWN when hours are missing — never a false closed claim", () => {
    const snapshot = buildAfterHoursSnapshot({ weekly: null, timeZone: LA, now: atUtc("2026-07-20T20:00:00Z") });
    expect(snapshot.state).toBe("UNKNOWN");
    expect(snapshot.statusLine.toLowerCase()).toContain("not been confirmed");
  });

  it("honors a special closure date over the weekly schedule", () => {
    const snapshot = buildAfterHoursSnapshot({
      weekly,
      special: [{ date: "2026-07-20", closed: true, periods: [], kind: "holiday" }],
      timeZone: LA,
      now: atUtc("2026-07-20T20:00:00Z") // Monday 1 PM — normally open
    });
    expect(snapshot.state).toBe("CLOSED");
  });

  it("supports simulate overrides, which never apply in LIVE mode", () => {
    const simulated = buildAfterHoursSnapshot({
      weekly,
      timeZone: LA,
      now: atUtc("2026-07-20T20:00:00Z"), // genuinely open
      simulate: "closed"
    });
    expect(simulated.state).toBe("CLOSED");
    expect(simulated.simulated).toBe("closed");

    expect(resolveSimulatedHoursState("LIVE", "closed")).toBeNull();
    expect(resolveSimulatedHoursState("LIVE", "open")).toBeNull();
    expect(resolveSimulatedHoursState("BUSINESS_TEST", "closed")).toBe("closed");
    expect(resolveSimulatedHoursState("ARCHITECT_DRY_RUN", "open")).toBe("open");
    expect(resolveSimulatedHoursState("BUSINESS_TEST", "weird")).toBeNull();
  });
});

describe("after-hours greeting", () => {
  it("renders the required California Family Dental Center greeting", () => {
    expect(GREETING).toContain("Thank you for calling California Family Dental Center.");
    expect(GREETING).toContain("Our office is currently closed.");
    expect(GREETING).toContain("I hope everything is okay.");
    expect(GREETING).toContain(
      "Are you calling about a dental emergency, or would you like help scheduling the next available appointment?"
    );
  });

  it("offers both the emergency and the appointment path", () => {
    expect(asksEmergencyQuestion(GREETING)).toBe(true);
    expect(GREETING).toContain("scheduling");
  });

  it("uses a neutral non-screening greeting when screening is off, and fills custom greeting tokens", () => {
    const plain = resolveAfterHoursGreeting({
      policy: dentalPolicy({ emergencyScreeningEnabled: false }),
      businessName: "Sunset Salon"
    });
    expect(plain).toContain("Sunset Salon");
    expect(plain).not.toContain("emergency");

    const custom = resolveAfterHoursGreeting({
      policy: dentalPolicy({ greeting: "Hi, {{businessName}} here — we're closed right now." }),
      businessName: "Acme AC"
    });
    expect(custom).toBe("Hi, Acme AC here — we're closed right now.");
  });
});

describe("red-flag and urgency classifiers", () => {
  it("detects each life-threatening warning sign", () => {
    expect(detectRedFlags("I can't breathe properly")).toContain("difficulty_breathing");
    expect(detectRedFlags("it's hard to swallow anything")).toContain("difficulty_swallowing");
    expect(detectRedFlags("I'm having trouble speaking")).toContain("difficulty_speaking");
    expect(detectRedFlags("my face is severely swollen and it's spreading to my neck")).toContain("severe_swelling");
    expect(detectRedFlags("the bleeding won't stop")).toContain("uncontrolled_bleeding");
    expect(detectRedFlags("I think I broke my jaw in the fall")).toContain("serious_facial_injury");
    expect(detectRedFlags("my son passed out for a moment")).toContain("loss_of_consciousness");
    expect(detectRedFlags("she hit her head and now she keeps vomiting")).toContain("head_injury_warning_signs");
  });

  it("does not flag negated symptoms", () => {
    expect(detectRedFlags("no trouble breathing at all")).toEqual([]);
    expect(detectRedFlags("the bleeding has stopped now")).toEqual([]);
    expect(detectRedFlags("breathing is fine, just a bad toothache")).toEqual([]);
  });

  it("detects urgent (non-red-flag) dental symptoms", () => {
    expect(detectUrgentSymptoms("I have severe pain in my tooth")).toBe(true);
    expect(detectUrgentSymptoms("my tooth broke this evening")).toBe(true);
    expect(detectUrgentSymptoms("my tooth was knocked out playing hockey")).toBe(true);
    expect(detectUrgentSymptoms("I had an accident and injured my mouth")).toBe(true);
    expect(detectUrgentSymptoms("my child injured a tooth at practice")).toBe(true);
    expect(detectUrgentSymptoms("this is an emergency")).toBe(true);
  });

  it("does not treat a plain booking request or a denial as urgent", () => {
    expect(detectUrgentSymptoms("I'd like to book a cleaning next week")).toBe(false);
    expect(detectUrgentSymptoms("no, it's not an emergency")).toBe(false);
  });

  it("classifies assistant screening questions and the 911 instruction", () => {
    expect(asksRedFlagQuestion(AFTER_HOURS_RED_FLAG_QUESTION)).toBe(true);
    expect(asksRedFlagQuestion(AFTER_HOURS_CLARIFY_QUESTION)).toBe(true);
    expect(asksRedFlagQuestion("What day works best for you?")).toBe(false);
    expect(gaveEmergencyInstruction("Please call 911 now or go to the nearest emergency department.")).toBe(true);
    expect(gaveEmergencyInstruction("See you tomorrow!")).toBe(false);
  });
});

describe("deriveAfterHoursState — route state machine", () => {
  const assistant = (content: string) => ({ role: "assistant" as const, content });
  const user = (content: string) => ({ role: "user" as const, content });

  it("ties a standalone 'yes' to the immediately preceding emergency question", () => {
    const withQuestion = deriveAfterHoursState({
      history: [assistant(GREETING)],
      message: "yes",
      screeningEnabled: true
    });
    expect(withQuestion.route).toBe("POSSIBLE_EMERGENCY");

    // The assistant's last message was NOT the emergency question — "yes" must
    // not become emergency intent.
    const withoutQuestion = deriveAfterHoursState({
      history: [assistant(GREETING), user("no, just an appointment"), assistant("Great — may I have your name, please?")],
      message: "yes",
      screeningEnabled: true
    });
    expect(withoutQuestion.route).not.toBe("POSSIBLE_EMERGENCY");
    expect(withoutQuestion.route).not.toBe("RED_FLAG_DETECTED");
  });

  it("routes a clear non-emergency answer into standard booking", () => {
    const state = deriveAfterHoursState({
      history: [assistant(GREETING)],
      message: "No emergency — I'd just like to schedule a cleaning.",
      screeningEnabled: true
    });
    expect(state.route).toBe("STANDARD_BOOKING");
    expect(state.outcome).toBe("STANDARD_APPOINTMENT_REQUEST");

    // Choosing the scheduling side of the disjunctive greeting counts as a
    // clear non-emergency answer even without a "no".
    const scheduling = deriveAfterHoursState({
      history: [assistant(GREETING)],
      message: "I'd like to schedule a cleaning please",
      screeningEnabled: true
    });
    expect(scheduling.route).toBe("STANDARD_BOOKING");
  });

  it("a denial after the clarify question (emergency never confirmed) routes to booking, not urgent triage", () => {
    const state = deriveAfterHoursState({
      history: [assistant(GREETING), user("I don't know"), assistant(AFTER_HOURS_CLARIFY_QUESTION)],
      message: "No, I'd just like to book a cleaning.",
      screeningEnabled: true
    });
    expect(state.route).toBe("STANDARD_BOOKING");
  });

  it("asks one clarification for an ambiguous answer, then routes to human review — never a loop", () => {
    const first = deriveAfterHoursState({
      history: [assistant(GREETING)],
      message: "I don't know",
      screeningEnabled: true
    });
    expect(first.needsClarification).toBe(true);
    expect(first.route).toBe("EMERGENCY_QUESTION_ASKED");

    const second = deriveAfterHoursState({
      history: [assistant(GREETING), user("I don't know"), assistant(AFTER_HOURS_CLARIFY_QUESTION)],
      message: "maybe, I'm not sure",
      screeningEnabled: true
    });
    expect(second.route).toBe("HUMAN_REVIEW");
    expect(second.outcome).toBe("UNCLEAR_REQUIRES_HUMAN_REVIEW");
    expect(second.needsClarification).toBe(false);
  });

  it("runs the warning-sign check before urgent routing: 'no' → URGENT_DENTAL, 'yes' → RED_FLAG_DETECTED", () => {
    const base = [assistant(GREETING), user("yes, I think it's an emergency"), assistant(AFTER_HOURS_RED_FLAG_QUESTION)];

    const noFlags = deriveAfterHoursState({ history: base, message: "No, none of those.", screeningEnabled: true });
    expect(noFlags.route).toBe("URGENT_DENTAL");
    expect(noFlags.outcome).toBe("URGENT_DENTAL_REQUEST");

    const affirmed = deriveAfterHoursState({ history: base, message: "Yes", screeningEnabled: true });
    expect(affirmed.route).toBe("RED_FLAG_DETECTED");
    expect(affirmed.outcome).toBe("IMMEDIATE_MEDICAL_EMERGENCY");
    expect(affirmed.redFlags).toContain("affirmed_warning_signs");
  });

  it("detects an explicit red flag immediately, at any point, and keeps it sticky", () => {
    const direct = deriveAfterHoursState({
      history: [assistant(GREETING)],
      message: "My mouth is bleeding and it won't stop",
      screeningEnabled: true
    });
    expect(direct.route).toBe("RED_FLAG_DETECTED");

    // Introduced later, during normal booking — re-enters emergency routing.
    const later = deriveAfterHoursState({
      history: [
        assistant(GREETING),
        user("just want an appointment"),
        assistant("Of course — what day works for you?")
      ],
      message: "Actually my face is severely swollen and spreading to my neck",
      screeningEnabled: true
    });
    expect(later.route).toBe("RED_FLAG_DETECTED");

    // Sticky: small talk never downgrades a stated red flag.
    const sticky = deriveAfterHoursState({
      history: [assistant(GREETING), user("the bleeding won't stop"), assistant("Please call 911 now or go to the nearest emergency department.")],
      message: "okay thanks",
      screeningEnabled: true
    });
    expect(sticky.route).toBe("RED_FLAG_DETECTED");
    expect(sticky.emergencyInstructionGiven).toBe(true);
  });

  it("safely downgrades a prior ambiguous interpretation on an explicit later denial", () => {
    const state = deriveAfterHoursState({
      history: [assistant(GREETING), user("yes"), assistant("I'm sorry to hear that. Can you tell me more?")],
      message: "Oh no, it's not an emergency — I just want a checkup.",
      screeningEnabled: true
    });
    expect(state.route).toBe("STANDARD_BOOKING");
  });

  it("urgent symptoms introduced mid-booking re-enter screening", () => {
    const state = deriveAfterHoursState({
      history: [
        assistant(GREETING),
        user("I'd like to schedule an appointment"),
        assistant("Happy to help — may I have your name?")
      ],
      message: "It's John — actually I have severe pain, my tooth broke tonight",
      screeningEnabled: true
    });
    expect(state.route).toBe("POSSIBLE_EMERGENCY");
  });

  it("with screening disabled, everything is standard booking but red flags still register", () => {
    const normal = deriveAfterHoursState({
      history: [assistant("Thank you for calling. We're closed — I can book you in.")],
      message: "book me for Tuesday",
      screeningEnabled: false
    });
    expect(normal.route).toBe("STANDARD_BOOKING");

    const flagged = deriveAfterHoursState({
      history: [],
      message: "I can't breathe properly",
      screeningEnabled: false
    });
    expect(flagged.route).toBe("RED_FLAG_DETECTED");
  });
});

describe("buildAfterHoursPromptSection", () => {
  const policy = dentalPolicy();
  const capabilities = { canCheckAvailability: true, canBook: true, canNotifyStaff: true };

  it("liquid render conditions on {{businessOpenState}} and carries the exact scripts", () => {
    const section = buildAfterHoursPromptSection({
      policy,
      businessName: "California Family Dental Center",
      bookingLabel: "appointment",
      capabilities,
      render: { kind: "liquid" }
    });
    expect(section).toContain("{{businessOpenState}}");
    expect(section).toContain("{{businessHoursStatusLine}}");
    expect(section).toContain(AFTER_HOURS_RED_FLAG_QUESTION);
    expect(section).toContain(AFTER_HOURS_CLARIFY_QUESTION);
    expect(section).toContain("call 911 now or go to the nearest emergency department");
    expect(section.toLowerCase()).toContain("never say you will diagnose");
    expect(section).toContain("I'm glad to hear that.");
    expect(section).toContain("I'm unable to confirm an urgent appointment right now.");
    // Consent honesty: emergency never creates SMS consent.
    expect(section).toContain("an emergency NEVER creates SMS consent");
  });

  it("literal render: OPEN yields nothing, UNKNOWN yields neutral wording, CLOSED yields the full protocol", () => {
    expect(
      buildAfterHoursPromptSection({
        policy,
        businessName: "X",
        capabilities,
        render: { kind: "literal", state: "OPEN" }
      })
    ).toBe("");

    const unknown = buildAfterHoursPromptSection({
      policy,
      businessName: "X",
      capabilities,
      render: { kind: "literal", state: "UNKNOWN" }
    });
    expect(unknown).toContain("NEVER claim the office is open or closed");
    expect(unknown).toContain("I can help with an appointment request or urgent concern.");

    const closed = buildAfterHoursPromptSection({
      policy,
      businessName: "X",
      capabilities,
      render: { kind: "literal", state: "CLOSED", statusLine: "Currently closed (Monday).", nextOpenText: "Tuesday (2026-07-21) at 9 AM" }
    });
    expect(closed).toContain("CLOSED right now");
    expect(closed).toContain("Tuesday (2026-07-21) at 9 AM");
    expect(closed).toContain(AFTER_HOURS_RED_FLAG_QUESTION);
  });

  it("never promises 'the next business day' and forbids unverified booking claims", () => {
    const section = buildAfterHoursPromptSection({
      policy,
      businessName: "X",
      capabilities,
      render: { kind: "liquid" }
    });
    expect(section).toContain(`never say "the next business day"`);
    expect(section).toContain("Never claim a booking, request, or notification succeeded unless the tool result confirmed it.");
  });

  it("uses the category default life-threatening instruction unless overridden", () => {
    expect(resolveLifeThreateningInstruction(policy)).toContain("Do not wait for a dental appointment.");
    expect(
      resolveLifeThreateningInstruction(dentalPolicy({ lifeThreateningInstruction: "Call 911 immediately." }))
    ).toBe("Call 911 immediately.");
  });
});
