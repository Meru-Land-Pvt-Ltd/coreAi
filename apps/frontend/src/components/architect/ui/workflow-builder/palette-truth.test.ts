import { describe, expect, it } from "vitest";
import { getNodeDefinition, isDeletedNodeType, isParkedNodeType } from "@coreai/shared";
import { libraryGroups } from "./library";

/**
 * THE SHELF TELLS THE TRUTH (2026-08-27).
 *
 * The palette is hand-written and the node rows are generated, so the two can
 * drift — and they had. Six cards were retired from the shelf while their rows
 * stayed, so the documentation still described cards nobody could place; one
 * retired slug was spelled wrong in the retired list, so that card was never
 * really retired at all; and three starter templates dropped retired cards
 * onto brand-new canvases, handing an architect something they could never add
 * again themselves.
 *
 * A card on this shelf must be a real, placeable node, and its words must be
 * the row's words — because the panel, the docs and the setup screen all read
 * that same row.
 */

type PaletteItem = { label: string; helper: string; overrides?: { type?: string } };

const cards = libraryGroups.flatMap((group) =>
  (group.items as PaletteItem[]).map((item) => ({ group: group.title, item }))
);

describe("the palette and the node rows agree", () => {
  it("has cards to check", () => {
    expect(cards.length).toBeGreaterThan(20);
  });

  it("offers nothing that has no row behind it", () => {
    const orphans = cards
      .filter(({ item }) => !getNodeDefinition(String(item.overrides?.type ?? "")))
      .map(({ group, item }) => `${group}/${item.label} (${item.overrides?.type ?? "no type"})`);

    expect(
      orphans,
      "a card with no row falls back to showing its machine name to the architect"
    ).toEqual([]);
  });

  it("offers nothing that has been retired", () => {
    const retired = cards
      .filter(({ item }) => isDeletedNodeType(String(item.overrides?.type ?? "")))
      .map(({ item }) => `${item.label} (${item.overrides?.type})`);

    expect(retired).toEqual([]);
  });

  it("says the same words the row says, so the panel and the docs cannot disagree", () => {
    const mismatched: string[] = [];
    for (const { item } of cards) {
      const row = getNodeDefinition(String(item.overrides?.type ?? ""));
      if (!row) continue;
      /* A sleeping card is allowed its own wording — it carries the reason it
         sleeps. Everything awake reads straight from the row. */
      if (isParkedNodeType(row.type)) continue;
      if (item.label !== row.label) mismatched.push(`${row.type}: shelf "${item.label}" vs row "${row.label}"`);
      if (item.helper !== row.description) {
        mismatched.push(`${row.type}: shelf helper differs from the row's description`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});
