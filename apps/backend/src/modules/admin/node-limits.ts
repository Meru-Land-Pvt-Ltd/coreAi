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
export const DEFAULT_LOOP_ROUNDS = 25;
export const LOOP_ROUNDS_BOUNDS = { min: 1, max: 100 } as const;

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
export const DEFAULT_TIMER_FLOOR_MINUTES = 60;
export const TIMER_FLOOR_BOUNDS = { min: 15, max: 1440 } as const;

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
export const DEFAULT_EMAIL_PER_RUN = 25;
export const EMAIL_PER_RUN_BOUNDS = { min: 1, max: 200 } as const;

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
