import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import type { NodeMemoryRecord } from "./types";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";

/**
 * Unified LangGraph Workflow State Annotation.
 * Centralizes run ID, thread ID, variables, node outputs, and attachments
 * to eliminate race conditions and complex context rebuilding.
 */
export const WorkflowStateAnnotation = Annotation.Root({
  workflowRunId: Annotation<string>(),
  threadId: Annotation<string>(),
  userPrompt: Annotation<string>(),
  currentNodeId: Annotation<string>(),
  // O(1) in-memory lookup for node outputs across the graph
  nodeOutputs: Annotation<Record<string, unknown>>({
    value: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  variables: Annotation<Record<string, unknown>>({
    value: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  attachments: Annotation<Array<{ name?: string; mimeType: string; data: string }>>({
    value: (current, update) => [...current, ...update],
    default: () => [],
  }),
  caller: Annotation<{ name?: string; phone?: string }>({
    value: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

export type WorkflowState = typeof WorkflowStateAnnotation.State;

/**
 * Creates an executable LangGraph StateGraph for a given workflow.
 */
export function buildLangGraphStateGraph() {
  const graph = new StateGraph(WorkflowStateAnnotation);

  // 1. Trigger Node Handler
  graph.addNode("trigger", async (state) => {
    return {
      variables: {
        "caller.phone": state.caller?.phone || "",
        "caller.name": state.caller?.name || "",
        "call.time": new Date().toISOString(),
      },
    };
  });

  // 2. AI Brain Node Handler
  graph.addNode("ai_brain", async (state) => {
    const currentNodeId = state.currentNodeId || "ai_brain";
    const prompt = state.userPrompt || "Execute step using context.";

    // Context format: previous node outputs converted into clean markdown prose
    const previousOutputsText = Object.entries(state.nodeOutputs)
      .map(([nodeId, output]) => `[Step: ${nodeId}]\n${typeof output === "string" ? output : JSON.stringify(output)}`)
      .join("\n\n");

    const systemPrompt = `You are an AI Brain node executing a workflow step.\n\nContext:\n${previousOutputsText}`;

    const response = await getProviderEngine().executeAI({
      systemPrompt,
      messages: [{ role: "user", content: prompt }],
      attachments: state.attachments,
    });

    return {
      nodeOutputs: {
        [currentNodeId]: response.text || response.error,
      },
    };
  });

  // 3. Action Node Handler (SMS / Email / Tool)
  graph.addNode("action", async (state) => {
    const currentNodeId = state.currentNodeId || "action";
    return {
      nodeOutputs: {
        [currentNodeId]: { status: "executed", timestamp: new Date().toISOString() },
      },
    };
  });

  // Default flow edges
  graph.addEdge(START, "trigger");
  graph.addEdge("trigger", "ai_brain");
  graph.addEdge("ai_brain", "action");
  graph.addEdge("action", END);

  return graph.compile();
}
