import { describe, expect, it } from "vitest";
import { surfaceLanguageProblems, surfaceLanguageViolations } from "./surface-laws";

/**
 * THE FRONTEND WING'S MARKERS ARE MARKED (2026-08-27) — same discipline as
 * the Builder's exam markers: fabricated screens with known grades, checked
 * mechanically, so the law that guards the customer's language can itself
 * never quietly rot.
 */

describe("the surface laws", () => {
  it("passes a screen that speaks the customer's world", () => {
    const spec = {
      pages: [
        {
          blocks: [
            { label: "Paste the confusing contract clause", placeholder: "Paste it here…" },
            { buttonLabel: "Explain it", helper: "Takes a few seconds." }
          ]
        }
      ]
    };
    expect(surfaceLanguageViolations(spec)).toEqual([]);
  });

  it("catches a platform word where a customer would read it", () => {
    const spec = { pages: [{ blocks: [{ label: "Enter the webhook trigger value" }] }] };
    const violations = surfaceLanguageViolations(spec);
    expect(violations.length).toBeGreaterThan(0);
    expect(["webhook", "trigger"]).toContain(violations[0]!.word);
  });

  it("catches a leaked {{token}} — machinery showing through the paint", () => {
    const spec = { pages: [{ blocks: [{ helper: "We will reply to {{customer.email}}" }] }] };
    expect(surfaceLanguageViolations(spec)[0]!.word).toBe("{{…}} token");
  });

  it("ignores machinery keys a customer never sees", () => {
    /* nodeId and wire targets legitimately carry platform vocabulary. */
    const spec = { pages: [{ blocks: [{ nodeId: "trigger.webhook", wire: { nodeId: "node-1", role: "input" } }] }] };
    expect(surfaceLanguageViolations(spec)).toEqual([]);
  });

  it("writes each violation as an order the generation loop can feed back", () => {
    const problems = surfaceLanguageProblems({ pages: [{ blocks: [{ label: "Configure the LLM" }] }] });
    expect(problems[0]).toContain("is our word, not theirs");
  });

  it("catches the word wherever it hides in the tree", () => {
    const spec = { nav: { brand: "Workflow Wizard" }, pages: [] };
    expect(surfaceLanguageViolations(spec)[0]!.word).toBe("workflow");
  });

  it("sees the words inside a list, not just the ones beside a label", () => {
    /* HALF THE CUSTOMER'S SCREEN WAS INVISIBLE. A string was only tested when
       it was the VALUE of a visible key; a string that is an ELEMENT of one —
       a dropdown's options, a list's items — matched neither branch and walked
       straight through. So "Webhook" could sit in a dropdown on a customer's
       page and pass this gate. */
    const problems = surfaceLanguageViolations({
      pages: [
        {
          blocks: [
            { options: ["Every day", "Webhook", "Once a week"] },
            { items: ["We reply to {{customer.email}}"] },
            { value: "3 workflows" }
          ]
        }
      ]
    });

    const words = problems.map((problem) => problem.word);
    expect(words).toContain("webhook");
    expect(words).toContain("{{…}} token");
    expect(words).toContain("workflow");
  });

  it("still says nothing about a machine key a customer never sees", () => {
    const problems = surfaceLanguageViolations({
      pages: [{ blocks: [{ nodeId: "trigger.webhook", type: "block.prompt_composer", config: { payload: "x" } }] }]
    });
    expect(problems).toEqual([]);
  });
});
