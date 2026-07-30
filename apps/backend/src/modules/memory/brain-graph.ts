import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import type { NodeMemoryRecord } from "./types";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";

export const WorkflowStateAnnotation = Annotation.Root({
  workflowRunId: Annotation<string>(),
  threadId: Annotation<string>(),
  userPrompt: Annotation<string>(),
  currentNodeId: Annotation<string>(),
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

export function buildLangGraphStateGraph() {
  const graph = new StateGraph(WorkflowStateAnnotation)
    .addNode("trigger", async (state) => {
      return {
        variables: {
          "caller.phone": state.caller?.phone || "",
          "caller.name": state.caller?.name || "",
          "call.time": new Date().toISOString(),
        },
      };
    })
    .addNode("ai_brain", async (state) => {
      const currentNodeId = state.currentNodeId || "ai_brain";
      const prompt = state.userPrompt || "Execute step using context.";

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
    })
    .addNode("action", async (state) => {
      const currentNodeId = state.currentNodeId || "action";
      return {
        nodeOutputs: {
          [currentNodeId]: { status: "executed", timestamp: new Date().toISOString() },
        },
      };
    })
    // Default flow edges
    .addEdge(START, "trigger")
    .addEdge("trigger", "ai_brain")
    .addEdge("ai_brain", "action")
    .addEdge("action", END);

  return graph.compile();
}
