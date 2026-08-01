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
});
