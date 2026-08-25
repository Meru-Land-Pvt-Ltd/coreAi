import { describe, it, expect, vi } from "vitest";

/**
 * NODE 009 — SEND EMAIL, the body's first Hand, against the engine.
 *
 * The cannon guard is the one behavior new enough to need its own proof: a
 * Loop wired into this hand must never become a campaign.
 */

vi.mock("../admin/node-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../admin/node-limits")>()),
  getEmailPerRunLimit: async () => 3,
  getLoopRoundLimit: async () => 25
}));

import { runWorkflowTest } from "./workflow-runner";

describe("Send email in the engine", () => {
  it("a Loop cannot turn the hand into a cannon — the ceiling stops it with a sentence", async () => {
    const graph = {
      nodes: [
        { id: "box", data: { type: "block.prompt_composer", nodeKind: "block", title: "Prompt Box" } },
        { id: "loop", data: { type: "logic.loop", nodeKind: "condition", title: "Loop", loopSplit: "commas", loopMaxRounds: "10" } },
        {
          id: "mail",
          data: {
            type: "communication.send_email",
            nodeKind: "connector",
            connector: "EMAIL",
            title: "Send email",
            recipientType: "custom",
            customRecipient: "manager@example.com",
            subjectTemplate: "Update",
            bodyTemplate: "One item done."
          }
        }
      ],
      edges: [
        { id: "e1", source: "box", target: "loop" },
        { id: "e2", source: "loop", target: "mail" }
      ]
    };

    const result = await runWorkflowTest({
      userId: `mail-${process.pid}`,
      workflowId: `test-run-mail-${process.pid}`,
      workflowJson: graph,
      input: { text: "a, b, c, d, e" } as never
    });

    const mailLogs = (result.logs ?? []).filter((log) => log.nodeId === "mail");
    const refused = mailLogs.filter((log) => log.message.includes("ceiling for one run"));
    // Five rounds asked; three allowed; two refused with the sentence.
    expect(refused.length).toBe(2);
  });

  it("a dry run says honestly that nothing was sent, and still shows the mail", async () => {
    const graph = {
      nodes: [
        {
          id: "mail",
          data: {
            type: "communication.send_email",
            nodeKind: "connector",
            connector: "EMAIL",
            title: "Send email",
            recipientType: "custom",
            customRecipient: "ana@example.com",
            subjectTemplate: "Your morning report",
            bodyTemplate: "All quiet."
          }
        }
      ],
      edges: []
    };

    const result = await runWorkflowTest({
      userId: `mail-${process.pid}`,
      workflowId: `test-run-maildry-${process.pid}`,
      workflowJson: graph,
      input: { message: "go" } as never
    });

    const log = (result.logs ?? []).find((entry) => entry.nodeId === "mail");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain("no email was sent");
    // The declared door out is written even on a dry run — honesty holds.
    expect((log?.output as { subject?: string })?.subject).toBe("Your morning report");
  });
});
