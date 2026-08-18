import { createHash } from "node:crypto";
import { env } from "../../../../config/env";
import { prisma } from "../../../../lib/prisma";
import {
  chunkExtractedText,
  normalizeExtractedText,
  sanitizeFilename
} from "../../knowledge-files";
import { SourceAdapterError, type ExtractedSourceContent, type KnowledgeSourceType } from "./types";

/**
 * Shared ingestion for source adapters (plan Part 3).
 *
 * Chunking parity: this module IMPORTS chunkExtractedText +
 * normalizeExtractedText from ../../knowledge-files.ts (both are exported), so
 * adapter-sourced documents are chunked by the EXACT same code path as
 * uploaded PDFs/DOCX/TXT — same ~2000-char paragraph-aligned chunks, same
 * overlap, same title/sourceSection shape. Nothing is reimplemented here.
 *
 * Storage: contentBytes holds the EXTRACTED TEXT (utf8). Because the stored
 * bytes are plain text, the existing reprocess/repair paths in
 * knowledge-files.ts (which sniff bytes → "txt") keep working on these rows.
 */

/** Same floor as knowledge-files.ts MIN_EXTRACTED_CHARS. */
const MIN_INGEST_CHARS = 40;

export type IngestedKnowledgeFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  sourceType: string;
  sourceUrl: string | null;
  extractedChars: number;
  chunkCount: number;
  /** True when this exact content was already ingested (idempotent repeat). */
  alreadyExisted: boolean;
};

const INGESTED_FILE_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  sourceType: true,
  sourceUrl: true,
  extractedChars: true,
  chunkCount: true
} as const;

export async function ingestExtractedText(params: {
  businessId: string;
  installedAgentId?: string | null;
  sourceType: KnowledgeSourceType;
  sourceUrl?: string | null;
  content: ExtractedSourceContent;
}): Promise<IngestedKnowledgeFile> {
  const installedAgentId = params.installedAgentId ?? null;

  // Tenant guard: a caller can only attach knowledge to its OWN agent.
  if (installedAgentId) {
    const agent = await prisma.installedAgent.findFirst({
      where: { id: installedAgentId, businessId: params.businessId },
      select: { id: true }
    });
    if (!agent) {
      throw new SourceAdapterError(
        "Installed agent not found for this business.",
        404,
        "INSTALLED_AGENT_NOT_FOUND"
      );
    }
  }

  let text = normalizeExtractedText(params.content.text ?? "");
  if (text.length < MIN_INGEST_CHARS) {
    throw new SourceAdapterError(
      "No readable text was found in this source.",
      422,
      "SOURCE_EMPTY"
    );
  }

  let truncated = false;
  if (text.length > env.KNOWLEDGE_MAX_EXTRACTED_CHARS) {
    text = text.slice(0, env.KNOWLEDGE_MAX_EXTRACTED_CHARS);
    truncated = true;
  }

  const contentBytes = Buffer.from(text, "utf8");
  const contentHash = createHash("sha256").update(contentBytes).digest("hex");
  const filename = sanitizeFilename(params.content.filename);

  // Idempotent re-ingest: same extracted content maps to the same record —
  // matches the @@unique([businessId, installedAgentId, contentHash]) guard.
  const existing = await prisma.businessKnowledgeFile.findFirst({
    where: { businessId: params.businessId, installedAgentId, contentHash },
    select: INGESTED_FILE_SELECT
  });
  if (existing) return { ...existing, alreadyExisted: true };

  const existingCount = await prisma.businessKnowledgeFile.count({
    where: { businessId: params.businessId }
  });
  if (existingCount >= env.KNOWLEDGE_MAX_FILES_PER_BUSINESS) {
    throw new SourceAdapterError(
      `You can store at most ${env.KNOWLEDGE_MAX_FILES_PER_BUSINESS} documents. Remove one and try again.`,
      422,
      "TOO_MANY_FILES"
    );
  }

  // SAME chunker as the upload pipeline (imported above).
  const chunks = chunkExtractedText(text, filename);

  // File row + chunks are created atomically; status is PROCESSED only inside
  // the same transaction that wrote the chunks — no half-ingested documents.
  const created = await prisma.$transaction(async (tx) => {
    const file = await tx.businessKnowledgeFile.create({
      data: {
        businessId: params.businessId,
        installedAgentId,
        filename,
        mimeType: params.content.mimeType || "text/plain",
        // Stored bytes ARE the extracted text, so size reflects what we keep.
        sizeBytes: contentBytes.byteLength,
        contentBytes: new Uint8Array(contentBytes),
        contentHash,
        status: "PROCESSED",
        sourceType: params.sourceType,
        sourceUrl: params.sourceUrl ?? null,
        pageCount: params.content.pageCount ?? null,
        extractedChars: text.length,
        chunkCount: chunks.length,
        errorCode: null,
        errorMessage: truncated
          ? `The source was longer than the ${env.KNOWLEDGE_MAX_EXTRACTED_CHARS.toLocaleString()}-character limit and was truncated.`
          : null
      },
      select: INGESTED_FILE_SELECT
    });

    // Field-for-field the same shape processKnowledgeFile writes
    // (BusinessKnowledgeBase: businessId, installedAgentId, title, content,
    // sourceFileId, chunkIndex, sourceSection — schema.prisma lines 572-597).
    await tx.businessKnowledgeBase.createMany({
      data: chunks.map((chunk) => ({
        businessId: params.businessId,
        installedAgentId,
        title: chunk.title,
        content: chunk.content,
        sourceFileId: file.id,
        chunkIndex: chunk.chunkIndex,
        sourceSection: chunk.sourceSection
      }))
    });

    return file;
  });

  return { ...created, alreadyExisted: false };
}
