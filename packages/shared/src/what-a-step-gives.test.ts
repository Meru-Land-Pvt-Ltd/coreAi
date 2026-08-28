import { describe, expect, it } from "vitest";
import { whatAStepGives } from "./what-a-step-gives.js";
import { getNodeDefinition, NODE_DEFINITIONS } from "./node-registry.js";

/**
 * A CARD MUST SAY WHAT A STEP GIVES IN THREE LINES (2026-08-28).
 *
 * The Telegram trigger printed twenty-four raw names on its card and asked a
 * non-technical architect to make something of them. The founder's question
 * was the right one: what does a paying architect DO with
 * `trigger.telegram.callback.data`? Almost nothing.
 */

describe("what a step gives, in the architect's words", () => {
  it("turns the Telegram trigger's twenty-four names into three ideas", () => {
    const raw = getNodeDefinition("trigger.telegram_message")?.producedVariables ?? [];
    expect(raw.length).toBeGreaterThan(20);

    const { words, more } = whatAStepGives(raw);

    expect(words.length).toBeLessThanOrEqual(3);
    expect(words).toContain("the message");
    expect(words).toContain("who sent it");
    /* And it says how many it did not list, rather than hiding them. */
    expect(more).toBeGreaterThan(0);
  });

  it("says nothing when a step hands on nothing", () => {
    expect(whatAStepGives([])).toEqual({ words: [], more: 0 });
    expect(whatAStepGives(undefined)).toEqual({ words: [], more: 0 });
  });

  it("still finds words for a name no rule has ever seen", () => {
    /* A node shipped next year must be summarised the day its row exists —
       there is no per-node table to forget to update. */
    const { words } = whatAStepGives(["shopify.orderTotal"]);
    expect(words).toEqual(["order total"]);
  });

  it("no card anywhere needs more than three lines", () => {
    for (const node of NODE_DEFINITIONS) {
      const gives = getNodeDefinition(node.type)?.producedVariables ?? [];
      const { words } = whatAStepGives(gives);
      expect(words.length, `${node.type} would print ${words.length} lines`).toBeLessThanOrEqual(3);
    }
  });
});
