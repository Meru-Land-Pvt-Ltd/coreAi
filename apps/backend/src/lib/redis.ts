import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config/env";

const BASE_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: 2,
  connectTimeout: 10_000,
  enableOfflineQueue: true,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 200, 2000)
};

let shared: Redis | null | undefined;

export function getSharedRedis(): Redis | null {
  if (shared !== undefined) return shared;
  if (!env.REDIS_URL) {
    shared = null;
    return shared;
  }

  const client = new Redis(env.REDIS_URL, BASE_OPTIONS);
  // Never log the URL/credentials — only the health transitions.
  client.on("error", (error) => {
    console.error("[redis] connection error", { message: error instanceof Error ? error.message : String(error) });
  });
  client.on("ready", () => console.log("[redis] ready"));
  client.on("reconnecting", () => console.warn("[redis] reconnecting"));
  client.on("end", () => console.warn("[redis] connection ended"));
  // Pre-warm so the first store command doesn't race the connect handshake.
  client.connect().catch((error) => {
    console.error("[redis] initial connect failed", {
      message: error instanceof Error ? error.message : String(error)
    });
  });
  shared = client;
  return shared;
}

/** Configuration presence (REDIS_URL set) — NOT a health signal. */
export function sharedRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

/** True only when the shared connection is genuinely READY right now. */
export function sharedRedisReady(): boolean {
  const client = getSharedRedis();
  return Boolean(client && client.status === "ready");
}

/** Test hook: drop the shared client so the next getSharedRedis() rebuilds it. */
export function resetSharedRedisForTests(): void {
  if (shared) {
    try {
      shared.disconnect();
    } catch {
      // already disconnected
    }
  }
  shared = undefined;
}
