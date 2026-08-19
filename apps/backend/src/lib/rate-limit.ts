/**
 * A counter with a deadline — the one every public endpoint should use.
 *
 * The agent-page limiter (modules/agent-pages/rate-limit.ts) already does this
 * well for its own case, but it is shaped around pages and slugs, so other
 * public endpoints shipped with no limit at all. The public booking form was
 * the worst of them: no limit, no captcha, no body cap, and it sends a text
 * message on every request. That is a stranger's phone bill and a stranger's
 * phone, both charged to the business.
 *
 * Increment first, then compare. INCR is atomic, so two requests arriving
 * together can never both read a stale count and slip through. A denied
 * request gives its increment back, so hammering a blocked key cannot inflate
 * the counter for everyone else.
 *
 * Redis when it is configured, memory when it is not. The memory fallback is
 * honest rather than perfect: it is per-process and resets on deploy, which is
 * fine for a second line of defence and clearly worse than Redis for a first.
 */

import { Redis } from "ioredis";
import { env } from "../config/env";

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
      console.warn("[rate-limit] redis error (falling back to memory)", error.message);
    });
  } catch (error) {
    console.warn("[rate-limit] redis init failed (memory fallback)", error);
    redisClient = null;
  }
  return redisClient;
}

function sweepMemory(now: number): void {
  if (memoryCounters.size < 5000) return;
  for (const [key, entry] of memoryCounters) {
    if (entry.expiresAt <= now) memoryCounters.delete(key);
  }
}

async function bump(key: string, windowMs: number, by: number): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.incrby(key, by);
      if (value === by) await redis.pexpire(key, windowMs);
      return value;
    } catch (error) {
      console.warn("[rate-limit] redis unavailable, using memory", (error as Error).message);
    }
  }

  const now = Date.now();
  sweepMemory(now);
  const existing = memoryCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(key, { count: by, expiresAt: now + windowMs });
    return by;
  }
  existing.count += by;
  return existing.count;
}

export type LimitDecision = {
  allowed: boolean;
  used: number;
  limit: number;
  /** Ready to show a person — never mentions the rule that caught them. */
  message: string;
};

/**
 * Take one unit from a bucket.
 *
 * `label` becomes part of the key, so the same identity can be limited
 * separately per concern (per IP, per phone, per business) without the buckets
 * colliding.
 */
export async function consumeLimit(args: {
  key: string;
  limit: number;
  windowMs: number;
  message?: string;
}): Promise<LimitDecision> {
  const used = await bump(`rl:${args.key}`, args.windowMs, 1);

  if (used > args.limit) {
    // Give it back: a blocked caller must not push the counter further and
    // punish the next honest person to share their address.
    await bump(`rl:${args.key}`, args.windowMs, -1);
    return {
      allowed: false,
      used: args.limit,
      limit: args.limit,
      message: args.message ?? "That's a few too many for now. Please try again shortly."
    };
  }

  return { allowed: true, used, limit: args.limit, message: "" };
}

/**
 * Take one unit from several buckets at once, refunding on the first failure.
 *
 * Public endpoints usually need more than one rule — per address, per phone
 * number, and per business so one business's page can never run up another's
 * bill. Written as one call so a route cannot accidentally check the cheap
 * rule and forget the expensive one.
 */
export async function consumeAll(
  buckets: Array<{ key: string; limit: number; windowMs: number; message?: string }>
): Promise<LimitDecision> {
  const taken: typeof buckets = [];

  for (const bucket of buckets) {
    const decision = await consumeLimit(bucket);
    if (!decision.allowed) {
      for (const done of taken) await bump(`rl:${done.key}`, done.windowMs, -1);
      return decision;
    }
    taken.push(bucket);
  }

  return { allowed: true, used: 0, limit: 0, message: "" };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
