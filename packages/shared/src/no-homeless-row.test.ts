import { describe, expect, it } from "vitest";
import { DELETED_NODE_TYPES, nodeCatalogue } from "./node-registry.js";
import { SETUP_FIELD_RULES } from "./setup-field-rules.js";

/**
 * NO HOMELESS ROW (2026-08-27).
 *
 * A node's row can say "the business answers this". If it says so and no setup
 * screen ever asks the question, the business installs the agent, presses the
 * button, and it does not work — with nothing anywhere to tell them what is
 * missing. That is the single worst failure this platform has, because it is
 * silent on both sides: the architect thinks they shipped it, the business
 * thinks they bought it.
 *
 * SETUP_FIELD_RULES is what decides which sections a business's setup screen
 * shows for the nodes in their agent. So every live node that asks the
 * business for something must appear there. It is true today — this keeps it
 * true for the node somebody adds next month.
 */

describe("no homeless row", () => {
  const rows = nodeCatalogue();
  const rules = Object.keys(SETUP_FIELD_RULES.nodes);

  it("reads a real catalogue", () => {
    expect(rows.length).toBeGreaterThan(30);
    expect(rules.length).toBeGreaterThan(10);
  });

  it("gives every live node that asks the business something a home on their setup screen", () => {
    const homeless = rows
      .filter((row) => !row.parked && row.settings.business.length > 0)
      .filter((row) => !rules.includes(row.type))
      .map((row) => `${row.type} — asks the business: ${row.settings.business.map((s) => s.name).join(", ")}`);

    expect(
      homeless,
      "these nodes ask a business for something and no setup screen ever asks them the question"
    ).toEqual([]);
  });

  it("never keeps a setup rule for a card that has been deleted", () => {
    /* A rule for a card nobody can place is dead weight that reads as intent
       to the next person. Legacy slugs from graphs people already saved are
       fine and are meant to be here — a DELETED type is not. */
    const dead = rules.filter((type) => type in DELETED_NODE_TYPES);
    expect(dead).toEqual([]);
  });
});
