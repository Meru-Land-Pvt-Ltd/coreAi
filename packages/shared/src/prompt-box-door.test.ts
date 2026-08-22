import { describe, it, expect } from "vitest";
import { getNodeDefinition, BLOCK_NODE_TYPES } from "./node-registry";
import { KNOWN_PROMPT_VARIABLES, extractPromptVariables } from "./prompt-variables";

/**
 * NODE ONE, AGAINST THE SOP.
 *
 * The Prompt Box is the switch: nothing on this platform runs until something
 * from outside gets into the machine, and for a person typing, this is that
 * door. docs/NODE-SOP.md asks every node six questions; these pin the two it
 * used to fail.
 */

describe("the Prompt Box answers the SOP", () => {
  const promptBox = getNodeDefinition(BLOCK_NODE_TYPES.promptComposer);

  it("exists, and is called what a person would call it", () => {
    expect(promptBox?.label).toBe("Prompt Box");
  });

  it("Q3 — needs nothing, because it is the first node", () => {
    expect(promptBox?.requiredConfig).toEqual([]);
  });

  it("Q4 — says what it gives, which it did not until today", () => {
    // The whole fix in one assertion. Before this, it declared nothing, and
    // what a customer typed arrived only if the next node happened to be named
    // one of eight hard-coded words.
    expect(promptBox?.producedVariables).toEqual(["text"]);
  });

  it("a later node can write {{text}} without the canvas calling it unknown", () => {
    // The platform must not offer a door and then warn about anyone using it.
    expect(KNOWN_PROMPT_VARIABLES).toContain("text");

    const used = extractPromptVariables("Answer this: {{text}}");
    expect(used).toContain("text");
    // And every token it finds there is one the platform recognises.
    const knownKeys = KNOWN_PROMPT_VARIABLES.map((v) => v.toLowerCase());
    for (const token of used) expect(knownKeys).toContain(token.toLowerCase());
  });

  it("what the door is called comes from the declaration, not a list somebody maintains", () => {
    // If the registry ever renames it, the rest of the platform follows. That
    // is the point: one fact, one home.
    const declared = getNodeDefinition(BLOCK_NODE_TYPES.promptComposer)?.producedVariables ?? [];
    expect(declared.length).toBeGreaterThan(0);
    for (const key of declared) {
      expect(KNOWN_PROMPT_VARIABLES.map((v) => v.toLowerCase())).toContain(key.toLowerCase());
    }
  });
});
