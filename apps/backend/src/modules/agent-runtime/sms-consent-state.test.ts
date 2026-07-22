import { describe, expect, it } from "vitest";
import {
  affirmsOffer,
  inferConversationState,
  offersTextConfirmation,
  type AgentMessage
} from "./runtime-context";

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
});
