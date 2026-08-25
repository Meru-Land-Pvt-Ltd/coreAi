import { describe, expect, it } from "vitest";
import { runWorkflowTest } from "./workflow-runner";

/**
 * NODE 012 — ESCALATE, against the engine.
 *
 * The judgment to stop: reached, it drafts the handover honestly, gives the
 * customer one honest sentence as the run's new text, and refuses to hand
 * over twice — a Loop must never mail the owner twenty-five times.
 */

function graph(extraNodeData: Record<string, unknown> = {}) {
  return {
    nodes: [
      { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
      {
        id: "esc",
        data: {
          type: "communication.escalate",
          nodeKind: "connector",
          connector: "ESCALATE",
          title: "Escalate",
          ...extraNodeData
        }
      },
      { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
    ],
    edges: [
      { id: "e1", source: "ear", target: "esc" },
      { id: "e2", source: "esc", target: "out" }
    ]
  };
}

const MAIL = { from: "ana@customer.com", subject: "Refund please", body: "I want my money back, this is urgent." };

describe("Escalate", () => {
  it("drafts the handover honestly and hands the customer the honest sentence", async () => {
    const result = await runWorkflowTest({
      userId: `esc-${process.pid}`,
      workflowId: `test-run-esc-${process.pid}`,
      workflowJson: graph({ teamNote: "Check the refunds sheet first." }),
      input: { email: MAIL } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "esc");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("business's own inbox");
    const output = log?.output as { subject?: string; bodyPreview?: string; customerHears?: string };
    expect(output?.subject).toContain("Refund please");
    expect(output?.bodyPreview).toContain("ana@customer.com");
    expect(output?.bodyPreview).toContain("money back");
    expect(output?.bodyPreview).toContain("refunds sheet");
    // The honest default sentence becomes the run's text.
    expect(output?.customerHears).toContain("passing this to the team");
  });

  it("the architect's own sentence wins over the default", async () => {
    const result = await runWorkflowTest({
      userId: `esc-${process.pid}`,
      workflowId: `test-run-escmsg-${process.pid}`,
      workflowJson: graph({ customerMessage: "A human will call you within the hour." }),
      input: { email: MAIL } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "esc");
    expect((log?.output as { customerHears?: string })?.customerHears).toBe(
      "A human will call you within the hour."
    );
  });

  it("hands over once per run, ever — the second reach is refused politely", async () => {
    const twice = {
      nodes: [
        { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
        { id: "esc1", data: { type: "communication.escalate", nodeKind: "connector", connector: "ESCALATE", title: "Escalate" } },
        { id: "esc2", data: { type: "communication.escalate", nodeKind: "connector", connector: "ESCALATE", title: "Escalate again" } }
      ],
      edges: [
        { id: "e1", source: "ear", target: "esc1" },
        { id: "e2", source: "esc1", target: "esc2" }
      ]
    };
    const result = await runWorkflowTest({
      userId: `esc-${process.pid}`,
      workflowId: `test-run-esctwice-${process.pid}`,
      workflowJson: twice,
      input: { email: MAIL } as never
    });
    const first = (result.logs ?? []).find((entry) => entry.nodeId === "esc1");
    const second = (result.logs ?? []).find((entry) => entry.nodeId === "esc2");
    expect(first?.status).toBe("success");
    expect(first?.message).toContain("Handover drafted");
    expect(second?.status).toBe("success");
    expect(second?.message).toContain("one handover per run");
  });
});
