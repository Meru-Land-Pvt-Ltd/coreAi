import { describe, expect, it } from "vitest";
import {
  applyTidyPositions,
  computeTidyPositions,
  tidyLaneFor,
  TIDY_COLUMN_SPACING,
  TIDY_COLUMN_X_START,
  TIDY_ROW_SPACING,
  TIDY_ROW_Y_START,
  type TidyEdge,
  type TidyNode
} from "./layout-graph";

/**
 * "Clean up" layout — deterministic layered columns:
 *   col 0 Face inputs · col 1 brains+logic (BFS depth) · col 2 hands/actions
 *   · col 3 Face outputs · Design Brain parked bottom-left.
 */

/** Canvas node footprint (w-56 ≈ 224px wide, tallest cards ≈ 170px). */
const NODE_WIDTH = 224;
const NODE_HEIGHT = 170;

function node(
  id: string,
  type: string,
  nodeKind: string,
  position: { x: number; y: number }
): TidyNode {
  return { id, position, data: { type, nodeKind } };
}

function columnX(column: number): number {
  return TIDY_COLUMN_X_START + column * TIDY_COLUMN_SPACING;
}

function assertNoOverlaps(positions: Map<string, { x: number; y: number }>) {
  const entries = [...positions.entries()];
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const [idA, posA] = entries[a];
      const [idB, posB] = entries[b];
      const overlaps =
        Math.abs(posA.x - posB.x) < NODE_WIDTH && Math.abs(posA.y - posB.y) < NODE_HEIGHT;
      expect(overlaps, `${idA} overlaps ${idB}`).toBe(false);
    }
  }
}

/**
 * The Yatra shape: an Image Studio product page — four Face input blocks
 * feeding an image brain, the result landing on an output stage + history
 * shelf, with the Design Brain sitting beside the flow. Positions are
 * deliberately messy (as after a real building session).
 */
function yatraGraph(): { nodes: TidyNode[]; edges: TidyEdge[] } {
  const nodes: TidyNode[] = [
    node("blk-styles", "block.preset_gallery", "block", { x: 430, y: 320 }),
    node("blk-composer", "block.prompt_composer", "block", { x: 120, y: 60 }),
    node("blk-models", "block.model_picker", "block", { x: 90, y: 610 }),
    node("blk-button", "block.action_button", "block", { x: 260, y: 900 }),
    node("brain-image", "ai.image_generation", "ai", { x: 700, y: 380 }),
    node("blk-output", "block.output_stage", "block", { x: 1100, y: 240 }),
    node("blk-history", "block.history_shelf", "block", { x: 1080, y: 760 }),
    node("design-brain", "design.brain", "block", { x: 950, y: 30 })
  ];
  const edges: TidyEdge[] = [
    { source: "blk-composer", target: "brain-image" },
    { source: "blk-styles", target: "brain-image" },
    { source: "blk-models", target: "brain-image" },
    { source: "blk-button", target: "brain-image" },
    { source: "brain-image", target: "blk-output" },
    { source: "brain-image", target: "blk-history" }
  ];
  return { nodes, edges };
}

describe("tidyLaneFor", () => {
  it("classifies every piece into its column", () => {
    expect(tidyLaneFor(node("a", "block.prompt_composer", "block", { x: 0, y: 0 }))).toBe(0);
    expect(tidyLaneFor(node("b", "block.preset_gallery", "block", { x: 0, y: 0 }))).toBe(0);
    expect(tidyLaneFor(node("c", "block.model_picker", "block", { x: 0, y: 0 }))).toBe(0);
    expect(tidyLaneFor(node("d", "block.action_button", "block", { x: 0, y: 0 }))).toBe(0);
    expect(tidyLaneFor(node("e", "block.file_upload", "block", { x: 0, y: 0 }))).toBe(0);
    expect(tidyLaneFor(node("f", "ai.image_generation", "ai", { x: 0, y: 0 }))).toBe(1);
    expect(tidyLaneFor(node("g", "trigger.manual", "trigger", { x: 0, y: 0 }))).toBe(1);
    expect(tidyLaneFor(node("h", "logic.if", "condition", { x: 0, y: 0 }))).toBe(1);
    expect(tidyLaneFor(node("i", "action.send_sms", "connector", { x: 0, y: 0 }))).toBe(2);
    expect(tidyLaneFor(node("j", "core.save_lead", "output", { x: 0, y: 0 }))).toBe(2);
    expect(tidyLaneFor(node("k", "block.output_stage", "block", { x: 0, y: 0 }))).toBe(3);
    expect(tidyLaneFor(node("l", "block.history_shelf", "block", { x: 0, y: 0 }))).toBe(3);
    expect(tidyLaneFor(node("m", "design.brain", "block", { x: 0, y: 0 }))).toBe("parked");
  });
});

describe("computeTidyPositions — Yatra-shaped graph", () => {
  it("puts every piece in its deterministic column", () => {
    const { nodes, edges } = yatraGraph();
    const positions = computeTidyPositions(nodes, edges);

    // Column 0: the four Face input blocks.
    for (const id of ["blk-composer", "blk-styles", "blk-models", "blk-button"]) {
      expect(positions.get(id)!.x, id).toBe(columnX(0));
    }
    // Column 1: the image brain.
    expect(positions.get("brain-image")!.x).toBe(columnX(1));
    // Column 3: the Face output blocks.
    expect(positions.get("blk-output")!.x).toBe(columnX(3));
    expect(positions.get("blk-history")!.x).toBe(columnX(3));
  });

  it("stacks column 0 by the blocks' current y-order", () => {
    const { nodes, edges } = yatraGraph();
    const positions = computeTidyPositions(nodes, edges);

    // Current y order: composer (60) < styles (320) < models (610) < button (900).
    expect(positions.get("blk-composer")!.y).toBe(TIDY_ROW_Y_START);
    expect(positions.get("blk-styles")!.y).toBe(TIDY_ROW_Y_START + TIDY_ROW_SPACING);
    expect(positions.get("blk-models")!.y).toBe(TIDY_ROW_Y_START + 2 * TIDY_ROW_SPACING);
    expect(positions.get("blk-button")!.y).toBe(TIDY_ROW_Y_START + 3 * TIDY_ROW_SPACING);
  });

  it("parks the Design Brain bottom-left, below every column", () => {
    const { nodes, edges } = yatraGraph();
    const positions = computeTidyPositions(nodes, edges);
    const parked = positions.get("design-brain")!;

    expect(parked.x).toBe(TIDY_COLUMN_X_START);
    for (const [id, pos] of positions) {
      if (id === "design-brain") continue;
      expect(parked.y, `parked below ${id}`).toBeGreaterThan(pos.y);
    }
  });

  it("never overlaps two pieces", () => {
    const { nodes, edges } = yatraGraph();
    assertNoOverlaps(computeTidyPositions(nodes, edges));
  });

  it("is deterministic: same result on repeat runs and shuffled input order", () => {
    const { nodes, edges } = yatraGraph();
    const first = computeTidyPositions(nodes, edges);
    const second = computeTidyPositions(nodes, edges);
    const shuffled = computeTidyPositions(
      [...nodes].reverse(),
      [...edges].reverse()
    );

    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
    expect(Object.fromEntries(shuffled)).toEqual(Object.fromEntries(first));
  });
});

describe("computeTidyPositions — BFS ordering and bigger canvases", () => {
  it("orders column 1 by BFS depth from the inputs (upstream above downstream)", () => {
    // composer -> brain-a -> brain-b (brain-b sits ABOVE brain-a on the messy
    // canvas; depth must win over current y).
    const nodes = [
      node("blk-composer", "block.prompt_composer", "block", { x: 0, y: 0 }),
      node("brain-b", "ai.llm_call", "ai", { x: 500, y: 10 }),
      node("brain-a", "ai.llm_call", "ai", { x: 500, y: 400 })
    ];
    const edges: TidyEdge[] = [
      { source: "blk-composer", target: "brain-a" },
      { source: "brain-a", target: "brain-b" }
    ];

    const positions = computeTidyPositions(nodes, edges);
    expect(positions.get("brain-a")!.x).toBe(columnX(1));
    expect(positions.get("brain-b")!.x).toBe(columnX(1));
    expect(positions.get("brain-a")!.y).toBeLessThan(positions.get("brain-b")!.y);
  });

  it("keeps 30 mixed pieces on the grid with zero overlaps", () => {
    const kinds = [
      { type: "block.prompt_composer", nodeKind: "block" },
      { type: "ai.llm_call", nodeKind: "ai" },
      { type: "action.send_sms", nodeKind: "connector" },
      { type: "block.output_stage", nodeKind: "block" },
      { type: "trigger.manual", nodeKind: "trigger" },
      { type: "design.brain", nodeKind: "block" }
    ];
    const nodes = Array.from({ length: 30 }, (_, index) => {
      const kind = kinds[index % kinds.length];
      // Deliberately collide everything on the same messy spot.
      return node(`piece-${index}`, kind.type, kind.nodeKind, { x: 100, y: 100 });
    });
    const edges: TidyEdge[] = [];

    const positions = computeTidyPositions(nodes, edges);
    expect(positions.size).toBe(30);
    assertNoOverlaps(positions);
  });

  it("handles an empty canvas and unknown pieces without dropping anything", () => {
    expect(computeTidyPositions([], []).size).toBe(0);

    const mystery = [node("mystery", "", "", { x: 5, y: 5 })];
    const positions = computeTidyPositions(mystery, []);
    expect(positions.get("mystery")).toEqual({ x: columnX(1), y: TIDY_ROW_Y_START });
  });
});

describe("applyTidyPositions", () => {
  it("moves messy nodes and reports moved=true", () => {
    const { nodes, edges } = yatraGraph();
    const result = applyTidyPositions(nodes, edges);

    expect(result.moved).toBe(true);
    const composer = result.nodes.find((entry) => entry.id === "blk-composer")!;
    expect(composer.position).toEqual({ x: columnX(0), y: TIDY_ROW_Y_START });
  });

  it("returns the same array untouched when the canvas is already tidy", () => {
    const { nodes, edges } = yatraGraph();
    const tidiedOnce = applyTidyPositions(nodes, edges).nodes;
    const second = applyTidyPositions(tidiedOnce, edges);

    expect(second.moved).toBe(false);
    expect(second.nodes).toBe(tidiedOnce);
  });
});
