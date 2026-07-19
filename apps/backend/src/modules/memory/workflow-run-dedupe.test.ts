import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createWorkflowRun, DuplicateWorkflowRunError } from "./work-flow-run-service";

/**
 * One external call → one WorkflowRun. Duplicate webhook deliveries (Twilio
 * retries, doubly-configured callbacks, repeated Vapi end-of-call reports)
 * lose the unique-constraint claim before any side effect can run.
 */

const RUN = `rundedupe-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let userId = "";
let workflowId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[workflow-run-dedupe.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "ARCHITECT" } });
  userId = user.id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: userId }
    })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.workflowRun.deleteMany({ where: { workflowId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("createWorkflowRun call linkage", () => {
  it("a retried delivery with the same CallSid throws DuplicateWorkflowRunError and keeps one row", async () => {
    if (!dbAvailable) return;

    const callSid = `${RUN}-CA-1`;

    const first = await createWorkflowRun({
      workflowId,
      triggeredByUserId: userId,
      mode: "live",
      executionMode: "LIVE",
      callProvider: "TWILIO",
      externalCallId: callSid
    });
    expect(first.workflowRunId).toBeTruthy();

    await expect(
      createWorkflowRun({
        workflowId,
        triggeredByUserId: userId,
        mode: "live",
        executionMode: "LIVE",
        callProvider: "TWILIO",
        externalCallId: callSid
      })
    ).rejects.toBeInstanceOf(DuplicateWorkflowRunError);

    const rows = await prisma.workflowRun.count({
      where: { callProvider: "TWILIO", externalCallId: callSid }
    });
    expect(rows).toBe(1);
  });

  it("two concurrent deliveries create exactly one run", async () => {
    if (!dbAvailable) return;

    const callSid = `${RUN}-CA-2`;
    const attempt = () =>
      createWorkflowRun({
        workflowId,
        triggeredByUserId: userId,
        mode: "live",
        executionMode: "LIVE",
        callProvider: "TWILIO",
        externalCallId: callSid
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const duplicates = results.filter(
      (result) => result.status === "rejected" && result.reason instanceof DuplicateWorkflowRunError
    );

    expect(fulfilled).toHaveLength(1);
    expect(duplicates).toHaveLength(1);

    const rows = await prisma.workflowRun.count({
      where: { callProvider: "TWILIO", externalCallId: callSid }
    });
    expect(rows).toBe(1);
  });

  it("runs without call linkage are unaffected by the unique constraint", async () => {
    if (!dbAvailable) return;

    const first = await createWorkflowRun({ workflowId, triggeredByUserId: userId, mode: "test" });
    const second = await createWorkflowRun({ workflowId, triggeredByUserId: userId, mode: "test" });

    expect(first.workflowRunId).not.toBe(second.workflowRunId);
  });
});
