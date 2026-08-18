import { describe, expect, it } from "vitest";
import { contextBundleToExecuteRequest, type AiBrainNodeConfig } from "./memory-to-provider";
import type { ContextBundle } from "./types";

/**
 * Input threading for one-shot runs (agent-page /run + builder preview-run):
 * the customer's message must reach the LLM as the authoritative close of the
 * user turn — labeled, last, never buried inside (or dropped from) the
 * workflow author's prompt template — and the system prompt must forbid
 * re-asking for details the message already contains.
 */

const NEVER_REASK_LINE =
  "If the user's message already contains details, use them; never re-ask for provided details.";

function bundle(): ContextBundle {
  return {
    workflowRunId: "run-1",
    nodeId: "node-1",
    threadId: "thread-1",
    nodeMemories: [],
    backLinkedMemories: [],
    previousMemory: null,
    contextLinks: [],
    merged: {
      summaries: [],
      variables: {},
      outputs: [],
      files: [],
      totalTokens: 0,
      totalCostCents: 0
    },
    compressedPrompt: "# Workflow context\n(none yet)"
  };
}

function llmCallNode(data: AiBrainNodeConfig["data"]): AiBrainNodeConfig {
  return {
    id: "node-1",
    nodeType: "ai.llm_call",
    nodeLabel: "AI Brain",
    data
  };
}

describe("contextBundleToExecuteRequest — customer message threading", () => {
  it("closes the user turn with the customer's message as the authoritative ask", async () => {
    const request = await contextBundleToExecuteRequest(
      bundle(),
      llmCallNode({
        llmRequirements: "Answer as the Yatra Planner based on the pressed button context.",
        llmSystemPrompt: "You are the Yatra Planner.",
        llmCustomerMessage:
          "The customer pressed the button: 'Plan my yatra'.\nThe customer wrote: 7 days with my family"
      })
    );

    const userTurn = request.messages[0].content;
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].role).toBe("user");
    // Labeled and LAST — after the author's requirements, never buried.
    expect(userTurn).toMatch(
      /The customer's message \(authoritative — answer this, using every detail it contains\):\nThe customer pressed the button: 'Plan my yatra'\.\nThe customer wrote: 7 days with my family$/
    );
    expect(userTurn.indexOf("Workflow author's rough requirements")).toBeLessThan(
      userTurn.indexOf("The customer's message")
    );
    // System prompt carries the one-shot never-re-ask rule.
    expect(request.systemPrompt).toContain(NEVER_REASK_LINE);
  });

  it("reaches the LLM even when the author left every prompt field empty", async () => {
    const request = await contextBundleToExecuteRequest(
      bundle(),
      llmCallNode({ llmCustomerMessage: "7 days with my family" })
    );

    expect(request.messages[0].content).toContain(
      "The customer's message (authoritative — answer this, using every detail it contains):\n7 days with my family"
    );
  });

  it("does not duplicate a message the author's template already embedded", async () => {
    const request = await contextBundleToExecuteRequest(
      bundle(),
      llmCallNode({
        llmRequirements: "Customer request: 7 days with my family. Plan the trip.",
        llmCustomerMessage: "7 days with my family"
      })
    );

    const userTurn = request.messages[0].content;
    expect(userTurn).not.toContain("The customer's message");
    expect(userTurn).toContain("Customer request: 7 days with my family");
    // The never-re-ask system rule still applies — a message was provided.
    expect(request.systemPrompt).toContain(NEVER_REASK_LINE);
  });

  it("leaves runs without a customer message untouched", async () => {
    const request = await contextBundleToExecuteRequest(
      bundle(),
      llmCallNode({
        llmRequirements: "Summarize the previous step's output."
      })
    );

    expect(request.messages[0].content).toBe(
      "Workflow author's rough requirements:\nSummarize the previous step's output."
    );
    expect(request.messages[0].content).not.toContain("The customer's message");
    expect(request.systemPrompt).not.toContain(NEVER_REASK_LINE);
  });
});
