import { sanitizeFilename } from "../../knowledge-files";
import { SourceAdapterError, type SourceAdapter } from "./types";

/**
 * CSV/TSV knowledge source (plan Part 3): parse a delimited export (price
 * lists, service menus, staff rosters) and render each row as a readable
 * "Header: value | Header: value" line so the chunker and retrieval treat it
 * like any other document.
 *
 * Scope: CSV and TSV only, parsed with a dependency-free RFC4180-ish state
 * machine (quoted fields, "" escapes, newlines inside quotes). XLSX is OUT of
 * scope — no xlsx/exceljs dependency exists in apps/backend/package.json, so
 * spreadsheet support needs a dependency decision first.
 */

const MAX_CSV_BYTES = 10 * 1024 * 1024; // parity with knowledge-files MAX_FILE_BYTES

function detectDelimiter(text: string): "," | "\t" {
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

/**
 * Parse delimited text into rows of fields. Handles quoted fields, escaped
 * quotes (""), delimiters and newlines inside quotes, and \r\n line endings.
 * Fully empty rows are dropped.
 */
export function parseDelimitedText(text: string, delimiter?: "," | "\t"): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      // \r\n → let the \n end the row; a bare \r ends the row itself.
      if (text[i + 1] !== "\n") endRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Render header + data rows into readable knowledge lines. */
export function renderRowsAsKnowledgeText(rows: string[][], filename: string): string {
  const [header, ...data] = rows;
  if (!header || header.every((cell) => !cell.trim())) {
    throw new SourceAdapterError("The CSV file has no header row.", 422, "CSV_EMPTY");
  }
  if (data.length === 0) {
    throw new SourceAdapterError(
      "The CSV file has a header but no data rows.",
      422,
      "CSV_NO_DATA"
    );
  }

  const headers = header.map((cell, index) => cell.trim() || `Column ${index + 1}`);

  const lines = data
    .map((cells) =>
      headers
        .map((name, index) => {
          const value = (cells[index] ?? "").trim();
          return value ? `${name}: ${value}` : "";
        })
        .filter(Boolean)
        .join(" | ")
    )
    .filter(Boolean);

  const intro = `${filename} — ${lines.length} rows. Columns: ${headers.join(", ")}.`;
  return `${intro}\n\n${lines.join("\n")}`;
}

export const csvSourceAdapter: SourceAdapter<{ filename: string; content: string }> = {
  sourceType: "CSV",

  async fetchContent(input) {
    const raw = String(input.content ?? "").replace(/^\uFEFF/, "");
    const sizeBytes = Buffer.byteLength(raw, "utf8");

    if (!raw.trim()) {
      throw new SourceAdapterError("The CSV file is empty.", 422, "CSV_EMPTY");
    }
    if (sizeBytes > MAX_CSV_BYTES) {
      throw new SourceAdapterError("CSV files can be at most 10 MB.", 413, "CSV_TOO_LARGE");
    }

    const filename = sanitizeFilename(input.filename || "data.csv");
    const rows = parseDelimitedText(raw);
    const text = renderRowsAsKnowledgeText(rows, filename);

    return {
      filename,
      mimeType: "text/plain",
      text,
      sizeBytes
    };
  }
};
