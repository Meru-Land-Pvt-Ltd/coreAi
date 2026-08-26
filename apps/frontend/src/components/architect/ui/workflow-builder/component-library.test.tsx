import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DELETED_NODE_TYPES, isParkedNodeType } from "@coreai/shared";
import { ComponentLibrary } from "./component-library";
import { libraryGroups } from "./library";

/**
 * THE PALETTE AFTER THE FOUNDER'S RULING (2026-08-26).
 *
 * The golden law's blade, applied card by card in one sitting: if the
 * Builder can generate it, it is not a card; if it carries no data, it is
 * decoration; if it cannot earn today, it parks. So the palette holds only
 * data doors and real powers, the sleepers gather on one grey PARKED shelf
 * at the bottom, and the ready-made templates — training wheels from before
 * the book — are gone: the Builder generates products on demand.
 */

afterEach(cleanup);

function renderLibrary(overrides: Partial<Parameters<typeof ComponentLibrary>[0]> = {}) {
  const onUseTemplate = vi.fn();
  const onAddNode = vi.fn();
  render(
    <ComponentLibrary
      searchTerm=""
      onSearchChange={() => undefined}
      onUseTemplate={onUseTemplate}
      onAddNode={onAddNode}
      {...overrides}
    />
  );
  return { onUseTemplate, onAddNode };
}

describe("the palette after the ruling", () => {
  it("has exactly three working groups with the founder's titles", () => {
    expect(libraryGroups.map((group) => group.title)).toEqual(["Face", "Brain", "Hands"]);
  });

  it("holds no deleted card — the blade fell once and stays fallen", () => {
    const types = libraryGroups
      .flatMap((group) => group.items)
      .map((item) => String(item.overrides?.type ?? ""));
    for (const deleted of Object.keys(DELETED_NODE_TYPES)) {
      expect(types, `${deleted} was deleted from the palette and must not return`).not.toContain(deleted);
    }
  });

  it("the Face group holds only the three data doors", () => {
    // Words in, files in, the answer out. Decoration is generated, never carded.
    const face = libraryGroups.find((group) => group.title === "Face");
    const types = (face?.items ?? []).map((item) => String(item.overrides?.type ?? ""));
    expect(types.sort()).toEqual(
      ["block.file_upload", "block.output_stage", "block.prompt_composer"].sort()
    );
  });

  it("every parked card carries its reason", () => {
    const parked = libraryGroups.flatMap((group) => group.items).filter((item) => item.parked);
    expect(parked.length).toBeGreaterThanOrEqual(11);
    for (const item of parked) {
      expect((item.parked ?? "").length).toBeGreaterThan(10);
      const type = String(item.overrides?.type ?? "");
      expect(isParkedNodeType(type), `${type} is drawn parked but the registry disagrees`).toBe(true);
    }
  });

  it("renders the PARKED shelf once, at the bottom, holding every sleeper", () => {
    renderLibrary();
    const headings = screen
      .getAllByTestId("architect-ui-workflow-builder-component-library-group-title", { exact: false })
      .map((el) => el.textContent);
    expect(headings[headings.length - 1]).toBe("Parked");
    expect(headings.filter((title) => title === "Parked")).toHaveLength(1);
  });

  it("shows no template section — the Builder generates products on demand", () => {
    renderLibrary();
    expect(screen.queryByTestId("face-template-section-title")).toBeNull();
    expect(screen.queryByTestId("library-template-ai-receptionist")).toBeNull();
    expect(screen.queryByTestId("library-template-missed-call")).toBeNull();
    expect(screen.queryByTestId("face-template-chatbot")).toBeNull();
  });
});
