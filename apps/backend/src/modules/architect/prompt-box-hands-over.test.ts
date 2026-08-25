import { describe, it, expect } from "vitest";
import { runWorkflowTest } from "./workflow-runner";

/**
 * THE PROMPT BOX HANDS OVER WHAT THE CUSTOMER TYPED.
 *
 * It always declared that it gives `text`. For a long time it gave nothing —
 * the words arrived on the run itself, put there by the page, and the node was
 * skipped as decoration. Everything worked, so nobody noticed, until our own
 * honesty check started naming it on every single run.
 */

const graph = {
  nodes: [
    { id: "box", data: { type: "block.prompt_composer", nodeKind: "block", title: "Prompt Box" } },
    { id: "out", data: { type: "block.output_stage", nodeKind: "block", title: "Result Viewer" } }
  ],
  edges: [{ source: "box", target: "out" }]
};

async function run(input: Record<string, unknown>) {
  const result = await runWorkflowTest({
    userId: `promptbox-${process.pid}`,
    workflowId: `test-run-promptbox-${process.pid}`,
    workflowJson: graph,
    input: input as never
  });
  return (result.logs ?? []).find((log) => log.nodeId === "box");
}

describe("the Prompt Box's door out", () => {
  it("hands on the words the public page sent as `text`", async () => {
    const log = await run({ text: "MANGO4242" });
    expect(log?.status).toBe("success");
    expect((log?.output as { text?: string })?.text).toBe("MANGO4242");
  });

  it("hands on the words the builder's preview sent as `message`", async () => {
    // The preview and the one-shot Face runs have always called them
    // `message`. A node that only understood the newest name would go quiet on
    // the screen an architect tests with.
    const log = await run({ message: "my crown fell out" });
    expect((log?.output as { text?: string })?.text).toBe("my crown fell out");
  });

  it("says so in words an architect reads, not ours", async () => {
    const log = await run({ text: "hello" });
    expect(log?.message).toBe("Took what your customer typed and handed it on.");
  });

  it("says nobody typed when a timer or a webhook started the run", async () => {
    // Claiming success here would be the same lie in the other direction: no
    // person was at a keyboard, so there is nothing to hand over.
    const log = await run({});
    expect(log?.status).toBe("skipped");
    expect(log?.message).toBe("Nobody typed anything into this box on this run.");
  });
});
