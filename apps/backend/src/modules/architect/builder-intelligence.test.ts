import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { BUILDER_INTELLIGENCE, builderIntelligenceText } from "./builder-intelligence";

/**
 * THE CHARACTER'S OWN LAW (2026-08-26).
 *
 * The Soul has a law that keeps it honest; the character gets the same.
 * These pin the manners that make the Builder an employee instead of a
 * vending machine — so no future edit quietly deletes the asking, the
 * proposal, or the one-at-a-time rule, and no edit sneaks product-specific
 * coaching into a file that must stay general (the founder's blind-test
 * rule: the character never knows what test is coming).
 */
describe("Builder Intelligence", () => {
  it("teaches the four manners, by name", () => {
    const text = BUILDER_INTELLIGENCE;
    expect(text).toContain("DECIDE EVERYTHING MECHANICAL YOURSELF");
    expect(text).toContain("ASK ONLY WHAT IS GENUINELY THE HUMAN'S");
    expect(text).toContain("NEVER ASK EMPTY-HANDED");
    expect(text).toContain("ONE QUESTION PER BREATH");
    expect(text).toContain("BREATHS WITHOUT LIMIT");
  });

  it("keeps the human's words sacred and honours 'you decide'", () => {
    expect(BUILDER_INTELLIGENCE).toContain("USE THEIR WORDS EXACTLY");
    expect(BUILDER_INTELLIGENCE).toContain('IF THEY SAY "you decide"');
  });

  it("stays general — no product or service is ever named", () => {
    /* The blind-test rule: character is how to behave with ANY unknown, not
       a cheat-sheet for the next demo. */
    for (const word of ["telegram", "whatsapp", "instantly", "apollo", "calendly", "open-meteo"]) {
      expect(BUILDER_INTELLIGENCE.toLowerCase()).not.toContain(word);
    }
  });

  it("rides inside the ONE mind every hand carries", () => {
    /* The founder's ruling (2026-08-27): eight hands each briefed themselves
       differently — the chat carried the Soul, the page designer did not,
       and that is how a Telegram agent was handed a website screen. The
       character and the laws now live in one mind, assembled once. */
    const mind = readFileSync(join(__dirname, "builder-mind.ts"), "utf8");
    expect(mind).toContain("builderIntelligenceText()");
    expect(mind).toContain("builderSoulText(");
    for (const hand of ["compose", "explain", "design-page", "repair"]) {
      expect(mind).toContain(hand);
    }
  });

  it("every hand reads that one mind — none brief themselves", () => {
    const hands = [
      join(__dirname, "composer", "compose.ts"),
      join(__dirname, "ai-builder.ts"),
      join(__dirname, "..", "agent-pages", "builder-page-hand.ts")
    ];
    for (const hand of hands) {
      const source = readFileSync(hand, "utf8");
      expect(source, hand).toContain("builderMind(");
    }
  });

  it("is one text, ready for any brain", () => {
    expect(builderIntelligenceText().length).toBeGreaterThan(500);
  });
});
