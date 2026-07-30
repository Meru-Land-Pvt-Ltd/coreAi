import { VOICE_NODE_TYPES } from "@coreai/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "./workflow-runner";

const RUN = `cleancontext-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let userId = "";
let workflowId = "";

const normalWorkflowJson = {
  nodes: [
    {
      id: "trigger-1",
      data: { label: "Manual Input", nodeKind: "trigger", type: "trigger.manual" }
    },
    {
      id: "ai-1",
      data: {
        label: "AI Processing",
        nodeKind: "ai",
        type: "ai.context_reply",
        prompt: "Summarize this text"
      }
    }
  ],
  edges: [{ id: "e1", source: "trigger-1", target: "ai-1" }]
};

const voiceWorkflowJson = {
  nodes: [
    {
      id: "trigger-phone",
      data: { label: "Inbound Call", nodeKind: "trigger", type: VOICE_NODE_TYPES.phoneCallTrigger }
    },
    {
      id: "voice-1",
      data: {
        label: "Voice Agent",
        nodeKind: "ai",
        type: VOICE_NODE_TYPES.voiceConversation,
        assistantName: "Assistant Alex"
      }
    }
  ],
  edges: [{ id: "e2", source: "trigger-phone", target: "voice-1" }]
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[workflow-runner-clean-context.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "ARCHITECT" }
  });
  userId = user.id;

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: userId,
      name: `${RUN} clean context workflow`,
      workflowJson: normalWorkflowJson as never
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

describe("Clean context seeding for workflow runner", () => {
  it("does not populate business, missedCall, inboundSms, or dummy caller info for normal workflows without call nodes or business config", async () => {
    if (!dbAvailable) return;

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson: normalWorkflowJson,
      mode: "test"
    });

    expect(result.context.business).toBeUndefined();
    expect(result.context.missedCall).toBeUndefined();
    expect(result.context.inboundSms).toBeUndefined();
    expect(result.context.caller_number).toBeUndefined();
    expect(result.context.caller_name).toBeUndefined();
  });

  it("populates business details when explicitly provided in input for a normal workflow", async () => {
    if (!dbAvailable) return;

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson: normalWorkflowJson,
      mode: "test",
      input: {
        businessName: "Acme Consulting",
        businessType: "Consulting Services"
      }
    });

    expect(result.context.business).toBeDefined();
    expect(result.context.business?.name).toBe("Acme Consulting");
    expect(result.context.business?.type).toBe("Consulting Services");
    expect(result.context.missedCall).toBeUndefined();
    expect(result.context.inboundSms).toBeUndefined();
  });

  it("seeds voice/call context fallbacks when workflow contains voice/call nodes but does not inject unconfigured services or faqs", async () => {
    if (!dbAvailable) return;

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson: voiceWorkflowJson,
      mode: "test"
    });

    expect(result.context.business).toBeDefined();
    expect(result.context.business?.name).toBeDefined();
    expect(result.context.business?.services).toBeUndefined();
    expect(result.context.business?.faqs).toBeUndefined();
    expect(result.context.missedCall).toBeDefined();
    expect(result.context.caller_number).toBe("+15555550100");
  });
});
