import { Redis } from "ioredis";
import {
  AFTER_HOURS_POLICY_VERSION,
  type AfterHoursLiveCallState,
  type StaffNotificationStatus
} from "@coreai/shared";
import { env, isProduction } from "../../config/env";

const CALL_STATE_TTL_SECONDS = 12 * 60 * 60;
const REDIS_CONNECT_TIMEOUT_MS = 5_000;

function storeKey(businessId: string, callId: string): string {
  return `after-hours-call:${businessId}:${callId}:${AFTER_HOURS_POLICY_VERSION}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let redis: Redis | null | undefined;

export class AfterHoursStateStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AfterHoursStateStoreUnavailableError";
  }
}

export type AfterHoursRedisAdapter = {
  readonly status: string;

  get(key: string): Promise<string | null>;

  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number
  ): Promise<unknown>;

  del(key: string): Promise<unknown>;

  ping?(): Promise<string>;
};

let adapterOverride: AfterHoursRedisAdapter | null | undefined;
let adapterOverrideActive = false;

let productionOverride: boolean | null = null;

export function setAfterHoursRedisAdapterForTests(
  adapter: AfterHoursRedisAdapter | null | undefined
): void {
  adapterOverrideActive = adapter !== undefined;
  adapterOverride = adapter;
}

export function setAfterHoursProductionModeForTests(
  value: boolean | null
): void {
  productionOverride = value;
}

function effectiveProduction(): boolean {
  return productionOverride ?? isProduction;
}

function redisClient(): AfterHoursRedisAdapter | null {
  if (adapterOverrideActive) {
    return adapterOverride ?? null;
  }

  if (redis !== undefined) {
    return redis;
  }

  if (!env.REDIS_URL) {
    redis = null;
    return null;
  }

  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,

    lazyConnect: false,

    enableOfflineQueue: true
  });

  redis.on("ready", () => {
    console.info("[after-hours-call-state] redis ready");
  });

  redis.on("reconnecting", (delay: number) => {
    console.warn(
      `[after-hours-call-state] redis reconnecting in ${delay}ms`
    );
  });

  redis.on("error", (error) => {
    console.error(
      "[after-hours-call-state] redis error",
      errorMessage(error)
    );
  });

  redis.on("end", () => {
    console.warn("[after-hours-call-state] redis connection ended");
  });

  return redis;
}

export function afterHoursCallStateStoreIsDistributed(): boolean {
  if (adapterOverrideActive) {
    return adapterOverride !== null;
  }

  return Boolean(env.REDIS_URL);
}

export function afterHoursStateStoreReady(): boolean {
  const client = redisClient();
  return Boolean(client && client.status === "ready");
}

export async function probeAfterHoursStateStore(): Promise<{
  distributed: boolean;
  production: boolean;
  connectionReady: boolean;
  pingOk: boolean;
  ready: boolean;
  safeForLive: boolean;
}> {
  const distributed = afterHoursCallStateStoreIsDistributed();
  const production = effectiveProduction();
  const client = redisClient();

  const connectionReady = Boolean(client && client.status === "ready");

  let pingOk = false;

  if (client && connectionReady) {
    try {
      if (typeof client.ping === "function") {
        const pong = await client.ping();

        pingOk =
          typeof pong === "string" &&
          pong.toUpperCase().includes("PONG");
      } else {
        // Compatibility for minimal test adapters without ping().
        pingOk = true;
      }
    } catch (error) {
      console.error(
        "[after-hours-call-state] redis health probe failed",
        errorMessage(error)
      );

      pingOk = false;
    }
  }

  const ready = connectionReady && pingOk;

  return {
    distributed,
    production,
    connectionReady,
    pingOk,
    ready,
    safeForLive: isAfterHoursStoreSafeForLive({
      distributed,
      production,
      ready
    })
  };
}

export function isAfterHoursStoreSafeForLive(params: {
  distributed: boolean;
  production: boolean;
  ready: boolean;
}): boolean {
  if (!params.production) {
    return true;
  }

  return params.distributed && params.ready;
}

export function afterHoursStateStoreAvailableForLive(): boolean {
  if (!effectiveProduction()) {
    return true;
  }

  return afterHoursCallStateStoreIsDistributed();
}

const memoryStore = new Map<
  string,
  {
    expiresAtMs: number;
    value: AfterHoursLiveCallState;
  }
>();

function pruneMemoryStore(): void {
  const now = Date.now();

  for (const [key, entry] of memoryStore) {
    if (entry.expiresAtMs <= now) {
      memoryStore.delete(key);
    }
  }
}

function parseState(
  raw: string | null
): AfterHoursLiveCallState | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AfterHoursLiveCallState;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.route !== "string"
    ) {
      return null;
    }

    return parsed;
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
      const raw = await client.get(key);
      return parseState(raw);
    } catch (error) {
      if (effectiveProduction()) {
        throw new AfterHoursStateStoreUnavailableError(
          `redis get failed: ${errorMessage(error)}`
        );
      }

      console.error(
        "[after-hours-call-state] redis get failed — using memory fallback in non-production",
        errorMessage(error)
      );
    }
  } else if (effectiveProduction()) {
    throw new AfterHoursStateStoreUnavailableError(
      "redis not configured in production"
    );
  }

  pruneMemoryStore();

  const entry = memoryStore.get(key);

  if (!entry || entry.expiresAtMs <= Date.now()) {
    return null;
  }

  return entry.value;
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
      await client.set(
        key,
        JSON.stringify(state),
        "EX",
        CALL_STATE_TTL_SECONDS
      );

      return;
    } catch (error) {
      if (effectiveProduction()) {
        throw new AfterHoursStateStoreUnavailableError(
          `redis set failed: ${errorMessage(error)}`
        );
      }

      console.error(
        "[after-hours-call-state] redis set failed — using memory fallback in non-production",
        errorMessage(error)
      );
    }
  } else if (effectiveProduction()) {
    throw new AfterHoursStateStoreUnavailableError(
      "redis not configured in production"
    );
  }

  pruneMemoryStore();

  memoryStore.set(key, {
    expiresAtMs:
      Date.now() + CALL_STATE_TTL_SECONDS * 1_000,
    value: state
  });
}

export async function clearAfterHoursCallState(
  businessId: string,
  callId: string
): Promise<void> {
  const key = storeKey(businessId, callId);
  const client = redisClient();

  if (client) {
    try {
      await client.del(key);
    } catch (error) {
      console.warn(
        "[after-hours-call-state] redis delete failed; TTL remains the backstop",
        errorMessage(error)
      );
    }
  }

  memoryStore.delete(key);
}

export async function updateAfterHoursStaffNotificationStatus(
  businessId: string,
  callId: string,
  status: StaffNotificationStatus
): Promise<void> {
  const existing = await readAfterHoursCallState(
    businessId,
    callId
  );

  if (!existing) {
    return;
  }

  await writeAfterHoursCallState(
    businessId,
    callId,
    {
      ...existing,
      staffNotificationStatus: status,
      updatedAt: new Date().toISOString()
    }
  );
}

export function resetAfterHoursCallStateStore(): void {
  memoryStore.clear();

  if (redis) {
    try {
      redis.disconnect();
    } catch {
      // The client was already disconnected.
    }
  }

  redis = undefined;
  adapterOverride = undefined;
  adapterOverrideActive = false;
  productionOverride = null;
}