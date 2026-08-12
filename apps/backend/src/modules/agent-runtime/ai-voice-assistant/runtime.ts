import type { Context } from "hono";
import { getVoiceSession, saveVoiceSession, updateVoiceSessionState } from "./session";
import { buildUnifiedVoiceSystemPrompt } from "./prompt";
import { handleVapiWebhook, startVapiOutboundCall, deployVapiAssistant } from "./vapi";
import type { AssistantDeployInput, ExecutionMode } from "./types";

export async function prepareVoiceAssistantRuntime(
  businessId: string,
  options?: {
    callId?: string;
    installedAgentId?: string;
    customerPhone?: string;
    executionMode?: ExecutionMode;
  }
) {
  const callId = options?.callId || `session_${Date.now()}`;
  const session = await getVoiceSession(businessId, callId, {
    installedAgentId: options?.installedAgentId,
    customerPhone: options?.customerPhone,
    executionMode: options?.executionMode
  });

  return {
    callId,
    session,
    compilePrompt: (businessDetails: Parameters<typeof buildUnifiedVoiceSystemPrompt>[0]) =>
      buildUnifiedVoiceSystemPrompt({
        ...businessDetails,
        session
      })
  };
}

export async function triggerOutboundCall(input: Parameters<typeof startVapiOutboundCall>[0]) {
  return startVapiOutboundCall(input);
}

export async function deployAssistant(input: AssistantDeployInput) {
  return deployVapiAssistant(input);
}

export async function processVoiceWebhook(c: Context) {
  return handleVapiWebhook(c);
}
