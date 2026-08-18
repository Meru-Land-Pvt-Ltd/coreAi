import { describe, expect, it } from "vitest";
import { VOICE_NODE_TYPES } from "@coreai/shared";
import { analyzeWorkflowGraph } from "./workflow-graph-validation";

describe("analyzeWorkflowGraph", () => {
  it("allows an empty canvas", () => {
    expect(analyzeWorkflowGraph([], []).ok).toBe(true);
  });

  it("requires a trigger when nodes exist", () => {
    const result = analyzeWorkflowGraph(
      [{ id: "a", data: { type: "ai.llm_call" } }],
      []
    );
    expect(result.ok).toBe(false);
    expect(result.issue).toBe("missing_trigger");
  });

  it("rejects multiple triggers", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "t1", data: { type: "trigger.manual" } },
        { id: "t2", data: { type: VOICE_NODE_TYPES.phoneCallTrigger } }
      ],
      []
    );
    expect(result.ok).toBe(false);
    expect(result.issue).toBe("multiple_triggers");
  });

  it("rejects nodes not connected from the trigger", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "t1", data: { type: "trigger.manual" } },
        { id: "a", data: { type: "ai.llm_call" } },
        { id: "b", data: { type: "ai.llm_call" } },
        { id: "c", data: { type: "ai.llm_call" } }
      ],
      [{ source: "a", target: "b" }]
    );
    expect(result.ok).toBe(false);
    expect(result.issue).toBe("disconnected_nodes");
    expect(result.orphanNodeIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("accepts a single connected trigger flow", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "t1", data: { type: "trigger.manual" } },
        { id: "a", data: { type: "ai.llm_call" } },
        { id: "b", data: { type: "ai.llm_call" } }
      ],
      [
        { source: "t1", target: "a" },
        { source: "a", target: "b" }
      ]
    );
    expect(result.ok).toBe(true);
    expect(result.orphanNodeIds).toEqual([]);
  });

  // ------------------- product blocks (customer page sections) -------------------

  it("accepts the flagship triggerless product graph: Prompt Box → AI → Result Viewer", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "p", data: { type: "block.prompt_composer", nodeKind: "block" } },
        { id: "ai", data: { type: "ai.image_generation" } },
        { id: "out", data: { type: "block.output_stage", nodeKind: "block" } }
      ],
      [
        { source: "p", target: "ai" },
        { source: "ai", target: "out" }
      ]
    );
    expect(result.ok).toBe(true);
    expect(result.issue).toBeNull();
  });

  it("accepts a triggerless Button product: Prompt Box + Button + AI Brain + Result Viewer", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "p", data: { type: "block.prompt_composer", nodeKind: "block" } },
        { id: "btn", data: { type: "block.action_button", nodeKind: "block" } },
        { id: "ai", data: { type: "ai.llm_call" } },
        { id: "out", data: { type: "block.output_stage", nodeKind: "block" } }
      ],
      [
        { source: "btn", target: "ai" },
        { source: "ai", target: "out" }
      ]
    );
    expect(result.ok).toBe(true);
    expect(result.issue).toBeNull();
    expect(result.orphanNodeIds).toEqual([]);
  });

  it("accepts a blocks-only graph with no trigger and no edges", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "p", data: { type: "block.prompt_composer", nodeKind: "block" } },
        { id: "out", data: { type: "block.output_stage", nodeKind: "block" } }
      ],
      []
    );
    expect(result.ok).toBe(true);
  });

  it("never counts unwired blocks beside a triggered flow as orphans", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "t1", data: { type: "trigger.manual" } },
        { id: "a", data: { type: "ai.llm_call" } },
        { id: "gallery", data: { type: "block.preset_gallery", nodeKind: "block" } },
        { id: "shelf", data: { type: "block.history_shelf", nodeKind: "block" } }
      ],
      [{ source: "t1", target: "a" }]
    );
    expect(result.ok).toBe(true);
    expect(result.orphanNodeIds).toEqual([]);
  });

  it("treats blocks as connectivity roots: a brain wired only to a Prompt Box is connected", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "t1", data: { type: "trigger.manual" } },
        { id: "chat", data: { type: "ai.llm_call" } },
        { id: "p", data: { type: "block.prompt_composer", nodeKind: "block" } },
        { id: "media", data: { type: "ai.image_generation" } }
      ],
      [
        { source: "t1", target: "chat" },
        { source: "p", target: "media" }
      ]
    );
    expect(result.ok).toBe(true);
  });

  it("still asks to connect a stray step in a product graph — in customer words", () => {
    const result = analyzeWorkflowGraph(
      [
        { id: "p", data: { type: "block.prompt_composer", nodeKind: "block" } },
        { id: "stray", data: { type: "ai.llm_call" } }
      ],
      []
    );
    expect(result.ok).toBe(false);
    expect(result.issue).toBe("disconnected_nodes");
    expect(result.orphanNodeIds).toEqual(["stray"]);
    for (const copy of [result.title, result.message]) {
      expect(copy.toLowerCase()).not.toMatch(/workflow|node|trigger/);
    }
  });
});
