import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDpaPdf, DPA_FILE_NAME, DPA_TEMPLATE_SHA256 } from "./dpa-pdf";

describe("DPA PDF generation", () => {
  it("uses the approved pre-signed v1.1 PDF byte-for-byte as its template", async () => {
    const template = await readFile(path.resolve(__dirname, "../../../assets", DPA_FILE_NAME));

    expect(createHash("sha256").update(template).digest("hex")).toBe(DPA_TEMPLATE_SHA256);
  });

  it("adds the Triven brand lockup without changing the approved page count", async () => {
    const template = await readFile(path.resolve(__dirname, "../../../assets", DPA_FILE_NAME));
    const generated = await createDpaPdf();
    const document = await PDFDocument.load(generated, { updateMetadata: false });

    expect(generated.equals(template)).toBe(false);
    expect(document.getPageCount()).toBe(3);
    expect(document.getTitle()).toBe("Triven Data Processing Agreement v1.1");
    expect(document.getAuthor()).toBe("Triven.ai, Inc.");
  });
});
