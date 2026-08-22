import { describe, it, expect } from "vitest";
import { getNodeDefinition, BLOCK_NODE_TYPES } from "./node-registry";
import { KNOWN_PROMPT_VARIABLES } from "./prompt-variables";

/**
 * NODE TWO, AGAINST THE SOP.
 *
 * The lamp. A switch with no lamp proves nothing, so this is the node that
 * lets a person see that anything happened — and it is why the Prompt Box
 * could be proven at all.
 *
 * docs/NODE-SOP.md asks six questions. These pin the three it used to fail.
 */

const resultViewer = getNodeDefinition(BLOCK_NODE_TYPES.outputStage);

describe("the Result Viewer answers the SOP", () => {
  it("exists, and is called what a person would call it", () => {
    expect(resultViewer?.label).toBe("Result Viewer");
  });

  it("Q3 — says what it needs, which it claimed was nothing", () => {
    // It claimed to need nothing, so an unwired Result Viewer sat on a canvas
    // looking healthy while being incapable of showing anything at all.
    expect(resultViewer?.requiredVariables).toEqual(["text"]);
  });

  it("Q4 — gives nothing, and says so out loud rather than by silence", () => {
    // The end of the line: what it has goes to a person, not another node.
    // Silence would be ambiguous — an undescribed node looks identical to one
    // that genuinely produces nothing.
    expect(resultViewer?.producedVariables).toEqual([]);
    expect(resultViewer?.producesNothing).toBe(true);
  });

  it("asks for a name the platform recognises, so the canvas cannot call it unknown", () => {
    const known = KNOWN_PROMPT_VARIABLES.map((v) => v.toLowerCase());
    for (const key of resultViewer?.requiredVariables ?? []) {
      expect(known).toContain(key.toLowerCase());
    }
  });

  it("takes exactly what the Prompt Box gives — the pair fits", () => {
    // Switch and lamp. If these two ever stop matching, the first machine on
    // the platform stops working and nothing else can be trusted either.
    const promptBox = getNodeDefinition(BLOCK_NODE_TYPES.promptComposer);
    expect(promptBox?.producedVariables).toEqual(resultViewer?.requiredVariables);
  });

  it("Q5 — its one setting has a default, so a dropped node is never blank", () => {
    expect(resultViewer?.defaultConfig).toEqual({ kind: "auto" });
  });
});
