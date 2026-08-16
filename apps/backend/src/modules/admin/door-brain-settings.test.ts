import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The door battery — one platform-wide provider/model every AI door runs on.
 *
 * The contract that matters:
 *   saved value wins → otherwise the safe default → doors are never model-less,
 * a mismatched model is never shipped to a provider that would reject it, and a
 * database problem can never take a customer's run down.
 *
 * Prisma is mocked with an in-memory key/value store so this suite proves the
 * logic without needing a database.
 */

const { findManyMock, upsertMock, deleteManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    platformApiSetting: {
      findMany: findManyMock,
      upsert: upsertMock,
      deleteMany: deleteManyMock
    }
  }
}));

import { encryptSecret } from "../../lib/crypto";
import {
  DEFAULT_DOOR_BRAIN_PROVIDER,
  DOOR_BRAIN_MODEL_KEY,
  DOOR_BRAIN_PROVIDER_KEY,
  doorBrainModelMismatch,
  doorBrainModelOptions,
  doorBrainProviderOptions,
  getDoorBrainConfig,
  getDoorBrainSetting,
  invalidateDoorBrainConfigCache,
  isSupportedDoorBrainProvider,
  saveDoorBrainConfig
} from "./door-brain-settings";

const ADMIN_ID = "admin-user";

/** In-memory stand-in for the two PlatformApiSetting rows. */
type Row = { key: string; valueEncrypted: string; updatedAt: Date; secret: boolean; updatedByUserId: string };
let rows = new Map<string, Row>();

function seed(key: string, value: string): void {
  rows.set(key, {
    key,
    valueEncrypted: encryptSecret(value),
    updatedAt: new Date("2026-08-16T10:00:00.000Z"),
    secret: false,
    updatedByUserId: ADMIN_ID
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map();
  invalidateDoorBrainConfigCache();

  findManyMock.mockImplementation(async ({ where }: { where: { key: { in: string[] } } }) =>
    where.key.in.map((key) => rows.get(key)).filter(Boolean)
  );
  upsertMock.mockImplementation(
    async ({ create }: { create: { key: string; valueEncrypted: string; secret: boolean; updatedByUserId: string } }) => {
      const row: Row = { ...create, updatedAt: new Date() };
      rows.set(create.key, row);
      return row;
    }
  );
  deleteManyMock.mockImplementation(async ({ where }: { where: { key: string } }) => {
    const count = rows.delete(where.key) ? 1 : 0;
    return { count };
  });
});

describe("safe default", () => {
  it("uses gemini with the provider's own model while nothing is saved", async () => {
    expect(await getDoorBrainConfig()).toEqual({ providerId: "gemini", modelId: null });
    expect(DEFAULT_DOOR_BRAIN_PROVIDER).toBe("gemini");

    const setting = await getDoorBrainSetting();
    expect(setting.isDefault).toBe(true);
    expect(setting.providerId).toBe("gemini");
    expect(setting.modelId).toBeNull();
    expect(setting.updatedAt).toBeNull();
  });

  it("falls back when the stored provider is no longer one we can run", async () => {
    seed(DOOR_BRAIN_PROVIDER_KEY, "some-retired-provider");

    expect((await getDoorBrainConfig()).providerId).toBe("gemini");
  });

  it("offers only providers the engine knows", () => {
    const ids = doorBrainProviderOptions().map((provider) => provider.id);
    expect(ids).toContain("gemini");
    expect(ids).toContain("claude");
    expect(ids).toContain("openai");
    for (const id of ids) expect(isSupportedDoorBrainProvider(id)).toBe(true);

    expect(isSupportedDoorBrainProvider("not-a-provider")).toBe(false);
    expect(isSupportedDoorBrainProvider("")).toBe(false);
    expect(doorBrainModelOptions("gemini").length).toBeGreaterThan(0);
  });
});

describe("saving the battery", () => {
  it("swaps the provider platform-wide", async () => {
    const result = await saveDoorBrainConfig({ provider: "claude" }, ADMIN_ID);

    expect(result.providerId).toBe("claude");
    expect(result.restoredDefault).toBe(false);
    expect(await getDoorBrainConfig()).toEqual({ providerId: "claude", modelId: null });
  });

  it("stores both rows encrypted at rest and marked non-secret", async () => {
    await saveDoorBrainConfig({ provider: "claude", model: "claude-haiku-4-5-20251001" }, ADMIN_ID);

    for (const key of [DOOR_BRAIN_PROVIDER_KEY, DOOR_BRAIN_MODEL_KEY]) {
      const row = rows.get(key);
      expect(row?.secret).toBe(false);
      expect(row?.updatedByUserId).toBe(ADMIN_ID);
      expect(row?.valueEncrypted).toBeTruthy();
      expect(row?.valueEncrypted).not.toContain("claude");
    }

    expect(await getDoorBrainConfig()).toEqual({
      providerId: "claude",
      modelId: "claude-haiku-4-5-20251001"
    });
  });

  it("blank deletes the row and restores the default", async () => {
    await saveDoorBrainConfig({ provider: "claude", model: "claude-sonnet-5" }, ADMIN_ID);

    const result = await saveDoorBrainConfig({ provider: "", model: "" }, ADMIN_ID);
    expect(result.restoredDefault).toBe(true);
    expect(rows.size).toBe(0);
    expect(await getDoorBrainConfig()).toEqual({ providerId: "gemini", modelId: null });
  });

  it("leaves a field alone when the payload does not mention it", async () => {
    await saveDoorBrainConfig({ provider: "openai", model: "gpt-5.4-mini" }, ADMIN_ID);
    await saveDoorBrainConfig({ model: "gpt-4.1-mini" }, ADMIN_ID);

    expect(await getDoorBrainConfig()).toEqual({ providerId: "openai", modelId: "gpt-4.1-mini" });
  });

  it("switching provider drops a model that belonged to the old one", async () => {
    await saveDoorBrainConfig({ provider: "openai", model: "gpt-5.4-mini" }, ADMIN_ID);

    const result = await saveDoorBrainConfig({ provider: "gemini" }, ADMIN_ID);
    expect(result).toMatchObject({ providerId: "gemini", modelId: null });
    expect(rows.has(DOOR_BRAIN_MODEL_KEY)).toBe(false);
  });

  it("keeps a model id the catalog has never heard of", async () => {
    // Providers ship models faster than the catalog is updated — an unknown id
    // must not be silently discarded.
    await saveDoorBrainConfig({ provider: "gemini", model: "gemini-9.9-turbo" }, ADMIN_ID);

    expect(await getDoorBrainConfig()).toEqual({
      providerId: "gemini",
      modelId: "gemini-9.9-turbo"
    });
  });

  it("never sends a stored model that belongs to another provider", () => {
    expect(doorBrainModelMismatch("gemini", "gpt-4o")).toBe(true);
    expect(doorBrainModelMismatch("gemini", "gemini-3.5-flash")).toBe(false);
    expect(doorBrainModelMismatch("gemini", "gemini-9.9-turbo")).toBe(false);
  });

  it("drops a mismatched pair that somehow reached the database", async () => {
    seed(DOOR_BRAIN_PROVIDER_KEY, "gemini");
    seed(DOOR_BRAIN_MODEL_KEY, "gpt-4o");

    expect(await getDoorBrainConfig()).toEqual({ providerId: "gemini", modelId: null });
  });
});

describe("cache", () => {
  it("serves from cache within the TTL and refreshes after invalidation", async () => {
    seed(DOOR_BRAIN_PROVIDER_KEY, "claude");
    expect((await getDoorBrainConfig()).providerId).toBe("claude");

    // Change the store behind the accessor's back — the cache must answer.
    rows.clear();
    expect((await getDoorBrainConfig()).providerId).toBe("claude");

    invalidateDoorBrainConfigCache();
    expect((await getDoorBrainConfig()).providerId).toBe("gemini");
  });

  it("save invalidates the cache so every door swaps instantly", async () => {
    expect((await getDoorBrainConfig()).providerId).toBe("gemini"); // primes cache
    await saveDoorBrainConfig({ provider: "mistral" }, ADMIN_ID);
    expect((await getDoorBrainConfig()).providerId).toBe("mistral");
  });
});

describe("never throws", () => {
  it("returns the default when the database is unreachable", async () => {
    findManyMock.mockRejectedValue(new Error("connection refused"));

    await expect(getDoorBrainConfig()).resolves.toEqual({
      providerId: "gemini",
      modelId: null
    });
  });

  it("returns the last known battery when the database dies after the cache expires", async () => {
    vi.useFakeTimers();
    try {
      seed(DOOR_BRAIN_PROVIDER_KEY, "groq");
      expect((await getDoorBrainConfig()).providerId).toBe("groq");

      // TTL lapses and the database is gone — doors keep running on what they knew.
      vi.advanceTimersByTime(61_000);
      findManyMock.mockRejectedValue(new Error("connection refused"));
      expect((await getDoorBrainConfig()).providerId).toBe("groq");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a row encrypted under a rotated key as unset", async () => {
    rows.set(DOOR_BRAIN_PROVIDER_KEY, {
      key: DOOR_BRAIN_PROVIDER_KEY,
      valueEncrypted: "not.a.valid.ciphertext",
      updatedAt: new Date(),
      secret: false,
      updatedByUserId: ADMIN_ID
    });

    expect((await getDoorBrainConfig()).providerId).toBe("gemini");
  });
});
