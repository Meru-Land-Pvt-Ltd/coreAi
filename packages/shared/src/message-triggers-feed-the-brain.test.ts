import { describe, expect, it } from "vitest";
import { checkWiring } from "./wiring-check.js";
import { getNodeDefinition } from "./node-registry.js";

/**
 * A CORRECTLY WIRED AGENT MUST NOT BE CALLED BROKEN (2026-08-28).
 *
 * Removing "text" from the always-available list was right — it is what
 * finally catches a step wired to nothing. But every trigger that carries a
 * person's message was silent about giving one. The engine hands it over on
 * every run and the AI Brain reads it; the rows just never said so. So the
 * founder opened his own Telegram agent, correctly wired, and the canvas
 * told him it was broken.
 *
 * The other half of the same fault is in the runner: the doors call it
 * `latestMessage`, the rows all ask for `text`, and nothing joined the two.
 */

/** Triggers where a person actually says something. */
const CARRIES_A_MESSAGE = [
  "trigger.telegram_message",
  "trigger.whatsapp_message_received",
  "trigger.twilio_inbound_sms",
  "trigger.email_received"
];

/**
 * Triggers where NOBODY says anything — a clock tick, a missed call, a
 * booking, a list of numbers to ring. A red mark on these is the check doing
 * its job, and this test exists so nobody "fixes" it by declaring a message
 * that never arrives.
 */
const CARRIES_NO_MESSAGE = [
  "trigger.schedule",
  "trigger.twilio_missed_call",
  "trigger.calendly",
  "trigger.call_list"
];

const brainAfter = (triggerType: string) =>
  checkWiring({
    nodes: [
      { id: "trig", data: { type: triggerType, nodeKind: "trigger" } },
      { id: "brain", data: { type: "ai.llm_call", nodeKind: "ai" } }
    ],
    edges: [{ id: "e1", source: "trig", target: "brain" }]
  } as never);

describe("a trigger that carries a person's message says so", () => {
  for (const type of CARRIES_A_MESSAGE) {
    it(`${type} declares the message it delivers`, () => {
      expect(getNodeDefinition(type)?.producedVariables ?? []).toContain("text");
    });

    it(`${type} wired to an AI Brain is not called broken`, () => {
      expect(brainAfter(type).problems).toEqual([]);
    });
  }
});

describe("a trigger where nobody speaks is still marked", () => {
  for (const type of CARRIES_NO_MESSAGE) {
    it(`${type} into an AI Brain is reported, because there really is no message`, () => {
      /* Not a bug to be fixed by declaring something untrue. A schedule tick
         has no customer and no words; an architect wiring a Brain straight
         to one needs to hear that. */
      expect(brainAfter(type).problems.length).toBeGreaterThan(0);
    });
  }
});
