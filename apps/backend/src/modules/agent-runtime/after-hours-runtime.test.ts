import { describe, expect, it, vi } from "vitest";
import {
  AFTER_HOURS_CLARIFY_QUESTION,
  AFTER_HOURS_RED_FLAG_QUESTION,
  VOICE_NODE_TYPES,
  defaultAfterHoursGreeting,
  type AfterHoursPolicy,
  type AfterHoursSnapshot
} from "@coreai/shared";
import { runAgentWorkflow } from "./graph-runner";
import { LIVE_VAPI_RUNTIME_VARIABLES } from "./prompt-builder";
import type { AgentProviders } from "./provider-adapters";
import type { AgentBusinessContext, AgentMessage } from "./runtime-context";

const LA = "America/Los_Angeles";

const WORKFLOW = {
  nodes: [
    { id: "trigger", data: { type: VOICE_NODE_TYPES.phoneCallTrigger, title: "Phone Call Trigger" } },
    { id: "ai", data: { type: VOICE_NODE_TYPES.voiceConversation, title: "AI Voice Conversation" } },
    { id: "cal", data: { type: VOICE_NODE_TYPES.calendarAvailability, title: "Calendar Availability" } },
    { id: "book", data: { type: VOICE_NODE_TYPES.bookAppointment, title: "Book Appointment" } },
    { id: "sms", data: { type: VOICE_NODE_TYPES.sendSms, title: "Send SMS" } },
    { id: "end", data: { type: VOICE_NODE_TYPES.endFlow, title: "End Flow" } }
  ],
  edges: [
    { id: "e1", source: "trigger", target: "ai" },
    { id: "e2", source: "ai", target: "cal" },
    { id: "e3", source: "cal", target: "book" },
    { id: "e4", source: "book", target: "sms" },
    { id: "e5", source: "sms", target: "end" }
  ]
};

function dentalPolicy(overrides: Partial<AfterHoursPolicy> = {}): AfterHoursPolicy {
  return {
    enabled: true,
    emergencyScreeningEnabled: true,
    emergencyCategory: "DENTAL",
    emergencyContactMethod: "SMS",
    offerAppointmentBooking: true,
    useEmergencySlots: false,
    allowUrgentCallbackRequest: true,
    ...overrides
  };
}

function snapshot(state: "OPEN" | "CLOSED" | "UNKNOWN"): AfterHoursSnapshot {
  return {
    state,
    timeZone: LA,
    localDate: "2026-07-20",
    localTime: "7:30 PM",
    weekday: "monday",
    statusLine:
      state === "CLOSED"
        ? "Currently closed (Monday) — next open Tuesday at 9 AM."
        : state === "OPEN"
          ? "Open now (Monday) — closes at 5 PM."
          : "Operating hours have not been confirmed yet.",
    nextOpenText: state === "CLOSED" ? "Tuesday (2026-07-21) at 9 AM" : ""
  };
}

function businessContext(state?: "OPEN" | "CLOSED" | "UNKNOWN"): AgentBusinessContext {
  return {
    name: "California Family Dental Center",
    type: "dental practice",
    assistantName: "Riley",
    timezone: LA,
    calendarId: "primary",
    appointmentService: "Appointment",
    services: ["Cleaning", "Emergency"],
    faqs: [],
    ...(state ? { afterHours: { policy: dentalPolicy(), snapshot: snapshot(state) } } : {})
  };
}

function spyProviders() {
  const checkAvailability = vi.fn(async () => ({
    slots: ["2026-07-21 10:00 AM", "2026-07-21 2:00 PM"],
    source: "test" as const,
    note: "test slots"
  }));
  const bookAppointment = vi.fn(async () => ({
    status: "confirmed" as const,
    confirmationId: "TEST-1",
    calendarEventId: "evt-1",
    note: "booked (test)"
  }));
  const smsSend = vi.fn(async () => ({ status: "simulated" as const, note: "sms simulated" }));
  const llmComplete = vi.fn(async (_params: { systemPrompt?: string; history?: unknown; message?: string }) => "");

  const providers = {
    mode: "business_test",
    telephonyEnabled: false,
    calendar: { checkAvailability, bookAppointment },
    sms: { send: smsSend },
    llm: { complete: llmComplete }
  } as unknown as AgentProviders;

  return { providers, checkAvailability, bookAppointment, smsSend, llmComplete };
}

const GREETING = defaultAfterHoursGreeting({
  businessName: "California Family Dental Center",
  emergencyNoun: "a dental emergency",
  offerAppointmentBooking: true
});

const assistant = (content: string): AgentMessage => ({ role: "assistant", content });
const user = (content: string): AgentMessage => ({ role: "user", content });

async function runTurn(params: {
  state?: "OPEN" | "CLOSED" | "UNKNOWN";
  message: string;
  history?: AgentMessage[];
  event?: "call_start" | "user_message";
}) {
  const spies = spyProviders();
  const result = await runAgentWorkflow({
    workflowId: "wf-after-hours",
    workflowJson: WORKFLOW,
    mode: "business_test",
    input: {
      channel: "browser_voice",
      event: params.event ?? "user_message",
      message: params.message,
      history: params.history ?? [],
      business: businessContext(params.state),
      caller: { name: "Test caller", phone: "+15555550100" }
    },
    providers: spies.providers
  });
  return { result, ...spies };
}

describe("after-hours call start", () => {
  it("speaks the closed greeting (with the business name) when the business is closed", async () => {
    const { result } = await runTurn({ state: "CLOSED", message: "__start__", event: "call_start" });
    expect(result.reply).toContain("Thank you for calling California Family Dental Center.");
    expect(result.reply).toContain("Our office is currently closed.");
    expect(result.reply).toContain("dental emergency");
    expect(result.variables["afterHours.state"]).toBe("CLOSED");
  });

  it("uses the normal greeting while open — the after-hours intro never plays", async () => {
    const { result } = await runTurn({ state: "OPEN", message: "__start__", event: "call_start" });
    expect(result.reply).toContain("Hello, this is Riley from California Family Dental Center.");
    expect(result.reply).not.toContain("currently closed");
  });

  it("fails safe on UNKNOWN hours — never claims the office is closed", async () => {
    const { result } = await runTurn({ state: "UNKNOWN", message: "__start__", event: "call_start" });
    expect(result.reply).not.toContain("currently closed");
  });
});

describe("red-flag enforcement", () => {
  it("gives the 911 direction immediately and blocks booking/SMS nodes on a red-flag turn", async () => {
    const { result, checkAvailability, bookAppointment, smsSend } = await runTurn({
      state: "CLOSED",
      history: [assistant(GREETING)],
      // Scheduling words WOULD normally trigger the calendar node — the
      // emergency screen must win.
      message: "I need an appointment right now, my mouth is bleeding and it won't stop"
    });

    expect(result.reply).toContain("911");
    expect(result.reply).not.toContain("booked");
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(bookAppointment).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(result.variables["afterHours.route"]).toBe("RED_FLAG_DETECTED");
    expect(result.variables["afterHours.outcome"]).toBe("IMMEDIATE_MEDICAL_EMERGENCY");

    const skipMessages = result.executedNodes.filter((log) =>
      log.message.includes("after-hours emergency screening takes priority")
    );
    expect(skipMessages.length).toBeGreaterThan(0);
  });

  it("asks the warning-sign question (not booking questions) after a 'yes' to the emergency question", async () => {
    const { result, checkAvailability } = await runTurn({
      state: "CLOSED",
      history: [assistant(GREETING)],
      message: "yes"
    });
    expect(result.reply).toContain(AFTER_HOURS_RED_FLAG_QUESTION);
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(result.variables["afterHours.route"]).toBe("POSSIBLE_EMERGENCY");
  });

  it("does not repeat the 911 instruction as new once it was given", async () => {
    const { result } = await runTurn({
      state: "CLOSED",
      history: [
        assistant(GREETING),
        user("the bleeding won't stop"),
        assistant("This may require immediate medical attention. Please call 911 now or go to the nearest emergency department.")
      ],
      message: "okay"
    });
    // Reinforces emergency care and offers the essential follow-ups instead of
    // restarting the instruction or a booking flow.
    expect(result.reply.toLowerCase()).toContain("911");
    expect(result.reply.toLowerCase()).toContain("name");
  });
});

describe("non-emergency and urgent flows", () => {
  it("a clear 'no' enters the normal booking flow with the required wording", async () => {
    const { result } = await runTurn({
      state: "CLOSED",
      history: [assistant(GREETING)],
      message: "No emergency, I'd just like to book an appointment"
    });
    expect(result.reply).toContain("I'm glad to hear that.");
    expect(result.reply.toLowerCase()).toContain("name");
    expect(result.variables["afterHours.route"]).toBe("STANDARD_BOOKING");
  });

  it("urgent-but-not-life-threatening callers can reach the calendar tools", async () => {
    const { result, checkAvailability } = await runTurn({
      state: "CLOSED",
      history: [
        assistant(GREETING),
        user("yes, I think so"),
        assistant(AFTER_HOURS_RED_FLAG_QUESTION),
        user("No, none of those."),
        assistant("I'm sorry you're going through that. Please briefly tell me what happened.")
      ],
      message: "My tooth broke tonight. Can I get an appointment tomorrow at 10 AM?"
    });
    expect(result.variables["afterHours.route"]).toBe("URGENT_DENTAL");
    expect(checkAvailability).toHaveBeenCalled();
  });

  it("clarifies an ambiguous answer exactly once, then routes to human review", async () => {
    const first = await runTurn({
      state: "CLOSED",
      history: [assistant(GREETING)],
      message: "I don't know"
    });
    expect(first.result.reply).toBe(AFTER_HOURS_CLARIFY_QUESTION);

    const second = await runTurn({
      state: "CLOSED",
      history: [assistant(GREETING), user("I don't know"), assistant(AFTER_HOURS_CLARIFY_QUESTION)],
      message: "maybe? I'm not sure"
    });
    expect(second.result.variables["afterHours.route"]).toBe("HUMAN_REVIEW");
    expect(second.result.reply).not.toBe(AFTER_HOURS_CLARIFY_QUESTION);
    expect(second.result.reply.toLowerCase()).toContain("team");
  });
});

describe("prompt and isolation", () => {
  it("injects the after-hours policy + turn state into the LLM prompt when closed", async () => {
    const { llmComplete } = await runTurn({
      state: "CLOSED",
      history: [assistant(GREETING)],
      message: "yes"
    });
    const promptArg = (llmComplete.mock.calls[0]?.[0] ?? {}) as { systemPrompt?: string };
    expect(promptArg.systemPrompt).toContain("After-hours call handling");
    expect(promptArg.systemPrompt).toContain("After-hours routing state this turn");
    expect(promptArg.systemPrompt).toContain("POSSIBLE_EMERGENCY");
  });

  it("adds neutral no-closed-claim guidance when hours are UNKNOWN", async () => {
    const { llmComplete } = await runTurn({
      state: "UNKNOWN",
      history: [assistant("Hello, this is Riley. How can I help you today?")],
      message: "are you open?"
    });
    const promptArg = (llmComplete.mock.calls[0]?.[0] ?? {}) as { systemPrompt?: string };
    expect(promptArg.systemPrompt).toContain("NEVER claim the office is open or closed");
  });

  it("adds nothing after-hours-related when no policy is configured (business isolation)", async () => {
    const { result, llmComplete } = await runTurn({
      message: "I want to book an appointment tomorrow"
    });
    const promptArg = (llmComplete.mock.calls[0]?.[0] ?? {}) as { systemPrompt?: string };
    expect(promptArg.systemPrompt).not.toContain("After-hours call handling");
    expect(result.variables["afterHours.route"]).toBeUndefined();
    expect(result.variables["afterHours.state"]).toBeUndefined();
  });

  it("stays inert while the business is OPEN — the normal workflow runs", async () => {
    const { result, checkAvailability } = await runTurn({
      state: "OPEN",
      message: "I want to book an appointment tomorrow"
    });
    expect(result.variables["afterHours.route"]).toBeUndefined();
    expect(checkAvailability).toHaveBeenCalled();
    expect(result.variables["afterHours.state"]).toBe("OPEN");
  });
});

describe("live-call runtime variable contract", () => {
  it("registers the after-hours variables for Vapi Liquid substitution", () => {
    expect(LIVE_VAPI_RUNTIME_VARIABLES).toContain("businessOpenState");
    expect(LIVE_VAPI_RUNTIME_VARIABLES).toContain("businessHoursStatusLine");
    expect(LIVE_VAPI_RUNTIME_VARIABLES).toContain("businessNextOpenTime");
  });
});
