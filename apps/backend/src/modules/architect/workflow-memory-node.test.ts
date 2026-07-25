import { beforeAll, describe, expect, test, vi } from "vitest";
import { runWorkflowTest } from "./workflow-runner";
import { initProviderEngine, getProviderEngine } from "../ai-provider-engine/ai-provider-engine";

describe("Workflow Memory Node Runner Integration", () => {
  beforeAll(async () => {
    await initProviderEngine().catch(() => {});
    vi.spyOn(getProviderEngine(), "executeWithProvider").mockImplementation(async (providerId, req) => {
      const prompt = req.messages?.[0]?.content || "";
      let text = "Generated AI Response";
      if (prompt.includes("Pearlia")) text = "Pearlia, the Eternal Tide character details.";
      if (prompt.includes("Melancholic")) text = "Melancholic Hope emotion details.";
      return {
        text,
        providerId: "mock",
        modelName: "mock-model",
        status: "success",
        error: null,
        usage: { inputTokens: 10, outputTokens: 20 },
        cost: 0,
        durationMs: 5
      };
    });
  });
  test("Memory Node aggregates outputs from AI Brain 1 & 2 and exposes {{memory}} to AI Brain 3", async () => {
    const workflowJson = {
      nodes: [
        {
          id: "trigger-1",
          data: { type: "trigger.manual", nodeKind: "trigger", title: "Manual Trigger" }
        },
        {
          id: "brain-1",
          data: {
            type: "ai.llm_call",
            nodeKind: "ai",
            title: "AI Brain 1",
            provider: "gemini",
            llmProvider: "gemini",
            llmOutputKey: "character_output",
            prompt: "Character: Pearlia the Eternal Tide"
          }
        },
        {
          id: "brain-2",
          data: {
            type: "ai.llm_call",
            nodeKind: "ai",
            title: "AI Brain 2",
            provider: "gemini",
            llmProvider: "gemini",
            llmOutputKey: "emotion_output",
            prompt: "Emotion: Melancholic Hope"
          }
        },
        {
          id: "memory-node-1",
          data: {
            type: "ai.memory",
            nodeKind: "ai",
            title: "Memory Node",
            customMemoryNotes: "Global Story Arc Guidelines: High fantasy style"
          }
        },
        {
          id: "brain-3",
          data: {
            type: "ai.llm_call",
            nodeKind: "ai",
            title: "AI Brain 3",
            provider: "gemini",
            llmProvider: "gemini",
            prompt: "Write a story using the context below:\n{{memory}}"
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "brain-1" },
        { id: "e2", source: "trigger-1", target: "brain-2" },
        { id: "e3", source: "brain-1", target: "memory-node-1" },
        { id: "e4", source: "brain-2", target: "memory-node-1" },
        { id: "e5", source: "memory-node-1", target: "brain-3" }
      ]
    };

    const runResult = await runWorkflowTest({
      userId: "user-123",
      workflowId: "wf-test-memory-123",
      workflowJson,
      input: {
        latestMessage: "Test run manual trigger"
      }
    });

    expect(runResult.logs).toBeDefined();
    
    const memoryLog = runResult.logs.find((l) => l.nodeId === "memory-node-1");
    expect(memoryLog).toBeDefined();
    expect(memoryLog?.status).toBe("success");
    expect(memoryLog?.output).toBeDefined();

    const outputObj = memoryLog?.output as { memory?: string };
    expect(outputObj.memory).toContain("=== MEMORY ===");
    expect(outputObj.memory).toContain("Global Story Arc Guidelines: High fantasy style");

    expect(runResult.context.memory).toBeDefined();
    expect(runResult.context.memory).toContain("=== MEMORY ===");
  });
});
