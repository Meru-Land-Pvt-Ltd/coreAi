import { describe, it, expect } from "vitest";
import { NODE_SETTINGS_PAGES, hasNodeSettingsPage, nodeSettingsPage } from "./node-settings-pages";

/**
 * A NODE'S SETTINGS BELONG TO THAT NODE.
 *
 * The sidebar used to grow an entry every time any node gained a setting — "AI
 * models", "Design Brain rules", "Builder nodes" — and within a year an admin
 * would be hunting through twenty items trying to remember which node each one
 * belonged to. Now the sidebar has one entry and each node has its own page.
 */

describe("which nodes have a page of their own", () => {
  it("the AI Brain does, because its models are configured there", () => {
    expect(hasNodeSettingsPage("ai.llm_call")).toBe(true);
    expect(nodeSettingsPage("ai.llm_call")?.title).toBe("Models");
  });

  it("a node with nothing to configure does not", () => {
    // A Settings link that opens an empty page teaches an admin not to click
    // links, which costs more than the link was ever worth.
    expect(hasNodeSettingsPage("block.output_stage")).toBe(false);
    expect(nodeSettingsPage("block.output_stage")).toBeNull();
  });

  it("every page says what an admin will find before they click", () => {
    for (const [type, page] of Object.entries(NODE_SETTINGS_PAGES)) {
      expect(page.title, type).toBeTruthy();
      expect(page.summary.length, type).toBeGreaterThan(20);
    }
  });
});
