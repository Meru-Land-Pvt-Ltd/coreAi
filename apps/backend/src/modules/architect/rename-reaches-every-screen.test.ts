import { describe, expect, it } from "vitest";

/**
 * THE AGENT'S NAME WAS KEPT IN TWO PLACES (2026-08-28).
 *
 * The builder's header saves the WORKFLOW's name. My Agents, the marketplace
 * card and the Telegram bot's own introduction all read the LISTING's name —
 * a second copy, written when the draft was created and never touched again.
 *
 * So an architect renamed their agent, watched the header say "saved", and
 * every other screen went on calling it "Untitled Agent". The founder renamed
 * one to "Telegram GPT" and his own bot still introduced itself to a customer
 * as "a virtual assistant for Untitled Agent".
 *
 * This is the rule the fix holds. It is written against the decision, not the
 * plumbing, so it survives a rewrite of the route.
 */

/** Which listing states a rename may quietly rewrite. */
const RENAME_REACHES = ["DRAFT", "PENDING_REVIEW", "REJECTED"];

/** And the one it must not. */
const RENAME_MUST_NOT_REACH = "APPROVED";

function listingStatesARenameTouches(): string[] {
  /* Read from the route itself so the test fails if somebody widens it. */
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "routes.ts"),
    "utf8"
  ) as string;
  const block = source.slice(source.indexOf("THE AGENT'S NAME IS ONE FACT"));
  const match = /status: \{ in: \[([^\]]+)\] \}/.exec(block);
  if (!match) return [];
  return [...match[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

describe("renaming an agent reaches every screen that shows its name", () => {
  it("carries to a listing that is not published yet", () => {
    const states = listingStatesARenameTouches();
    for (const state of RENAME_REACHES) {
      expect(states, `a rename must reach a ${state} listing`).toContain(state);
    }
  });

  it("never silently rewrites the name on an agent businesses have bought", () => {
    /* An APPROVED listing's name is on a card people bought from. Changing
       that without review is the rug-pull the freeze rule exists to prevent —
       it goes through review like any other change to a live agent. */
    expect(listingStatesARenameTouches()).not.toContain(RENAME_MUST_NOT_REACH);
  });
});
