import { describe, it, expect } from "vitest";
import { checkPlan, type ComposerPlan } from "./check-plan";
import type { MenuEntry } from "./node-menu";
import { planToCanvas } from "./to-canvas";

/**
 * The composer may propose anything; this decides whether it holds.
 *
 * Every test here is a way a plan can look finished and do nothing — which is
 * the only failure that matters, because an architect trusts what appears on
 * their canvas.
 */

const menu: MenuEntry[] = [
  { type: "trigger.phone_call", label: "Incoming call", does: "A call arrives.", kind: "trigger", needs: [], gives: ["callerNumber"], reachesTheWorld: false },
  { type: "trigger.manual", label: "Start here", does: "Started by hand.", kind: "trigger", needs: [], gives: [], reachesTheWorld: false },
  { type: "ai.voice_conversation", label: "AI receptionist", does: "Talks to the caller.", kind: "ai", needs: [], gives: ["transcript"], reachesTheWorld: true },
  { type: "action.send_sms", label: "Send text", does: "Sends a text.", kind: "connector", needs: ["smsTo", "smsBody"], gives: [], reachesTheWorld: true },
  { type: "logic.condition", label: "Condition", does: "Branches.", kind: "condition", needs: [], gives: [], reachesTheWorld: false }
];

const plan = (over: Partial<ComposerPlan> = {}): ComposerPlan => ({
  summary: "Answers the phone.",
  nodes: [
    { id: "t", type: "trigger.phone_call", title: "Someone calls" },
    { id: "ai", type: "ai.voice_conversation", title: "Talk to them" }
  ],
  edges: [{ from: "t", to: "ai" }],
  ...over
});

describe("a plan that holds", () => {
  it("passes", () => {
    expect(checkPlan(plan(), menu)).toEqual([]);
  });
});

describe("a step that does not exist", () => {
  it("is refused by name", () => {
    // The single most important check. A made-up type produces a canvas that
    // looks finished and does nothing at all.
    const problems = checkPlan(
      plan({
        nodes: [
          { id: "t", type: "trigger.phone_call" },
          { id: "x", type: "action.send_carrier_pigeon" }
        ],
        edges: [{ from: "t", to: "x" }]
      }),
      menu
    );
    expect(problems.join(" ")).toContain("action.send_carrier_pigeon");
    expect(problems.join(" ")).toContain("not a step that exists");
  });
});

describe("the way in", () => {
  it("refuses a plan nothing starts", () => {
    const problems = checkPlan(
      plan({ nodes: [{ id: "ai", type: "ai.voice_conversation" }], edges: [] }),
      menu
    );
    expect(problems.join(" ")).toContain("Nothing starts this agent");
  });

  it("refuses two triggers", () => {
    const problems = checkPlan(
      plan({
        nodes: [
          { id: "t1", type: "trigger.phone_call" },
          { id: "t2", type: "trigger.manual" },
          { id: "ai", type: "ai.voice_conversation" }
        ],
        edges: [
          { from: "t1", to: "ai" },
          { from: "t2", to: "ai" }
        ]
      }),
      menu
    );
    expect(problems.join(" ")).toContain("2 triggers");
  });
});

describe("the wires", () => {
  it("refuses a wire pointing at nothing", () => {
    const problems = checkPlan(plan({ edges: [{ from: "t", to: "ghost" }] }), menu);
    expect(problems.join(" ")).toContain("ghost");
  });

  it("refuses a step nothing ever reaches", () => {
    // A step with no way in reads as a feature on the canvas and is a blank on
    // the day somebody needs it.
    const problems = checkPlan(
      plan({
        nodes: [
          { id: "t", type: "trigger.phone_call" },
          { id: "ai", type: "ai.voice_conversation" },
          { id: "stray", type: "action.send_sms", config: { smsTo: "x", smsBody: "y" } }
        ],
        edges: [{ from: "t", to: "ai" }]
      }),
      menu
    );
    expect(problems.join(" ")).toContain("Nothing ever reaches \"stray\"");
  });

  it("refuses a loop, which would never finish", () => {
    const problems = checkPlan(
      plan({
        nodes: [
          { id: "t", type: "trigger.phone_call" },
          { id: "a", type: "ai.voice_conversation" },
          { id: "b", type: "logic.condition" }
        ],
        edges: [
          { from: "t", to: "a" },
          { from: "a", to: "b" },
          { from: "b", to: "a" }
        ]
      }),
      menu
    );
    expect(problems.join(" ")).toContain("loop");
  });
});

describe("settings a step cannot run without", () => {
  it("refuses a step left unfilled", () => {
    const problems = checkPlan(
      plan({
        nodes: [
          { id: "t", type: "trigger.phone_call" },
          { id: "s", type: "action.send_sms", config: { smsTo: "+1555" } }
        ],
        edges: [{ from: "t", to: "s" }]
      }),
      menu
    );
    expect(problems.join(" ")).toContain("smsBody");
  });

  it("accepts one the business will fill in", () => {
    // {{business.x}} is the composer saying "only they know this" — which is
    // right, and far better than inventing somebody's phone number.
    const problems = checkPlan(
      plan({
        nodes: [
          { id: "t", type: "trigger.phone_call" },
          { id: "s", type: "action.send_sms", config: { smsTo: "{{business.teamPhone}}", smsBody: "Hello" } }
        ],
        edges: [{ from: "t", to: "s" }]
      }),
      menu
    );
    expect(problems).toEqual([]);
  });
});

describe("what lands on the canvas", () => {
  const built = planToCanvas(
    plan({
      nodes: [
        { id: "t", type: "trigger.phone_call", title: "Someone rings the practice" },
        { id: "ai", type: "ai.voice_conversation", title: "Maya answers" },
        { id: "s", type: "action.send_sms", title: "Text them back", config: { smsBody: "Hi" } }
      ],
      edges: [
        { from: "t", to: "ai" },
        { from: "ai", to: "s" }
      ]
    })
  );

  it("reads left to right, in the order things happen", () => {
    const x = built.nodes.map((node) => node.position.x);
    expect(x[0]).toBeLessThan(x[1]);
    expect(x[1]).toBeLessThan(x[2]);
  });

  it("never overlaps two steps", () => {
    const seen = new Set(built.nodes.map((node) => `${node.position.x}:${node.position.y}`));
    expect(seen.size).toBe(built.nodes.length);
  });

  it("shows the architect's own words, never the type name", () => {
    expect(built.nodes[0].data.title).toBe("Someone rings the practice");
    expect(String(built.nodes[0].data.title)).not.toContain("trigger.");
  });

  it("keeps the settings the composer filled in", () => {
    expect(built.nodes[2].data.smsBody).toBe("Hi");
  });

  it("wires every edge it was given", () => {
    expect(built.edges).toHaveLength(2);
    expect(built.edges[0].source).toBe("t");
    expect(built.edges[0].target).toBe("ai");
  });
});
