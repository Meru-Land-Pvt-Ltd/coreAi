import { getSharedRedis, sharedRedisConfigured } from "../../lib/redis";

const OFFER_TTL_SECONDS = 12 * 60 * 60;

export type ConsentOfferKey = {
  businessId: string;
  callId: string;
  disclosureVersion: string;
};

function storeKey(key: ConsentOfferKey): string {
  return `sms-consent-offer:${key.businessId}:${key.callId}:${key.disclosureVersion}`;
}

function redisClient() {
  return getSharedRedis();
}

export function consentOfferStoreIsDistributed(): boolean {
  return sharedRedisConfigured();
}

const memoryStore = new Map<string, number>();

function pruneMemoryStore(now: number): void {
  for (const [key, expiresAt] of memoryStore) {
    if (expiresAt <= now) memoryStore.delete(key);
  }
}

export async function markConsentOffered(key: ConsentOfferKey): Promise<void> {
  const client = redisClient();
  if (client) {
    try {
      await client.set(storeKey(key), "1", "EX", OFFER_TTL_SECONDS);
      return;
    } catch (error) {
      console.error("[consent-offer-store] redis set failed — using memory fallback", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const now = Date.now();
  pruneMemoryStore(now);
  memoryStore.set(storeKey(key), now + OFFER_TTL_SECONDS * 1000);
}

export async function wasConsentOffered(key: ConsentOfferKey): Promise<boolean> {
  const client = redisClient();
  if (client) {
    try {
      if ((await client.get(storeKey(key))) === "1") return true;
    } catch (error) {
      console.error("[consent-offer-store] redis get failed — using memory fallback", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const now = Date.now();
  pruneMemoryStore(now);
  const expiresAt = memoryStore.get(storeKey(key));
  return typeof expiresAt === "number" && expiresAt > now;
}

/** Terminal transition (OPTED_IN/DECLINED recorded): the offer marker is spent. */
export async function clearConsentOffer(key: ConsentOfferKey): Promise<void> {
  const client = redisClient();
  if (client) {
    try {
      await client.del(storeKey(key));
    } catch {
      // TTL remains the backstop.
    }
  }
  memoryStore.delete(storeKey(key));
}
