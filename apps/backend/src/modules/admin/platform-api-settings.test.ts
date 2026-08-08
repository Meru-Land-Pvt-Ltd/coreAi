import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { env, rawEnv } from "../../config/env";
import {
  invalidatePlatformApiSettingsCache,
  isSecretPlatformApiKey,
  listPlatformApiSettings,
  platformApiSettingAsync,
  preloadPlatformApiSettings,
  savePlatformApiSettings,
  PLATFORM_API_SETTING_KEYS
} from "./platform-api-settings";

/**
 * Admin → Manage API. The contract that matters:
 *   admin value wins → otherwise .env → otherwise empty
 * and clearing a field restores the .env value rather than disabling a provider.
 */

const KEY = "OPENAI_API_KEY";
const ADMIN_VALUE = "sk-admin-managed-test-value-0123456789";

let dbAvailable = false;
let adminUserId = "";
const RUN = `apisettings-${process.pid}-${Date.now().toString(36)}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[platform-api-settings.test] database unreachable — suite skipped");
    return;
  }
  adminUserId = (
    await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "ADMIN" } })
  ).id;
});

afterEach(async () => {
  if (!dbAvailable) return;
  await prisma.platformApiSetting.deleteMany({ where: { key: { in: [...PLATFORM_API_SETTING_KEYS] } } });
  invalidatePlatformApiSettingsCache();
  await preloadPlatformApiSettings();
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.platformApiSetting.deleteMany({ where: { updatedByUserId: adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
  }
  await prisma.$disconnect();
});

describe("resolution order", () => {
  it("an admin value overrides the environment", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    await savePlatformApiSettings([{ key: KEY, value: ADMIN_VALUE }], adminUserId);
    await preloadPlatformApiSettings();

    expect(await platformApiSettingAsync(KEY)).toBe(ADMIN_VALUE);
    // The whole point: existing `env.OPENAI_API_KEY` call sites see it unchanged.
    expect(env.OPENAI_API_KEY).toBe(ADMIN_VALUE);
    // …while the raw environment is untouched.
    expect(rawEnv.OPENAI_API_KEY).not.toBe(ADMIN_VALUE);
  });

  it("clearing an admin value restores the .env fallback", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    await savePlatformApiSettings([{ key: KEY, value: ADMIN_VALUE }], adminUserId);
    await preloadPlatformApiSettings();
    expect(env.OPENAI_API_KEY).toBe(ADMIN_VALUE);

    // Blank deletes the row instead of storing "" — a stored blank would
    // disable the provider entirely, which is never what "clear" should mean.
    const result = await savePlatformApiSettings([{ key: KEY, value: "   " }], adminUserId);
    await preloadPlatformApiSettings();

    expect(result.cleared).toBe(1);
    expect(await prisma.platformApiSetting.count({ where: { key: KEY } })).toBe(0);
    expect(env.OPENAI_API_KEY).toBe(rawEnv.OPENAI_API_KEY);
  });

  it("unmanaged environment variables are never intercepted", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");
    // Only the keys on the page route through the resolver.
    expect(env.DATABASE_URL).toBe(rawEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe(rawEnv.NODE_ENV);
  });
});

describe("admin API surface", () => {
  it("never returns a stored secret in plaintext", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    await savePlatformApiSettings([{ key: KEY, value: ADMIN_VALUE }], adminUserId);
    const groups = await listPlatformApiSettings();
    const field = groups.flatMap((group) => group.fields).find((entry) => entry.key === KEY);

    expect(field?.source).toBe("admin");
    expect(field?.value).not.toBe(ADMIN_VALUE);
    expect(field?.value).toContain("••••");
    // Enough to recognise which key is stored, not enough to use it.
    expect(field?.value.startsWith("sk-a")).toBe(true);
  });

  it("returns non-secret settings in full so they can be edited", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    await savePlatformApiSettings([{ key: "CARTESIA_TTS_MODEL", value: "sonic-2" }], adminUserId);
    const groups = await listPlatformApiSettings();
    const field = groups.flatMap((group) => group.fields).find((entry) => entry.key === "CARTESIA_TTS_MODEL");

    expect(isSecretPlatformApiKey("CARTESIA_TTS_MODEL")).toBe(false);
    expect(field?.value).toBe("sonic-2");
  });

  it("stores secrets encrypted at rest", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    await savePlatformApiSettings([{ key: KEY, value: ADMIN_VALUE }], adminUserId);
    const row = await prisma.platformApiSetting.findUnique({ where: { key: KEY } });

    expect(row?.valueEncrypted).toBeTruthy();
    expect(row?.valueEncrypted).not.toContain(ADMIN_VALUE);
  });

  it("covers every key the page renders", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");

    const groups = await listPlatformApiSettings();
    const rendered = groups.flatMap((group) => group.fields).map((field) => field.key);
    expect(new Set(rendered)).toEqual(new Set(PLATFORM_API_SETTING_KEYS));
  });
});
