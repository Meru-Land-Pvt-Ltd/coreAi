import { describe, it, expect, vi } from "vitest";

/**
 * THE LOOP — the machine's third leg, tested against the engine itself.
 *
 * Do things in order, choose, and REPEAT: the platform had no repeat, so an
 * agent could serve one customer at a time but never work through a list.
 * These tests run a real graph through runWorkflowTest and check that the
 * downstream steps genuinely ran once per item — not that a loop "exists".
 */

vi.mock("../admin/node-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../admin/node-limits")>()),
  getLoopRoundLimit: async () => 25,
  getFileUploadImagesAllowed: async () => true
}));

import { runWorkflowTest } from "./workflow-runner";

const graph = (loopConfig: Record<string, unknown> = {}) => ({
  nodes: [
    { id: "box", data: { type: "block.prompt_composer", nodeKind: "block", title: "Prompt Box" } },
    { id: "loop", data: { type: "logic.loop", nodeKind: "condition", title: "Loop", loopSplit: "commas", loopMaxRounds: "10", ...loopConfig } },
    { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
  ],
  edges: [
    { id: "e1", source: "box", target: "loop" },
    { id: "e2", source: "loop", target: "out" }
  ]
});

async function run(text: string, loopConfig?: Record<string, unknown>) {
  return runWorkflowTest({
    userId: `loop-${process.pid}`,
    workflowId: `test-run-loop-${process.pid}`,
    workflowJson: graph(loopConfig),
    input: { text } as never
  });
}

describe("the Loop", () => {
  it("works through every item, in order, and hands on all the answers", async () => {
    const result = await run("red, green, blue");
    const loopLogs = (result.logs ?? []).filter((log) => log.nodeId === "loop");

    const rounds = loopLogs.filter((log) => /^Round \d/.test(log.message));
    expect(rounds.map((log) => log.message)).toEqual([
      'Round 1 of 3 — item: "red"',
      'Round 2 of 3 — item: "green"',
      'Round 3 of 3 — item: "blue"'
    ]);

    const final = loopLogs[loopLogs.length - 1];
    expect(final.message).toContain("Worked through 3 items");
    expect((final.output as { results?: string[] })?.results).toEqual(["red", "green", "blue"]);
  });

  it("splits one-per-line when the architect says so", async () => {
    const result = await run("apples\npears", { loopSplit: "lines" });
    const rounds = (result.logs ?? []).filter((log) => log.nodeId === "loop" && /^Round/.test(log.message));
    expect(rounds).toHaveLength(2);
  });

  it("never runs more rounds than the architect's ceiling", async () => {
    // Every round can be an AI call. A pasted spreadsheet must not become a bill.
    const fifty = Array.from({ length: 50 }, (_, i) => `item${i}`).join(", ");
    const result = await run(fifty, { loopMaxRounds: "5" });
    const rounds = (result.logs ?? []).filter((log) => log.nodeId === "loop" && /^Round/.test(log.message));
    expect(rounds).toHaveLength(5);
  });

  it("says honestly that there was nothing to work through", async () => {
    const result = await run("   ");
    const loopLog = (result.logs ?? []).find((log) => log.nodeId === "loop");
    expect(loopLog?.status).toBe("skipped");
    expect(loopLog?.message).toContain("no items arrived");
  });

  it("refuses a Loop inside a Loop with a sentence, not a hang", async () => {
    const nested = {
      nodes: [
        { id: "box", data: { type: "block.prompt_composer", nodeKind: "block", title: "Prompt Box" } },
        { id: "loop1", data: { type: "logic.loop", nodeKind: "condition", title: "Outer" } },
        { id: "loop2", data: { type: "logic.loop", nodeKind: "condition", title: "Inner" } }
      ],
      edges: [
        { id: "e1", source: "box", target: "loop1" },
        { id: "e2", source: "loop1", target: "loop2" }
      ]
    };
    const result = await runWorkflowTest({
      userId: `loop-${process.pid}`,
      workflowId: `test-run-loopnest-${process.pid}`,
      workflowJson: nested,
      input: { text: "a, b" } as never
    });
    const outer = (result.logs ?? []).find((log) => log.nodeId === "loop1" && log.status === "error");
    expect(outer?.message).toContain("One Loop inside another");
  });
});

describe("File Upload in the engine", () => {
  it("reads a document and hands its words on", async () => {
    const textFile = Buffer.from("The total owed is forty pounds.").toString("base64");
    const result = await runWorkflowTest({
      userId: `upload-${process.pid}`,
      workflowId: `test-run-upload-${process.pid}`,
      workflowJson: {
        nodes: [{ id: "up", data: { type: "block.file_upload", nodeKind: "block", title: "File Upload" } }],
        edges: []
      },
      input: {
        message: "what do I owe?",
        attachments: [{ name: "invoice.txt", mimeType: "text/plain", data: `data:text/plain;base64,${textFile}` }]
      } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "up");
    expect(log?.status).toBe("success");
    expect(log?.message).toContain('invoice.txt');
    expect((log?.output as { file?: { text?: string } })?.file?.text).toContain("forty pounds");
  });

  it("says a picture went to the Brain's eyes, not into words", async () => {
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const result = await runWorkflowTest({
      userId: `upload-${process.pid}`,
      workflowId: `test-run-upload-img-${process.pid}`,
      workflowJson: {
        nodes: [{ id: "up", data: { type: "block.file_upload", nodeKind: "block", title: "File Upload" } }],
        edges: []
      },
      input: {
        message: "what is in this photo?",
        attachments: [{ name: "photo.png", mimeType: "image/png", data: `data:image/png;base64,${pixel}` }]
      } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "up");
    expect(log?.message).toContain("Brain's eyes");
  });

  it("says honestly that no file was attached", async () => {
    const result = await runWorkflowTest({
      userId: `upload-${process.pid}`,
      workflowId: `test-run-upload-none-${process.pid}`,
      workflowJson: {
        nodes: [{ id: "up", data: { type: "block.file_upload", nodeKind: "block", title: "File Upload" } }],
        edges: []
      },
      input: { message: "hello" } as never
    });
    const log = (result.logs ?? []).find((entry) => entry.nodeId === "up");
    expect(log?.status).toBe("skipped");
  });
});
