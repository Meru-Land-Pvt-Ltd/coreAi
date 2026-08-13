import { prisma } from "../../../lib/prisma";
import { logBusinessActivity } from "../activity-log";

/**
 * Knowledge lifecycle + versioning (plan Part 3).
 *
 * The "upload corrected price list" workflow is two existing steps plus one
 * new call: the buyer uploads the corrected document through the normal
 * upload/URL/CSV pipeline (untouched), then linkReplacement() marks the new
 * file as superseding the old one — version bumps, the old file is archived
 * atomically, and retrieval (once filtered on lifecycle) stops serving it
 * while the audit trail and rollback data stay intact.
 *
 * Every function is tenant-guarded: the file must belong to the calling
 * business or the call 404s — ids from other tenants are indistinguishable
 * from missing ones.
 */

export type KnowledgeLifecycle = "ACTIVE" | "ARCHIVED";
export type KnowledgeVisibility = "CUSTOMER_VISIBLE" | "INTERNAL_ONLY";

export class KnowledgeVersioningError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 422,
    public readonly code: string
  ) {
    super(message);
    this.name = "KnowledgeVersioningError";
  }
}

const VERSIONED_FILE_SELECT = {
  id: true,
  filename: true,
  status: true,
  lifecycle: true,
  visibility: true,
  version: true,
  supersedesId: true,
  sourceType: true,
  sourceUrl: true,
  updatedAt: true
} as const;

type VersionedFileRow = {
  id: string;
  filename: string;
  status: string;
  lifecycle: string;
  visibility: string;
  version: number;
  supersedesId: string | null;
  sourceType: string;
  sourceUrl: string | null;
  updatedAt: Date;
};

export type VersionedKnowledgeFile = Omit<VersionedFileRow, "updatedAt"> & {
  updatedAt: string;
};

function toVersioned(row: VersionedFileRow): VersionedKnowledgeFile {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** Tenant guard: the file must belong to this business, else 404. */
async function requireBusinessFile(businessId: string, fileId: string): Promise<VersionedFileRow> {
  const row = await prisma.businessKnowledgeFile.findFirst({
    where: { id: fileId, businessId },
    select: VERSIONED_FILE_SELECT
  });
  if (!row) {
    throw new KnowledgeVersioningError("Document not found.", 404, "KNOWLEDGE_FILE_NOT_FOUND");
  }
  return row;
}

export async function archiveFile(params: {
  businessId: string;
  fileId: string;
  actorUserId?: string | null;
}): Promise<VersionedKnowledgeFile> {
  const file = await requireBusinessFile(params.businessId, params.fileId);

  // Idempotent: archiving an archived file changes (and logs) nothing.
  if (file.lifecycle === "ARCHIVED") return toVersioned(file);

  const updated = await prisma.businessKnowledgeFile.update({
    where: { id: file.id },
    data: { lifecycle: "ARCHIVED" },
    select: VERSIONED_FILE_SELECT
  });

  await logBusinessActivity({
    businessId: params.businessId,
    action: "KNOWLEDGE_ARCHIVED",
    actorUserId: params.actorUserId ?? null,
    targetType: "BusinessKnowledgeFile",
    targetId: file.id,
    detail: { filename: file.filename, transition: "ACTIVE→ARCHIVED" }
  });

  return toVersioned(updated);
}

export async function restoreFile(params: {
  businessId: string;
  fileId: string;
  actorUserId?: string | null;
}): Promise<VersionedKnowledgeFile> {
  const file = await requireBusinessFile(params.businessId, params.fileId);

  if (file.lifecycle === "ACTIVE") return toVersioned(file);

  const updated = await prisma.businessKnowledgeFile.update({
    where: { id: file.id },
    data: { lifecycle: "ACTIVE" },
    select: VERSIONED_FILE_SELECT
  });

  // The activity-log action union has no KNOWLEDGE_RESTORED; the restore is
  // recorded under KNOWLEDGE_ARCHIVED with an explicit transition detail.
  await logBusinessActivity({
    businessId: params.businessId,
    action: "KNOWLEDGE_ARCHIVED",
    actorUserId: params.actorUserId ?? null,
    targetType: "BusinessKnowledgeFile",
    targetId: file.id,
    detail: { filename: file.filename, transition: "ARCHIVED→ACTIVE", restored: true }
  });

  return toVersioned(updated);
}

export async function setVisibility(params: {
  businessId: string;
  fileId: string;
  visibility: string;
  actorUserId?: string | null;
}): Promise<VersionedKnowledgeFile> {
  if (params.visibility !== "CUSTOMER_VISIBLE" && params.visibility !== "INTERNAL_ONLY") {
    throw new KnowledgeVersioningError(
      'Visibility must be "CUSTOMER_VISIBLE" or "INTERNAL_ONLY".',
      422,
      "INVALID_VISIBILITY"
    );
  }

  const file = await requireBusinessFile(params.businessId, params.fileId);

  if (file.visibility === params.visibility) return toVersioned(file);

  const updated = await prisma.businessKnowledgeFile.update({
    where: { id: file.id },
    data: { visibility: params.visibility },
    select: VERSIONED_FILE_SELECT
  });

  await logBusinessActivity({
    businessId: params.businessId,
    action: "KNOWLEDGE_VISIBILITY_CHANGED",
    actorUserId: params.actorUserId ?? null,
    targetType: "BusinessKnowledgeFile",
    targetId: file.id,
    detail: { filename: file.filename, from: file.visibility, to: params.visibility }
  });

  return toVersioned(updated);
}

/**
 * Link an already-ingested replacement to the document it supersedes:
 * new.supersedesId = old.id, new.version = old.version + 1, and the old file
 * is archived — all in one transaction, so retrieval never sees both copies
 * as ACTIVE nor neither.
 */
export async function linkReplacement(params: {
  businessId: string;
  newFileId: string;
  oldFileId: string;
  actorUserId?: string | null;
}): Promise<{ file: VersionedKnowledgeFile; archivedOldFileId: string }> {
  if (params.newFileId === params.oldFileId) {
    throw new KnowledgeVersioningError(
      "A document cannot replace itself.",
      422,
      "REPLACEMENT_SELF"
    );
  }

  const [newFile, oldFile] = await Promise.all([
    requireBusinessFile(params.businessId, params.newFileId),
    requireBusinessFile(params.businessId, params.oldFileId)
  ]);

  if (newFile.supersedesId) {
    throw new KnowledgeVersioningError(
      "This document already replaces another one.",
      409,
      "REPLACEMENT_ALREADY_LINKED"
    );
  }
  if (oldFile.supersedesId === newFile.id) {
    throw new KnowledgeVersioningError(
      "These documents already replace each other.",
      409,
      "REPLACEMENT_CYCLE"
    );
  }

  const [updatedNew] = await prisma.$transaction([
    prisma.businessKnowledgeFile.update({
      where: { id: newFile.id },
      data: { supersedesId: oldFile.id, version: oldFile.version + 1 },
      select: VERSIONED_FILE_SELECT
    }),
    prisma.businessKnowledgeFile.update({
      where: { id: oldFile.id },
      data: { lifecycle: "ARCHIVED" },
      select: { id: true }
    })
  ]);

  await logBusinessActivity({
    businessId: params.businessId,
    action: "KNOWLEDGE_ARCHIVED",
    actorUserId: params.actorUserId ?? null,
    targetType: "BusinessKnowledgeFile",
    targetId: oldFile.id,
    detail: {
      reason: "REPLACED",
      oldFileId: oldFile.id,
      oldFilename: oldFile.filename,
      newFileId: newFile.id,
      newFilename: newFile.filename,
      newVersion: oldFile.version + 1
    }
  });

  return { file: toVersioned(updatedNew), archivedOldFileId: oldFile.id };
}
