import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  $transaction: vi.fn(),
  logBusinessActivity: vi.fn()
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    businessKnowledgeFile: { findFirst: mocks.findFirst, update: mocks.update },
    $transaction: mocks.$transaction
  }
}));

vi.mock("../activity-log", () => ({
  logBusinessActivity: mocks.logBusinessActivity
}));

import {
  archiveFile,
  linkReplacement,
  restoreFile,
  setVisibility
} from "./knowledge-versioning";

function fileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "file-1",
    filename: "price-list.pdf",
    status: "PROCESSED",
    lifecycle: "ACTIVE",
    visibility: "CUSTOMER_VISIBLE",
    version: 1,
    supersedesId: null,
    sourceType: "UPLOAD",
    sourceUrl: null,
    updatedAt: new Date("2026-08-13T00:00:00Z"),
    ...overrides
  };
}

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.update.mockReset();
  mocks.$transaction.mockReset();
  mocks.logBusinessActivity.mockReset();
  mocks.logBusinessActivity.mockResolvedValue(undefined);
  // Array-form transaction: the ops were already invoked through the mocked
  // update(), so resolving them together mirrors prisma's behavior closely
  // enough for assertion purposes.
  mocks.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
});

describe("archiveFile", () => {
  it("sets lifecycle ARCHIVED and logs KNOWLEDGE_ARCHIVED", async () => {
    mocks.findFirst.mockResolvedValue(fileRow());
    mocks.update.mockResolvedValue(fileRow({ lifecycle: "ARCHIVED" }));

    const result = await archiveFile({ businessId: "biz-1", fileId: "file-1", actorUserId: "user-1" });

    expect(result.lifecycle).toBe("ARCHIVED");
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ lifecycle: "ARCHIVED" });
    expect(mocks.logBusinessActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        action: "KNOWLEDGE_ARCHIVED",
        actorUserId: "user-1",
        targetId: "file-1"
      })
    );
  });

  it("is idempotent for an already-ARCHIVED file — no update, no log", async () => {
    mocks.findFirst.mockResolvedValue(fileRow({ lifecycle: "ARCHIVED" }));

    const result = await archiveFile({ businessId: "biz-1", fileId: "file-1" });

    expect(result.lifecycle).toBe("ARCHIVED");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.logBusinessActivity).not.toHaveBeenCalled();
  });

  it("tenant-guards: a file id from another business 404s", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(archiveFile({ businessId: "biz-2", fileId: "file-1" })).rejects.toMatchObject({
      status: 404,
      code: "KNOWLEDGE_FILE_NOT_FOUND"
    });
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "file-1", businessId: "biz-2" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("restoreFile", () => {
  it("sets lifecycle back to ACTIVE and records the transition", async () => {
    mocks.findFirst.mockResolvedValue(fileRow({ lifecycle: "ARCHIVED" }));
    mocks.update.mockResolvedValue(fileRow({ lifecycle: "ACTIVE" }));

    const result = await restoreFile({ businessId: "biz-1", fileId: "file-1" });

    expect(result.lifecycle).toBe("ACTIVE");
    expect(mocks.update.mock.calls[0][0].data).toEqual({ lifecycle: "ACTIVE" });
    const logged = mocks.logBusinessActivity.mock.calls[0][0];
    expect(logged.detail).toMatchObject({ transition: "ARCHIVED→ACTIVE", restored: true });
  });
});

describe("setVisibility", () => {
  it("rejects invalid visibility values with 422 before touching the database", async () => {
    await expect(
      setVisibility({ businessId: "biz-1", fileId: "file-1", visibility: "PUBLIC" })
    ).rejects.toMatchObject({ status: 422, code: "INVALID_VISIBILITY" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates visibility and logs KNOWLEDGE_VISIBILITY_CHANGED with from/to", async () => {
    mocks.findFirst.mockResolvedValue(fileRow());
    mocks.update.mockResolvedValue(fileRow({ visibility: "INTERNAL_ONLY" }));

    const result = await setVisibility({
      businessId: "biz-1",
      fileId: "file-1",
      visibility: "INTERNAL_ONLY",
      actorUserId: "user-1"
    });

    expect(result.visibility).toBe("INTERNAL_ONLY");
    expect(mocks.update.mock.calls[0][0].data).toEqual({ visibility: "INTERNAL_ONLY" });
    const logged = mocks.logBusinessActivity.mock.calls[0][0];
    expect(logged.action).toBe("KNOWLEDGE_VISIBILITY_CHANGED");
    expect(logged.detail).toMatchObject({ from: "CUSTOMER_VISIBLE", to: "INTERNAL_ONLY" });
  });

  it("is a no-op (no update, no log) when the visibility is unchanged", async () => {
    mocks.findFirst.mockResolvedValue(fileRow());

    await setVisibility({ businessId: "biz-1", fileId: "file-1", visibility: "CUSTOMER_VISIBLE" });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.logBusinessActivity).not.toHaveBeenCalled();
  });
});

describe("linkReplacement", () => {
  it("links supersedesId, bumps version to old+1, and archives the old file atomically", async () => {
    const newFile = fileRow({ id: "file-new", filename: "price-list-v2.pdf" });
    const oldFile = fileRow({ id: "file-old", version: 3 });
    mocks.findFirst.mockResolvedValueOnce(newFile).mockResolvedValueOnce(oldFile);
    mocks.update
      .mockResolvedValueOnce(fileRow({ id: "file-new", supersedesId: "file-old", version: 4 }))
      .mockResolvedValueOnce({ id: "file-old" });

    const result = await linkReplacement({
      businessId: "biz-1",
      newFileId: "file-new",
      oldFileId: "file-old",
      actorUserId: "user-1"
    });

    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      where: { id: "file-new" },
      data: { supersedesId: "file-old", version: 4 }
    });
    expect(mocks.update.mock.calls[1][0]).toMatchObject({
      where: { id: "file-old" },
      data: { lifecycle: "ARCHIVED" }
    });
    expect(result.file.version).toBe(4);
    expect(result.archivedOldFileId).toBe("file-old");
    const logged = mocks.logBusinessActivity.mock.calls[0][0];
    expect(logged.action).toBe("KNOWLEDGE_ARCHIVED");
    expect(logged.detail).toMatchObject({ reason: "REPLACED", newVersion: 4 });
  });

  it("rejects a file replacing itself", async () => {
    await expect(
      linkReplacement({ businessId: "biz-1", newFileId: "file-1", oldFileId: "file-1" })
    ).rejects.toMatchObject({ status: 422, code: "REPLACEMENT_SELF" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("rejects when the new file already replaces another document", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(fileRow({ id: "file-new", supersedesId: "file-elsewhere" }))
      .mockResolvedValueOnce(fileRow({ id: "file-old" }));

    await expect(
      linkReplacement({ businessId: "biz-1", newFileId: "file-new", oldFileId: "file-old" })
    ).rejects.toMatchObject({ status: 409, code: "REPLACEMENT_ALREADY_LINKED" });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
