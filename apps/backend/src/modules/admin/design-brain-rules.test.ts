import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  DEFAULT_DESIGN_BRAIN_RULES,
  DESIGN_BRAIN_RULES_KEY,
  getDesignBrainRules,
  getDesignBrainRulesSetting,
  invalidateDesignBrainRulesCache,
  saveDesignBrainRules
} from "./design-brain-rules";

/**
 * Design Brain constitution. The contract that matters:
 *   saved rules win → otherwise the platform default → never rule-less
 * and clearing restores the default rather than storing an empty constitution.
 */

const CUSTOM_RULES = "Always use the business's own words.\nNever ship a page that is hard to read.";

let dbAvailable = false;
let adminUserId = "";
const RUN = `designrules-${process.pid}-${Date.now().toString(36)}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[design-brain-rules.test] database unreachable — suite skipped");
    return;
  }
  adminUserId = (
    await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "ADMIN" } })
  ).id;
});

afterEach(async () => {
  if (!dbAvailable) return;
  await prisma.platformApiSetting.deleteMany({ where: { key: DESIGN_BRAIN_RULES_KEY } });
  invalidateDesignBrainRulesCache();
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.platformApiSetting.deleteMany({ where: { key: DESIGN_BRAIN_RULES_KEY } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
  }
  await prisma.$disconnect();
});

function requireDb() {
  if (!dbAvailable) {
    throw new Error(
      "Integration test requires a reachable database; failing loudly instead of passing silently."
    );
  }
}

describe("default constitution", () => {
  it("applies the platform default while nothing is saved", async () => {
    requireDb();

    const setting = await getDesignBrainRulesSetting();
    expect(setting.isDefault).toBe(true);
    expect(setting.value).toBe(DEFAULT_DESIGN_BRAIN_RULES);
    expect(setting.updatedAt).toBeNull();

    // The accessor design-chat uses agrees — the Brain is never rule-less.
    expect(await getDesignBrainRules()).toBe(DEFAULT_DESIGN_BRAIN_RULES);
  });

  it("ships a real constitution, not a stub", () => {
    // ~10 rules of plain language. Forbidden technical words stay out of it —
    // this text steers copy the customer will eventually see.
    expect(DEFAULT_DESIGN_BRAIN_RULES.split("\n").length).toBeGreaterThanOrEqual(10);
    for (const word of ["workflow", "node", "dry run", "execution", "token", "webhook", "payload"]) {
      expect(DEFAULT_DESIGN_BRAIN_RULES.toLowerCase()).not.toContain(word);
    }
  });
});

describe("saving", () => {
  it("persists admin rules and returns them everywhere", async () => {
    requireDb();

    const result = await saveDesignBrainRules(CUSTOM_RULES, adminUserId);
    expect(result.restoredDefault).toBe(false);

    const setting = await getDesignBrainRulesSetting();
    expect(setting.isDefault).toBe(false);
    expect(setting.value).toBe(CUSTOM_RULES);
    expect(setting.updatedAt).not.toBeNull();

    expect(await getDesignBrainRules()).toBe(CUSTOM_RULES);
  });

  it("stores the row encrypted at rest and marked non-secret", async () => {
    requireDb();

    await saveDesignBrainRules(CUSTOM_RULES, adminUserId);
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: DESIGN_BRAIN_RULES_KEY }
    });

    expect(row?.valueEncrypted).toBeTruthy();
    expect(row?.valueEncrypted).not.toContain("business's own words");
    expect(row?.secret).toBe(false);
    expect(row?.updatedByUserId).toBe(adminUserId);
  });

  it("blank deletes the row and restores the default", async () => {
    requireDb();

    await saveDesignBrainRules(CUSTOM_RULES, adminUserId);
    const result = await saveDesignBrainRules("   ", adminUserId);

    expect(result.restoredDefault).toBe(true);
    expect(
      await prisma.platformApiSetting.count({ where: { key: DESIGN_BRAIN_RULES_KEY } })
    ).toBe(0);
    expect(await getDesignBrainRules()).toBe(DEFAULT_DESIGN_BRAIN_RULES);
  });

  it("saving text identical to the default stores nothing", async () => {
    requireDb();

    const result = await saveDesignBrainRules(DEFAULT_DESIGN_BRAIN_RULES, adminUserId);
    expect(result.restoredDefault).toBe(true);
    expect(
      await prisma.platformApiSetting.count({ where: { key: DESIGN_BRAIN_RULES_KEY } })
    ).toBe(0);
  });
});

describe("accessor cache", () => {
  it("serves from cache within the TTL and refreshes after invalidation", async () => {
    requireDb();

    await saveDesignBrainRules(CUSTOM_RULES, adminUserId);
    expect(await getDesignBrainRules()).toBe(CUSTOM_RULES);

    // Change the database behind the accessor's back — the cache must answer.
    await prisma.platformApiSetting.deleteMany({ where: { key: DESIGN_BRAIN_RULES_KEY } });
    expect(await getDesignBrainRules()).toBe(CUSTOM_RULES);

    // saveDesignBrainRules invalidates internally; a manual invalidate must too.
    invalidateDesignBrainRulesCache();
    expect(await getDesignBrainRules()).toBe(DEFAULT_DESIGN_BRAIN_RULES);
  });

  it("save invalidates the cache so changes are live immediately", async () => {
    requireDb();

    expect(await getDesignBrainRules()).toBe(DEFAULT_DESIGN_BRAIN_RULES); // primes cache
    await saveDesignBrainRules(CUSTOM_RULES, adminUserId);
    expect(await getDesignBrainRules()).toBe(CUSTOM_RULES);
  });
});
