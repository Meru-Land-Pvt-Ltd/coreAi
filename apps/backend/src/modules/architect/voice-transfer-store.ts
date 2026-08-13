import { prisma } from "../../lib/prisma";
import { getSharedRedis } from "../../lib/redis";

export interface VoiceTransferContext {
  twilioCallSid: string;
  businessId?: string | null;
  installedAgentId?: string | null;
  workflowId?: string | null;
  /** The business's own Twilio number the customer dialed (loop guard). */
  calledNumber?: string | null;
  callerNumber?: string | null;
}

const KEY_PREFIX = "voice:transfer:ctx:";
/** Longer than any live call can run (LIVE max duration is far below this). */
const CONTEXT_TTL_SECONDS = 6 * 60 * 60;

function keyFor(vapiCallId: string): string {
  return `${KEY_PREFIX}${vapiCallId}`;
}

export async function storeVoiceTransferContext(
  vapiCallId: string,
  context: VoiceTransferContext
): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis || !vapiCallId || !context.twilioCallSid) return false;

  try {
    await redis.set(keyFor(vapiCallId), JSON.stringify(context), "EX", CONTEXT_TTL_SECONDS);
    return true;
  } catch (error) {
    // Non-fatal: the call proceeds normally, only live transfer is unavailable.
    console.error("[voice-transfer] failed to store transfer context", {
      vapiCallId,
      message: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

export async function loadVoiceTransferContext(
  vapiCallId: string
): Promise<VoiceTransferContext | null> {
  if (!vapiCallId) return null;

  const redis = getSharedRedis();
  if (redis) {
    try {
      const raw = await redis.get(keyFor(vapiCallId));
      if (raw) {
        const parsed = JSON.parse(raw) as VoiceTransferContext;
        if (typeof parsed?.twilioCallSid === "string" && parsed.twilioCallSid) return parsed;
      }
    } catch (error) {
      console.error("[voice-transfer] Redis load failed — trying DB fallback", {
        vapiCallId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Durable fallback: the Twilio leg is also stamped on the VapiCall row at
  // TwiML-creation time, so an in-flight transfer survives a Redis restart.
  // The loop-guard fields (calledNumber) may be absent here — the transfer
  // executor treats missing fields conservatively.
  try {
    const row = await prisma.vapiCall.findUnique({
      where: { callId: vapiCallId },
      select: {
        twilioCallSid: true,
        businessId: true,
        installedAgentId: true,
        customerPhone: true
      }
    });
    if (!row?.twilioCallSid) return null;
    return {
      twilioCallSid: row.twilioCallSid,
      businessId: row.businessId,
      installedAgentId: row.installedAgentId,
      workflowId: null,
      calledNumber: null,
      callerNumber: row.customerPhone
    };
  } catch (error) {
    console.error("[voice-transfer] DB fallback load failed", {
      vapiCallId,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
