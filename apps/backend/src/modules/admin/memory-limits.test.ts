import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE ADMIN'S HALF OF MEMORY.
 *
 * Four numbers that were constants compiled into the backend: how long a
 * customer's words are kept, how big a file may be, how much a brain reads per
 * answer, and whether search by meaning runs at all. Changing any of them used
 * to mean a release.
 */

const findMany = vi.fn();
const upsert = vi.fn();
vi.mock("../../lib/prisma", () => ({
  prisma: {
    platformApiSetting: {
      findMany: (...args: unknown[]) => findMany(...args),
      upsert: (...args: unknown[]) => upsert(...args)
    }
  }
}));

import {
  defaultMemoryLimits,
  getMemoryLimits,
  invalidateMemoryLimitsCache,
  saveMemoryLimits
} from "./memory-limits";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateMemoryLimitsCache();
});

describe("before an admin ever opens the screen", () => {
  it("keeps memory forever, exactly as the platform always did", async () => {
    findMany.mockResolvedValue([]);
    const limits = await getMemoryLimits();
    // 0 is not "no answer" here — it is "keep forever", and it is what the
    // platform did before this file existed.
    expect(limits.keepForDays).toBe(0);
    expect(limits).toEqual(defaultMemoryLimits());
  });

  it("gives the defaults rather than failing when the database is unreachable", async () => {
    // Memory carrying on is always better than a customer's run stopping
    // because a settings row could not be read.
    findMany.mockRejectedValue(new Error("db down"));
    expect(await getMemoryLimits()).toEqual(defaultMemoryLimits());
  });
});

describe("what an admin saves", () => {
  it("is what the engine then reads", async () => {
    upsert.mockResolvedValue({});
    const saved = await saveMemoryLimits(
      { keepForDays: 90, biggestFileMb: 20, piecesPerAnswer: 15, searchByMeaning: false },
      "admin-1"
    );
    expect(saved.keepForDays).toBe(90);
    expect(saved.searchByMeaning).toBe(false);
    expect(upsert).toHaveBeenCalledTimes(4);
  });

  it("is pulled back inside sane bounds", async () => {
    // A typed zero in "how much a brain reads" would make every agent forget,
    // and a hundred years of retention is not a decision anyone meant to make.
    upsert.mockResolvedValue({});
    const saved = await saveMemoryLimits(
      { keepForDays: 999_999, biggestFileMb: 0, piecesPerAnswer: 0, searchByMeaning: true },
      "admin-1"
    );
    expect(saved.keepForDays).toBe(3650);
    expect(saved.biggestFileMb).toBe(1);
    expect(saved.piecesPerAnswer).toBe(1);
  });

  it("is stored where a person can read it without decrypting anything", async () => {
    // These are numbers on a screen, not secrets.
    upsert.mockResolvedValue({});
    await saveMemoryLimits({ keepForDays: 30, biggestFileMb: 5, piecesPerAnswer: 10, searchByMeaning: true }, "a");
    const written = upsert.mock.calls.map((call) => (call[0] as { create: { key: string; valueEncrypted: string } }).create);
    expect(written.find((row) => row.key === "memoryKeepForDays")?.valueEncrypted).toBe("30");
    expect(written.find((row) => row.key === "memorySearchByMeaning")?.valueEncrypted).toBe("on");
  });
});
