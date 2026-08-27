import { describe, expect, it } from "vitest";
import { wayInFor } from "./the-door";

/**
 * THE DOOR'S EXAMS (2026-08-27) — the frontend wing of the Examination Hall.
 *
 * The old preview dressed a Telegram agent as a website because its judgement
 * was "otherwise: chat." These exams make that mistake impossible to ship
 * again: the door's judgement is pure, so it is graded here without a model
 * in the room — the same discipline the Builder's exams follow.
 */

const graph = (...types: string[]) => ({
  nodes: types.map((type, index) => ({ id: `n${index}`, data: { type } }))
});

describe("the door's judgement", () => {
  it("a Telegram agent is never dressed as a website", () => {
    const door = wayInFor(graph("trigger.telegram_message", "ai.llm_call", "action.telegram_send_message"));
    expect(door.kind).toBe("telegram");
    expect(door.why).toContain("Telegram");
  });

  it("an email agent is met as an inbox", () => {
    expect(wayInFor(graph("trigger.email_received", "ai.llm_call", "communication.send_email")).kind).toBe("email");
  });

  it("a WhatsApp agent is met as a chat app", () => {
    expect(wayInFor(graph("trigger.whatsapp_message_received", "ai.llm_call")).kind).toBe("whatsapp");
  });

  it("a clock agent is met as a clock, even with brains and hands aboard", () => {
    expect(wayInFor(graph("trigger.schedule", "ai.memory", "ai.llm_call", "communication.send_email")).kind).toBe(
      "clock"
    );
  });

  it("a webhook agent is met as its private link", () => {
    expect(wayInFor(graph("trigger.webhook", "ai.llm_call", "communication.send_email")).kind).toBe("webhook");
  });

  it("a Calendly agent is met as its booking events", () => {
    expect(wayInFor(graph("trigger.calendly", "ai.llm_call")).kind).toBe("calendly");
  });

  it("a page product is met as its page", () => {
    expect(
      wayInFor(graph("trigger.manual", "block.prompt_composer", "ai.llm_call", "block.output_stage")).kind
    ).toBe("page");
  });

  it("an empty canvas says so honestly — no costume", () => {
    expect(wayInFor({ nodes: [] }).kind).toBe("empty");
    expect(wayInFor(undefined).kind).toBe("empty");
  });

  it("every judgement carries its why, in plain words", () => {
    for (const g of [
      graph("trigger.telegram_message"),
      graph("trigger.schedule"),
      graph("trigger.manual", "block.prompt_composer")
    ]) {
      expect(wayInFor(g).why.length).toBeGreaterThan(15);
    }
  });
});
