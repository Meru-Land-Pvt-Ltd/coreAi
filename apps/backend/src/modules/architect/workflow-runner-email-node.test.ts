import { VOICE_NODE_TYPES } from "@coreai/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest, type WorkflowRunLog } from "./workflow-runner";

const RUN = `emailnode-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let userId = "";
let workflowId = "";

const workflowJson = {
  nodes: [
    {
      id: "trigger-1",
      data: { label: "Input", nodeKind: "trigger", type: "trigger.manual" }
    },
    {
      id: "email-1",
      data: {
        label: "Send Email",
        nodeKind: "connector",
        connector: "EMAIL",
        connectorAction: "send_notification",
        type: VOICE_NODE_TYPES.sendEmail,
        recipientType: "customer",
        subjectTemplate: "Your booking with {{businessName}}",
        bodyTemplate: "Hi {{customerName}}, thanks for contacting {{businessName}}."
      }
    }
  ],
  edges: [{ id: "e1", source: "trigger-1", target: "email-1" }]
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[workflow-runner-email-node.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "ARCHITECT" }
  });
  userId = user.id;

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: userId,
      name: `${RUN} email node workflow`,
      workflowJson: workflowJson as never
    }
  });
  workflowId = workflow.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    // WorkflowRun/NodeRun rows cascade with the workflow definition.
    if (workflowId) await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("Send Email node in the builder dry run", () => {
  it("previews the email instead of failing with 'Unsupported connector: email'", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson,
      mode: "test",
      input: {
        callerName: "Test Customer",
        businessName: "Sample Business",
        businessType: "Service Business"
      }
    });

    const logs = result.logs as WorkflowRunLog[];
    const messages = logs.map((log) => log.message).join("\n");
    expect(messages).not.toContain("Unsupported connector");

    const emailLog = logs.find((log) => log.nodeId === "email-1");
    expect(emailLog?.status).toBe("success");
    expect(emailLog?.message).toContain("Dry run passed");
    expect(emailLog?.message).toContain("no email was sent");

    // Templates render with the test business details and land in the
    // context, so the Test panel can show the email preview card.
    const sentEmail = result.context.sentEmail as { to?: string; subject?: string; body?: string } | undefined;
    expect(sentEmail?.subject).toBe("Your booking with Sample Business");
    expect(sentEmail?.body).toContain("Hi Test Customer");
    expect(sentEmail?.to).toContain("Customer email");
  });

  it("previews team/custom recipients from the node config", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const teamGraph = {
      nodes: [
        workflowJson.nodes[0],
        {
          id: "email-1",
          data: {
            ...workflowJson.nodes[1].data,
            recipientType: "custom",
            customRecipient: "front-desk@example.com"
          }
        }
      ],
      edges: workflowJson.edges
    };

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson: teamGraph,
      mode: "test",
      input: { businessName: "Sample Business" }
    });

    const sentEmail = result.context.sentEmail as { to?: string } | undefined;
    expect(sentEmail?.to).toBe("front-desk@example.com");
  });
});
