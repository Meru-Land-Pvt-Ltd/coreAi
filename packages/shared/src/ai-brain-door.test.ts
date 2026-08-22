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

  it("Q3 — its needs are written by the architect, in its own prompt, and it says so", () => {
    // The one place this node is genuinely different from the first two.
    // Pretending it has a fixed door in would be a lie the canvas then checks
    // against; pretending it needs nothing reads as "wire me to anything".
    expect(brain?.requiredVariables).toEqual([]);
    expect(brain?.needsWhateverItsPromptAsksFor).toBe(true);
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

  it("the prompt is the one setting it cannot run without", () => {
    expect(brain?.requiredConfig).toContain("llmRequirements");
  });

  it("takes what the Prompt Box gives, and gives what the Result Viewer takes", () => {
    // The whole first machine, checked in one line. Prompt Box -> AI Brain ->
    // Result Viewer is the shape every product on this platform starts from.
    const resultViewer = getNodeDefinition("block.output_stage");
    expect(brain?.producedVariables).toEqual(resultViewer?.requiredVariables);
  });
});
