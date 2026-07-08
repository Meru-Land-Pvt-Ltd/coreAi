/**
 * End-to-end Brain Memory self-test.
 * Creates a temporary workflow run, saves nodes, links them, builds context,
 * and returns every result so you can inspect the full flow in one API call.
 */
import { prisma } from "../../lib/prisma";
import { memoryBroker } from "./memory-broker";
import { mapNodeRunToRecord } from "./mappers";

type RunMemoryTestInput = {
  architectUserId: string;
};

export async function runMemorySelfTest(input: RunMemoryTestInput) {
  const stamp = Date.now();
  const triggerNodeId = "node_trigger";
  const smsNodeId = "node_sms";
  const brainNodeId = "node_ai_brain";

  // 1) Temporary workflow definition owned by the caller
  const workflow = await prisma.workflowDefinition.create({
    data: {
      name: `[Memory Test] ${stamp}`,
      description: "Temporary workflow created by GET /memory/test — safe to delete",
      architectUserId: input.architectUserId,
      workflowJson: {
        nodes: [
          { id: triggerNodeId, type: "trigger" },
          { id: smsNodeId, type: "twilio_sms" },
          { id: brainNodeId, type: "ai_brain" },
        ],
        edges: [],
      },
      isTemplate: false,
    },
  });

  // 2) One WorkflowRun (this is the real id memory APIs need)
  const workflowRun = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      triggeredByUserId: input.architectUserId,
      mode: "TEST",
      status: "RUNNING",
      threadId: `memory-test-${stamp}`,
      inputJson: { source: "GET /memory/test" },
      metadataJson: { purpose: "brain-memory-self-test" },
    },
  });

  // 3) Save three node memories in execution order
  const triggerSave = await memoryBroker.saveNodeMemory({
    workflowRunId: workflowRun.id,
    nodeId: triggerNodeId,
    nodeType: "trigger",
    nodeLabel: "Missed Call Trigger",
    status: "success",
    executionOrder: 0,
    threadId: workflowRun.threadId ?? undefined,
    input: { event: "missed_call" },
    output: { callerPhone: "+15550100", dialStatus: "no-answer" },
    summary: "Missed call from +15550100",
    variables: { callerPhone: "+15550100" },
    provider: "twilio",
    tokenInput: 0,
    tokenOutput: 0,
    costCents: 0,
  });

  const smsSave = await memoryBroker.saveNodeMemory({
    workflowRunId: workflowRun.id,
    nodeId: smsNodeId,
    nodeType: "twilio_sms",
    nodeLabel: "Missed Call SMS",
    status: "success",
    executionOrder: 1,
    threadId: workflowRun.threadId ?? undefined,
    input: { to: "+15550100", body: "Sorry we missed your call." },
    output: { sid: "SM_test_123", status: "sent" },
    summary: "Sent missed-call SMS to +15550100",
    variables: { lastSmsSid: "SM_test_123" },
    provider: "twilio",
    tokenInput: 10,
    tokenOutput: 20,
    costCents: 1,
  });

  const brainSave = await memoryBroker.saveNodeMemory({
    workflowRunId: workflowRun.id,
    nodeId: brainNodeId,
    nodeType: "ai_brain",
    nodeLabel: "AI Brain Reply",
    status: "running",
    executionOrder: 2,
    threadId: workflowRun.threadId ?? undefined,
    input: { userMessage: "Can I book tomorrow at 3pm?" },
    output: null,
    summary: "Waiting for AI context build",
    provider: "openai",
    model: "gpt-4o-mini",
    tokenInput: 0,
    tokenOutput: 0,
    costCents: 0,
  });

  // 4) Back-link: AI Brain reads Trigger memory (not just SMS)
  const contextLink = await prisma.contextLink.create({
    data: {
      workflowRunId: workflowRun.id,
      fromNodeRunId: triggerSave.nodeRunId,
      toNodeRunId: brainSave.nodeRunId,
      linkType: "BACKLINK",
      reason: "AI Brain needs caller phone from the trigger",
      linkStatus: "ACTIVE",
    },
  });

  // 5) Exercise every broker method
  const loadedTrigger = await memoryBroker.loadNodeMemory(triggerSave.nodeRunId);
  const previousForBrain = await memoryBroker.getPreviousNodeMemory(
    workflowRun.id,
    brainNodeId
  );
  const backLinkedForBrain = await memoryBroker.getBackLinkedMemory(
    workflowRun.id,
    brainNodeId
  );
  const contextBundle = await memoryBroker.buildContextBundle({
    workflowRunId: workflowRun.id,
    nodeId: brainNodeId,
    threadId: workflowRun.threadId ?? undefined,
    originalPrompt: "Reply helpfully using business context and prior memory.",
    backlinkNodeIds: [triggerNodeId],
    workflowMetadata: { agent: "ai-receptionist", test: true },
  });

  // 6) Full DB snapshot for the response
  const fullRun = await prisma.workflowRun.findUnique({
    where: { id: workflowRun.id },
    include: {
      nodeRuns: { orderBy: { executionOrder: "asc" } },
      contextLinks: true,
    },
  });

  return {
    ok: true,
    message: "Brain Memory self-test completed",
    howToRead: {
      workflowRunId: "Use this id for all /memory/... APIs",
      previousMemory: "Should be the SMS node (forward chain)",
      backLinkedMemories: "Should include the Trigger node (back-link)",
      compressedPrompt: "Final string an AI provider would receive",
    },
    ids: {
      workflowId: workflow.id,
      workflowRunId: workflowRun.id,
      triggerNodeRunId: triggerSave.nodeRunId,
      smsNodeRunId: smsSave.nodeRunId,
      brainNodeRunId: brainSave.nodeRunId,
      contextLinkId: contextLink.id,
    },
    brokerResults: {
      loadNodeMemory: loadedTrigger,
      getPreviousNodeMemory: previousForBrain,
      getBackLinkedMemory: backLinkedForBrain,
      buildContextBundle: contextBundle,
    },
    databaseSnapshot: fullRun
      ? {
          ...fullRun,
          nodeRuns: fullRun.nodeRuns.map(mapNodeRunToRecord),
        }
      : null,
    checks: {
      previousIsSms: previousForBrain?.nodeId === smsNodeId,
      backlinkIncludesTrigger: backLinkedForBrain.some((m) => m.nodeId === triggerNodeId),
      compressedPromptHasSections: Boolean(contextBundle.compressedPrompt.includes("#")),
      nodeRunCount: fullRun?.nodeRuns.length ?? 0,
      contextLinkCount: fullRun?.contextLinks.length ?? 0,
    },
  };
}
