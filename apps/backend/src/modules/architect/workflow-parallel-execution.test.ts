import { beforeAll, describe, expect, test, vi } from "vitest";
import { runWorkflowTest, groupNodesIntoExecutionWaves } from "./workflow-runner";
import { initProviderEngine, getProviderEngine } from "../ai-provider-engine/ai-provider-engine";

describe("Workflow Parallel DAG Execution Engine", () => {
  beforeAll(async () => {
    await initProviderEngine().catch(() => {});
  });

  test("groupNodesIntoExecutionWaves correctly clusters parallel branches into waves", () => {
    const nodes = [
      { id: "input", data: { title: "Input" }, position: { x: 0, y: 0 } },
      { id: "pm", data: { title: "Project Manager" }, position: { x: -100, y: 100 } },
      { id: "ba", data: { title: "Business Analyst" }, position: { x: 100, y: 100 } },
      { id: "mem1", data: { title: "Memory Node 1" }, position: { x: 0, y: 200 } },
      { id: "sa", data: { title: "Software Architect" }, position: { x: -150, y: 300 } },
      { id: "qa", data: { title: "QA Lead" }, position: { x: 0, y: 300 } },
      { id: "devops", data: { title: "DevOps" }, position: { x: 150, y: 300 } },
      { id: "mem2", data: { title: "Memory Node 2" }, position: { x: 0, y: 400 } },
      { id: "brain", data: { title: "AI Brain" }, position: { x: 0, y: 500 } }
    ];

    const edges = [
      { id: "e1", source: "input", target: "pm" },
      { id: "e2", source: "input", target: "ba" },
      { id: "e3", source: "pm", target: "mem1" },
      { id: "e4", source: "ba", target: "mem1" },
      { id: "e5", source: "mem1", target: "sa" },
      { id: "e6", source: "mem1", target: "qa" },
      { id: "e7", source: "mem1", target: "devops" },
      { id: "e8", source: "sa", target: "mem2" },
      { id: "e9", source: "qa", target: "mem2" },
      { id: "e10", source: "devops", target: "mem2" },
      { id: "e11", source: "mem2", target: "brain" }
    ];

    const waves = groupNodesIntoExecutionWaves(nodes as any, edges as any);

    expect(waves.length).toBe(6);
    expect(waves[0].map((n) => n.id)).toEqual(["input"]);
    expect(waves[1].map((n) => n.id)).toEqual(["pm", "ba"]);
    expect(waves[2].map((n) => n.id)).toEqual(["mem1"]);
    expect(waves[3].map((n) => n.id)).toEqual(["sa", "qa", "devops"]);
    expect(waves[4].map((n) => n.id)).toEqual(["mem2"]);
    expect(waves[5].map((n) => n.id)).toEqual(["brain"]);
  });

  test("runs multi-branch graph with concurrent Promise.all execution and aggregates memory", async () => {
    const DELAY_MS = 100;
    
    vi.spyOn(getProviderEngine(), "executeWithProvider").mockImplementation(async (providerId, req) => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      const prompt = req.messages?.[0]?.content || "";
      return {
        text: `Response for: ${prompt.slice(0, 30)}`,
        providerId: "mock-provider",
        modelName: "mock-model",
        status: "success",
        error: null,
        usage: { inputTokens: 10, outputTokens: 10 },
        cost: 0,
        durationMs: DELAY_MS
      };
    });

    const workflowJson = {
      nodes: [
        { id: "input", data: { type: "trigger.manual", nodeKind: "trigger", title: "Input" } },
        { id: "pm", data: { type: "ai.llm_call", nodeKind: "ai", title: "Project Manager", provider: "gemini", llmOutputKey: "pm_out", prompt: "PM Task" } },
        { id: "ba", data: { type: "ai.llm_call", nodeKind: "ai", title: "Business Analyst", provider: "gemini", llmOutputKey: "ba_out", prompt: "BA Task" } },
        { id: "mem1", data: { type: "ai.memory", nodeKind: "ai", title: "Memory Node 1" } },
        { id: "sa", data: { type: "ai.llm_call", nodeKind: "ai", title: "Software Architect", provider: "gemini", llmOutputKey: "sa_out", prompt: "SA Task" } },
        { id: "qa", data: { type: "ai.llm_call", nodeKind: "ai", title: "QA Lead", provider: "gemini", llmOutputKey: "qa_out", prompt: "QA Task" } },
        { id: "devops", data: { type: "ai.llm_call", nodeKind: "ai", title: "DevOps", provider: "gemini", llmOutputKey: "devops_out", prompt: "DevOps Task" } },
        { id: "mem2", data: { type: "ai.memory", nodeKind: "ai", title: "Memory Node 2" } },
        { id: "brain", data: { type: "ai.llm_call", nodeKind: "ai", title: "AI Brain", provider: "gemini", llmOutputKey: "final_out", prompt: "Summary Task" } }
      ],
      edges: [
        { id: "e1", source: "input", target: "pm" },
        { id: "e2", source: "input", target: "ba" },
        { id: "e3", source: "pm", target: "mem1" },
        { id: "e4", source: "ba", target: "mem1" },
        { id: "e5", source: "mem1", target: "sa" },
        { id: "e6", source: "mem1", target: "qa" },
        { id: "e7", source: "mem1", target: "devops" },
        { id: "e8", source: "sa", target: "mem2" },
        { id: "e9", source: "qa", target: "mem2" },
        { id: "e10", source: "devops", target: "mem2" },
        { id: "e11", source: "mem2", target: "brain" }
      ]
    };

    const startTime = Date.now();
    const runResult = await runWorkflowTest({
      userId: "test-user-123",
      workflowId: "wf-parallel-test",
      workflowJson,
      input: { latestMessage: "Start Workflow" }
    });
    const totalDuration = Date.now() - startTime;

    expect(runResult.logs.length).toBeGreaterThanOrEqual(9);
    
    // Sequential 6 LLM calls * 100ms = 600ms+
    // Parallel wave execution: Wave 1 (100ms) + Wave 3 (100ms) + Wave 5 (100ms) = ~300ms
    // We expect total duration to be under 500ms
    expect(totalDuration).toBeLessThan(500);

    // Verify all parallel outputs are saved in context
    expect(runResult.context.pm_out).toBeDefined();
    expect(runResult.context.ba_out).toBeDefined();
    expect(runResult.context.sa_out).toBeDefined();
    expect(runResult.context.qa_out).toBeDefined();
    expect(runResult.context.devops_out).toBeDefined();
  });
});
