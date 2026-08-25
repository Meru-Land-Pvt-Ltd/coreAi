import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HOW MANY WAYS OUT ONE STEP MAY HAVE.
 *
 * Nothing used to say no, so a Condition could grow twelve roads: a flowchart
 * nobody can read, twelve prompts the AI door has to choose between, and twelve
 * chances to send a real customer somewhere nobody meant.
 */

const findUnique = vi.fn();
const upsert = vi.fn();
vi.mock("../../lib/prisma", () => ({
  prisma: { platformApiSetting: { findUnique: (...a: unknown[]) => findUnique(...a), upsert: (...a: unknown[]) => upsert(...a) } }
}));

import {
  DEFAULT_CONDITION_ROADS,
  getConditionRoadLimit,
  invalidateNodeLimitsCache,
  saveConditionRoadLimit
} from "./node-limits";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateNodeLimitsCache();
});

describe("the road limit", () => {
  it("is eight until an admin says otherwise", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getConditionRoadLimit()).toBe(DEFAULT_CONDITION_ROADS);
  });

  it("is whatever the admin saved", async () => {
    findUnique.mockResolvedValue({ valueEncrypted: "4" });
    expect(await getConditionRoadLimit()).toBe(4);
  });

  it("never falls below two, because two is the smallest thing that is still a choice", async () => {
    upsert.mockResolvedValue({});
    expect(await saveConditionRoadLimit(1, "admin")).toBe(2);
    expect(await saveConditionRoadLimit(500, "admin")).toBe(20);
  });

  it("gives the default rather than breaking the builder when the database is unreachable", async () => {
    // A builder that cannot draw a node because a settings row was slow is far
    // worse than one that allows a road too many for a minute.
    findUnique.mockRejectedValue(new Error("db down"));
    expect(await getConditionRoadLimit()).toBe(DEFAULT_CONDITION_ROADS);
  });
});
