/**
 * KNOWLEDGE — the platform's side of the library.
 *
 * The architect owns the meaning (what the node is for); the business owns the
 * facts (their documents). These three are the admin's, because each one is a
 * judgement about cost and safety, and a judgement should never need a release:
 *
 *   biggestFileMb   — document bytes live in Postgres rows; every megabyte
 *                     allowed here is database the platform pays for.
 *   maxFiles        — the shelf's length per business, the other half of the
 *                     same bill.
 *   charsPerAnswer  — how much library one answer may carry to a Brain. More
 *                     is not smarter: past a point the model drowns and the
 *                     tokens are pure cost.
 *
 * Defaults equal the values that shipped hard-coded, so turning these into
 * dials changes nothing until an admin turns one.
 */

import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

export type KnowledgeLimits = {
  /** Largest single document a business may upload, in megabytes. */
  biggestFileMb: number;
  /** Most documents one business may keep on the shelf. */
  maxFiles: number;
  /** Most characters of library one retrieval hands a Brain. */
  charsPerAnswer: number;
};

const KEYS = {
  biggestFileMb: "knowledgeBiggestFileMb",
  maxFiles: "knowledgeMaxFiles",
  charsPerAnswer: "knowledgeCharsPerAnswer"
} as const;

export function defaultKnowledgeLimits(): KnowledgeLimits {
  return {
    biggestFileMb: 10,
    maxFiles: env.KNOWLEDGE_MAX_FILES_PER_BUSINESS,
    charsPerAnswer: 8_000
  };
}

export const KNOWLEDGE_LIMIT_BOUNDS = {
  biggestFileMb: { min: 1, max: 50 },
  maxFiles: { min: 1, max: 200 },
  charsPerAnswer: { min: 2_000, max: 20_000 }
} as const;

let cached: KnowledgeLimits | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateKnowledgeLimitsCache(): void {
  cached = null;
  cachedAt = 0;
}

function clamp(value: number, bounds: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/**
 * Never throws: a database that cannot be reached gives the shipped defaults,
 * because a library that cannot be read for a minute is worse than one that
 * allows a page too many for a minute.
 */
export async function getKnowledgeLimits(): Promise<KnowledgeLimits> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  const defaults = defaultKnowledgeLimits();
  try {
    const rows = await prisma.platformApiSetting.findMany({
      where: { key: { in: Object.values(KEYS) } },
      select: { key: true, valueEncrypted: true }
    });
    const byKey = new Map(rows.map((row) => [row.key, row.valueEncrypted]));
    const read = (key: string, bounds: { min: number; max: number }, fallback: number) => {
      const raw = byKey.get(key);
      return raw === undefined ? fallback : clamp(Number(raw), bounds, fallback);
    };
    cached = {
      biggestFileMb: read(KEYS.biggestFileMb, KNOWLEDGE_LIMIT_BOUNDS.biggestFileMb, defaults.biggestFileMb),
      maxFiles: read(KEYS.maxFiles, KNOWLEDGE_LIMIT_BOUNDS.maxFiles, defaults.maxFiles),
      charsPerAnswer: read(KEYS.charsPerAnswer, KNOWLEDGE_LIMIT_BOUNDS.charsPerAnswer, defaults.charsPerAnswer)
    };
    cachedAt = Date.now();
    return cached;
  } catch (error) {
    console.warn("[knowledge-limits] falling back to defaults", (error as Error).message);
    return cached ?? defaults;
  }
}

export async function saveKnowledgeLimits(
  limits: KnowledgeLimits,
  updatedByUserId: string
): Promise<KnowledgeLimits> {
  const defaults = defaultKnowledgeLimits();
  const safe: KnowledgeLimits = {
    biggestFileMb: clamp(limits.biggestFileMb, KNOWLEDGE_LIMIT_BOUNDS.biggestFileMb, defaults.biggestFileMb),
    maxFiles: clamp(limits.maxFiles, KNOWLEDGE_LIMIT_BOUNDS.maxFiles, defaults.maxFiles),
    charsPerAnswer: clamp(limits.charsPerAnswer, KNOWLEDGE_LIMIT_BOUNDS.charsPerAnswer, defaults.charsPerAnswer)
  };
  const entries: Array<[string, number]> = [
    [KEYS.biggestFileMb, safe.biggestFileMb],
    [KEYS.maxFiles, safe.maxFiles],
    [KEYS.charsPerAnswer, safe.charsPerAnswer]
  ];
  for (const [key, value] of entries) {
    await prisma.platformApiSetting.upsert({
      where: { key },
      update: { valueEncrypted: String(value), secret: false, updatedByUserId },
      create: { key, valueEncrypted: String(value), secret: false, updatedByUserId }
    });
  }
  invalidateKnowledgeLimitsCache();
  return safe;
}
