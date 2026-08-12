import { redactForLog } from "../../compliance/log-redaction";

export interface VoiceCallLogPayload {
  callId?: string;
  businessId?: string;
  installedAgentId?: string;
  event: string;
  message?: string;
  status?: number | string;
  details?: Record<string, unknown>;
  latencyMs?: number;
}

export function logVoiceCallEvent(payload: VoiceCallLogPayload): void {
  const redactedDetails = payload.details ? redactForLog(payload.details) : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    module: "ai-voice-assistant",
    callId: payload.callId,
    businessId: payload.businessId,
    installedAgentId: payload.installedAgentId,
    event: payload.event,
    status: payload.status,
    message: payload.message,
    latencyMs: payload.latencyMs,
    details: redactedDetails
  };

  if (payload.status === "ERROR" || (typeof payload.status === "number" && payload.status >= 400)) {
    console.error(`[ai-voice-assistant] [${payload.event}]`, JSON.stringify(entry));
  } else {
    console.log(`[ai-voice-assistant] [${payload.event}]`, JSON.stringify(entry));
  }
}

export function logVoiceToolExecution(
  toolName: string,
  latencyMs: number,
  success: boolean,
  callId: string,
  businessId?: string
): void {
  logVoiceCallEvent({
    callId,
    businessId,
    event: "tool_execution",
    status: success ? "SUCCESS" : "FAILURE",
    latencyMs,
    details: { toolName, success }
  });
}
