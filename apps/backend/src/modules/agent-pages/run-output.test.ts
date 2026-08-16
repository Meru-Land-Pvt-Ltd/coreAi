import { describe, expect, it } from "vitest";
import { extractRunOutput, extractRunText } from "./run-output";

/**
 * extractRunText is the LAST exit for one-shot run text (public agent-page
 * /run and the builder's preview-run both extract here), so it must apply
 * customer-text hygiene: leaked {{...}} tokens never survive extraction,
 * while legitimate braces in real answers pass through untouched.
 */
describe("extractRunText hygiene", () => {
  it("returns clean ai output text unchanged", () => {
    const result = { context: { ai: { output: "Here is your 7-day Kerala plan." } }, logs: [] };
    expect(extractRunText(result)).toBe("Here is your 7-day Kerala plan.");
  });

  it("strips a leaked {{business.name}} token from the final run text", () => {
    const result = {
      context: { ai: { output: "A 7-day trip for your family, planned by {{business.name}}  " } },
      logs: []
    };
    expect(extractRunText(result)).toBe("A 7-day trip for your family, planned by");
  });

  it("preserves legitimate braces in code-style answers", () => {
    const output = 'Send {"name": "Ana", "days": 7} to the form, or use { spread } syntax.';
    const result = { context: { ai: { output } }, logs: [] };
    expect(extractRunText(result)).toBe(output);
  });

  it("still returns null when the run produced no text", () => {
    expect(extractRunText({ context: {}, logs: [] })).toBeNull();
    expect(extractRunText({ context: { ai: { output: 42 } }, logs: [] })).toBeNull();
  });

  it("extractRunOutput carries the sanitized text alongside media", () => {
    const result = {
      context: {
        ai: { output: "Your poster is ready!\n— {{business.name}}" },
        image_url: "https://cdn.example.com/poster.png"
      },
      logs: []
    };
    expect(extractRunOutput(result)).toEqual({
      text: "Your poster is ready!",
      mediaUrls: ["https://cdn.example.com/poster.png"]
    });
  });
});
