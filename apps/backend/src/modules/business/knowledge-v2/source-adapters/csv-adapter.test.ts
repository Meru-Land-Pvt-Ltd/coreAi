import { describe, expect, it } from "vitest";
import { csvSourceAdapter, parseDelimitedText, renderRowsAsKnowledgeText } from "./csv-adapter";

describe("parseDelimitedText", () => {
  it("parses quoted fields containing commas and escaped quotes", () => {
    const rows = parseDelimitedText(
      'Service,Price,Note\n"Cleaning, deep",$120,"She said ""ouch"" once"\nWhitening,$80,Simple'
    );
    expect(rows).toEqual([
      ["Service", "Price", "Note"],
      ["Cleaning, deep", "$120", 'She said "ouch" once'],
      ["Whitening", "$80", "Simple"]
    ]);
  });

  it("keeps newlines inside quoted fields within one field", () => {
    const rows = parseDelimitedText('Name,Bio\nDr. Hart,"Line one\nLine two"');
    expect(rows).toEqual([
      ["Name", "Bio"],
      ["Dr. Hart", "Line one\nLine two"]
    ]);
  });

  it("auto-detects TSV and handles \\r\\n endings, dropping empty rows", () => {
    const rows = parseDelimitedText("Service\tPrice\r\nCleaning\t$100\r\n\r\n");
    expect(rows).toEqual([
      ["Service", "Price"],
      ["Cleaning", "$100"]
    ]);
  });
});

describe("renderRowsAsKnowledgeText", () => {
  it('renders "Header: value | Header: value" lines with an intro', () => {
    const text = renderRowsAsKnowledgeText(
      [
        ["Service", "Price"],
        ["Cleaning", "$100"],
        ["Whitening", ""]
      ],
      "prices.csv"
    );
    expect(text).toContain("prices.csv — 2 rows. Columns: Service, Price.");
    expect(text).toContain("Service: Cleaning | Price: $100");
    // Empty cells are omitted rather than rendered as "Price: ".
    expect(text).toContain("Service: Whitening");
    expect(text).not.toContain("Price: \n");
  });

  it("rejects a header-only file", () => {
    expect(() => renderRowsAsKnowledgeText([["Service", "Price"]], "x.csv")).toThrowError(
      expect.objectContaining({ code: "CSV_NO_DATA" })
    );
  });
});

describe("csvSourceAdapter.fetchContent", () => {
  it("rejects empty content with 422 CSV_EMPTY", async () => {
    await expect(
      csvSourceAdapter.fetchContent({ filename: "empty.csv", content: "   " })
    ).rejects.toMatchObject({ status: 422, code: "CSV_EMPTY" });
  });

  it("returns readable text/plain content with the source byte size", async () => {
    const content = "Service,Price\nCleaning,$100\n";
    const result = await csvSourceAdapter.fetchContent({ filename: "prices.csv", content });
    expect(result.mimeType).toBe("text/plain");
    expect(result.filename).toBe("prices.csv");
    expect(result.sizeBytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.text).toContain("Service: Cleaning | Price: $100");
  });
});
