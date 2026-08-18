import { describe, expect, it } from "vitest";
import { sanitizeCustomerText } from "./output-hygiene";

/**
 * Last-exit hygiene contract: identifier-shaped {{tokens}} that upstream
 * failed to resolve are stripped before text reaches a customer; everything
 * that is not a token — code braces, JSON, expressions — is preserved
 * byte-for-byte. Token-free lines are never rewritten at all.
 */
describe("sanitizeCustomerText", () => {
  it("strips a leaked {{business.name}} token without doubling spaces", () => {
    expect(sanitizeCustomerText("A plan made by {{business.name}} for your family.")).toBe(
      "A plan made by for your family."
    );
  });

  it("strips a trailing token (the founder's observed leak shape)", () => {
    expect(sanitizeCustomerText("Your 7-day itinerary, prepared by {{business.name}}")).toBe(
      "Your 7-day itinerary, prepared by"
    );
  });

  it("strips single-word, underscore, and spaced token shapes", () => {
    expect(sanitizeCustomerText("Hello from {{business_name}} today")).toBe("Hello from today");
    expect(sanitizeCustomerText("Notes: {{ memory }} end")).toBe("Notes: end");
    expect(sanitizeCustomerText("{{assistantName}} here, how can I help?")).toBe(
      "here, how can I help?"
    );
  });

  it("strips multiple tokens on one line", () => {
    expect(sanitizeCustomerText("From {{business.name}} ({{business.type}}) with care")).toBe(
      "From () with care"
    );
  });

  it("blanks a line reduced to bare punctuation, leaving other lines untouched", () => {
    expect(sanitizeCustomerText("Here is your plan:\n— {{business.name}}\nDay 1: Arrive")).toBe(
      "Here is your plan:\n\nDay 1: Arrive"
    );
  });

  it("preserves legitimate braces: code, JSON, expressions, single braces", () => {
    const code = 'Use `{ a: 1 }`, {"json": true}, {{ x + 1 }}, or {single} as needed.';
    expect(sanitizeCustomerText(code)).toBe(code);
  });

  it("preserves the rest of a line that mixes a token with legitimate braces", () => {
    expect(sanitizeCustomerText('Set {"retries": 3} for {{business.name}} now')).toBe(
      'Set {"retries": 3} for now'
    );
  });

  it("preserves tokens inside inline code spans while stripping the leak outside", () => {
    expect(
      sanitizeCustomerText("Write `{{business.name}}` in your template — {{business.name}} sends this.")
    ).toBe("Write `{{business.name}}` in your template — sends this.");
  });

  it("preserves tokens inside fenced code blocks", () => {
    const text = "Use this snippet:\n```\nHello {{business.name}}!\n```\nSigned, {{business.name}}";
    expect(sanitizeCustomerText(text)).toBe(
      "Use this snippet:\n```\nHello {{business.name}}!\n```\nSigned,"
    );
  });

  it("leaves token-free text untouched apart from trailing whitespace", () => {
    expect(sanitizeCustomerText("Spacing  stays   exactly  as written.")).toBe(
      "Spacing  stays   exactly  as written."
    );
  });

  it("trims trailing whitespace", () => {
    expect(sanitizeCustomerText("All done.   \n\n")).toBe("All done.");
  });

  it("returns empty input unchanged", () => {
    expect(sanitizeCustomerText("")).toBe("");
  });
});
