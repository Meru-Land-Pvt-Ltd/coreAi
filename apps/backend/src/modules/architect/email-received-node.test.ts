import { describe, it, expect, vi } from "vitest";

/**
 * NODE 010 — EMAIL RECEIVED, the ear, against the engine.
 * The whole limb in one graph: a mail arrives, the Condition can read it, the
 * hand can answer it — and a test Run is honest about its sample.
 */

vi.mock("../admin/node-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../admin/node-limits")>()),
  getEmailPerRunLimit: async () => 25,
  getLoopRoundLimit: async () => 25
}));

import { runWorkflowTest } from "./workflow-runner";

const EAR = { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } };

describe("Email received", () => {
  it("a live mail wakes the agent and travels under its declared name", async () => {
    const result = await runWorkflowTest({
      userId: `ear-${process.pid}`,
      workflowId: `test-run-ear-${process.pid}`,
      workflowJson: { nodes: [EAR], edges: [] },
      input: {
        email: { from: "ana@customer.com", subject: "Do you open Sundays?", body: "Hi — are you open this Sunday?" }
      } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "ear");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("ana@customer.com");
    expect(log?.message).toContain("Do you open Sundays?");
    // Never marked as a sample when the mail is real.
    expect(log?.message).not.toContain("sample");
    expect((log?.output as { body?: string })?.body).toContain("open this Sunday");
  });

  it("a test Run synthesizes a mail and SAYS it is a sample", async () => {
    // The builder's Run must work with no real mail — and must never let a
    // sample masquerade as the real thing.
    const result = await runWorkflowTest({
      userId: `ear-${process.pid}`,
      workflowId: `test-run-earsample-${process.pid}`,
      workflowJson: { nodes: [EAR], edges: [] },
      input: {} as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "ear");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("(sample");
  });

  it("the mail's words reach the steps after it as text", async () => {
    const graph = {
      nodes: [
        { id: "ear2", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
        { id: "loop", data: { type: "logic.loop", nodeKind: "condition", title: "Loop", loopSplit: "commas", loopMaxRounds: "5" } },
        { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
      ],
      edges: [
        { id: "e1", source: "ear2", target: "loop" },
        { id: "e2", source: "loop", target: "out" }
      ]
    };
    const result = await runWorkflowTest({
      userId: `ear-${process.pid}`,
      workflowId: `test-run-earflow-${process.pid}`,
      workflowJson: graph,
      input: { email: { from: "a@b.com", subject: "s", body: "one, two" } } as never
    });
    const rounds = (result.logs ?? []).filter((log) => log.nodeId === "loop" && /^Round/.test(log.message));
    // The Loop split the MAIL's body — proof the ear's words travel as text.
    expect(rounds).toHaveLength(2);
  });
});
