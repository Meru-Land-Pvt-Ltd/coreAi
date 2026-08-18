import { describe, expect, it } from "vitest";
import { parseVisualResults } from "@coreai/shared";

/**
 * The Visual Results contract is emitted by a language model, so the shared
 * validator must be strict: coerce what it can, drop what it can't, cap sizes,
 * and return null for anything that isn't a real visual payload (so the caller
 * falls back to plain text). These tests are the guard the backend extractor
 * and the frontend Result Viewer both rely on.
 */
describe("parseVisualResults", () => {
  it("parses a JSON string payload into validated stats/chart/table", () => {
    const payload = parseVisualResults(
      JSON.stringify({
        stats: [{ label: "Subs", value: 100, delta: "+5", deltaDir: "up" }],
        chart: { type: "line", series: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
        table: { columns: ["X"], rows: [["1"], ["2"]] }
      })
    );
    expect(payload?.stats).toHaveLength(1);
    expect(payload?.stats?.[0].value).toBe("100");
    expect(payload?.chart?.type).toBe("line");
    expect(payload?.table?.rows).toHaveLength(2);
  });

  it("accepts an already-parsed object too", () => {
    const payload = parseVisualResults({ stats: [{ label: "A", value: "1" }] });
    expect(payload?.stats?.[0]).toEqual({ label: "A", value: "1" });
  });

  it("returns null for plain text, empty string, and non-JSON", () => {
    expect(parseVisualResults("hello world")).toBeNull();
    expect(parseVisualResults("")).toBeNull();
    expect(parseVisualResults("{not json")).toBeNull();
  });

  it("returns null for null, arrays, numbers, and text-only payloads", () => {
    expect(parseVisualResults(null)).toBeNull();
    expect(parseVisualResults([1, 2, 3])).toBeNull();
    expect(parseVisualResults(42)).toBeNull();
    // Text with no structured section falls through to the plain-text path.
    expect(parseVisualResults(JSON.stringify({ text: "just prose" }))).toBeNull();
  });

  it("unwraps a ```json fenced block", () => {
    const fenced = "```json\n{\"stats\":[{\"label\":\"A\",\"value\":\"1\"}]}\n```";
    expect(parseVisualResults(fenced)?.stats?.[0].label).toBe("A");
  });

  it("drops invalid stat entries but keeps valid ones", () => {
    const payload = parseVisualResults({
      stats: [
        { label: "Good", value: "1" },
        { label: "", value: "2" }, // empty label → dropped
        { value: "3" }, // no label → dropped
        { label: "AlsoGood", value: 4 }
      ]
    });
    expect(payload?.stats?.map((s) => s.label)).toEqual(["Good", "AlsoGood"]);
  });

  it("ignores an unknown chart type and non-numeric points", () => {
    expect(parseVisualResults({ chart: { type: "donut", series: [{ label: "A", value: 1 }] } })).toBeNull();
    const payload = parseVisualResults({
      chart: { type: "bar", series: [{ label: "A", value: "not a number" }, { label: "B", value: 7 }] }
    });
    expect(payload?.chart?.series).toEqual([{ label: "B", value: 7 }]);
  });

  it("coerces numeric strings in chart values (commas allowed)", () => {
    const payload = parseVisualResults({ chart: { type: "bar", series: [{ label: "A", value: "1,200" }] } });
    expect(payload?.chart?.series[0].value).toBe(1200);
  });

  it("drops a chart with no plottable points", () => {
    expect(parseVisualResults({ chart: { type: "pie", series: [] } })).toBeNull();
    expect(parseVisualResults({ chart: { type: "pie", series: [{ label: "A" }] } })).toBeNull();
  });

  it("normalizes table rows to the column count", () => {
    const payload = parseVisualResults({
      table: { columns: ["A", "B", "C"], rows: [["1", "2"], ["x", "y", "z", "extra"]] }
    });
    expect(payload?.table?.rows).toEqual([
      ["1", "2", ""],
      ["x", "y", "z"]
    ]);
  });

  it("caps oversized arrays so a hallucinated payload can't flood the page", () => {
    const stats = Array.from({ length: 500 }, (_, i) => ({ label: `L${i}`, value: i }));
    const rows = Array.from({ length: 5000 }, (_, i) => [`r${i}`]);
    const payload = parseVisualResults({ stats, table: { columns: ["c"], rows } });
    expect(payload?.stats?.length).toBeLessThanOrEqual(12);
    expect(payload?.table?.rows.length).toBeLessThanOrEqual(100);
  });
});
