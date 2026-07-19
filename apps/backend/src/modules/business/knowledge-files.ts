import { createHash } from "node:crypto";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
/** Chunk target sizes — deterministic, paragraph-aligned, small overlap. */
const CHUNK_TARGET_CHARS = 2000;
const CHUNK_MAX_CHARS = 2500;
const CHUNK_OVERLAP_CHARS = 150;
/** Documents with less usable text than this are rejected as empty/scanned. */
const MIN_EXTRACTED_CHARS = 40;

export type KnowledgeFileKind = "pdf" | "docx" | "txt";

export class KnowledgeFileError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422,
    public readonly code: string
  ) {
    super(message);
    this.name = "KnowledgeFileError";
  }
}

export type KnowledgeFileSummary = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  extractedChars: number;
  chunkCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeFileUploadResult = KnowledgeFileSummary & {
  /** True when this exact document was already uploaded (idempotent re-upload). */
  alreadyExisted: boolean;
};

/* ------------------------------- validation ------------------------------- */

const ALLOWED_EXTENSIONS: Record<string, KnowledgeFileKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "txt"
};

const ALLOWED_MIME_BY_KIND: Record<KnowledgeFileKind, string[]> = {
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Browsers occasionally report docx as zip; the signature check still runs.
    "application/zip",
    "application/octet-stream"
  ],
  txt: ["text/plain", "application/octet-stream", ""]
};

/** Strip any path components and dangerous characters from a client filename. */
export function sanitizeFilename(raw: string): string {
  const base = String(raw ?? "")
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  const safe = base.slice(0, 120);
  return safe || "document";
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

/** Detect the real file kind from magic bytes — never trust the client MIME. */
export function sniffFileKind(bytes: Buffer): KnowledgeFileKind | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // DOCX is a ZIP container (PK\x03\x04). Mammoth rejects non-Word archives.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "docx";
  }
  // Plain text: no null bytes in the sample and mostly printable when decoded.
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return null;
  const text = sample.toString("utf8");
  if (!text.trim()) return null;
  // eslint-disable-next-line no-control-regex
  const controlChars = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) ?? []).length;
  return controlChars / text.length < 0.02 ? "txt" : null;
}

export function validateKnowledgeUpload(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): { filename: string; kind: KnowledgeFileKind } {
  const filename = sanitizeFilename(input.filename);
  const extension = extensionOf(filename);
  const kindFromExtension = ALLOWED_EXTENSIONS[extension];

  if (!kindFromExtension) {
    throw new KnowledgeFileError(
      "Only PDF, DOCX, and TXT documents are supported.",
      415,
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  if (input.bytes.length === 0) {
    throw new KnowledgeFileError("The file is empty.", 422, "EMPTY_FILE");
  }

  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new KnowledgeFileError("Files can be at most 10 MB.", 413, "FILE_TOO_LARGE");
  }

  const declaredMime = (input.mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (declaredMime && !ALLOWED_MIME_BY_KIND[kindFromExtension].includes(declaredMime)) {
    throw new KnowledgeFileError(
      "The file type does not match its extension.",
      415,
      "MIME_MISMATCH"
    );
  }

  const sniffed = sniffFileKind(input.bytes);
  if (sniffed !== kindFromExtension) {
    throw new KnowledgeFileError(
      "The file contents do not match its extension.",
      415,
      "FILE_SIGNATURE_MISMATCH"
    );
  }

  return { filename, kind: kindFromExtension };
}

/* ------------------------------- extraction ------------------------------- */

/** Remove null bytes, normalize newlines/whitespace, keep paragraph breaks. */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocumentText(
  kind: KnowledgeFileKind,
  bytes: Buffer
): Promise<{ text: string; pageCount?: number }> {
  if (kind === "txt") {
    // Strip a UTF-8 BOM; TXT is decoded, never executed or shelled out.
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    return { text };
  }

  if (kind === "docx") {
    try {
      // extractRawText reads word/document.xml only — macros never execute.
      const result = await mammoth.extractRawText({ buffer: bytes });
      return { text: result.value ?? "" };
    } catch {
      throw new KnowledgeFileError(
        "This DOCX file could not be read. Re-save it from your editor and try again.",
        422,
        "DOCX_PARSE_FAILED"
      );
    }
  }

  try {
    const result = await pdfParse(bytes, { max: env.KNOWLEDGE_MAX_PDF_PAGES });
    if (result.numpages > env.KNOWLEDGE_MAX_PDF_PAGES) {
      throw new KnowledgeFileError(
        `PDFs can have at most ${env.KNOWLEDGE_MAX_PDF_PAGES} pages.`,
        422,
        "PDF_TOO_MANY_PAGES"
      );
    }
    return { text: result.text ?? "", pageCount: result.numpages };
  } catch (error) {
    if (error instanceof KnowledgeFileError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("password") || message.includes("encrypt")) {
      throw new KnowledgeFileError(
        "This PDF is password-protected. Remove the password and upload it again.",
        422,
        "PDF_ENCRYPTED"
      );
    }
    throw new KnowledgeFileError(
      "This PDF could not be read. Export it again as a standard PDF and retry.",
      422,
      "PDF_PARSE_FAILED"
    );
  }
}

/* -------------------------------- chunking -------------------------------- */

export type KnowledgeChunk = {
  chunkIndex: number;
  title: string;
  content: string;
  sourceSection: string;
};

/**
 * Deterministic paragraph-aligned chunks (~1.5–2.5k chars) with a small
 * overlap so context is not lost at boundaries.
 */
export function chunkExtractedText(text: string, filename: string): KnowledgeChunk[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const rawChunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) rawChunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    // A paragraph longer than the max is split on sentence-ish boundaries.
    const pieces =
      paragraph.length <= CHUNK_MAX_CHARS
        ? [paragraph]
        : (paragraph.match(new RegExp(`[\\s\\S]{1,${CHUNK_TARGET_CHARS}}(?:[.!?\\n]|$)`, "g")) ?? [paragraph]);

    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > CHUNK_TARGET_CHARS) push();
      current = current ? `${current}\n\n${piece}` : piece;
      if (current.length >= CHUNK_MAX_CHARS) push();
    }
  }
  push();

  return rawChunks.map((content, index) => {
    // Overlap: prepend the tail of the previous chunk for continuity.
    const overlap = index > 0 ? rawChunks[index - 1].slice(-CHUNK_OVERLAP_CHARS).trim() : "";
    const withOverlap = overlap ? `…${overlap}\n\n${content}` : content;
    return {
      chunkIndex: index,
      title: rawChunks.length > 1 ? `${filename} (part ${index + 1}/${rawChunks.length})` : filename,
      content: withOverlap,
      sourceSection: `part ${index + 1} of ${rawChunks.length}`
    };
  });
}

/* ------------------------------- persistence ------------------------------ */

function toSummary(row: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  extractedChars: number;
  chunkCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeFileSummary {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    extractedChars: row.extractedChars,
    chunkCount: row.chunkCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/** Never returns contentBytes — document content stays out of list APIs. */
const SUMMARY_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  extractedChars: true,
  chunkCount: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true
} as const;

export async function processKnowledgeFile(fileId: string): Promise<KnowledgeFileSummary> {
  const file = await prisma.businessKnowledgeFile.findUnique({ where: { id: fileId } });
  if (!file) throw new KnowledgeFileError("Document not found.", 404, "KNOWLEDGE_FILE_NOT_FOUND");

  const kind = ALLOWED_EXTENSIONS[extensionOf(file.filename)] ?? sniffFileKind(Buffer.from(file.contentBytes));
  const fail = async (code: string, message: string): Promise<KnowledgeFileSummary> => {
    const [, updated] = await prisma.$transaction([
      prisma.businessKnowledgeBase.deleteMany({ where: { sourceFileId: file.id } }),
      prisma.businessKnowledgeFile.update({
        where: { id: file.id },
        data: { status: "FAILED", errorCode: code, errorMessage: message, extractedChars: 0, chunkCount: 0 },
        select: SUMMARY_SELECT
      })
    ]);
    return toSummary(updated);
  };

  if (!kind) return fail("UNSUPPORTED_FILE_TYPE", "Only PDF, DOCX, and TXT documents are supported.");

  let extracted: { text: string; pageCount?: number };
  try {
    extracted = await extractDocumentText(kind, Buffer.from(file.contentBytes));
  } catch (error) {
    if (error instanceof KnowledgeFileError) return fail(error.code, error.message);
    return fail("EXTRACTION_FAILED", "The document could not be processed.");
  }

  let text = normalizeExtractedText(extracted.text);

  if (text.length < MIN_EXTRACTED_CHARS) {
    if (kind === "pdf") {
      return fail(
        "PDF_TEXT_NOT_FOUND",
        "This PDF appears to contain scanned images rather than readable text."
      );
    }
    return fail("DOCUMENT_EMPTY", "No readable text was found in this document.");
  }

  let truncated = false;
  if (text.length > env.KNOWLEDGE_MAX_EXTRACTED_CHARS) {
    text = text.slice(0, env.KNOWLEDGE_MAX_EXTRACTED_CHARS);
    truncated = true;
  }

  const chunks = chunkExtractedText(text, file.filename);

  const [, , updated] = await prisma.$transaction([
    prisma.businessKnowledgeBase.deleteMany({ where: { sourceFileId: file.id } }),
    prisma.businessKnowledgeBase.createMany({
      data: chunks.map((chunk) => ({
        businessId: file.businessId,
        title: chunk.title,
        content: chunk.content,
        sourceFileId: file.id,
        chunkIndex: chunk.chunkIndex,
        sourceSection: chunk.sourceSection
      }))
    }),
    prisma.businessKnowledgeFile.update({
      where: { id: file.id },
      data: {
        status: "PROCESSED",
        extractedChars: text.length,
        chunkCount: chunks.length,
        errorCode: null,
        errorMessage: truncated
          ? `The document was longer than the ${env.KNOWLEDGE_MAX_EXTRACTED_CHARS.toLocaleString()}-character limit and was truncated.`
          : null
      },
      select: SUMMARY_SELECT
    })
  ]);

  return toSummary(updated);
}

export async function ingestKnowledgeFiles(params: {
  businessId: string;
  installedAgentId?: string | null;
  files: Array<{ filename: string; mimeType: string; bytes: Buffer }>;
}): Promise<KnowledgeFileUploadResult[]> {
  if (params.files.length === 0) {
    throw new KnowledgeFileError("Attach at least one document.", 400, "NO_FILES");
  }

  const existingCount = await prisma.businessKnowledgeFile.count({
    where: { businessId: params.businessId }
  });
  if (existingCount + params.files.length > env.KNOWLEDGE_MAX_FILES_PER_BUSINESS) {
    throw new KnowledgeFileError(
      `You can store at most ${env.KNOWLEDGE_MAX_FILES_PER_BUSINESS} documents. Remove one and try again.`,
      422,
      "TOO_MANY_FILES"
    );
  }

  const results: KnowledgeFileUploadResult[] = [];

  for (const upload of params.files) {
    const { filename, kind } = validateKnowledgeUpload(upload);
    const contentHash = createHash("sha256").update(upload.bytes).digest("hex");

    // Idempotent re-upload: the same bytes map to the same record. A failed
    // record gets another processing attempt instead of a duplicate row.
    const existing = await prisma.businessKnowledgeFile.findUnique({
      where: { businessId_contentHash: { businessId: params.businessId, contentHash } },
      select: SUMMARY_SELECT
    });
    if (existing) {
      const summary =
        existing.status === "FAILED" ? await processKnowledgeFile(existing.id) : toSummary(existing);
      results.push({ ...summary, alreadyExisted: true });
      continue;
    }

    const created = await prisma.businessKnowledgeFile.create({
      data: {
        businessId: params.businessId,
        installedAgentId: params.installedAgentId ?? null,
        filename,
        mimeType:
          kind === "pdf"
            ? "application/pdf"
            : kind === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "text/plain",
        sizeBytes: upload.bytes.length,
        contentBytes: new Uint8Array(upload.bytes),
        contentHash,
        status: "PROCESSING"
      },
      select: { id: true }
    });

    const summary = await processKnowledgeFile(created.id);
    results.push({ ...summary, alreadyExisted: false });
  }

  return results;
}

export async function listKnowledgeFiles(businessId: string): Promise<KnowledgeFileSummary[]> {
  const rows = await prisma.businessKnowledgeFile.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: SUMMARY_SELECT
  });
  return rows.map(toSummary);
}

/** Delete a document and (via cascade) every knowledge chunk derived from it. */
export async function deleteKnowledgeFile(businessId: string, fileId: string): Promise<void> {
  const file = await prisma.businessKnowledgeFile.findFirst({
    where: { id: fileId, businessId },
    select: { id: true }
  });
  if (!file) throw new KnowledgeFileError("Document not found.", 404, "KNOWLEDGE_FILE_NOT_FOUND");

  await prisma.businessKnowledgeFile.delete({ where: { id: file.id } });
}

export async function reprocessKnowledgeFile(
  businessId: string,
  fileId: string
): Promise<KnowledgeFileSummary> {
  const file = await prisma.businessKnowledgeFile.findFirst({
    where: { id: fileId, businessId },
    select: { id: true }
  });
  if (!file) throw new KnowledgeFileError("Document not found.", 404, "KNOWLEDGE_FILE_NOT_FOUND");

  await prisma.businessKnowledgeFile.update({
    where: { id: file.id },
    data: { status: "PROCESSING", errorCode: null, errorMessage: null }
  });
  return processKnowledgeFile(file.id);
}
