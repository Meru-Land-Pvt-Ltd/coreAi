import { describe, it, expect } from "vitest";
import { getNodeDefinition } from "./node-registry";

/**
 * NODE FOUR, AGAINST THE SOP.
 *
 * The fork in the road. With a switch, a circuit and a lamp you have a machine
 * that always does the same thing; this is the node that lets an agent behave
 * differently depending on what happened.
 */

const condition = getNodeDefinition("logic.condition");

describe("the Condition answers the SOP", () => {
  it("exists, and is called what a person would call it", () => {
    expect(condition?.label).toBe("Condition");
  });

  it("Q3 — it needs something to look at", () => {
    expect(condition?.requiredVariables).toEqual(["text"]);
  });

  it("Q4 — it gives the road it took and one line of why", () => {
    // It does not hand on a value, it chooses a road. But which road, and why,
    // let a Send Text after it say "sorry about the delay" instead of a
    // generic line — so they are declared rather than lost.
    expect(condition?.producedVariables).toEqual(["choice", "why"]);
  });

  it("Q5 — it starts with two roads, and both are ordinary words", () => {
    // Yes and No are a default, not a law. Routing three ways used to mean
    // three conditions chained in a ladder.
    expect(condition?.defaultConfig?.conditionChoices).toEqual(["Yes", "No"]);
  });

  it("takes what the AI Brain gives, so the pair fits", () => {
    const brain = getNodeDefinition("ai.llm_call");
    for (const need of condition?.requiredVariables ?? []) {
      expect(brain?.producedVariables).toContain(need);
    }
  });
});
