import { getSharedRedis, sharedRedisConfigured, sharedRedisReady } from "../../lib/redis";
import { isProduction } from "../../config/env";

export type CallPhoneSource = "confirmed" | "caller_id" | "supplied";
const PHONE_SOURCE_RANK: Record<CallPhoneSource, number> = { confirmed: 3, caller_id: 2, supplied: 1 };

export type CanonicalCallContact = {
  customerName?: string;
  canonicalPhoneE164?: string;
  phoneSource?: CallPhoneSource;
  phoneConfirmedAt?: number;
  appointmentId?: string;
  smsRecipientE164?: string;
  /** A corrected number validated in update_appointment_contact:prepare, awaiting commit. */
  pendingCorrectedPhoneE164?: string;
  expiresAt: number;
};

export type CallContactPatch = {
  customerName?: string;
  canonicalPhoneE164?: string;
  phoneSource?: CallPhoneSource;
  appointmentId?: string;
  smsRecipientE164?: string;
  pendingCorrectedPhoneE164?: string | null;
};

const TTL_SECONDS = 6 * 60 * 60;

export class CallStateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallStateUnavailableError";
  }
}

function storeKey(businessId: string, callId: string): string {
  return `call-contact:${businessId}:${callId}`;
}

export function callStateAvailableForLive(): boolean {
  if (!isProduction) return true;
  return sharedRedisConfigured() && sharedRedisReady();
}

const memory = new Map<string, CanonicalCallContact>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, value] of memory) {
    if (value.expiresAt <= now) memory.delete(key);
  }
}

function parse(raw: string | null): CanonicalCallContact | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CanonicalCallContact;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readRaw(businessId: string, callId: string): Promise<CanonicalCallContact | null> {
  const key = storeKey(businessId, callId);
  const client = getSharedRedis();
  if (client) {
    try {
      return parse(await client.get(key));
    } catch (error) {
      if (isProduction) {
        throw new CallStateUnavailableError(
          `redis get failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      // dev/test only
    }
  } else if (isProduction) {
    throw new CallStateUnavailableError("redis not configured in production");
  }
  pruneMemory();
  const entry = memory.get(key);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

async function writeRaw(businessId: string, callId: string, value: CanonicalCallContact): Promise<void> {
  const key = storeKey(businessId, callId);
  const client = getSharedRedis();
  if (client) {
    try {
      await client.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
      return;
    } catch (error) {
      if (isProduction) {
        throw new CallStateUnavailableError(
          `redis set failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } else if (isProduction) {
    throw new CallStateUnavailableError("redis not configured in production");
  }
  pruneMemory();
  memory.set(key, value);
}

export async function readCallContact(
  businessId: string | undefined | null,
  callId: string | undefined | null
): Promise<CanonicalCallContact | null> {
  if (!businessId || !callId) return null;
  return readRaw(businessId, callId);
}

/** Merge a patch with source-precedence and persist. Returns the merged state. */
export async function updateCallContact(
  businessId: string | undefined | null,
  callId: string | undefined | null,
  patch: CallContactPatch
): Promise<CanonicalCallContact | null> {
  if (!businessId || !callId) return null;
  const existing = (await readRaw(businessId, callId)) ?? { expiresAt: 0 };

  const incomingPhone = patch.canonicalPhoneE164;
  const incomingSource: CallPhoneSource = patch.phoneSource ?? "supplied";
  let canonicalPhoneE164 = existing.canonicalPhoneE164;
  let phoneSource = existing.phoneSource;
  let phoneConfirmedAt = existing.phoneConfirmedAt;
  if (incomingPhone) {
    const existingRank = phoneSource ? PHONE_SOURCE_RANK[phoneSource] : 0;
    const replace =
      canonicalPhoneE164 !== incomingPhone ? PHONE_SOURCE_RANK[incomingSource] >= existingRank : true;
    if (replace) {
      canonicalPhoneE164 = incomingPhone;
      phoneSource = incomingSource;
      if (incomingSource === "confirmed") phoneConfirmedAt = Date.now();
    }
  }

  const next: CanonicalCallContact = {
    customerName: patch.customerName || existing.customerName,
    canonicalPhoneE164,
    phoneSource,
    phoneConfirmedAt,
    appointmentId: patch.appointmentId || existing.appointmentId,
    smsRecipientE164: patch.smsRecipientE164 || existing.smsRecipientE164 || canonicalPhoneE164,
    pendingCorrectedPhoneE164:
      patch.pendingCorrectedPhoneE164 === null
        ? undefined
        : patch.pendingCorrectedPhoneE164 || existing.pendingCorrectedPhoneE164,
    expiresAt: Date.now() + TTL_SECONDS * 1000
  };
  await writeRaw(businessId, callId, next);
  return next;
}

export async function clearCallContact(
  businessId: string | undefined | null,
  callId: string | undefined | null
): Promise<void> {
  if (!businessId || !callId) return;
  const key = storeKey(businessId, callId);
  const client = getSharedRedis();
  if (client) {
    try {
      await client.del(key);
    } catch {
      // TTL is the backstop.
    }
  }
  memory.delete(key);
}

/** Test hook: clear the in-memory fallback. */
export function resetCallContactStoreForTests(): void {
  memory.clear();
}
