/**
 * WHAT THE PLATFORM ALLOWS MEMORY TO DO.
 *
 * The architect owns the meaning — what to always remember, how much to keep.
 * The admin owns the cost and the law, and until now they owned neither: every
 * one of these numbers was a constant compiled into the backend, so changing
 * how long a customer's words are kept meant a release.
 *
 * The four that matter:
 *
 *   how long it is kept   — the legal one. A business that deletes a customer
 *                           cannot have their words living on in a drawer.
 *   biggest file          — 5 MB, hardcoded in smart-memory.ts until today.
 *   pieces per answer     — how much memory a brain reads before it replies.
 *                           This one is money: every piece is tokens, on every
 *                           single answer, on every agent.
 *   search by meaning     — Pinecone on or off, for when it is unavailable or
 *                           not worth its bill.
 *
 * Stored one row per setting so a half-saved screen cannot leave the platform
 * in a state nobody chose, and cached for a minute because the runner reads
 * these on every memory step of every run.
 */

import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

export type MemoryLimits = {
  /** Days before a stored memory is deleted. 0 = keep forever. */
  keepForDays: number;
  /** Biggest file memory will try to read, in megabytes. */
  biggestFileMb: number;
  /** How many remembered pieces a brain may be handed per answer. */
  piecesPerAnswer: number;
  /** Search by meaning (Pinecone). Off = timeline only. */
  searchByMeaning: boolean;
};

const KEYS = {
  keepForDays: "memoryKeepForDays",
  biggestFileMb: "memoryBiggestFileMb",
  piecesPerAnswer: "memoryPiecesPerAnswer",
  searchByMeaning: "memorySearchByMeaning"
} as const;

/**
 * The defaults are exactly what the platform did before this screen existed.
 * An admin who never opens it sees no change whatsoever — that is the rule for
 * every setting we lift out of the code.
 */
export function defaultMemoryLimits(): MemoryLimits {
  return {
    keepForDays: 0,
    biggestFileMb: 5,
    piecesPerAnswer: env.MEMORY_SEARCH_TOP_K || 10,
    searchByMeaning: true
  };
}

/** Sane bounds, so a typo cannot bankrupt a customer or break the law. */
export const MEMORY_LIMIT_BOUNDS = {
  keepForDays: { min: 0, max: 3650 },
  biggestFileMb: { min: 1, max: 50 },
  piecesPerAnswer: { min: 1, max: 50 }
} as const;

function clamp(value: number, bounds: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

let cached: MemoryLimits | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateMemoryLimitsCache(): void {
  cached = null;
  cachedAt = 0;
}

/**
 * What the engine should obey right now.
 *
 * Never throws. A database that cannot be reached gives the defaults — memory
 * carrying on with the platform's own numbers is always better than a run that
 * stops because a settings row could not be read.
 */
export async function getMemoryLimits(): Promise<MemoryLimits> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  const defaults = defaultMemoryLimits();
  try {
    const rows = await prisma.platformApiSetting.findMany({
      where: { key: { in: Object.values(KEYS) } },
      select: { key: true, valueEncrypted: true }
    });
    const stored = new Map(rows.map((row) => [row.key, row.valueEncrypted]));

    const read = (key: string): string => stored.get(key) ?? "";

    cached = {
      keepForDays: stored.has(KEYS.keepForDays)
        ? clamp(Number(read(KEYS.keepForDays)), MEMORY_LIMIT_BOUNDS.keepForDays, defaults.keepForDays)
        : defaults.keepForDays,
      biggestFileMb: stored.has(KEYS.biggestFileMb)
        ? clamp(Number(read(KEYS.biggestFileMb)), MEMORY_LIMIT_BOUNDS.biggestFileMb, defaults.biggestFileMb)
        : defaults.biggestFileMb,
      piecesPerAnswer: stored.has(KEYS.piecesPerAnswer)
        ? clamp(Number(read(KEYS.piecesPerAnswer)), MEMORY_LIMIT_BOUNDS.piecesPerAnswer, defaults.piecesPerAnswer)
        : defaults.piecesPerAnswer,
      searchByMeaning: stored.has(KEYS.searchByMeaning) ? read(KEYS.searchByMeaning) !== "off" : defaults.searchByMeaning
    };
    cachedAt = Date.now();
    return cached;
  } catch (error) {
    console.warn("[memory-limits] falling back to the platform defaults", (error as Error).message);
    return cached ?? defaults;
  }
}

/**
 * Save what an admin chose.
 *
 * These are numbers on a screen, not secrets, so they are stored in the clear —
 * an admin reading the database should be able to see that memory is kept for
 * ninety days without decrypting anything.
 */
export async function saveMemoryLimits(limits: MemoryLimits, updatedByUserId: string): Promise<MemoryLimits> {
  const defaults = defaultMemoryLimits();
  const safe: MemoryLimits = {
    keepForDays: clamp(limits.keepForDays, MEMORY_LIMIT_BOUNDS.keepForDays, defaults.keepForDays),
    biggestFileMb: clamp(limits.biggestFileMb, MEMORY_LIMIT_BOUNDS.biggestFileMb, defaults.biggestFileMb),
    piecesPerAnswer: clamp(limits.piecesPerAnswer, MEMORY_LIMIT_BOUNDS.piecesPerAnswer, defaults.piecesPerAnswer),
    searchByMeaning: Boolean(limits.searchByMeaning)
  };

  const write = async (key: string, value: string) => {
    await prisma.platformApiSetting.upsert({
      where: { key },
      update: { valueEncrypted: value, secret: false, updatedByUserId },
      create: { key, valueEncrypted: value, secret: false, updatedByUserId }
    });
  };

  await Promise.all([
    write(KEYS.keepForDays, String(safe.keepForDays)),
    write(KEYS.biggestFileMb, String(safe.biggestFileMb)),
    write(KEYS.piecesPerAnswer, String(safe.piecesPerAnswer)),
    write(KEYS.searchByMeaning, safe.searchByMeaning ? "on" : "off")
  ]);

  invalidateMemoryLimitsCache();
  return safe;
}
