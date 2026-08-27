import { Redis } from "ioredis";
import { env } from "../../config/env";

/**
 * Rate limiting for public agent-page usage: per IP+slug daily limit, a
 * platform-wide daily cap (cost control), and a short per-IP burst cap.
 * Counters live in Redis when REDIS_URL is configured so they survive
 * restarts and multiple instances; otherwise an in-memory fallback.
 *
 * Consumption is increment-first (INCR is atomic per key), then the returned
 * values are compared against the caps — concurrent requests can never all
 * observe a stale count and slip past a limit together. A denied request
 * decrements what it incremented so denials never burn quota (an attacker
 * hammering a denied IP must not inflate the platform-wide counter).
 */

/** Per-minute burst cap per IP across all agent pages. */
export const AGENT_PAGE_BURST_LIMIT_PER_MINUTE = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const memoryCounters = new Map<string, { count: number; expiresAt: number }>();

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  if (!env.REDIS_URL) {
    redisClient = null;
    return null;
  }

  try {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false
    });
    redisClient.on("error", (error) => {
      console.warn("[agent-pages] redis error (falling back to memory)", error.message);
    });
  } catch (error) {
    console.warn("[agent-pages] redis init failed (memory fallback)", error);
    redisClient = null;
  }

  return redisClient;
}

function dayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

function minuteBucket(): string {
  return new Date().toISOString().slice(0, 16);
}

function ipDayKey(clientIp: string, slug: string): string {
  return `agent-page:day:${dayBucket()}:ip:${clientIp}:slug:${slug}`;
}

function globalDayKey(): string {
  return `agent-page:day:${dayBucket()}:global`;
}

function burstKey(clientIp: string): string {
  return `agent-page:minute:${minuteBucket()}:ip:${clientIp}`;
}

function memoryCount(key: string): number {
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    memoryCounters.delete(key);
    return 0;
  }
  return entry.count;
}

function memoryIncrementAndGet(key: string, ttlMs: number): number {
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    memoryCounters.set(key, { count: 1, expiresAt: Date.now() + ttlMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function memoryDecrement(key: string): void {
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < Date.now()) return;
  entry.count = Math.max(0, entry.count - 1);
}

type CounterKey = { key: string; ttlSeconds: number };

function counterKeys(clientIp: string, slug: string): [CounterKey, CounterKey, CounterKey] {
  return [
    { key: ipDayKey(clientIp, slug), ttlSeconds: DAY_MS / 1000 },
    { key: globalDayKey(), ttlSeconds: DAY_MS / 1000 },
    { key: burstKey(clientIp), ttlSeconds: MINUTE_MS / 1000 }
  ];
}

/**
 * Atomically increment every counter and return the post-increment values.
 * Plain EXPIRE (not "NX") keeps Redis 6 compatible; the keys are date/minute
 * bucketed, so refreshing the TTL on each hit never extends a limit window.
 */
async function incrementCounts(keys: [CounterKey, CounterKey, CounterKey]): Promise<[number, number, number]> {
  const redis = getRedis();

  if (redis) {
    try {
      const multi = redis.multi();
      for (const { key, ttlSeconds } of keys) {
        multi.incr(key);
        multi.expire(key, ttlSeconds);
      }
      const results = await multi.exec();
      if (results) {
        const values = [0, 2, 4].map((index) => {
          const [error, value] = results[index] ?? [null, null];
          if (error || typeof value !== "number") throw error ?? new Error("INCR returned no count");
          return value;
        });
        return values as [number, number, number];
      }
    } catch {
      // Redis down — degrade to the in-memory counters below.
    }
  }

  return keys.map(({ key, ttlSeconds }) => memoryIncrementAndGet(key, ttlSeconds * 1000)) as [
    number,
    number,
    number
  ];
}

async function decrementCounts(keys: readonly CounterKey[]): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      /* A COUNTER MUST NEVER GO BELOW ZERO. A bare DECR on a key that was
         never incremented creates it at -1, with no expiry — and the platform
         key is compared against a daily ceiling, so one stray refund quietly
         bought the whole platform an extra free run that never expires.
         Decrement only a key that exists, and never past zero. */
      const floorAtZero = `
        local current = redis.call('GET', KEYS[1])
        if current == false then return 0 end
        local value = tonumber(current)
        if value == nil or value <= 0 then return 0 end
        return redis.call('DECR', KEYS[1])
      `;
      await Promise.all(keys.map(({ key }) => redis.eval(floorAtZero, 1, key)));
      return;
    } catch {
      // Redis down — mirror the decrement in memory.
    }
  }

  for (const { key } of keys) memoryDecrement(key);
}

async function readCounts(keys: string[]): Promise<number[]> {
  const redis = getRedis();

  if (redis) {
    try {
      const values = await redis.mget(...keys);
      return values.map((value) => Number(value ?? 0));
    } catch {
      // Redis down — degrade to the in-memory counters below.
    }
  }

  return keys.map((key) => memoryCount(key));
}

export type AgentPageLimitDecision = {
  allowed: boolean;
  /** Uses left for this IP on this page today (after this use when allowed). */
  remainingToday: number;
};

/** Uses left today for this IP on this page — for the public page payload. */
export async function agentPageRemainingToday(clientIp: string, slug: string): Promise<number> {
  const [ipCount] = await readCounts([ipDayKey(clientIp, slug)]);
  return Math.max(0, env.AGENT_PAGE_DAILY_LIMIT - (ipCount ?? 0));
}

/**
 * Consume one use: increment every cap atomically, then compare the returned
 * counts. On denial the increments are rolled back so a denied request never
 * eats into any quota. Callers treat a denial as 429 PAGE_LIMIT_REACHED
 * regardless of which cap tripped.
 */
export async function consumeAgentPageLimit(clientIp: string, slug: string): Promise<AgentPageLimitDecision> {
  const keys = counterKeys(clientIp, slug);
  const [ipCount, globalCount, burstCount] = await incrementCounts(keys);

  const allowed =
    ipCount <= env.AGENT_PAGE_DAILY_LIMIT &&
    globalCount <= env.AGENT_PAGE_GLOBAL_DAILY_LIMIT &&
    burstCount <= AGENT_PAGE_BURST_LIMIT_PER_MINUTE;

  if (!allowed) {
    await decrementCounts(keys);
    return {
      allowed: false,
      remainingToday: Math.max(0, env.AGENT_PAGE_DAILY_LIMIT - (ipCount - 1))
    };
  }

  return { allowed: true, remainingToday: Math.max(0, env.AGENT_PAGE_DAILY_LIMIT - ipCount) };
}

/**
 * Give back a consumed use after the platform failed to deliver (engine
 * error, broken workflow config) — visitors must not lose quota to our
 * failures. Only call after a successful consume.
 */
export async function refundAgentPageUse(clientIp: string, slug: string): Promise<void> {
  await decrementCounts(counterKeys(clientIp, slug));
}

/** Exposed for tests: clears counters and re-resolves the Redis client. */
export function resetAgentPageRateLimits() {
  memoryCounters.clear();
  redisClient?.disconnect();
  redisClient = undefined;
}
