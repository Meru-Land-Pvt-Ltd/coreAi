import { describe, expect, it } from "vitest";
import { deriveFaceBlueprint, type FaceBlueprint } from "./blueprint";

/**
 * Face Blueprint derivation: null unless the graph has block.* nodes, blocks
 * ordered by canvas position (y then x, array order when positions are
 * missing), configs zod-sanitized (presets capped at 8, options at 6, strings
 * at 120 chars) and malformed configs tolerated instead of thrown on.
 */

/** Canvas node in the shape the builder serializes (see blueprint.ts header). */
function canvasNode(
  type: string,
  position: { x: number; y: number } | null,
  config: Record<string, unknown> = {}
) {
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 8)}`,
    type: "coreNode",
    position: position ?? undefined,
    data: { type, nodeKind: "block", title: type, ...config }
  };
}

/** Blocks minus the nodeId (which the helper randomizes; asserted in its own
 * describe below) so config/order tests can keep exact toEqual shapes. */
function blockShapes(blueprint: FaceBlueprint | null) {
  return blueprint?.blocks.map(({ type, config }) => ({ type, config }));
}

describe("deriveFaceBlueprint", () => {
  it("returns null for non-object / null / missing nodes input", () => {
    expect(deriveFaceBlueprint(null)).toBeNull();
    expect(deriveFaceBlueprint(undefined)).toBeNull();
    expect(deriveFaceBlueprint("nope")).toBeNull();
    expect(deriveFaceBlueprint({})).toBeNull();
    expect(deriveFaceBlueprint({ nodes: "broken" })).toBeNull();
  });

  it("returns null when the graph has no block nodes (default Face is kept)", () => {
    const workflowJson = {
      nodes: [
        { id: "t1", type: "coreNode", position: { x: 0, y: 0 }, data: { type: "trigger.manual", nodeKind: "trigger" } },
        { id: "a1", type: "coreNode", position: { x: 200, y: 0 }, data: { type: "ai.llm_call", nodeKind: "ai" } }
      ],
      edges: [{ id: "e1", source: "t1", target: "a1" }]
    };
    expect(deriveFaceBlueprint(workflowJson)).toBeNull();
  });

  it("orders blocks by canvas position — y first, then x — ignoring non-block nodes", () => {
    const workflowJson = {
      nodes: [
        canvasNode("block.output_stage", { x: 0, y: 300 }),
        { id: "a1", type: "coreNode", position: { x: 0, y: 0 }, data: { type: "ai.llm_call", nodeKind: "ai" } },
        canvasNode("block.continue_chain", { x: 400, y: 300 }),
        canvasNode("block.prompt_composer", { x: 100, y: 10 })
      ],
      edges: []
    };

    const blueprint = deriveFaceBlueprint(workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.prompt_composer",
      "block.output_stage",
      "block.continue_chain"
    ]);
  });

  it("falls back to node array order when a block has no usable position", () => {
    const workflowJson = {
      nodes: [
        canvasNode("block.output_stage", { x: 0, y: 999 }),
        canvasNode("block.prompt_composer", null)
      ],
      edges: []
    };

    const blueprint = deriveFaceBlueprint(workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.output_stage",
      "block.prompt_composer"
    ]);
  });

  it("reads config from the flattened node.data fields and applies defaults", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [
        canvasNode("block.prompt_composer", { x: 0, y: 0 }, { placeholder: "  Dream it up  " }),
        canvasNode("block.output_stage", { x: 0, y: 100 }, { kind: "image" }),
        canvasNode("block.continue_chain", { x: 0, y: 200 })
      ]
    });

    expect(blockShapes(blueprint)).toEqual([
      { type: "block.prompt_composer", config: { placeholder: "Dream it up" } },
      { type: "block.output_stage", config: { kind: "image" } },
      { type: "block.continue_chain", config: { label: "Continue" } }
    ]);
  });

  it("caps presets at 8, drops malformed entries, and trims strings to 120 chars", () => {
    const longTitle = "t".repeat(500);
    const presets = [
      { id: "p1", title: longTitle, emoji: "🎨", promptFragment: "in watercolor" },
      { id: "p2", title: "Neon", emoji: 42, promptFragment: null }, // bad optional fields survive as ""
      { id: "", title: "No id" }, // dropped: blank id
      "garbage", // dropped: not an object
      { title: "No id at all" }, // dropped: missing id
      ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, title: `Style ${i}` }))
    ];

    const blueprint = deriveFaceBlueprint({
      nodes: [canvasNode("block.preset_gallery", { x: 0, y: 0 }, { presets })]
    });

    const derived = blueprint?.blocks[0]?.config.presets as Array<{
      id: string;
      title: string;
      emoji: string;
      promptFragment: string;
    }>;
    expect(derived).toHaveLength(8);
    expect(derived[0]).toEqual({
      id: "p1",
      title: "t".repeat(120),
      emoji: "🎨",
      promptFragment: "in watercolor"
    });
    expect(derived[1]).toEqual({ id: "p2", title: "Neon", emoji: "", promptFragment: "" });
    expect(derived.map((preset) => preset.id)).not.toContain("");
  });

  it("caps model options at 6 and falls back to the id when the label is unusable", () => {
    const options = [
      { id: "flux", label: "Flux Pro" },
      { id: "sd3", label: "   " },
      { id: "gpt-image", label: 7 },
      { id: 123, label: "dropped — bad id" },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` }))
    ];

    const blueprint = deriveFaceBlueprint({
      nodes: [canvasNode("block.model_picker", { x: 0, y: 0 }, { options })]
    });

    const derived = blueprint?.blocks[0]?.config.options as Array<{ id: string; label: string }>;
    expect(derived).toHaveLength(6);
    expect(derived[0]).toEqual({ id: "flux", label: "Flux Pro" });
    expect(derived[1]).toEqual({ id: "sd3", label: "sd3" });
    expect(derived[2]).toEqual({ id: "gpt-image", label: "gpt-image" });
    expect(derived[3]).toEqual({ id: "m0", label: "m0" });
  });

  it("tolerates malformed configs across all block types instead of throwing", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [
        canvasNode("block.prompt_composer", { x: 0, y: 0 }, { placeholder: { evil: true } }),
        canvasNode("block.preset_gallery", { x: 0, y: 10 }, { presets: "not-an-array" }),
        canvasNode("block.model_picker", { x: 0, y: 20 }, { options: 42 }),
        canvasNode("block.output_stage", { x: 0, y: 30 }, { kind: "PRODUCT" }),
        canvasNode("block.continue_chain", { x: 0, y: 40 }, { label: "" }),
        canvasNode("block.history_shelf", { x: 0, y: 50 }, { junk: "ignored" })
      ]
    });

    expect(blockShapes(blueprint)).toEqual([
      { type: "block.prompt_composer", config: { placeholder: "Describe what you want…" } },
      { type: "block.preset_gallery", config: { presets: [] } },
      { type: "block.model_picker", config: { options: [] } },
      { type: "block.output_stage", config: { kind: "auto" } },
      { type: "block.continue_chain", config: { label: "Continue" } },
      { type: "block.history_shelf", config: {} }
    ]);
  });

  it("passes unknown block.* types through with an empty config (forward compatibility)", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [canvasNode("block.future_thing", { x: 0, y: 0 }, { anything: "goes" })]
    });

    expect(blockShapes(blueprint)).toEqual([{ type: "block.future_thing", config: {} }]);
  });

  it("derives Buttons with a trimmed label capped at 40 chars, falling back to Go", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [
        canvasNode("block.action_button", { x: 0, y: 0 }, { label: "  Plan my yatra  " }),
        canvasNode("block.action_button", { x: 0, y: 100 }, { label: "B".repeat(90) }),
        canvasNode("block.action_button", { x: 0, y: 200 }, { label: "   " }),
        canvasNode("block.action_button", { x: 0, y: 300 }, { label: { evil: true } })
      ]
    });

    expect(blockShapes(blueprint)).toEqual([
      { type: "block.action_button", config: { label: "Plan my yatra" } },
      { type: "block.action_button", config: { label: "B".repeat(40) } },
      { type: "block.action_button", config: { label: "Go" } },
      { type: "block.action_button", config: { label: "Go" } }
    ]);
  });

  it("keeps multiple Buttons, in canvas order, alongside other blocks", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [
        canvasNode("block.action_button", { x: 200, y: 100 }, { label: "Surprise me" }),
        canvasNode("block.prompt_composer", { x: 0, y: 0 }),
        canvasNode("block.action_button", { x: 0, y: 100 }, { label: "Plan my trip" }),
        canvasNode("block.output_stage", { x: 0, y: 200 })
      ]
    });

    expect(blockShapes(blueprint)).toEqual([
      { type: "block.prompt_composer", config: { placeholder: "Describe what you want…" } },
      { type: "block.action_button", config: { label: "Plan my trip" } },
      { type: "block.action_button", config: { label: "Surprise me" } },
      { type: "block.output_stage", config: { kind: "auto" } }
    ]);
  });

  it("caps the continue label at 120 chars", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [canvasNode("block.continue_chain", { x: 0, y: 0 }, { label: "Keep going ".repeat(30) })]
    });

    const label = blueprint?.blocks[0]?.config.label as string;
    expect(label.length).toBeLessThanOrEqual(120);
    expect(label.startsWith("Keep going")).toBe(true);
  });

  it("excludes Design Brain nodes — they style the page, they are never a section", () => {
    // Alone on the canvas: no blueprint at all (default Face is kept).
    expect(
      deriveFaceBlueprint({ nodes: [canvasNode("design.brain", { x: 0, y: 0 })] })
    ).toBeNull();

    // Mixed with real blocks: the Design Brain never appears in the block list,
    // whether its slug sits on data.type (builder graphs) or on the top-level
    // node.type (hand-written graphs).
    const blueprint = deriveFaceBlueprint({
      nodes: [
        canvasNode("design.brain", { x: 0, y: 0 }),
        canvasNode("block.prompt_composer", { x: 0, y: 100 }),
        { id: "d2", type: "design.brain", position: { x: 0, y: 200 }, data: {} },
        canvasNode("block.output_stage", { x: 0, y: 300 })
      ]
    });

    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.prompt_composer",
      "block.output_stage"
    ]);
  });

  it("carries each canvas node's id as nodeId — the key design.layout points at", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [
        {
          id: "blk-output",
          type: "coreNode",
          position: { x: 0, y: 200 },
          data: { type: "block.output_stage", nodeKind: "block" }
        },
        {
          id: "blk-composer",
          type: "coreNode",
          position: { x: 0, y: 0 },
          data: { type: "block.prompt_composer", nodeKind: "block" }
        }
      ]
    });

    // Canvas order (y then x), each block keyed by its real canvas node id.
    expect(blueprint?.blocks.map((block) => block.nodeId)).toEqual(["blk-composer", "blk-output"]);
  });

  it("falls back to a deterministic block-<index> nodeId when a node has no id", () => {
    const blueprint = deriveFaceBlueprint({
      nodes: [
        { type: "coreNode", data: { type: "block.prompt_composer", nodeKind: "block" } },
        { id: "", type: "coreNode", data: { type: "block.output_stage", nodeKind: "block" } },
        {
          id: "blk-real",
          type: "coreNode",
          data: { type: "block.history_shelf", nodeKind: "block" }
        }
      ]
    });

    // No usable positions -> array order; the index is the node's position in
    // the original nodes array, so the fallback is stable for a given graph.
    expect(blueprint?.blocks.map((block) => block.nodeId)).toEqual([
      "block-0",
      "block-1",
      "blk-real"
    ]);
  });
});
