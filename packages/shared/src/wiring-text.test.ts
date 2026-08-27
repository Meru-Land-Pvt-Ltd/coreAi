import { describe, expect, it } from "vitest";
import { checkWiring } from "./wiring-check.js";

/**
 * THE COMMONEST MISTAKE ON A CANVAS (2026-08-27).
 *
 * A Result Viewer with nothing feeding it. An AI Brain wired to no input. All
 * four of the steps that declare they need "text" were painted green with no
 * wire at all, because "text" sat in the list of things the platform always
 * provides — so the one check whose whole job is catching an unwired step
 * could never catch the commonest one.
 *
 * Everything else in that list really is filled in by the platform. "text" is
 * what an earlier step hands over.
 */

const node = (id: string, type: string) => ({
  id,
  data: { type, nodeKind: type.startsWith("block.") ? "block" : "ai" }
});

describe("a step that needs text must be given text", () => {
  it("says so when nothing feeds the Result Viewer", () => {
    const result = checkWiring({
      nodes: [node("brain", "ai.llm_call"), node("viewer", "block.output_stage")],
      edges: []
    } as never);

    /* Assert on the problems, not the whole result — healthyNodeIds lists
       every node id, so a crude string search always "matches". */
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.problems)).toContain("viewer");
  });

  it("says nothing once it is wired", () => {
    const wired = checkWiring({
      nodes: [
        { id: "box", data: { type: "block.prompt_composer", nodeKind: "block" } },
        node("brain", "ai.llm_call"),
        node("viewer", "block.output_stage")
      ],
      edges: [
        { id: "e1", source: "box", target: "brain" },
        { id: "e2", source: "brain", target: "viewer" }
      ]
    } as never);

    /* The viewer is fed by the brain, and the brain by the box. Nothing to
       report — a check that cries wolf is a check nobody reads. */
    expect(JSON.stringify(wired.problems)).not.toContain("viewer");
    expect(wired.healthyNodeIds).toContain("viewer");
  });
});
