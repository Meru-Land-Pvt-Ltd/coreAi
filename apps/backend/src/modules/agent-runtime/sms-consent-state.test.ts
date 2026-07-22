import { VOICE_NODE_TYPES } from "@coreai/shared";
import { describe, expect, it } from "vitest";
import {
  affirmsOffer,
  inferConversationState,
  offersTextConfirmation,
  wantsSmsMessage,
  type AgentMessage,
  type AgentRuntimeContext
} from "./runtime-context";
import { executeNode } from "./node-handlers";
import type { AgentProviders } from "./provider-adapters";

const business = {
  name: "Bright Smile Dental",
  type: "dental practice",
  assistantName: "Ava",
  timezone: "America/New_York",
  calendarId: "primary",
  appointmentService: "Cleaning",
  services: ["Cleaning"],
  faqs: []
};

const caller = { name: "", phone: "" };

function stateFor(history: AgentMessage[], message: string) {
  return inferConversationState({ history, message, caller, business });
}

describe("offersTextConfirmation / affirmsOffer", () => {
  it("detects a text-confirmation offer", () => {
    expect(offersTextConfirmation("Would you like a text confirmation of this?")).toBe(true);
    expect(offersTextConfirmation("Shall I send you an SMS with the details?")).toBe(true);
    expect(offersTextConfirmation("You're booked for 3 PM.")).toBe(false);
    expect(offersTextConfirmation("We can text you next time.")).toBe(false);
  });

  it("counts only a clear yes as agreement", () => {
    expect(affirmsOffer("Yes please")).toBe(true);
    expect(affirmsOffer("sure, that's fine")).toBe(true);
    expect(affirmsOffer("No thanks")).toBe(false);
    expect(affirmsOffer("maybe later")).toBe(false);
    expect(affirmsOffer("hmm")).toBe(false);
    expect(affirmsOffer("don't")).toBe(false);
  });
});

describe("inferConversationState SMS consent", () => {
  const offer: AgentMessage = { role: "assistant", content: "Would you like a text confirmation of this?" };

  it("yes to the assistant's offer → smsRequested, not declined", () => {
    const state = stateFor([offer], "Yes please");
    expect(state.smsRequested).toBe(true);
    expect(state.smsDeclined).toBe(false);
  });

  it("no to the offer → smsDeclined", () => {
    const state = stateFor([offer], "No thanks");
    expect(state.smsDeclined).toBe(true);
  });

  it("an unclear answer to the offer is a decline, not consent", () => {
    const state = stateFor([offer], "uh, what time was it again?");
    expect(state.smsRequested).toBe(false);
    expect(state.smsDeclined).toBe(true);
  });

  it("the LAST answer wins — a later explicit yes can still opt in", () => {
    const history: AgentMessage[] = [
      offer,
      { role: "user", content: "No thanks" },
      { role: "assistant", content: "No problem. Anything else?" }
    ];
    const state = stateFor(history, "Actually yes, please text me the details");
    expect(state.smsRequested).toBe(true);
  });

  it("booking without any text mention gives neither consent nor decline", () => {
    const state = stateFor(
      [{ role: "assistant", content: "You're booked for 3 PM tomorrow." }],
      "Great, thank you!"
    );
    expect(state.smsRequested).toBe(false);
    expect(state.smsDeclined).toBe(false);
  });

  it("an explicit caller request like 'text me the confirmation' counts as a request", () => {
    expect(wantsSmsMessage("text me the confirmation")).toBe(true);
    const state = stateFor([], "Can you text me the confirmation please?");
    expect(state.smsRequested).toBe(true);
    expect(state.smsDeclined).toBe(false);
  });
});

/* ------------------- simulated SMS handler consent gate ------------------- */

function smsRunContext(overrides: {
  smsRequested: boolean;
  smsDeclined: boolean;
  bookedThisTurn?: boolean;
}): AgentRuntimeContext {
  return {
    mode: "business_test",
    channel: "browser_voice",
    workflowId: "wf-1",
    currentNodeId: "sms-1",
    userMessage: "ok",
    history: [],
    variables: { "customer.phone": "+16175550100" },
    business,
    caller: { name: "Jane", phone: "+16175550100" },
    conversation: {
      schedulingIntent: true,
      currentContributes: false,
      ending: false,
      isQuestion: false,
      smsRequested: overrides.smsRequested,
      smsDeclined: overrides.smsDeclined,
      detailsComplaint: false,
      wantsMessage: false,
      messageFollowUp: false,
      vagueQuestion: false,
      collectedName: "Jane",
      collectedPhone: "+16175550100",
      requestedService: "Cleaning",
      requestedDate: "2026-07-25",
      lastTimeMessage: ""
    },
    turn: {
      bookedThisTurn: overrides.bookedThisTurn ?? true,
      smsThisTurn: false,
      slotsOffered: false,
      missingVariables: [],
      endReached: false
    },
    executedNodes: [],
    toolCalls: []
  };
}

function smsProviders(sendSpy: { calls: number }): AgentProviders {
  return {
    sms: {
      send: async () => {
        sendSpy.calls += 1;
        return { status: "simulated", note: "test" };
      }
    }
  } as unknown as AgentProviders;
}

const smsNode = { id: "sms-1", data: { type: VOICE_NODE_TYPES.sendSms } };

describe("simulated SMS handler requires consent (never auto-sends on booking)", () => {
  it("booking success alone does NOT send — smsRequested must be true", async () => {
    const spy = { calls: 0 };
    const context = smsRunContext({ smsRequested: false, smsDeclined: false, bookedThisTurn: true });
    const result = await executeNode(smsNode, context, smsProviders(spy));
    expect(result.status).toBe("skipped");
    expect(spy.calls).toBe(0);
    expect(context.turn.smsThisTurn).toBe(false);
  });

  it("a decline blocks the send even after a booking", async () => {
    const spy = { calls: 0 };
    const context = smsRunContext({ smsRequested: true, smsDeclined: true, bookedThisTurn: true });
    const result = await executeNode(smsNode, context, smsProviders(spy));
    expect(result.status).toBe("skipped");
    expect(spy.calls).toBe(0);
  });

  it("a clear yes (smsRequested, not declined) sends the simulated SMS", async () => {
    const spy = { calls: 0 };
    const context = smsRunContext({ smsRequested: true, smsDeclined: false, bookedThisTurn: true });
    const result = await executeNode(smsNode, context, smsProviders(spy));
    expect(result.status).toBe("executed");
    expect(spy.calls).toBe(1);
    expect(context.turn.smsThisTurn).toBe(true);
  });
});
