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

import { allPlatformDials } from "@coreai/shared";
import { prisma } from "../../lib/prisma";

/**
 * ONE SOURCE OF TRUTH (the founder's ruling, 2026-08-26).
 *
 * These constants used to BE the truth, while the node's own row said the same
 * thing in another file — two copies of one number, agreeing only by luck.
 * Now the row is the truth and these read from it; the fallbacks below are
 * what ships if a declaration is ever removed, never a second opinion.
 */
function declared(storedAs: string): { value: number; min: number; max: number } | null {
  const dial = allPlatformDials().find((entry) => entry.storedAs === storedAs);
  if (!dial || typeof dial.default !== "number") return null;
  return {
    value: dial.default,
    min: dial.limits?.min ?? 1,
    max: dial.limits?.max ?? Number.MAX_SAFE_INTEGER
  };
}

export const CONDITION_ROADS_KEY = "conditionMaxRoads";

/**
 * Eight, because a step with more ways out than that is really two steps — and
 * because it is well above anything a real agent has needed so far. Generous
 * enough that nobody sensible meets it; low enough that nobody builds a maze.
 */
export const DEFAULT_CONDITION_ROADS = declared("conditionMaxRoads")?.value ?? 8;

/** Two is the smallest thing that can still be called a choice. */
export const CONDITION_ROADS_BOUNDS = {
  min: declared("conditionMaxRoads")?.min ?? 2,
  max: declared("conditionMaxRoads")?.max ?? 20
};

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

/* ------------------------- File Upload: pictures ------------------------- */

export const FILE_UPLOAD_IMAGES_KEY = "fileUploadImagesAllowed";

let cachedImages: boolean | null = null;
let cachedImagesAt = 0;

export function invalidateFileUploadCache(): void {
  cachedImages = null;
  cachedImagesAt = 0;
}

/** May customers hand agents pictures? On by default — the founder's call. */
export async function getFileUploadImagesAllowed(): Promise<boolean> {
  if (cachedImages !== null && Date.now() - cachedImagesAt < CACHE_TTL_MS) return cachedImages;
  try {
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: FILE_UPLOAD_IMAGES_KEY },
      select: { valueEncrypted: true }
    });
    cachedImages = row ? row.valueEncrypted !== "off" : true;
    cachedImagesAt = Date.now();
    return cachedImages;
  } catch {
    return cachedImages ?? true;
  }
}

export async function saveFileUploadImagesAllowed(allowed: boolean, updatedByUserId: string): Promise<boolean> {
  await prisma.platformApiSetting.upsert({
    where: { key: FILE_UPLOAD_IMAGES_KEY },
    update: { valueEncrypted: allowed ? "on" : "off", secret: false, updatedByUserId },
    create: { key: FILE_UPLOAD_IMAGES_KEY, valueEncrypted: allowed ? "on" : "off", secret: false, updatedByUserId }
  });
  invalidateFileUploadCache();
  return allowed;
}

/* ----------------------------- Loop: the rounds ---------------------------- */

export const LOOP_ROUNDS_KEY = "loopMaxRounds";

/** Twenty-five: far above any sensible product, low enough that a pasted
 *  spreadsheet cannot become a runaway bill — every round can be an AI call. */
export const DEFAULT_LOOP_ROUNDS = declared("loopMaxRounds")?.value ?? 25;
export const LOOP_ROUNDS_BOUNDS = {
  min: declared("loopMaxRounds")?.min ?? 1,
  max: declared("loopMaxRounds")?.max ?? 100
};

let cachedLoop: number | null = null;
let cachedLoopAt = 0;

export function invalidateLoopLimitCache(): void {
  cachedLoop = null;
  cachedLoopAt = 0;
}

export async function getLoopRoundLimit(): Promise<number> {
  if (cachedLoop !== null && Date.now() - cachedLoopAt < CACHE_TTL_MS) return cachedLoop;
  try {
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: LOOP_ROUNDS_KEY },
      select: { valueEncrypted: true }
    });
    const value = row ? Number(row.valueEncrypted) : DEFAULT_LOOP_ROUNDS;
    cachedLoop = Number.isFinite(value)
      ? Math.min(LOOP_ROUNDS_BOUNDS.max, Math.max(LOOP_ROUNDS_BOUNDS.min, Math.round(value)))
      : DEFAULT_LOOP_ROUNDS;
    cachedLoopAt = Date.now();
    return cachedLoop;
  } catch {
    return cachedLoop ?? DEFAULT_LOOP_ROUNDS;
  }
}

export async function saveLoopRoundLimit(value: number, updatedByUserId: string): Promise<number> {
  const safe = Number.isFinite(value)
    ? Math.min(LOOP_ROUNDS_BOUNDS.max, Math.max(LOOP_ROUNDS_BOUNDS.min, Math.round(value)))
    : DEFAULT_LOOP_ROUNDS;
  await prisma.platformApiSetting.upsert({
    where: { key: LOOP_ROUNDS_KEY },
    update: { valueEncrypted: String(safe), secret: false, updatedByUserId },
    create: { key: LOOP_ROUNDS_KEY, valueEncrypted: String(safe), secret: false, updatedByUserId }
  });
  invalidateLoopLimitCache();
  return safe;
}

/* ------------------------------ Timer: the floor --------------------------- */

export const TIMER_FLOOR_KEY = "timerFloorMinutes";

/** Sixty: the shipped floor. An agent waking every minute is a bill nobody
 *  watches; an admin can tighten to 15 for a trusted platform, never below. */
export const DEFAULT_TIMER_FLOOR_MINUTES = declared("timerFloorMinutes")?.value ?? 60;
export const TIMER_FLOOR_BOUNDS = {
  min: declared("timerFloorMinutes")?.min ?? 15,
  max: declared("timerFloorMinutes")?.max ?? 1440
};

let cachedFloor: number | null = null;
let cachedFloorAt = 0;

export function invalidateTimerFloorCache(): void {
  cachedFloor = null;
  cachedFloorAt = 0;
}

export async function getTimerFloorMinutes(): Promise<number> {
  if (cachedFloor !== null && Date.now() - cachedFloorAt < CACHE_TTL_MS) return cachedFloor;
  try {
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: TIMER_FLOOR_KEY },
      select: { valueEncrypted: true }
    });
    const value = row ? Number(row.valueEncrypted) : DEFAULT_TIMER_FLOOR_MINUTES;
    cachedFloor = Number.isFinite(value)
      ? Math.min(TIMER_FLOOR_BOUNDS.max, Math.max(TIMER_FLOOR_BOUNDS.min, Math.round(value)))
      : DEFAULT_TIMER_FLOOR_MINUTES;
    cachedFloorAt = Date.now();
    return cachedFloor;
  } catch {
    return cachedFloor ?? DEFAULT_TIMER_FLOOR_MINUTES;
  }
}

export async function saveTimerFloorMinutes(value: number, updatedByUserId: string): Promise<number> {
  const safe = Number.isFinite(value)
    ? Math.min(TIMER_FLOOR_BOUNDS.max, Math.max(TIMER_FLOOR_BOUNDS.min, Math.round(value)))
    : DEFAULT_TIMER_FLOOR_MINUTES;
  await prisma.platformApiSetting.upsert({
    where: { key: TIMER_FLOOR_KEY },
    update: { valueEncrypted: String(safe), secret: false, updatedByUserId },
    create: { key: TIMER_FLOOR_KEY, valueEncrypted: String(safe), secret: false, updatedByUserId }
  });
  invalidateTimerFloorCache();
  return safe;
}

/* --------------------------- Send email: the cannon guard ------------------ */

export const EMAIL_PER_RUN_KEY = "emailMaxPerRun";

/** A Loop plus a hand is a cannon. Twenty-five mails in one run is already a
 *  campaign, not a notification — and campaigns deserve their own product. */
export const DEFAULT_EMAIL_PER_RUN = declared("emailMaxPerRun")?.value ?? 25;
export const EMAIL_PER_RUN_BOUNDS = {
  min: declared("emailMaxPerRun")?.min ?? 1,
  max: declared("emailMaxPerRun")?.max ?? 200
};

let cachedEmailCap: number | null = null;
let cachedEmailCapAt = 0;

export function invalidateEmailCapCache(): void {
  cachedEmailCap = null;
  cachedEmailCapAt = 0;
}

export async function getEmailPerRunLimit(): Promise<number> {
  if (cachedEmailCap !== null && Date.now() - cachedEmailCapAt < CACHE_TTL_MS) return cachedEmailCap;
  try {
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: EMAIL_PER_RUN_KEY },
      select: { valueEncrypted: true }
    });
    const value = row ? Number(row.valueEncrypted) : DEFAULT_EMAIL_PER_RUN;
    cachedEmailCap = Number.isFinite(value)
      ? Math.min(EMAIL_PER_RUN_BOUNDS.max, Math.max(EMAIL_PER_RUN_BOUNDS.min, Math.round(value)))
      : DEFAULT_EMAIL_PER_RUN;
    cachedEmailCapAt = Date.now();
    return cachedEmailCap;
  } catch {
    return cachedEmailCap ?? DEFAULT_EMAIL_PER_RUN;
  }
}

export async function saveEmailPerRunLimit(value: number, updatedByUserId: string): Promise<number> {
  const safe = Number.isFinite(value)
    ? Math.min(EMAIL_PER_RUN_BOUNDS.max, Math.max(EMAIL_PER_RUN_BOUNDS.min, Math.round(value)))
    : DEFAULT_EMAIL_PER_RUN;
  await prisma.platformApiSetting.upsert({
    where: { key: EMAIL_PER_RUN_KEY },
    update: { valueEncrypted: String(safe), secret: false, updatedByUserId },
    create: { key: EMAIL_PER_RUN_KEY, valueEncrypted: String(safe), secret: false, updatedByUserId }
  });
  invalidateEmailCapCache();
  return safe;
}

/* ---------------------- Timer: the longest patience ------------------------ */

export const TIMER_MAX_HOLD_KEY = "timerMaxHoldDays";

/** A week: long enough for any honest follow-up, short enough that a held
 *  conversation is never a surprise from a forgotten month. */
export const DEFAULT_TIMER_MAX_HOLD_DAYS = declared("timerMaxHoldDays")?.value ?? 7;
export const TIMER_MAX_HOLD_BOUNDS = {
  min: declared("timerMaxHoldDays")?.min ?? 1,
  max: declared("timerMaxHoldDays")?.max ?? 30
};

let cachedHold: number | null = null;
let cachedHoldAt = 0;

export function invalidateTimerHoldCache(): void {
  cachedHold = null;
  cachedHoldAt = 0;
}

export async function getTimerMaxHoldDays(): Promise<number> {
  if (cachedHold !== null && Date.now() - cachedHoldAt < CACHE_TTL_MS) return cachedHold;
  try {
    const row = await prisma.platformApiSetting.findUnique({
      where: { key: TIMER_MAX_HOLD_KEY },
      select: { valueEncrypted: true }
    });
    const value = row ? Number(row.valueEncrypted) : DEFAULT_TIMER_MAX_HOLD_DAYS;
    cachedHold = Number.isFinite(value)
      ? Math.min(TIMER_MAX_HOLD_BOUNDS.max, Math.max(TIMER_MAX_HOLD_BOUNDS.min, Math.round(value)))
      : DEFAULT_TIMER_MAX_HOLD_DAYS;
    cachedHoldAt = Date.now();
    return cachedHold;
  } catch {
    return cachedHold ?? DEFAULT_TIMER_MAX_HOLD_DAYS;
  }
}

export async function saveTimerMaxHoldDays(value: number, updatedByUserId: string): Promise<number> {
  const safe = Number.isFinite(value)
    ? Math.min(TIMER_MAX_HOLD_BOUNDS.max, Math.max(TIMER_MAX_HOLD_BOUNDS.min, Math.round(value)))
    : DEFAULT_TIMER_MAX_HOLD_DAYS;
  await prisma.platformApiSetting.upsert({
    where: { key: TIMER_MAX_HOLD_KEY },
    update: { valueEncrypted: String(safe), secret: false, updatedByUserId },
    create: { key: TIMER_MAX_HOLD_KEY, valueEncrypted: String(safe), secret: false, updatedByUserId }
  });
  invalidateTimerHoldCache();
  return safe;
}
