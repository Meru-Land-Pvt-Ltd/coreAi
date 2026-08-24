import { describe, it, expect } from "vitest";
import { getNodeDefinition } from "./node-registry";

/**
 * NODE THREE, AGAINST THE SOP.
 *
 * The circuit. Switch, circuit, lamp — the Prompt Box is the way in and the
 * Result Viewer is the way out, and this is the only node between them that
 * does any work. Its voice cousin sits inside ten of the eleven agents
 * businesses pay for, which makes it the most used node on the platform.
 */

const brain = getNodeDefinition("ai.llm_call");

describe("the AI Brain answers the SOP", () => {
  it("exists, and is called what a person would call it", () => {
    expect(brain?.label).toBe("AI Brain");
  });

  it("Q3 — it needs text, the same as any other node", () => {
    // It briefly carried a special case saying its needs were whatever its
    // prompt asked for. That was an invention; see the test below.
    expect(brain?.requiredVariables).toEqual(["text"]);
  });

  it("Q4 — gives text", () => {
    expect(brain?.producedVariables).toEqual(["text"]);
    expect(brain?.producesNothing ?? false).toBe(false);
  });

  it("Q5 — every dial the runner reads is written down, with a default", () => {
    // The runner reads exactly these off the node. Anything it reads that is
    // missing here is a setting nobody documented; anything here the runner
    // ignores is a dial that does nothing.
    const dials = Object.keys(brain?.defaultConfig ?? {});
    for (const dial of [
      "llmProvider",
      "llmModel",
      "llmSystemPrompt",
      "llmRequirements",
      "llmTemperature",
      "llmMaxTokens",
      "llmOutputFormat"
    ]) {
      expect(dials).toContain(dial);
    }
  });

  it("the one thing it cannot run without is being told what the answer should be", () => {
    expect(brain?.requiredConfig).toContain("llmAnswerShouldBe");
  });

  it("takes what the Prompt Box gives, and gives what the Result Viewer takes", () => {
    // The whole first machine, checked in one line. Prompt Box -> AI Brain ->
    // Result Viewer is the shape every product on this platform starts from.
    const resultViewer = getNodeDefinition("block.output_stage");
    expect(brain?.producedVariables).toEqual(resultViewer?.requiredVariables);
  });
});

describe("the two boxes become one instruction", () => {
  it("the door in is text — no special case", () => {
    // This carried "it needs whatever its prompt asks for" for a while. That
    // was an invention: a file becomes text, audio becomes text, a video
    // becomes text before it ever reaches here. It is the one node that can
    // read anything, which is why its door is the simplest, not the cleverest.
    expect(brain?.requiredVariables).toEqual(["text"]);
    expect((brain as { needsWhateverItsPromptAsksFor?: boolean })?.needsWhateverItsPromptAsksFor).toBeUndefined();
  });

  it("ships with both boxes and the old single box, so nothing already built breaks", () => {
    const dials = Object.keys(brain?.defaultConfig ?? {});
    expect(dials).toContain("llmInputIs");
    expect(dials).toContain("llmAnswerShouldBe");
    // Sixty-seven brains across forty-one agents were written in the old one.
    expect(dials).toContain("llmRequirements");
  });
});
