import { describe, it, expect } from "vitest";
import { toBuilderNodes, toBuilderEdges, parseNodes } from "./parsers";

/**
 * One door onto the canvas.
 *
 * The AI composer used to put its result on the canvas raw, behind a cast the
 * type checker could not see through. React Flow only draws nodes whose type it
 * has been given — "coreNode" — so everything the composer built appeared as
 * plain grey stock boxes beside the coloured cards a person dragged in. A page
 * reload fixed them, because reloading came through here.
 *
 * These pin the door shut.
 */

const composerOutput = [
  {
    id: "1",
    type: "builder",
    position: { x: 120, y: 120 },
    data: { title: "Start Here", label: "Start Here", type: "trigger.manual", nodeKind: "trigger" }
  },
  {
    id: "2",
    type: "builder",
    position: { x: 460, y: 120 },
    data: { title: "AI Receptionist", label: "AI Receptionist", type: "ai.voice_conversation", nodeKind: "ai" }
  }
];

describe("everything that reaches the canvas comes through one door", () => {
  it("turns what the composer sends into nodes React Flow will actually draw", () => {
    const nodes = toBuilderNodes(composerOutput);
    expect(nodes).toHaveLength(2);
    // The whole bug in one line: anything else and React Flow draws its own
    // grey box instead of ours.
    expect(nodes.every((node) => node.type === "coreNode")).toBe(true);
  });

  it("gives every node the look its kind is supposed to have", () => {
    const [trigger, ai] = toBuilderNodes(composerOutput);
    // A colour and an icon, so a composed agent is indistinguishable from one
    // built by hand — which is the point the founder made.
    expect(trigger.data.accent).toBeTruthy();
    expect(trigger.data.icon).toBeTruthy();
    expect(ai.data.accent).toBeTruthy();
    expect(ai.data.icon).toBeTruthy();
  });

  it("keeps the architect's own titles rather than overwriting them", () => {
    const [trigger] = toBuilderNodes(composerOutput);
    expect(trigger.data.title).toBe("Start Here");
    expect(trigger.data.type).toBe("trigger.manual");
  });

  it("drops anything that is not a node instead of putting a broken one on screen", () => {
    expect(toBuilderNodes([{ nope: true }, null, "x", ...composerOutput])).toHaveLength(2);
    expect(toBuilderNodes(undefined)).toEqual([]);
    expect(toBuilderNodes(null)).toEqual([]);
  });

  it("keeps the wires", () => {
    const edges = toBuilderEdges([{ id: "e1", source: "1", target: "2" }, { broken: true }]);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("1");
  });

  it("loading a saved agent uses the same door", () => {
    const nodes = parseNodes({ workflowJson: { nodes: composerOutput } } as never);
    expect(nodes.every((node) => node.type === "coreNode")).toBe(true);
  });
});
