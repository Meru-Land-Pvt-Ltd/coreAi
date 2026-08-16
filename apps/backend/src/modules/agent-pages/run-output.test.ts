import { describe, expect, it } from "vitest";
import { extractRunOutput, extractRunStructured, extractRunText } from "./run-output";

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
      mediaUrls: ["https://cdn.example.com/poster.png"],
      structured: null
    });
  });
});

/**
 * When the AI Brain replies with the Visual Results JSON contract, the run
 * output carries a validated `structured` payload and the raw JSON never leaks
 * as visitor-facing text. Plain replies (and non-visual JSON) keep the old
 * behavior — structured is null.
 */
describe("extractRunStructured", () => {
  it("detects stat cards, a chart, and a table from a JSON Brain reply", () => {
    const payload = JSON.stringify({
      text: "Channel is growing.",
      stats: [{ label: "Subscribers", value: "312M", delta: "+1.2M", deltaDir: "up" }],
      chart: { type: "bar", title: "Views", series: [{ label: "Jan", value: 1200 }] },
      table: { columns: ["Video", "Views"], rows: [["Intro", "1,200"]] }
    });
    const structured = extractRunStructured({ context: { ai: { output: payload } }, logs: [] });
    expect(structured).not.toBeNull();
    expect(structured?.stats?.[0]).toEqual({
      label: "Subscribers",
      value: "312M",
      delta: "+1.2M",
      deltaDir: "up"
    });
    expect(structured?.chart?.type).toBe("bar");
    expect(structured?.chart?.series).toEqual([{ label: "Jan", value: 1200 }]);
    expect(structured?.table?.columns).toEqual(["Video", "Views"]);
  });

  it("returns null for plain text (backward compatible)", () => {
    expect(
      extractRunStructured({ context: { ai: { output: "Just a normal answer." } }, logs: [] })
    ).toBeNull();
  });

  it("returns null for non-visual JSON so it renders as text", () => {
    const output = JSON.stringify({ foo: "bar", count: 3 });
    expect(extractRunStructured({ context: { ai: { output } }, logs: [] })).toBeNull();
  });

  it("hygiene runs inside stat labels, values, and table cells", () => {
    const payload = JSON.stringify({
      stats: [{ label: "By {{business.name}}", value: "10 {{leak}}" }],
      table: { columns: ["Name {{x}}"], rows: [["Row {{y}}"]] }
    });
    const structured = extractRunStructured({ context: { ai: { output: payload } }, logs: [] });
    expect(structured?.stats?.[0].label).toBe("By");
    expect(structured?.stats?.[0].value).toBe("10");
    expect(structured?.table?.columns).toEqual(["Name"]);
    expect(structured?.table?.rows).toEqual([["Row"]]);
  });
});

describe("extractRunOutput with a visual payload", () => {
  it("surfaces structured visuals and never leaks the raw JSON as text", () => {
    const payload = JSON.stringify({
      text: "Here are the numbers.",
      stats: [{ label: "Views", value: 1000 }]
    });
    const output = extractRunOutput({ context: { ai: { output: payload } }, logs: [] });
    // text is the payload's own prose, not the raw JSON string.
    expect(output.text).toBe("Here are the numbers.");
    expect(output.structured?.stats?.[0]).toEqual({ label: "Views", value: "1000" });
    expect(output.mediaUrls).toEqual([]);
  });

  it("leaves text null when a visual payload carries no prose", () => {
    const payload = JSON.stringify({ chart: { type: "pie", series: [{ label: "A", value: 5 }] } });
    const output = extractRunOutput({ context: { ai: { output: payload } }, logs: [] });
    expect(output.text).toBeNull();
    expect(output.structured?.chart?.type).toBe("pie");
  });
});
