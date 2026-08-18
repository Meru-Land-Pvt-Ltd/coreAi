import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  fileFindFirst: vi.fn(),
  fileCount: vi.fn(),
  fileCreate: vi.fn(),
  chunkCreateMany: vi.fn(),
  agentFindFirst: vi.fn(),
  $transaction: vi.fn()
}));

vi.mock("../../../../lib/prisma", () => ({
  prisma: {
    businessKnowledgeFile: {
      findFirst: mocks.fileFindFirst,
      count: mocks.fileCount,
      create: mocks.fileCreate
    },
    businessKnowledgeBase: { createMany: mocks.chunkCreateMany },
    installedAgent: { findFirst: mocks.agentFindFirst },
    $transaction: mocks.$transaction
  }
}));

import { ingestExtractedText } from "./ingest";

const LONG_TEXT =
  "Acme Dental offers cleaning, whitening, and implants. " +
  "Our team of hygienists is available Monday through Friday. " +
  "Call us any time to book an appointment or ask about insurance coverage.";

beforeEach(() => {
  mocks.fileFindFirst.mockReset();
  mocks.fileCount.mockReset();
  mocks.fileCreate.mockReset();
  mocks.chunkCreateMany.mockReset();
  mocks.agentFindFirst.mockReset();
  mocks.$transaction.mockReset();

  mocks.fileFindFirst.mockResolvedValue(null);
  mocks.fileCount.mockResolvedValue(0);
  mocks.chunkCreateMany.mockResolvedValue({ count: 1 });
  // Interactive transaction: hand the callback the same mocked delegates.
  mocks.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      businessKnowledgeFile: { create: mocks.fileCreate },
      businessKnowledgeBase: { createMany: mocks.chunkCreateMany }
    })
  );
  mocks.fileCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "file-1",
      filename: data.filename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      status: data.status,
      sourceType: data.sourceType,
      sourceUrl: data.sourceUrl,
      extractedChars: data.extractedChars,
      chunkCount: data.chunkCount
    })
  );
});

describe("ingestExtractedText", () => {
  it("creates a PROCESSED file row plus chunk rows carrying source metadata", async () => {
    const result = await ingestExtractedText({
      businessId: "biz-1",
      sourceType: "URL",
      sourceUrl: "https://example.com/pricing",
      content: {
        filename: "Acme Pricing.txt",
        mimeType: "text/plain",
        text: LONG_TEXT,
        sizeBytes: 999
      }
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.status).toBe("PROCESSED");

    const fileData = mocks.fileCreate.mock.calls[0][0].data;
    expect(fileData).toMatchObject({
      businessId: "biz-1",
      installedAgentId: null,
      sourceType: "URL",
      sourceUrl: "https://example.com/pricing",
      status: "PROCESSED",
      chunkCount: 1
    });
    // Hash is sha256 of the stored (normalized) text bytes.
    expect(fileData.contentHash).toBe(
      createHash("sha256").update(Buffer.from(fileData.contentBytes)).digest("hex")
    );
    // Stored size reflects what we keep (the extracted text), not the raw fetch.
    expect(fileData.sizeBytes).toBe(Buffer.from(fileData.contentBytes).byteLength);

    const chunkRows = mocks.chunkCreateMany.mock.calls[0][0].data;
    expect(chunkRows).toHaveLength(1);
    expect(chunkRows[0]).toMatchObject({
      businessId: "biz-1",
      installedAgentId: null,
      sourceFileId: "file-1",
      chunkIndex: 0
    });
    expect(chunkRows[0].content).toContain("Acme Dental offers cleaning");
  });

  it("is idempotent: identical content returns the existing row without writing", async () => {
    mocks.fileFindFirst.mockResolvedValue({
      id: "file-existing",
      filename: "Acme Pricing.txt",
      mimeType: "text/plain",
      sizeBytes: 200,
      status: "PROCESSED",
      sourceType: "URL",
      sourceUrl: "https://example.com/pricing",
      extractedChars: 200,
      chunkCount: 1
    });

    const result = await ingestExtractedText({
      businessId: "biz-1",
      sourceType: "URL",
      sourceUrl: "https://example.com/pricing",
      content: { filename: "Acme Pricing.txt", mimeType: "text/plain", text: LONG_TEXT, sizeBytes: 999 }
    });

    expect(result).toMatchObject({ id: "file-existing", alreadyExisted: true });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });

  it("rejects sources with no readable text", async () => {
    await expect(
      ingestExtractedText({
        businessId: "biz-1",
        sourceType: "CSV",
        content: { filename: "x.csv", mimeType: "text/plain", text: "  \n ", sizeBytes: 4 }
      })
    ).rejects.toMatchObject({ status: 422, code: "SOURCE_EMPTY" });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("tenant-guards installedAgentId — another business's agent 404s", async () => {
    mocks.agentFindFirst.mockResolvedValue(null);

    await expect(
      ingestExtractedText({
        businessId: "biz-1",
        installedAgentId: "agent-of-biz-2",
        sourceType: "URL",
        content: { filename: "a.txt", mimeType: "text/plain", text: LONG_TEXT, sizeBytes: 10 }
      })
    ).rejects.toMatchObject({ status: 404, code: "INSTALLED_AGENT_NOT_FOUND" });
    expect(mocks.agentFindFirst.mock.calls[0][0].where).toEqual({
      id: "agent-of-biz-2",
      businessId: "biz-1"
    });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("enforces the per-business document cap", async () => {
    mocks.fileCount.mockResolvedValue(1000);

    await expect(
      ingestExtractedText({
        businessId: "biz-1",
        sourceType: "URL",
        content: { filename: "a.txt", mimeType: "text/plain", text: LONG_TEXT, sizeBytes: 10 }
      })
    ).rejects.toMatchObject({ status: 422, code: "TOO_MANY_FILES" });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
