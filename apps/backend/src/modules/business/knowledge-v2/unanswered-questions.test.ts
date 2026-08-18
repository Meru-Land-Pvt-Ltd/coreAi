import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  fileFindFirst: vi.fn()
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    unansweredQuestion: {
      upsert: mocks.upsert,
      findFirst: mocks.findFirst,
      update: mocks.update,
      findMany: mocks.findMany
    },
    businessKnowledgeFile: { findFirst: mocks.fileFindFirst }
  }
}));

import {
  listQuestions,
  normalizeQuestionKey,
  recordUnansweredQuestion,
  resolveQuestion
} from "./unanswered-questions";

beforeEach(() => {
  mocks.upsert.mockReset();
  mocks.findFirst.mockReset();
  mocks.update.mockReset();
  mocks.findMany.mockReset();
  mocks.fileFindFirst.mockReset();
});

describe("normalizeQuestionKey", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeQuestionKey("  Do you   take PPO insurance??!  ")).toBe(
      "do you take ppo insurance"
    );
  });

  it("caps the key at 120 characters", () => {
    const key = normalizeQuestionKey(`what about ${"pricing ".repeat(50)}`);
    expect(key.length).toBeLessThanOrEqual(120);
    expect(key.startsWith("what about pricing")).toBe(true);
  });

  it("returns an empty key for punctuation-only input", () => {
    expect(normalizeQuestionKey("?!... ---")).toBe("");
  });
});

describe("recordUnansweredQuestion", () => {
  it("upserts on (businessId, normalizedKey), incrementing count and reopening RESOLVED rows", async () => {
    mocks.upsert.mockResolvedValue({ id: "q-1" });

    await recordUnansweredQuestion({
      businessId: "biz-1",
      installedAgentId: "agent-1",
      channel: "VOICE",
      question: "Do you offer teeth whitening?"
    });

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      businessId_normalizedKey: {
        businessId: "biz-1",
        normalizedKey: "do you offer teeth whitening"
      }
    });
    expect(args.create).toMatchObject({
      businessId: "biz-1",
      installedAgentId: "agent-1",
      channel: "VOICE",
      question: "Do you offer teeth whitening?"
    });
    // Reopen-on-repeat: a RESOLVED row asked again flips back to OPEN and the
    // stale resolution is cleared — the linked knowledge evidently didn't cover it.
    expect(args.update).toMatchObject({
      count: { increment: 1 },
      status: "OPEN",
      resolvedByFileId: null,
      resolvedAt: null
    });
    expect(args.update.lastAskedAt).toBeInstanceOf(Date);
  });

  it("skips empty/punctuation-only questions without touching the database", async () => {
    await expect(
      recordUnansweredQuestion({ businessId: "biz-1", channel: "SMS", question: "???" })
    ).resolves.toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("is best-effort: a database failure resolves null instead of throwing", async () => {
    mocks.upsert.mockRejectedValue(new Error("db down"));
    await expect(
      recordUnansweredQuestion({ businessId: "biz-1", channel: "VOICE", question: "Parking?" })
    ).resolves.toBeNull();
  });
});

describe("resolveQuestion", () => {
  it("tenant-guards: 404 when the question is not in this business", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(
      resolveQuestion({ businessId: "biz-2", id: "q-1" })
    ).rejects.toMatchObject({ status: 404, code: "UNANSWERED_QUESTION_NOT_FOUND" });
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "q-1", businessId: "biz-2" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("tenant-guards the resolving file id", async () => {
    mocks.findFirst.mockResolvedValue({ id: "q-1" });
    mocks.fileFindFirst.mockResolvedValue(null);

    await expect(
      resolveQuestion({ businessId: "biz-1", id: "q-1", resolvedByFileId: "file-of-other-biz" })
    ).rejects.toMatchObject({ status: 404, code: "KNOWLEDGE_FILE_NOT_FOUND" });
    expect(mocks.fileFindFirst.mock.calls[0][0].where).toEqual({
      id: "file-of-other-biz",
      businessId: "biz-1"
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("marks the row RESOLVED with resolvedByFileId and resolvedAt", async () => {
    mocks.findFirst.mockResolvedValue({ id: "q-1" });
    mocks.fileFindFirst.mockResolvedValue({ id: "file-1" });
    mocks.update.mockResolvedValue({ id: "q-1", status: "RESOLVED" });

    await resolveQuestion({
      businessId: "biz-1",
      id: "q-1",
      resolvedByFileId: "file-1",
      actorUserId: "user-1"
    });

    const args = mocks.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "q-1" });
    expect(args.data).toMatchObject({ status: "RESOLVED", resolvedByFileId: "file-1" });
    expect(args.data.resolvedAt).toBeInstanceOf(Date);
  });
});

describe("listQuestions", () => {
  it("filters by status and orders by count then recency", async () => {
    mocks.findMany.mockResolvedValue([]);

    await listQuestions({ businessId: "biz-1", status: "OPEN" });

    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ businessId: "biz-1", status: "OPEN" });
    expect(args.orderBy).toEqual([{ count: "desc" }, { lastAskedAt: "desc" }]);
  });

  it("lists all statuses when no filter is given", async () => {
    mocks.findMany.mockResolvedValue([]);
    await listQuestions({ businessId: "biz-1" });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ businessId: "biz-1" });
  });
});
