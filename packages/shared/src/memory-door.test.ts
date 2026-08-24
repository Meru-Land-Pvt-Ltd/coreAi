import { describe, it, expect } from "vitest";
import { getNodeDefinition } from "./node-registry";

/**
 * NODE FIVE, AGAINST THE SOP.
 *
 * With in, out, think and choose, the machine was complete except for one
 * thing: it forgot. Every run started blank. Memory is what turned a calculator
 * into a computer, and here it is what turns a tool into an assistant.
 */

const memory = getNodeDefinition("ai.memory");

describe("Memory answers the SOP", () => {
  it("is called Memory — not Memory Node", () => {
    // "Node" is a word from our side of the screen.
    expect(memory?.label).toBe("Memory");
  });

  it("says what it does in words a person uses", () => {
    // It used to say it "aggregates node execution history into a compact text
    // memory string", which is a sentence written for us, not for an architect.
    expect(memory?.description).toBe(
      "Remembers what has happened, so the next answer knows about the last one."
    );
  });

  it("Q3 — it needs what just happened", () => {
    expect(memory?.requiredVariables).toEqual(["text"]);
  });

  it("Q4 — it gives everything remembered so far", () => {
    expect(memory?.producedVariables).toEqual(["memory"]);
  });

  it("Q5 — both dials have a default, so a dropped node is never blank", () => {
    expect(memory?.defaultConfig?.customMemoryNotes).toBe("");
    expect(memory?.defaultConfig?.maxMemoryTokens).toBe("4000");
  });

  it("takes what the AI Brain gives, and the AI Brain can read what it gives", () => {
    // Memory is already the Brain's biggest partner on this platform: eleven
    // agents feed into it, sixteen take from it.
    const brain = getNodeDefinition("ai.llm_call");
    expect(brain?.producedVariables).toEqual(memory?.requiredVariables);
  });
});
