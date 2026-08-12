import { getSharedRedis } from "../../../lib/redis";
import type { ExecutionMode, VoiceCallSessionState } from "./types";

const SESSION_TTL_SECONDS = 86400; // 24 hours
const memoryStore = new Map<string, VoiceCallSessionState>();

export function getV2SessionKey(businessId: string, callId: string): string {
  return `call-session:v2:${businessId}:${callId}`;
}

export function getV1SessionKey(businessId: string, callId: string): string {
  return `call-session:${businessId}:${callId}`;
}

export function createDefaultSessionState(
  businessId: string,
  callId: string,
  options?: {
    installedAgentId?: string;
    conversationId?: string;
    customerPhone?: string;
    executionMode?: ExecutionMode;
    timeZone?: string;
  }
): VoiceCallSessionState {
  return {
    businessId,
    callId,
    installedAgentId: options?.installedAgentId,
    conversationId: options?.conversationId,
    customerPhone: options?.customerPhone,
    executionMode: options?.executionMode ?? "LIVE",
    timeZone: options?.timeZone ?? "UTC",
    bookingState: "IDLE",
    smsConsentState: "UNKNOWN",
    verificationState: "UNVERIFIED",
    approvalState: "NONE",
    transferState: "NONE",
    updatedAt: new Date().toISOString(),
    version: "v2"
  };
}

export async function getVoiceSession(
  businessId: string,
  callId: string,
  fallbackOptions?: {
    installedAgentId?: string;
    conversationId?: string;
    customerPhone?: string;
    executionMode?: ExecutionMode;
    timeZone?: string;
  }
): Promise<VoiceCallSessionState> {
  const redis = getSharedRedis();
  const v2Key = getV2SessionKey(businessId, callId);

  if (redis) {
    try {
      const v2Raw = await redis.get(v2Key);
      if (v2Raw) {
        const parsed = JSON.parse(v2Raw) as VoiceCallSessionState;
        if (parsed && parsed.version === "v2") {
          return parsed;
        }
      }

      // Check legacy v1 session
      const v1Key = getV1SessionKey(businessId, callId);
      const v1Raw = await redis.get(v1Key);
      if (v1Raw) {
        const legacyState = JSON.parse(v1Raw) as Record<string, unknown>;
        const normalized = normalizeV1StateToV2(businessId, callId, legacyState, fallbackOptions);
        await saveVoiceSession(normalized);
        return normalized;
      }
    } catch (error) {
      console.error("[voice-session] redis read failed, using fallback memory", error);
    }
  }

  // Memory fallback
  const cached = memoryStore.get(v2Key);
  if (cached) return cached;

  const fresh = createDefaultSessionState(businessId, callId, fallbackOptions);
  await saveVoiceSession(fresh);
  return fresh;
}

export async function saveVoiceSession(session: VoiceCallSessionState): Promise<void> {
  const updated: VoiceCallSessionState = {
    ...session,
    updatedAt: new Date().toISOString(),
    version: "v2"
  };

  const redis = getSharedRedis();
  const v2Key = getV2SessionKey(session.businessId, session.callId);

  if (redis) {
    try {
      await redis.set(v2Key, JSON.stringify(updated), "EX", SESSION_TTL_SECONDS);
      return;
    } catch (error) {
      console.error("[voice-session] redis write failed, saving to memory fallback", error);
    }
  }

  memoryStore.set(v2Key, updated);
}

export async function updateVoiceSessionState(
  businessId: string,
  callId: string,
  patch: Partial<VoiceCallSessionState>
): Promise<VoiceCallSessionState> {
  const current = await getVoiceSession(businessId, callId);
  const updated: VoiceCallSessionState = {
    ...current,
    ...patch,
    businessId,
    callId,
    version: "v2",
    updatedAt: new Date().toISOString()
  };

  await saveVoiceSession(updated);
  return updated;
}

export async function clearVoiceSession(businessId: string, callId: string): Promise<void> {
  const redis = getSharedRedis();
  const v2Key = getV2SessionKey(businessId, callId);
  const v1Key = getV1SessionKey(businessId, callId);

  if (redis) {
    try {
      await redis.del(v2Key, v1Key);
    } catch (error) {
      console.error("[voice-session] redis delete failed", error);
    }
  }

  memoryStore.delete(v2Key);
  memoryStore.delete(v1Key);
}

function normalizeV1StateToV2(
  businessId: string,
  callId: string,
  v1State: Record<string, unknown>,
  fallbackOptions?: {
    installedAgentId?: string;
    conversationId?: string;
    customerPhone?: string;
    executionMode?: ExecutionMode;
    timeZone?: string;
  }
): VoiceCallSessionState {
  const defaultState = createDefaultSessionState(businessId, callId, fallbackOptions);

  return {
    ...defaultState,
    installedAgentId: (v1State.installedAgentId as string) || defaultState.installedAgentId,
    customerPhone: (v1State.customerPhone as string) || (v1State.patientPhone as string) || defaultState.customerPhone,
    requestedService: (v1State.requestedService as string) || (v1State.service as string) || undefined,
    confirmedDate: (v1State.confirmedDate as string) || (v1State.date as string) || undefined,
    confirmedTime: (v1State.confirmedTime as string) || (v1State.time as string) || undefined,
    bookingState: v1State.bookingState === "CONFIRMED" ? "CONFIRMED" : defaultState.bookingState,
    smsConsentState: v1State.smsConsentState === "GRANTED" ? "GRANTED" : v1State.smsConsentState === "DENIED" ? "DENIED" : defaultState.smsConsentState
  };
}
