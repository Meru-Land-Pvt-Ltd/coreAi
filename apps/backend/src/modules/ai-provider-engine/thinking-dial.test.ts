import { describe, expect, it } from "vitest";
import { contextBundleToExecuteRequest } from "../memory/memory-to-provider";

/**
 * "HOW HARD IT THINKS" REACHED NOTHING (2026-08-28).
 *
 * The node inspector shows this dial on every thinking model, tells the
 * architect it can cost several times more than quick, saves what they
 * choose — and no adapter ever sent it. Every model kept its own default
 * while the architect believed they had chosen, and had been warned about a
 * price they were never charged.
 */

const bundle = {
  workflowRunId: "run-1",
  nodeId: "node-1",
  threadId: "thread-1",
  merged: {},
  contextLinks: [],
  backLinkedMemories: [],
  previousMemory: null,
  compressedPrompt: null
} as never;

const node = (data: Record<string, unknown>) =>
  ({
    id: "node-1",
    nodeType: "ai.llm_call",
    nodeLabel: "AI Brain",
    data: { llmRequirements: "Answer the customer", ...data }
  }) as never;

describe("the thinking dial reaches the provider", () => {
  it("carries the architect's choice", async () => {
    const request = await contextBundleToExecuteRequest(bundle, node({ reasoningEffort: "high" }));
    expect(request.reasoningEffort).toBe("high");
  });

  it("carries nothing when the architect never set it", async () => {
    const request = await contextBundleToExecuteRequest(bundle, node({}));
    expect(request.reasoningEffort).toBeUndefined();
  });

  it("drops a value that is not one of the three words", async () => {
    /* A stale setting left behind when the model changed must never reach a
       provider — it is a 400 on most of them. */
    const request = await contextBundleToExecuteRequest(bundle, node({ reasoningEffort: "maximum" }));
    expect(request.reasoningEffort).toBeUndefined();
  });
});
