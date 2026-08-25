import { BLOCK_NODE_TYPES, DESIGN_BRAIN_NODE_TYPE } from "@coreai/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "./workflow-runner";
import { getProviderEngine, initProviderEngine } from "../ai-provider-engine/ai-provider-engine";

/**
 * Product blocks (block.*) are Face anchors — sections of the customer-facing
 * page — not engine work. A graph that mixes them with AI nodes must still run
 * its AI nodes cleanly in test mode: every block node is skipped with a
 * customer-worded success log, never an "Unknown node kind" error.
 *
 * Same DB-backed pattern as workflow-runner-clean-context.test.ts (skips when
 * the database is unreachable).
 */

const RUN = `blocknodes-${process.pid}-${Date.now().toString(36)}`;
const BLOCK_SKIP_MESSAGE = "Product section — shown to your customer, nothing to run";
const DESIGN_BRAIN_SKIP_MESSAGE = "Design Brain — it styles your page, nothing to run";

let dbAvailable = false;
let userId = "";
let workflowId = "";

const productWorkflowJson = {
  nodes: [
    {
      id: "trigger-1",
      type: "coreNode",
      position: { x: 0, y: 0 },
      data: { label: "Manual Input", nodeKind: "trigger", type: "trigger.manual" }
    },
    {
      id: "prompt-box-1",
      type: "coreNode",
      position: { x: 0, y: 120 },
      data: {
        label: "Prompt Box",
        nodeKind: "block",
        type: BLOCK_NODE_TYPES.promptComposer,
        placeholder: "Describe what you want…"
      }
    },
    {
      id: "ai-1",
      type: "coreNode",
      position: { x: 0, y: 240 },
      data: {
        label: "AI Processing",
        nodeKind: "ai",
        type: "ai.context_reply",
        prompt: "Summarize this text"
      }
    },
    {
      id: "result-viewer-1",
      type: "coreNode",
      position: { x: 0, y: 360 },
      // No nodeKind on purpose: the type-prefix fallback must still skip it.
      data: { label: "Result Viewer", type: BLOCK_NODE_TYPES.outputStage, kind: "auto" }
    },
    {
      id: "design-brain-1",
      type: "coreNode",
      position: { x: 0, y: 480 },
      // No nodeKind on purpose: "design.brain" has no "block." prefix, so only
      // the explicit Design Brain check can skip it.
      data: { label: "Design Brain", type: DESIGN_BRAIN_NODE_TYPE }
    }
  ],
  edges: [
    { id: "e1", source: "trigger-1", target: "prompt-box-1" },
    { id: "e2", source: "prompt-box-1", target: "ai-1" },
    { id: "e3", source: "ai-1", target: "result-viewer-1" },
    { id: "e4", source: "result-viewer-1", target: "design-brain-1" }
  ]
};

beforeAll(async () => {
  // This suite asserts block-node skipping, not model output. Stub the
  // provider (as the sibling AI-node suites do) so it never calls OpenAI.
  await initProviderEngine().catch(() => {});
  vi.spyOn(getProviderEngine(), "executeWithProvider").mockImplementation(async () => ({
    text: "Generated AI Response",
    providerId: "mock",
    modelName: "mock-model",
    status: "success",
    error: null,
    usage: { inputTokens: 10, outputTokens: 20 },
    cost: 0,
    durationMs: 5
  }));
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[workflow-runner-block-nodes.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "ARCHITECT" }
  });
  userId = user.id;

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: userId,
      name: `${RUN} product blocks workflow`,
      workflowJson: productWorkflowJson as never
    }
  });
  workflowId = workflow.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    if (workflowId) await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("workflow runner with product block nodes", () => {
  it("skips block nodes with a success log and still runs the AI nodes cleanly", async () => {
    if (!dbAvailable) return;

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson: productWorkflowJson,
      input: { message: "A watercolor fox" },
      mode: "test"
    });

    const errorLogs = result.logs.filter((log) => log.status === "error");
    expect(errorLogs).toEqual([]);

    /* The Prompt Box is the one block that is not decoration: it hands over
       what the customer typed, under the name it has always declared it gives.
       This test used to assert the opposite, which is how the node went on
       promising `text` and delivering nothing for so long. */
    const promptBoxLog = result.logs.find((log) => log.nodeId === "prompt-box-1");
    expect(promptBoxLog?.status).toBe("success");
    expect(promptBoxLog?.message).toBe("Took what your customer typed and handed it on.");
    expect((promptBoxLog?.output as { text?: string })?.text).toBe("A watercolor fox");

    const resultViewerLog = result.logs.find((log) => log.nodeId === "result-viewer-1");
    expect(resultViewerLog?.status).toBe("success");
    expect(resultViewerLog?.message).toBe(BLOCK_SKIP_MESSAGE);

    // The Design Brain (no nodeKind, no "block." prefix) got its own friendly skip.
    const designBrainLog = result.logs.find((log) => log.nodeId === "design-brain-1");
    expect(designBrainLog?.status).toBe("success");
    expect(designBrainLog?.message).toBe(DESIGN_BRAIN_SKIP_MESSAGE);

    // The AI node between the blocks actually ran.
    const aiLog = result.logs.find((log) => log.nodeId === "ai-1");
    expect(aiLog?.status).toBe("success");
    expect(aiLog?.message).not.toBe(BLOCK_SKIP_MESSAGE);

    // No "Unknown node kind" failure anywhere.
    expect(result.logs.some((log) => log.message.includes("Unknown node kind"))).toBe(false);
  });
});
