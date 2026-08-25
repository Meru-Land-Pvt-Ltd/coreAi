/**
 * HOW FAR AN ARCHITECT MAY GO — the platform's side of a node's settings.
 *
 * The Condition's roads out are the first case. An architect can name as many
 * as they like, and nothing has ever said no: twelve roads on one step is a
 * flowchart nobody can read, twelve prompts an AI door has to choose between,
 * and twelve chances to send a real customer somewhere nobody meant.
 *
 * The number belongs to the admin rather than the code for the same reason as
 * Memory's limits: it is a judgement about what the platform should allow, and
 * a judgement should never need a release.
 */

import { prisma } from "../../lib/prisma";

export const CONDITION_ROADS_KEY = "conditionMaxRoads";

/**
 * Eight, because a step with more ways out than that is really two steps — and
 * because it is well above anything a real agent has needed so far. Generous
 * enough that nobody sensible meets it; low enough that nobody builds a maze.
 */
export const DEFAULT_CONDITION_ROADS = 8;

/** Two is the smallest thing that can still be called a choice. */
export const CONDITION_ROADS_BOUNDS = { min: 2, max: 20 } as const;

let cached: number | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateNodeLimitsCache(): void {
  cached = null;
  cachedAt = 0;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONDITION_ROADS;
  return Math.min(CONDITION_ROADS_BOUNDS.max, Math.max(CONDITION_ROADS_BOUNDS.min, Math.round(value)));
}

/**
 * The most roads a Condition may have.
 *
 * Never throws: a database that cannot be reached gives the platform default,
 * because a builder that cannot draw a node is worse than one that allows a
 * road too many for a minute.
 */
export async function getConditionRoadLimit(): Promise<number> {
  if (cached !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  try {
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: CONDITION_ROADS_KEY },
      select: { valueEncrypted: true }
    });
    cached = row ? clamp(Number(row.valueEncrypted)) : DEFAULT_CONDITION_ROADS;
    cachedAt = Date.now();
    return cached;
  } catch (error) {
    console.warn("[node-limits] falling back to the default road limit", (error as Error).message);
    return cached ?? DEFAULT_CONDITION_ROADS;
  }
}

export async function saveConditionRoadLimit(value: number, updatedByUserId: string): Promise<number> {
  const safe = clamp(value);
  await prisma.platformApiSetting.upsert({
    where: { key: CONDITION_ROADS_KEY },
    update: { valueEncrypted: String(safe), secret: false, updatedByUserId },
    create: { key: CONDITION_ROADS_KEY, valueEncrypted: String(safe), secret: false, updatedByUserId }
  });
  invalidateNodeLimitsCache();
  return safe;
}
