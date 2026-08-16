/**
 * "My Keys" locker + platform YouTube key-pool rotation.
 *
 * Prisma is mocked; crypto is REAL (ENCRYPTION_KEY is set by the test setup), so
 * the round-trip proves the stored value is genuinely encrypted and that no
 * plaintext ever leaks into a list/create summary. The YouTube pool parser and
 * rotator are pure and tested directly, plus an empty-safe end-to-end path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertMock, findManyMock, deleteManyMock, findUniqueMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  findManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  findUniqueMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    architectSecret: {
      upsert: upsertMock,
      findMany: findManyMock,
      deleteMany: deleteManyMock,
      findUnique: findUniqueMock
    }
  }
}));

import { decryptSecret, encryptSecret } from "../../lib/crypto";
import {
  SECRET_MASK,
  createArchitectSecret,
  listArchitectSecrets,
  deleteArchitectSecret,
  getArchitectSecretValue,
  parseYouTubeKeyPool,
  rotateKeyPool,
  getPlatformYouTubeKey
} from "./architect-secrets";

const NOW = new Date("2026-08-16T12:00:00.000Z");

beforeEach(() => {
  upsertMock.mockReset();
  findManyMock.mockReset();
  deleteManyMock.mockReset();
  findUniqueMock.mockReset();
});

/* ------------------------------ create / mask ----------------------------- */

describe("createArchitectSecret", () => {
  it("encrypts the value and returns only a mask", async () => {
    upsertMock.mockImplementation(async ({ create }: any) => ({
      id: "sec-1",
      name: create.name,
      createdAt: NOW,
      updatedAt: NOW
    }));

    const summary = await createArchitectSecret("arch-1", "  My Weather Key  ", "  secret-abc-123  ");

    // Name and value are trimmed before storage.
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const arg = upsertMock.mock.calls[0][0];
    expect(arg.where).toEqual({ architectUserId_name: { architectUserId: "arch-1", name: "My Weather Key" } });
    expect(arg.create.name).toBe("My Weather Key");

    // Stored value is encrypted, not plaintext, and decrypts back to the input.
    expect(arg.create.valueEncrypted).not.toContain("secret-abc-123");
    expect(decryptSecret(arg.create.valueEncrypted)).toBe("secret-abc-123");
    expect(arg.update.valueEncrypted).not.toContain("secret-abc-123");

    // The summary carries a mask, never the value.
    expect(summary).toEqual({
      id: "sec-1",
      name: "My Weather Key",
      maskedValue: SECRET_MASK,
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(JSON.stringify(summary)).not.toContain("secret-abc-123");
  });

  it("rejects an empty name", async () => {
    await expect(createArchitectSecret("arch-1", "   ", "value")).rejects.toMatchObject({
      code: "SECRET_NAME_REQUIRED"
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects an over-long name", async () => {
    await expect(createArchitectSecret("arch-1", "x".repeat(65), "value")).rejects.toMatchObject({
      code: "SECRET_NAME_TOO_LONG"
    });
  });

  it("rejects an empty value", async () => {
    await expect(createArchitectSecret("arch-1", "Name", "   ")).rejects.toMatchObject({
      code: "SECRET_VALUE_REQUIRED"
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

/* --------------------------------- list ----------------------------------- */

describe("listArchitectSecrets", () => {
  it("returns masked summaries scoped to the architect and never decrypts", async () => {
    findManyMock.mockResolvedValue([
      { id: "a", name: "Weather", createdAt: NOW, updatedAt: NOW },
      { id: "b", name: "Stocks", createdAt: NOW, updatedAt: NOW }
    ]);

    const list = await listArchitectSecrets("arch-1");

    expect(findManyMock).toHaveBeenCalledWith({
      where: { architectUserId: "arch-1" },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" }
    });
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.maskedValue === SECRET_MASK)).toBe(true);
    // No encrypted field is selected, so nothing sensitive can leak.
    expect(JSON.stringify(list)).not.toContain("valueEncrypted");
  });
});

/* -------------------------------- delete ---------------------------------- */

describe("deleteArchitectSecret", () => {
  it("deletes only the owner's key and reports success", async () => {
    deleteManyMock.mockResolvedValue({ count: 1 });
    const ok = await deleteArchitectSecret("arch-1", "sec-9");
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { id: "sec-9", architectUserId: "arch-1" } });
    expect(ok).toBe(true);
  });

  it("reports failure when nothing matched (e.g. another architect's key)", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });
    const ok = await deleteArchitectSecret("arch-1", "sec-belongs-to-someone-else");
    expect(ok).toBe(false);
  });
});

/* --------------------------- getArchitectSecretValue ---------------------- */

describe("getArchitectSecretValue", () => {
  it("decrypts the stored value at call time, scoped by owner + name", async () => {
    findUniqueMock.mockResolvedValue({ valueEncrypted: encryptSecret("live-key-xyz") });
    const value = await getArchitectSecretValue("arch-1", "Weather");
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { architectUserId_name: { architectUserId: "arch-1", name: "Weather" } },
      select: { valueEncrypted: true }
    });
    expect(value).toBe("live-key-xyz");
  });

  it("returns null when the architect has no key with that name", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getArchitectSecretValue("arch-1", "Missing")).toBeNull();
  });

  it("returns null for an empty name without hitting the database", async () => {
    expect(await getArchitectSecretValue("arch-1", "  ")).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

/* ----------------------------- YouTube key pool --------------------------- */

describe("parseYouTubeKeyPool", () => {
  it("returns an empty list for unset / blank / non-JSON / non-array input", () => {
    expect(parseYouTubeKeyPool(undefined)).toEqual([]);
    expect(parseYouTubeKeyPool(null)).toEqual([]);
    expect(parseYouTubeKeyPool("")).toEqual([]);
    expect(parseYouTubeKeyPool("   ")).toEqual([]);
    expect(parseYouTubeKeyPool("not json")).toEqual([]);
    expect(parseYouTubeKeyPool('{"a":1}')).toEqual([]);
    expect(parseYouTubeKeyPool("[]")).toEqual([]);
  });

  it("keeps only non-blank string entries, trimmed", () => {
    expect(parseYouTubeKeyPool('["AIzaOne","  AIzaTwo  ","",123,null]')).toEqual([
      "AIzaOne",
      "AIzaTwo"
    ]);
  });
});

describe("rotateKeyPool", () => {
  it("returns null for an empty pool", () => {
    expect(rotateKeyPool([])).toBeNull();
  });

  it("cycles round-robin over the pool", () => {
    const keys = ["k1", "k2", "k3"];
    const picks = Array.from({ length: 6 }, () => rotateKeyPool(keys) as string);
    // Every key appears, and the sequence repeats with period = pool length,
    // regardless of the shared cursor's starting offset.
    expect(new Set(picks.slice(0, 3))).toEqual(new Set(keys));
    for (let i = 0; i < 3; i++) {
      expect(picks[i]).toBe(picks[i + 3]);
    }
    expect(picks[0]).not.toBe(picks[1]);
    expect(picks[1]).not.toBe(picks[2]);
  });
});

describe("getPlatformYouTubeKey", () => {
  it("is empty-safe end to end (no YOUTUBE_API_KEY_POOL in the test env)", () => {
    // The test setup does not configure the pool, so the accessor must not throw
    // and must return null so callers know to fall back.
    expect(getPlatformYouTubeKey()).toBeNull();
  });
});
