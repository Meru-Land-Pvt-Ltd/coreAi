import { describe, expect, it } from "vitest";
import { NODE_DEFINITIONS, PRODUCES_BY_TYPE, getNodeDefinition } from "./node-registry.js";

/**
 * ONE FACT, ONE PLACE — WHAT A STEP HANDS ON (2026-08-28).
 *
 * What a node produces was declared in two places: on the node itself, and
 * again in PRODUCES_BY_TYPE, which overrides it at read time.
 *
 * The table exists for a good reason. The rows were lying — the phone
 * trigger claimed it produced the caller's name and the business's name and
 * type, and produced none of the three — so somebody wrote one list taken
 * from runs that actually happened, readable in a single sitting, and made
 * it win. That was right. What was wrong is that the rows it replaced were
 * left standing.
 *
 * The cost, measured: correcting a node in the obvious place changed
 * nothing. Three separate attempts edited a decoration while the real answer
 * sat somewhere else, and nothing anywhere said so.
 *
 * This test makes that impossible. A type may be described in the table OR
 * on its own row — never both.
 */

describe("what a step hands on is written down once", () => {
  it("no node declares its outputs in two places", () => {
    const twice: string[] = [];

    for (const node of NODE_DEFINITIONS) {
      const inTable = Object.prototype.hasOwnProperty.call(PRODUCES_BY_TYPE, node.type);
      const onRow = Array.isArray(node.producedVariables);
      if (inTable && onRow) twice.push(node.type);
    }

    expect(
      twice,
      `These types declare what they produce twice. The table wins, so the row is a decoration that will mislead the next person who edits it — delete the row:\n  ${twice.join("\n  ")}`
    ).toEqual([]);
  });

  it("whichever place holds it, reading a node gives the same answer", () => {
    /* The guard above only forbids the collision. This one proves the value
       a caller actually receives comes from wherever it is declared, so
       removing a duplicate row can never quietly change behaviour. */
    for (const node of NODE_DEFINITIONS) {
      const live = getNodeDefinition(node.type);
      const declared = PRODUCES_BY_TYPE[node.type];

      if (declared === null) {
        expect(live?.producesNothing, `${node.type} is declared to hand on nothing`).toBe(true);
        expect(live?.producedVariables).toEqual([]);
      } else if (declared) {
        expect(live?.producedVariables, `${node.type} must read back from the table`).toEqual(declared);
      } else {
        expect(live?.producedVariables ?? undefined, `${node.type} must read back from its own row`).toEqual(
          node.producedVariables ?? undefined
        );
      }
    }
  });
});
