import { describe, expect, it } from "vitest";
import { runWorkflowTest } from "./workflow-runner";

/**
 * THE TIMER'S PATIENCE — the mid-wire flavor, against the engine.
 *
 * Position is mode: at the start it is the alarm clock (unchanged); mid-wire
 * it holds the conversation. A test cannot wait two days and says so — the
 * silence report is handed on so the follow-up path is testable right now.
 */

describe("Timer, placed mid-wire", () => {
  it("test runs wake with silence immediately, marked as a sample, and the follow-up runs", async () => {
    const graph = {
      nodes: [
        { id: "ear", data: { type: "trigger.email_received", nodeKind: "trigger", title: "Email received" } },
        { id: "hold", data: { type: "trigger.schedule", nodeKind: "trigger", title: "Timer", holdFor: "2" } },
        { id: "loop", data: { type: "logic.loop", nodeKind: "condition", title: "Loop", loopSplit: "commas", loopMaxRounds: "5" } },
        { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
      ],
      edges: [
        { id: "e1", source: "ear", target: "hold" },
        { id: "e2", source: "hold", target: "loop" },
        { id: "e3", source: "loop", target: "out" }
      ]
    };
    const result = await runWorkflowTest({
      userId: `hold-${process.pid}`,
      workflowId: `test-run-hold-${process.pid}`,
      workflowJson: graph,
      input: { email: { from: "ana@customer.com", subject: "s", body: "one, two" } } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "hold");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("woke with silence");
    expect(log?.message).toContain("sample");
    expect(log?.message).toContain("cancelled the moment they reply");
    // Downstream ran — the ear's words travelled through the hold as text.
    const rounds = (result.logs ?? []).filter((entry) => entry.nodeId === "loop" && /^Round/.test(entry.message));
    expect(rounds).toHaveLength(2);
  });

  it("placed at the start it stays the alarm clock — nothing held", async () => {
    const graph = {
      nodes: [
        { id: "tick", data: { type: "trigger.schedule", nodeKind: "trigger", title: "Timer", cadence: "daily" } },
        { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
      ],
      edges: [{ id: "e1", source: "tick", target: "out" }]
    };
    const result = await runWorkflowTest({
      userId: `hold-${process.pid}`,
      workflowId: `test-run-tick-${process.pid}`,
      workflowJson: graph,
      input: {} as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "tick");
    expect(log?.status).toBe("success");
    expect(log?.message).not.toContain("silence");
  });
});
