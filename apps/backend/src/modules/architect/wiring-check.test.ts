import { describe, it, expect } from "vitest";
import { checkWiring, tokensUsedBy } from "@coreai/shared";

/**
 * The spine: does every step get the data it needs?
 *
 * The failure this exists for is the one the founder described — a step wired
 * to a value that never arrives. Nothing looks broken. The run completes. The
 * business quietly gets nothing.
 *
 * The second thing these tests protect is the opposite risk. A check that
 * flags working orchestrations is worse than no check, because after the first
 * false alarm nobody reads the second one. So there are as many tests here for
 * what must NOT be flagged as for what must.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({
  id,
  data: { type, title: id, ...data }
});

describe("a promise nothing keeps", () => {
  it("catches a step using a value no earlier step produces", () => {
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("sms", "action.send_sms", { smsBody: "Your booking is {{appointment.confirmation_id}}" })
      ],
      edges: [{ source: "t", target: "sms" }]
    });

    expect(result.ok).toBe(false);
    expect(result.problems[0].wanted).toBe("appointment.confirmation_id");
    expect(result.problems[0].message).toContain("empty every time");
  });

  it("is happy once a step upstream produces it", () => {
    // A realistic flow: the voice conversation is what learns the customer's
    // name, the service and the slot, which is why the booking step needs it
    // in front of it.
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("talk", "ai.voice_conversation"),
        node("book", "calendar.book_appointment"),
        node("sms", "action.send_sms", { smsBody: "Your booking is {{calendarAppointment}}" })
      ],
      edges: [
        { source: "t", target: "talk" },
        { source: "talk", target: "book" },
        { source: "book", target: "sms" }
      ]
    });
    expect(result.ok).toBe(true);
  });

  it("catches a booking step with no conversation in front of it", () => {
    // The booking step learns who it is booking from the conversation. Wired
    // straight to the trigger it has no name, no service and no slot — and
    // would have run anyway.
    const result = checkWiring({
      nodes: [node("t", "trigger.phone_call"), node("book", "calendar.book_appointment")],
      edges: [{ source: "t", target: "book" }]
    });
    /* The name and phone are values the platform can supply from the call
       itself. The TIME is not — either a conversation produces it or the
       architect types it into the node's own box. The voice era called it
       "selected.slot"; what this engine writes and reads is
       appointmentStartAt, and each engine now asks in its own words. */
    expect(result.problems.some((problem) => problem.wanted === "appointmentStartAt")).toBe(true);
  });

  it("catches a typo, which is the whole point", () => {
    // Found in a real production workflow: an architect wrote "bussiness".
    // Nothing complained, and it has rendered empty ever since.
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("sms", "action.send_sms", { smsBody: "We do {{bussiness.service}}" })
      ],
      edges: [{ source: "t", target: "sms" }]
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0].wanted).toBe("bussiness.service");
  });

  it("still catches it when the producing step is on a different branch", () => {
    // The value exists somewhere on the canvas but not on the path to this
    // step, which is the version of this bug that looks fine at a glance.
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("talk", "ai.voice_conversation"),
        node("book", "calendar.book_appointment"),
        node("sms", "action.send_sms", { smsBody: "Ref {{calendarAppointment}}" })
      ],
      edges: [
        { source: "t", target: "talk" },
        { source: "talk", target: "book" },
        { source: "t", target: "sms" }
      ]
    });
    expect(result.ok).toBe(false);
  });
});

describe("what must never be flagged", () => {
  it("leaves alone a value the business fills in", () => {
    // {{business.teamPhone}} is the architect saying "only they know this" —
    // it becomes a question on their setup form, not a gap.
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("sms", "action.send_sms", { smsTo: "{{business.teamPhone}}", smsBody: "Hello" })
      ],
      edges: [{ source: "t", target: "sms" }]
    });
    expect(result.ok).toBe(true);
  });

  it("leaves alone the values every run carries", () => {
    const result = checkWiring({
      nodes: [
        node("t", "trigger.manual"),
        node("ai", "ai.llm_call", { prompt: "You work for {{business_name}}. They said {{latestMessage}}." })
      ],
      edges: [{ source: "t", target: "ai" }]
    });
    expect(result.ok).toBe(true);
  });

  it("does not read a label or an icon as a promise about data", () => {
    const result = checkWiring({
      nodes: [node("t", "trigger.manual", { title: "{{something}}", icon: "{{else}}" })],
      edges: []
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a near-miss in shape rather than crying wolf", () => {
    // A step producing "callerNumber" satisfies a reference to
    // "callerNumber.formatted". One false alarm costs more than one missed
    // warning, because after the first nobody reads the second.
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("sms", "action.send_sms", { smsTo: "{{callerNumber.formatted}}" })
      ],
      edges: [{ source: "t", target: "sms" }]
    });
    expect(result.ok).toBe(true);
  });
});

describe("a step nothing leads to", () => {
  it("is caught, because it will never run", () => {
    const result = checkWiring({
      nodes: [node("t", "trigger.phone_call"), node("stray", "action.send_sms", { smsBody: "Hi" })],
      edges: []
    });
    expect(result.problems.some((problem) => problem.kind === "unreachable")).toBe(true);
  });

  it("says nothing about an orchestration with no trigger yet", () => {
    // Half-built is normal while an architect is working. Shouting at every
    // node on a canvas mid-build is how a warning becomes wallpaper.
    const result = checkWiring({
      nodes: [node("sms", "action.send_sms", { smsBody: "Hi" })],
      edges: []
    });
    expect(result.problems.some((problem) => problem.kind === "unreachable")).toBe(false);
  });
});

describe("what the canvas paints green", () => {
  it("names the healthy steps, not just the broken ones", () => {
    const result = checkWiring({
      nodes: [
        node("t", "trigger.phone_call"),
        node("ok", "action.send_sms", { smsTo: "{{callerNumber}}", smsBody: "Hi" }),
        node("bad", "action.send_sms", { smsTo: "{{nowhere.at.all}}", smsBody: "Hi" })
      ],
      edges: [
        { source: "t", target: "ok" },
        { source: "ok", target: "bad" }
      ]
    });

    expect(result.healthyNodeIds).toContain("t");
    expect(result.healthyNodeIds).toContain("ok");
    expect(result.healthyNodeIds).not.toContain("bad");
  });
});

describe("reading what the architect wrote", () => {
  it("finds tokens wherever they are, including inside a list", () => {
    const found = tokensUsedBy({
      id: "n",
      data: { type: "x", body: "Hi {{a}}", items: ["{{b}}", { deep: "{{c}}" }] }
    });
    expect(found.sort()).toEqual(["a", "b", "c"]);
  });
});
