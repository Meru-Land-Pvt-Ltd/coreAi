import { Redis } from "ioredis";
import {
  AFTER_HOURS_POLICY_VERSION,
  type AfterHoursLiveCallState,
  type StaffNotificationStatus
} from "@coreai/shared";
import { env, isProduction } from "../../config/env";

const CALL_STATE_TTL_SECONDS = 12 * 60 * 60;

function storeKey(businessId: string, callId: string): string {
  return `after-hours-call:${businessId}:${callId}:${AFTER_HOURS_POLICY_VERSION}`;
}

let redis: Redis | null | undefined;

export class AfterHoursStateStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AfterHoursStateStoreUnavailableError";
  }
}

function redisClient(): Redis | null {
  if (redis !== undefined) return redis;

  if (!env.REDIS_URL) {
    redis = null;
    return redis;
  }

  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false
  });
  redis.on("error", (error) => {
    console.error("[after-hours-call-state] redis error", error instanceof Error ? error.message : error);
  });
  // Pre-warm so readiness reflects a REAL connection, not just a configured
  // URL — Boolean(REDIS_URL) is configuration, `status === "ready"` is health.
  redis.connect().catch((error) => {
    console.error("[after-hours-call-state] redis connect failed", error instanceof Error ? error.message : error);
  });
  return redis;
}

export function afterHoursCallStateStoreIsDistributed(): boolean {
  return Boolean(env.REDIS_URL);
}

/** True only when the Redis connection is genuinely READY right now. */
export function afterHoursStateStoreReady(): boolean {
  const client = redisClient();
  return Boolean(client && client.status === "ready");
}

/**
 * Pure availability rule (exported for tests): production requires a
 * configured AND genuinely ready distributed store; development/test may use
 * the in-process memory fallback.
 */
export function isAfterHoursStoreSafeForLive(params: {
  distributed: boolean;
  production: boolean;
  ready: boolean;
}): boolean {
  if (!params.production) return true;
  return params.distributed && params.ready;
}

export function afterHoursStateStoreAvailableForLive(): boolean {
  return isAfterHoursStoreSafeForLive({
    distributed: afterHoursCallStateStoreIsDistributed(),
    production: isProduction,
    ready: afterHoursStateStoreReady()
  });
}

const memoryStore = new Map<string, { expiresAtMs: number; value: AfterHoursLiveCallState }>();

function pruneMemoryStore(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAtMs <= now) memoryStore.delete(key);
  }
}

function parseState(raw: string | null): AfterHoursLiveCallState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AfterHoursLiveCallState;
    return parsed && typeof parsed === "object" && typeof parsed.route === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function readAfterHoursCallState(
  businessId: string,
  callId: string
): Promise<AfterHoursLiveCallState | null> {
  const key = storeKey(businessId, callId);
  const client = redisClient();

  if (client) {
    try {
      return parseState(await client.get(key));
    } catch (error) {
      // PRODUCTION never degrades to per-process memory — that would let two
      // backend instances hold divergent safety state. Fail closed instead.
      if (isProduction) {
        throw new AfterHoursStateStoreUnavailableError(
          `redis get failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      console.error("[after-hours-call-state] redis get failed — using memory fallback (non-production)", error);
    }
  } else if (isProduction) {
    throw new AfterHoursStateStoreUnavailableError("redis not configured in production");
  }

  pruneMemoryStore();
  const entry = memoryStore.get(key);
  return entry && entry.expiresAtMs > Date.now() ? entry.value : null;
}

export async function writeAfterHoursCallState(
  businessId: string,
  callId: string,
  state: AfterHoursLiveCallState
): Promise<void> {
  const key = storeKey(businessId, callId);
  const client = redisClient();

  if (client) {
    try {
      await client.set(key, JSON.stringify(state), "EX", CALL_STATE_TTL_SECONDS);
      return;
    } catch (error) {
      if (isProduction) {
        throw new AfterHoursStateStoreUnavailableError(
          `redis set failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      console.error("[after-hours-call-state] redis set failed — using memory fallback (non-production)", error);
    }
  } else if (isProduction) {
    throw new AfterHoursStateStoreUnavailableError("redis not configured in production");
  }

  pruneMemoryStore();
  memoryStore.set(key, { expiresAtMs: Date.now() + CALL_STATE_TTL_SECONDS * 1000, value: state });
}

/** Called when the Vapi call ends — the TTL remains the backstop. */
export async function clearAfterHoursCallState(businessId: string, callId: string): Promise<void> {
  const key = storeKey(businessId, callId);
  const client = redisClient();

  if (client) {
    try {
      await client.del(key);
    } catch {
      // TTL remains the backstop.
    }
  }
  memoryStore.delete(key);
}

/** Persist only the staff-notification lifecycle without touching the route. */
export async function updateAfterHoursStaffNotificationStatus(
  businessId: string,
  callId: string,
  status: StaffNotificationStatus
): Promise<void> {
  const existing = await readAfterHoursCallState(businessId, callId);
  if (!existing) return;
  await writeAfterHoursCallState(businessId, callId, {
    ...existing,
    staffNotificationStatus: status,
    updatedAt: new Date().toISOString()
  });
}

/** Test hook: clear memory state and re-resolve the client (marketplace-demo pattern). */
export function resetAfterHoursCallStateStore(): void {
  memoryStore.clear();
  if (redis) {
    try {
      redis.disconnect();
    } catch {
      // already disconnected
    }
  }
  redis = undefined;
}
