import { describe, expect, it, vi } from "vitest";
import { runAgentWorkflow, workflowCapabilities } from "./graph-runner";
import type { AgentProviders } from "./provider-adapters";

/**
 * The workflow graph is the only authority for browser/chat test execution:
 * nodes that are not in the graph never run, booking never happens without a
 * Book Calendar Appointment node, availability output feeds the booking node,
 * and skipped nodes are reported (never silently hidden).
 */

const BUSINESS = {
  name: "Bright Salon",
  type: "salon",
  assistantName: "Ava",
  timezone: "America/New_York",
  calendarId: "primary",
  appointmentService: "Test Appointment",
  services: ["Haircut"],
  faqs: []
};

const CALLER = { name: "Jordan Test", phone: "+15551230000" };

const OFFERED_SLOT = "2099-01-05 10:00 AM";

function spyProviders() {
  const checkAvailability = vi.fn(async () => ({
    slots: [OFFERED_SLOT],
    source: "test" as const,
    note: "test slots"
  }));
  const bookAppointment = vi.fn(async (input: { slot: string; service: string }) => ({
    status: "confirmed" as const,
    confirmationId: "conf-1",
    calendarEventId: "evt-1",
    note: `booked ${input.slot}`,
    /* A real booking, the shape the live adapter actually returns: an event
       that was CREATED on the calendar. A "confirmed" with no event, or one
       marked SIMULATED, is a preview — and the agent must never tell a
       customer a preview is booked. */
    event: {
      testEventId: "test-event-1",
      title: "Appointment",
      startAt: "2026-09-01T10:00:00.000Z",
      endAt: "2026-09-01T10:30:00.000Z",
      timeZone: "UTC",
      status: "CREATED" as const
    }
  }));
  const send = vi.fn(async () => ({ status: "simulated" as const, note: "sms simulated" }));
  const complete = vi.fn(async () => "Happy to help!");

  const providers: AgentProviders = {
    mode: "business_test",
    telephonyEnabled: false,
    calendar: { checkAvailability, bookAppointment },
    sms: { send },
    llm: { complete }
  };

  return { providers, checkAvailability, bookAppointment, send };
}

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({
  id,
  data: { type, ...data }
});
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

const FULL_GRAPH = {
  nodes: [
    node("t", "trigger.phone_call"),
    node("ai", "ai.voice_conversation"),
    node("avail", "calendar.availability"),
    node("book", "calendar.book_appointment"),
    node("end", "flow.end")
  ],
  edges: [edge("t", "ai"), edge("ai", "avail"), edge("avail", "book"), edge("book", "end")]
};

const NO_BOOKING_GRAPH = {
  nodes: [node("t", "trigger.phone_call"), node("ai", "ai.voice_conversation"), node("end", "flow.end")],
  edges: [edge("t", "ai"), edge("ai", "end")]
};

async function run(
  workflowJson: unknown,
  providers: AgentProviders,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
) {
  return runAgentWorkflow({
    workflowId: "wf-test",
    workflowJson,
    mode: "business_test",
    input: {
      channel: "phone_call",
      event: "user_message",
      message,
      history,
      business: BUSINESS,
      caller: CALLER
    },
    providers
  });
}

describe("graph-driven tool gating", () => {
  it("reports no booking capability when the graph has no booking node", () => {
    expect(workflowCapabilities(NO_BOOKING_GRAPH).canBook).toBe(false);
    expect(workflowCapabilities(FULL_GRAPH).canBook).toBe(true);
  });

  it("never calls the calendar when the workflow has no booking node — even when asked to book", async () => {
    const { providers, checkAvailability, bookAppointment } = spyProviders();

    const result = await run(NO_BOOKING_GRAPH, providers, "Book an appointment for tomorrow at 10:00 AM please.");

    expect(bookAppointment).not.toHaveBeenCalled();
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(result.capabilities.canBook).toBe(false);
    // Nodes that are not in the graph never appear in the execution timeline.
    expect(result.executedNodes.map((log) => log.nodeId)).not.toContain("book");
  });

  it("reports availability and booking nodes as skipped (not hidden) on non-scheduling turns", async () => {
    const { providers, checkAvailability, bookAppointment } = spyProviders();

    const result = await run(FULL_GRAPH, providers, "What are your opening hours?");

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(bookAppointment).not.toHaveBeenCalled();

    const byNode = new Map(result.executedNodes.map((log) => [log.nodeId, log.status]));
    expect(byNode.get("avail")).toBe("skipped");
    expect(byNode.get("book")).toBe("skipped");
  });

  it("runs the availability node on scheduling turns but blocks booking while details are missing", async () => {
    const { providers, checkAvailability, bookAppointment } = spyProviders();

    const result = await run(FULL_GRAPH, providers, "I'd like to book a Haircut tomorrow.");

    expect(checkAvailability).toHaveBeenCalledTimes(1);
    // Booking must not fire before name/phone/slot are all known.
    expect(bookAppointment).not.toHaveBeenCalled();
    expect(result.turn.bookedThisTurn).toBe(false);
  });

  it("books through the booking node with the exact slot the availability node offered", async () => {
    const { providers, bookAppointment } = spyProviders();

    const history: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "I'd like to book a Haircut." },
      { role: "assistant", content: `We have ${OFFERED_SLOT} available. Does that work?` },
      { role: "user", content: "Yes, 10:00 AM works. My name is Jordan Test." },
      { role: "assistant", content: "And the best phone number for you?" }
    ];

    const result = await run(FULL_GRAPH, providers, "It's 555-123-9999.", history);

    expect(bookAppointment).toHaveBeenCalledTimes(1);
    const input = bookAppointment.mock.calls[0][0];
    expect(input.slot).toBe(OFFERED_SLOT);
    expect(input.service.length).toBeGreaterThan(0);
    expect(result.turn.bookedThisTurn).toBe(true);
  });

  it("a simulated event is never told to the customer as a booking", async () => {
    /* On a public agent page every turn runs in test mode, so the calendar
       step writes a SIMULATED row and still answers "confirmed". That used to
       be enough to tell the visitor their appointment was booked — nothing was
       booked, nobody was expecting them, and the agent is forbidden from using
       the words "test" or "simulated" to a customer, so they had no way to
       know. */
    const { providers, bookAppointment } = spyProviders();
    bookAppointment.mockResolvedValueOnce({
      status: "confirmed" as const,
      confirmationId: "conf-preview",
      calendarEventId: "",
      note: 'Simulated calendar event "Appointment". No live calendar event was created.',
      event: {
        testEventId: "test-event-preview",
        title: "Appointment",
        startAt: "2026-09-01T10:00:00.000Z",
        endAt: "2026-09-01T10:30:00.000Z",
        timeZone: "UTC",
        status: "SIMULATED" as const
      }
    });

    const history: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "I'd like to book a Haircut." },
      { role: "assistant", content: `We have ${OFFERED_SLOT} available. Does that work?` },
      { role: "user", content: "Yes, 10:00 AM works. My name is Jordan Test." },
      { role: "assistant", content: "And the best phone number for you?" }
    ];

    const result = await run(FULL_GRAPH, providers, "It's 555-123-9999.", history);

    expect(bookAppointment).toHaveBeenCalledTimes(1);
    expect(result.turn.bookedThisTurn).toBe(false);
  });

  it("a failed provider booking is reported as failed — never as a confirmed appointment", async () => {
    const { providers, bookAppointment } = spyProviders();
    bookAppointment.mockResolvedValueOnce({
      status: "failed",
      confirmationId: "",
      calendarEventId: "",
      note: "calendar write failed",
      errorCode: "CALENDAR_EVENT_CREATE_FAILED",
      remediation: "Reconnect Google Calendar."
    } as never);

    const history: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "I'd like to book a Haircut." },
      { role: "assistant", content: `We have ${OFFERED_SLOT} available. Does that work?` },
      { role: "user", content: "Yes, 10:00 AM works. My name is Jordan Test." },
      { role: "assistant", content: "And the best phone number for you?" }
    ];

    const result = await run(FULL_GRAPH, providers, "It's 555-123-9999.", history);

    expect(bookAppointment).toHaveBeenCalledTimes(1);
    expect(result.turn.bookedThisTurn).toBe(false);
  });
});
