import { describe, expect, it } from "vitest";
import { deriveFaceBlueprint } from "./blueprint";
import { applyGraphOps, blockCatalogForPrompt, currentBlocksForPrompt } from "./graph-patch";

/**
 * Foundation graph mutation service: adds blocks in the builder's exact canvas
 * shape, auto-wires to a single brain, refuses to touch brains/hands/design
 * brain, whitelists config per the registry, and swallows malformed ops with
 * notes instead of throwing.
 */

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };

function blockNode(
  id: string,
  type: string,
  y: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    type: "coreNode",
    position: { x: 0, y },
    data: { type, nodeKind: "block", label: "Product Section", title: type, ...extra }
  };
}

function aiNode(id: string): Record<string, unknown> {
  return {
    id,
    type: "coreNode",
    position: { x: 780, y: 190 },
    data: { type: "ai.llm_call", nodeKind: "ai", label: "AI Brain", title: "AI Brain" }
  };
}

function triggerNode(id: string): Record<string, unknown> {
  return {
    id,
    type: "coreNode",
    position: { x: 400, y: 0 },
    data: { type: "trigger.manual", nodeKind: "trigger", label: "Input" }
  };
}

/** One brain + composer/output blocks, Yatra-style. */
function baseGraph(): Graph {
  return {
    nodes: [
      blockNode("blk-composer", "block.prompt_composer", 0, {
        placeholder: "Describe what you want…"
      }),
      aiNode("ai-brain"),
      blockNode("blk-output", "block.output_stage", 190, { kind: "auto" })
    ],
    edges: [
      {
        id: "edge-blk-composer-ai-brain",
        source: "blk-composer",
        target: "ai-brain",
        animated: true,
        style: { stroke: "#f59e0b", strokeWidth: 2.6 }
      },
      {
        id: "edge-ai-brain-blk-output",
        source: "ai-brain",
        target: "blk-output",
        animated: true,
        style: { stroke: "#f59e0b", strokeWidth: 2.6 }
      }
    ]
  };
}

function graphOf(result: { workflowJson: unknown }): Graph {
  return result.workflowJson as Graph;
}

function nodeById(graph: Graph, id: string): Record<string, unknown> | undefined {
  return graph.nodes.find((node) => node.id === id);
}

describe("applyGraphOps addBlock", () => {
  it("adds a block in the builder's exact node shape and auto-wires it to the single brain", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [{ op: "addBlock", blockType: "block.action_button", config: { label: "Make it" } }],
      idSeed: "t"
    });

    expect(result.changed).toBe(true);
    const graph = graphOf(result);
    expect(graph.nodes).toHaveLength(4);

    const added = nodeById(graph, "blk-button-t1");
    expect(added).toBeDefined();
    // Exact builder canvas shape (verified against a production row).
    expect(added).toMatchObject({
      id: "blk-button-t1",
      type: "coreNode",
      position: { x: 0, y: 190 + 190 },
      data: {
        type: "block.action_button",
        nodeKind: "block",
        kind: "PRODUCT",
        accent: "rose",
        icon: "pointer-click",
        title: "Button",
        footer: "",
        label: "Make it"
      }
    });
    expect(typeof (added?.data as Record<string, unknown>).subtitle).toBe("string");

    // Auto-wired: input-ish block -> brain, builder edge shape.
    const wire = graph.edges.find((edge) => edge.source === "blk-button-t1");
    expect(wire).toMatchObject({
      id: "edge-blk-button-t1-ai-brain",
      target: "ai-brain",
      animated: true,
      style: { stroke: "#f59e0b", strokeWidth: 2.6 }
    });
    expect(result.notes).toEqual([]);
  });

  it("wires output-stage blocks FROM the brain, and feeds the Face blueprint in order", () => {
    const graph = baseGraph();
    graph.nodes = graph.nodes.filter((node) => node.id !== "blk-output");
    graph.edges = graph.edges.filter((edge) => edge.target !== "blk-output");

    const result = applyGraphOps({
      workflowJson: graph,
      ops: [{ op: "addBlock", blockType: "block.output_stage" }],
      idSeed: "t"
    });

    const next = graphOf(result);
    const wire = next.edges.find((edge) => edge.target === "blk-output-t1");
    expect(wire).toMatchObject({ source: "ai-brain" });

    // The consumer contract: blueprint renders composer then result viewer.
    const blueprint = deriveFaceBlueprint(result.workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.prompt_composer",
      "block.output_stage"
    ]);
  });

  it("skips wiring and asks which brain when there are two brains", () => {
    const graph = baseGraph();
    graph.nodes.push(aiNode("ai-brain-2"));

    const result = applyGraphOps({
      workflowJson: graph,
      ops: [{ op: "addBlock", blockType: "block.prompt_composer" }],
      idSeed: "t"
    });

    expect(result.changed).toBe(true);
    const next = graphOf(result);
    expect(nodeById(next, "blk-composer-t1")).toBeDefined();
    expect(next.edges.filter((edge) => edge.source === "blk-composer-t1")).toHaveLength(0);
    expect(result.notes).toContain("Tell me which brain to connect it to");
  });

  it("skips wiring and asks which brain when there is no brain", () => {
    const result = applyGraphOps({
      workflowJson: { nodes: [blockNode("blk-composer", "block.prompt_composer", 0)], edges: [] },
      ops: [{ op: "addBlock", blockType: "block.action_button" }],
      idSeed: "t"
    });
    expect(result.changed).toBe(true);
    expect(graphOf(result).edges).toHaveLength(0);
    expect(result.notes).toContain("Tell me which brain to connect it to");
  });

  it('places "start" additions at the top of the block column and reflows y', () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [{ op: "addBlock", blockType: "block.preset_gallery", position: "start" }],
      idSeed: "t"
    });

    const blueprint = deriveFaceBlueprint(result.workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.preset_gallery",
      "block.prompt_composer",
      "block.output_stage"
    ]);
    // The brain's position is untouched by the reflow.
    expect(nodeById(graphOf(result), "ai-brain")?.position).toEqual({ x: 780, y: 190 });
  });

  it('places {after} additions right below the anchor block', () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [
        {
          op: "addBlock",
          blockType: "block.continue_chain",
          position: { after: "blk-composer" }
        }
      ],
      idSeed: "t"
    });
    const blueprint = deriveFaceBlueprint(result.workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.prompt_composer",
      "block.continue_chain",
      "block.output_stage"
    ]);
  });

  it("rejects design.brain and non-block types with a note, never touching the canvas", () => {
    const before = JSON.stringify(baseGraph());
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [
        { op: "addBlock", blockType: "design.brain" },
        { op: "addBlock", blockType: "ai.llm_call" },
        { op: "addBlock", blockType: "block.does_not_exist" }
      ],
      idSeed: "t"
    });
    expect(result.changed).toBe(false);
    expect(JSON.stringify(result.workflowJson)).toBe(before);
    expect(result.notes.length).toBeGreaterThanOrEqual(3);
  });

  it("generates deterministic unique ids from idSeed", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [
        { op: "addBlock", blockType: "block.action_button" },
        { op: "addBlock", blockType: "block.action_button" }
      ],
      idSeed: "seed"
    });
    const graph = graphOf(result);
    expect(nodeById(graph, "blk-button-seed1")).toBeDefined();
    expect(nodeById(graph, "blk-button-seed2")).toBeDefined();
  });
});

describe("applyGraphOps removeBlock", () => {
  it("removes a block and every edge attached to it", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [{ op: "removeBlock", nodeId: "blk-composer" }]
    });
    expect(result.changed).toBe(true);
    const graph = graphOf(result);
    expect(nodeById(graph, "blk-composer")).toBeUndefined();
    expect(
      graph.edges.some((edge) => edge.source === "blk-composer" || edge.target === "blk-composer")
    ).toBe(false);
    // The brain and its remaining edge survive.
    expect(nodeById(graph, "ai-brain")).toBeDefined();
    expect(graph.edges.some((edge) => edge.source === "ai-brain")).toBe(true);
  });

  it("never removes brains, hands, or the design brain", () => {
    const graph = baseGraph();
    graph.nodes.push(triggerNode("trig-1"));
    graph.nodes.push({
      id: "design-1",
      type: "coreNode",
      position: { x: 900, y: 400 },
      data: { type: "design.brain", nodeKind: "block", title: "Design Brain" }
    });
    const before = JSON.stringify(graph);

    const result = applyGraphOps({
      workflowJson: graph,
      ops: [
        { op: "removeBlock", nodeId: "ai-brain" },
        { op: "removeBlock", nodeId: "trig-1" },
        { op: "removeBlock", nodeId: "design-1" },
        { op: "removeBlock", nodeId: "no-such-id" }
      ]
    });

    expect(result.changed).toBe(false);
    expect(JSON.stringify(result.workflowJson)).toBe(before);
    expect(result.notes).toHaveLength(4);
  });
});

describe("applyGraphOps reorderBlock", () => {
  it("moves a block to the top and recomputes y ordering among blocks only", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [{ op: "reorderBlock", nodeId: "blk-output", to: "start" }]
    });
    expect(result.changed).toBe(true);

    const blueprint = deriveFaceBlueprint(result.workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.output_stage",
      "block.prompt_composer"
    ]);

    const graph = graphOf(result);
    expect(nodeById(graph, "ai-brain")?.position).toEqual({ x: 780, y: 190 });
    // Edges are untouched by reorder.
    expect(graph.edges).toHaveLength(2);
  });

  it('moves a block to {after} another block', () => {
    const graph = baseGraph();
    graph.nodes.push(blockNode("blk-history", "block.history_shelf", 380));

    const result = applyGraphOps({
      workflowJson: graph,
      ops: [{ op: "reorderBlock", nodeId: "blk-history", to: { after: "blk-composer" } }]
    });

    const blueprint = deriveFaceBlueprint(result.workflowJson);
    expect(blueprint?.blocks.map((block) => block.type)).toEqual([
      "block.prompt_composer",
      "block.history_shelf",
      "block.output_stage"
    ]);
  });

  it("refuses to reorder non-block ids", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [{ op: "reorderBlock", nodeId: "ai-brain", to: "start" }]
    });
    expect(result.changed).toBe(false);
    expect(result.notes).toHaveLength(1);
  });
});

describe("applyGraphOps updateBlockConfig", () => {
  it("applies whitelisted keys, trims and caps strings, and drops unknown keys with a note", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [
        {
          op: "updateBlockConfig",
          nodeId: "blk-composer",
          config: {
            placeholder: `  ${"p".repeat(200)}  `,
            hackedField: "nope"
          }
        }
      ]
    });

    expect(result.changed).toBe(true);
    const data = nodeById(graphOf(result), "blk-composer")?.data as Record<string, unknown>;
    expect(data.placeholder).toBe("p".repeat(120));
    expect(data.hackedField).toBeUndefined();
    expect(result.notes.some((note) => note.includes("hackedField"))).toBe(true);
  });

  it("caps presets at 8, allows promptFragment up to 500 chars, and fills missing ids", () => {
    const graph = baseGraph();
    graph.nodes.push(blockNode("blk-styles", "block.preset_gallery", 380, { presets: [] }));

    const presets = Array.from({ length: 10 }, (_, index) => ({
      title: `Style ${index}`,
      emoji: "✨",
      promptFragment: "f".repeat(600)
    }));

    const result = applyGraphOps({
      workflowJson: graph,
      ops: [{ op: "updateBlockConfig", nodeId: "blk-styles", config: { presets } }]
    });

    const data = nodeById(graphOf(result), "blk-styles")?.data as Record<string, unknown>;
    const saved = data.presets as Record<string, unknown>[];
    expect(saved).toHaveLength(8);
    expect(saved[0].id).toBe("style-0");
    expect((saved[0].promptFragment as string).length).toBe(500);
  });

  it("rejects out-of-enum output kinds and keeps the old value", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [{ op: "updateBlockConfig", nodeId: "blk-output", config: { kind: "hologram" } }]
    });
    expect(result.changed).toBe(false);
    const data = nodeById(graphOf(result), "blk-output")?.data as Record<string, unknown>;
    expect(data.kind).toBe("auto");
    expect(result.notes).toHaveLength(1);
  });

  it("never edits brains or the design brain through config ops", () => {
    const graph = baseGraph();
    const before = JSON.stringify(graph);
    const result = applyGraphOps({
      workflowJson: graph,
      ops: [
        { op: "updateBlockConfig", nodeId: "ai-brain", config: { llmSystemPrompt: "pwned" } }
      ]
    });
    expect(result.changed).toBe(false);
    expect(JSON.stringify(result.workflowJson)).toBe(before);
    expect(result.notes).toHaveLength(1);
  });
});

describe("applyGraphOps malformed tolerance", () => {
  it("skips malformed ops with notes, applies the valid ones, and never throws", () => {
    const result = applyGraphOps({
      workflowJson: baseGraph(),
      ops: [
        null,
        42,
        { op: "teleportBlock" },
        { op: "addBlock" },
        { op: "removeBlock" },
        { op: "reorderBlock", nodeId: "blk-output" },
        { op: "addBlock", blockType: "block.history_shelf" }
      ],
      idSeed: "t"
    });

    expect(result.changed).toBe(true);
    expect(nodeById(graphOf(result), "blk-history-t1")).toBeDefined();
    expect(result.notes.length).toBeGreaterThanOrEqual(6);
  });

  it("returns unchanged with a note for unreadable canvases and non-array ops", () => {
    for (const workflowJson of [null, undefined, "broken", 7, []]) {
      const result = applyGraphOps({
        workflowJson,
        ops: [{ op: "addBlock", blockType: "block.action_button" }]
      });
      expect(result.changed).toBe(false);
      expect(result.workflowJson).toBe(workflowJson);
      expect(result.notes).toHaveLength(1);
    }

    const opsNotArray = applyGraphOps({ workflowJson: baseGraph(), ops: "do stuff" });
    expect(opsNotArray.changed).toBe(false);
    expect(opsNotArray.notes).toHaveLength(1);
  });

  it("preserves unknown top-level graph keys when rewriting", () => {
    const graph = { ...baseGraph(), viewport: { x: 1, y: 2, zoom: 0.8 } };
    const result = applyGraphOps({
      workflowJson: graph,
      ops: [{ op: "addBlock", blockType: "block.history_shelf" }],
      idSeed: "t"
    });
    expect((result.workflowJson as Record<string, unknown>).viewport).toEqual({
      x: 1,
      y: 2,
      zoom: 0.8
    });
  });

  it("never mutates the input graph object", () => {
    const graph = baseGraph();
    const before = JSON.stringify(graph);
    applyGraphOps({
      workflowJson: graph,
      ops: [
        { op: "addBlock", blockType: "block.action_button" },
        { op: "removeBlock", nodeId: "blk-composer" },
        { op: "reorderBlock", nodeId: "blk-output", to: "start" }
      ],
      idSeed: "t"
    });
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe("currentBlocksForPrompt", () => {
  it("lists block sections top to bottom with real nodeIds, labels, and current config", () => {
    const graph = baseGraph();
    graph.nodes.push(
      blockNode("blk-styles", "block.preset_gallery", 380, {
        presets: [
          { id: "solo", title: "Solo", emoji: "🧘", promptFragment: "solo trip" },
          { id: "family", title: "Family", emoji: "👪", promptFragment: "family trip" }
        ]
      })
    );
    graph.nodes.push({
      id: "design-1",
      type: "coreNode",
      position: { x: 900, y: 400 },
      data: { type: "design.brain", nodeKind: "block", title: "Design Brain" }
    });

    const listing = currentBlocksForPrompt(graph);
    const lines = listing.split("\n");

    // Top-to-bottom canvas order: composer (y 0), output (y 190), styles (y 380).
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("blk-composer");
    expect(lines[0]).toContain("block.prompt_composer");
    expect(lines[0]).toContain('placeholder: "Describe what you want…"');
    expect(lines[1]).toContain("blk-output");
    expect(lines[1]).toContain('kind: "auto"');
    expect(lines[2]).toContain("blk-styles");
    expect(lines[2]).toContain("presets: 2 (Solo, Family)");

    // Brains and the Design Brain never appear as referencable sections.
    expect(listing).not.toContain("ai-brain");
    expect(listing).not.toContain("design.brain");
  });

  it("falls back to registry defaults for config a node never customized", () => {
    const graph: Graph = {
      nodes: [blockNode("blk-plain", "block.prompt_composer", 0)],
      edges: []
    };
    const listing = currentBlocksForPrompt(graph);
    // blockNode() sets no placeholder; the registry default shows instead.
    expect(listing).toContain("blk-plain");
    expect(listing).toContain('placeholder: "Describe what you want…"');
  });

  it("returns an empty string for unreadable canvases and block-less graphs", () => {
    expect(currentBlocksForPrompt(null)).toBe("");
    expect(currentBlocksForPrompt("broken")).toBe("");
    expect(currentBlocksForPrompt({ nodes: [aiNode("ai-1")], edges: [] })).toBe("");
  });
});

describe("blockCatalogForPrompt", () => {
  it("lists every registry block with its editable properties, excluding design.brain", () => {
    const catalog = blockCatalogForPrompt();
    expect(catalog).toContain("block.prompt_composer");
    expect(catalog).toContain("block.preset_gallery");
    expect(catalog).toContain("block.model_picker");
    expect(catalog).toContain("block.action_button");
    expect(catalog).toContain("block.output_stage");
    expect(catalog).toContain("block.continue_chain");
    expect(catalog).toContain("block.history_shelf");
    expect(catalog).not.toContain("design.brain");

    // Editable properties come from the registry defaultConfig shapes.
    expect(catalog).toContain("placeholder (text, up to 120 characters)");
    expect(catalog).toContain("presets (list of up to 8 items");
    expect(catalog).toContain("options (list of up to 6 items");
    expect(catalog).toContain("kind (one of: auto, image, video, text)");
  });
});
