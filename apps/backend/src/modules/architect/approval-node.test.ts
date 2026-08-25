import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "./workflow-runner";
import { approvalRoutes } from "../approvals/routes";

/**
 * NODE 013 — APPROVAL, against the engine and its public door.
 *
 * The probation: a drafted reply is HELD, the owner decides at a tokened
 * page, GET never decides (mail scanners prefetch links), deciding twice is
 * answered honestly, and one run asks for one approval only.
 */

const RUN = `approval-${process.pid}-${Date.now().toString(36)}`;

function graph() {
  return {
    nodes: [
      { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
      { id: "brainless", data: { type: "logic.loop", nodeKind: "condition", title: "Loop", loopSplit: "lines", loopMaxRounds: "1" } },
      { id: "app", data: { type: "communication.approval", nodeKind: "connector", connector: "APPROVAL", title: "Approval", approvalNote: "Check the calendar first." } }
    ],
    edges: [
      { id: "e1", source: "ear", target: "brainless" },
      { id: "e2", source: "brainless", target: "app" }
    ]
  };
}

describe("Approval — the engine", () => {
  it("holds the draft honestly in a dry run", async () => {
    const result = await runWorkflowTest({
      userId: `${RUN}-u`,
      workflowId: `test-run-app-${process.pid}`,
      workflowJson: graph(),
      input: { email: { from: "ana@customer.com", subject: "Price?", body: "How much is whitening?" } } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "app");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("nothing reaches the customer without their yes");
    expect((log?.output as { subject?: string })?.subject).toContain("Price?");
  });

  it("asks once per run, ever", async () => {
    const twice = {
      nodes: [
        { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
        { id: "a1", data: { type: "communication.approval", nodeKind: "connector", connector: "APPROVAL", title: "Approval" } },
        { id: "a2", data: { type: "communication.approval", nodeKind: "connector", connector: "APPROVAL", title: "Approval again" } }
      ],
      edges: [
        { id: "e1", source: "ear", target: "a1" },
        { id: "e2", source: "a1", target: "a2" }
      ]
    };
    const result = await runWorkflowTest({
      userId: `${RUN}-u`,
      workflowId: `test-run-apptwice-${process.pid}`,
      workflowJson: twice,
      input: { email: { from: "b@c.com", subject: "s", body: "hello there" } } as never
    });
    const second = (result.logs ?? []).find((entry) => entry.nodeId === "a2");
    expect(second?.status).toBe("success");
    expect(second?.message).toContain("one approval per run");
  });
});

describe("Approval — the public door", () => {
  let dbAvailable = false;
  const token = `${"a".repeat(40)}${process.pid}`.slice(0, 56).padEnd(56, "b");

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch {
      console.warn("[approval-node.test] database unreachable — door tests skipped");
      return;
    }
    await prisma.pendingApproval.create({
      data: {
        token,
        customerEmail: "ana@customer.com",
        ownerEmail: "owner@business.com",
        draftSubject: "Re: Price?",
        draftBody: "Whitening costs $200.",
        isTest: true,
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await prisma.pendingApproval.deleteMany({ where: { token } });
  });

  it("GET shows the draft and never decides", async () => {
    if (!dbAvailable) return;
    const response = await approvalRoutes.request(`/${token}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Whitening costs $200.");
    expect(html).toContain("Approve — send it");
    const row = await prisma.pendingApproval.findUnique({ where: { token } });
    expect(row?.status).toBe("PENDING");
  });

  it("rejecting buries the draft, and asking again answers honestly", async () => {
    if (!dbAvailable) return;
    const form = new URLSearchParams({ decision: "reject" });
    const response = await approvalRoutes.request(`/${token}/decide`, {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Not sent");
    const row = await prisma.pendingApproval.findUnique({ where: { token } });
    expect(row?.status).toBe("REJECTED");

    const again = await approvalRoutes.request(`/${token}/decide`, {
      method: "POST",
      body: new URLSearchParams({ decision: "approve" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    expect(await again.text()).toContain("Not sent");
  });

  it("an unknown token is turned away", async () => {
    const response = await approvalRoutes.request(`/${"f".repeat(56)}`);
    expect(response.status).toBe(404);
  });
});
