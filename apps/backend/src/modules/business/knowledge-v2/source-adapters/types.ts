/**
 * Knowledge source adapters (plan Part 3).
 *
 * Every non-upload knowledge source (public web page, CSV export, later
 * Drive/Notion/YouTube/images) is a SourceAdapter that produces EXTRACTED
 * TEXT. Persistence + chunking is shared by ingestExtractedText (./ingest.ts)
 * so all sources land in BusinessKnowledgeFile / BusinessKnowledgeBase with a
 * shape identical to the upload pipeline in ../../knowledge-files.ts — the
 * retrieval loader (agent-knowledge.ts) never needs to know where a document
 * came from.
 */

/** Mirrors BusinessKnowledgeFile.sourceType in prisma/schema.prisma. */
export type KnowledgeSourceType =
  | "UPLOAD"
  | "URL"
  | "CSV"
  | "IMAGE"
  | "DRIVE"
  | "NOTION"
  | "YOUTUBE";

export type ExtractedSourceContent = {
  /** Display name for the knowledge document (sanitized before persisting). */
  filename: string;
  /** MIME of the STORED content. Adapters store extracted text → text/plain. */
  mimeType: string;
  /** Plain text ready for normalizeExtractedText + chunking. */
  text: string;
  pageCount?: number;
  /** Bytes received from the source (pre-extraction), for caps/telemetry. */
  sizeBytes: number;
};

export interface SourceAdapter<TInput> {
  sourceType: KnowledgeSourceType;
  fetchContent(input: TInput): Promise<ExtractedSourceContent>;
}

export class SourceAdapterError extends Error {
  constructor(
    message: string,
    /** Routes map this through apiErrorStatus() — unknown values render 422. */
    public readonly status: 400 | 404 | 409 | 413 | 415 | 422 | 502,
    public readonly code: string
  ) {
    super(message);
    this.name = "SourceAdapterError";
  }
}
