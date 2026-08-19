import { describe, it, expect } from "vitest";
import { nodesSwitchedOffByConditions } from "./workflow-runner";

/**
 * Branching used to be decorative: the canvas drew a Yes line and a No line
 * and the engine ran both. These lock in that it now follows exactly one.
 */
const node = (id: string) => ({ id, data: {}, position: { x: 0, y: 0 } }) as never;
const edge = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, sourceHandle }) as never;

describe("condition branching", () => {
  const nodes = [node("start"), node("cond"), node("yes"), node("no"), node("end")];
  const edges = [
    edge("e1", "start", "cond"),
    edge("e2", "cond", "yes", "yes"),
    edge("e3", "cond", "no", "no"),
    edge("e4", "yes", "end"),
    edge("e5", "no", "end")
  ];

  it("switches off the No branch when the answer is yes", () => {
    const off = nodesSwitchedOffByConditions(nodes, edges, { cond: true });
    expect(off.has("no")).toBe(true);
    expect(off.has("yes")).toBe(false);
  });

  it("switches off the Yes branch when the answer is no", () => {
    const off = nodesSwitchedOffByConditions(nodes, edges, { cond: false });
    expect(off.has("yes")).toBe(true);
    expect(off.has("no")).toBe(false);
  });

  it("keeps a step both branches lead to", () => {
    // "end" is reachable whichever way the flow went — switching it off
    // because one branch closed would break every join in every agent.
    expect(nodesSwitchedOffByConditions(nodes, edges, { cond: true }).has("end")).toBe(false);
    expect(nodesSwitchedOffByConditions(nodes, edges, { cond: false }).has("end")).toBe(false);
  });

  it("switches off everything downstream of a closed branch", () => {
    const deep = [...nodes, node("after-no")];
    const deepEdges = [...edges, edge("e6", "no", "after-no")];
    const off = nodesSwitchedOffByConditions(deep, deepEdges, { cond: true });
    expect(off.has("after-no")).toBe(true);
  });

  it("runs an unlabelled line rather than guessing which side it meant", () => {
    const plain = [node("start"), node("cond"), node("next")];
    const plainEdges = [edge("e1", "start", "cond"), edge("e2", "cond", "next")];
    expect(nodesSwitchedOffByConditions(plain, plainEdges, { cond: false }).size).toBe(0);
  });

  it("changes nothing when there are no conditions", () => {
    expect(nodesSwitchedOffByConditions(nodes, edges, {}).size).toBe(0);
  });
});
