import { describe, expect, it, vi } from "vitest";
import { parseGraph, runAgentWorkflow, workflowCapabilities } from "../agent-runtime/graph-runner";
import type { AgentProviders } from "../agent-runtime/provider-adapters";
// The production creator stays executable as a standalone Node script; it also
// exports its pure catalog builders so runtime tests exercise the exact payloads.
import { AGENTS, makeWorkflow } from "../../../../../scripts/triven_agent_creator.mjs";

const OFFERED_SLOT = "2099-01-05 10:00 AM";

function providers() {
  const checkAvailability = vi.fn(async () => ({
    slots: [OFFERED_SLOT],
    source: "test" as const,
    note: "Runtime contract slots"
  }));
  const bookAppointment = vi.fn(async () => ({
    status: "confirmed" as const,
    confirmationId: "catalog-confirmation",
    calendarEventId: "catalog-event",
    note: "Runtime contract booking",
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
  const send = vi.fn(async () => ({ status: "simulated" as const, note: "Runtime contract SMS" }));
  const complete = vi.fn(async () => "I can help with that.");

  const runtimeProviders: AgentProviders = {
    mode: "business_test",
    telephonyEnabled: false,
    calendar: { checkAvailability, bookAppointment },
    sms: { send },
    llm: { complete }
  };

  return { runtimeProviders, checkAvailability, bookAppointment, send };
}

describe("Triven 25-agent runtime contract", () => {
  it.each(AGENTS)("$name exposes its complete connected capability set", (agent) => {
    const workflow = makeWorkflow(agent);
    const graph = parseGraph(workflow, "phone_call");

    expect(graph.executionOrder).toHaveLength(6);
    expect(workflowCapabilities(workflow)).toEqual({
      canCheckAvailability: true,
      canBook: true,
      canText: true,
      canEmail: false,
      hasEnd: true,
      hasAi: true
    });
  });

  it.each(AGENTS)("$name starts, books, and renders its confirmation SMS", async (agent) => {
    const workflow = makeWorkflow(agent);
    const startProviders = providers();
    const business = {
      name: "Runtime Contract Business",
      type: agent.subindustry,
      assistantName: "Avery",
      timezone: "America/New_York",
      calendarId: "primary",
      appointmentService: agent.bookingLabel,
      services: [agent.bookingLabel],
      faqs: []
    };

    const started = await runAgentWorkflow({
      workflowId: `catalog-${agent.name}`,
      workflowJson: workflow,
      mode: "business_test",
      input: {
        channel: "phone_call",
        event: "call_start",
        message: "",
        history: [],
        business,
        caller: { name: "Jordan Runtime", phone: "+15551239999" }
      },
      providers: startProviders.runtimeProviders
    });

    expect(started.reply).toContain("Runtime Contract Business");
    expect(started.executedNodes.map((entry) => entry.nodeId)).toEqual(
      workflow.nodes.slice(0, 2).map((node) => node.id)
    );

    const turnProviders = providers();
    const booked = await runAgentWorkflow({
      workflowId: `catalog-${agent.name}`,
      workflowJson: workflow,
      mode: "business_test",
      input: {
        channel: "phone_call",
        event: "user_message",
        message: "It's 555-123-9999. Please text the confirmation.",
        history: [
          { role: "user", content: `I'd like to book a ${agent.bookingLabel}.` },
          { role: "assistant", content: `We have ${OFFERED_SLOT} available. Does that work?` },
          { role: "user", content: "Yes, 10:00 AM works. My name is Jordan Runtime." },
          { role: "assistant", content: "And the best phone number for you?" }
        ],
        business,
        caller: { name: "Test Caller", phone: "+15555550100" }
      },
      providers: turnProviders.runtimeProviders
    });

    expect(turnProviders.checkAvailability).toHaveBeenCalledTimes(1);
    expect(turnProviders.bookAppointment).toHaveBeenCalledTimes(1);
    expect(turnProviders.send).toHaveBeenCalledTimes(1);
    expect(booked.turn.bookedThisTurn).toBe(true);
    expect(booked.turn.smsThisTurn).toBe(true);

    const sms = turnProviders.send.mock.calls[0]?.[0];
    expect(sms?.to).toBe("555-123-9999");
    expect(sms?.body).toContain(agent.bookingLabel);
    expect(sms?.body).toContain("2099-01-05");
    expect(sms?.body).toContain("Runtime Contract Business");
    expect(sms?.body).not.toMatch(/\[[^\]]+\]/);
  });
});
