import type { VOICE_TOOL_NAMES } from "@coreai/shared";
import type { BusinessRuntimeContext } from "../../architect/twilio-business-routing";
import type { LiveAfterHoursGateContext } from "../../architect/after-hours-live-gate";

export type ExecutionMode = "LIVE" | "ARCHITECT_DRY_RUN" | "BUSINESS_TEST";

// VOICE_TOOL_NAMES is a name map (camelCase key → tool name), not an array.
export type VoiceToolName =
  | (typeof VOICE_TOOL_NAMES)[keyof typeof VOICE_TOOL_NAMES]
  | string;

export interface VoiceCallSessionState {
  businessId: string;
  callId: string;
  installedAgentId?: string;
  conversationId?: string;
  customerPhone?: string;
  executionMode: ExecutionMode;
  timeZone: string;
  currentIntent?: string;
  requestedService?: string;
  confirmedDate?: string;
  confirmedTime?: string;
  bookingState?: "IDLE" | "CHECKING" | "CONFIRMED" | "FAILED";
  smsConsentState?: "UNKNOWN" | "GRANTED" | "DENIED";
  verificationState?: "UNVERIFIED" | "VERIFIED" | "FAILED";
  approvalState?: "NONE" | "PENDING" | "APPROVED" | "DENIED";
  activeOperation?: string;
  transferState?: "NONE" | "REQUESTED" | "APPROVED" | "TRANSFERRED" | "DENIED";
  updatedAt: string;
  version: "v2";
}

export interface VoiceToolContext {
  session: VoiceCallSessionState;
  // The exact runtime context the live webhook builds — not a lookalike shape.
  business: BusinessRuntimeContext | null;
  customerPhone: string;
  patientPhone: string;
  conversationId?: string;
  callId: string;
  summary?: string;
  transcript?: string;
  executionMode: ExecutionMode;
  installedAgentId?: string;
  timeZone: string;
  callTurns?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  afterHours?: LiveAfterHoursGateContext | null;
  dental?: Record<string, unknown> | null;
}

export interface NormalizedToolResult {
  success: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
  customerSafeMessage?: string;
  customerSpeechCode?: string;
}

export interface VoiceToolDefinition {
  name: VoiceToolName;
  description: string;
  parameters: Record<string, unknown>;
  authorize?: (ctx: VoiceToolContext, args: Record<string, unknown>) => Promise<{ allowed: boolean; code?: string; message?: string }>;
  execute: (ctx: VoiceToolContext, args: Record<string, unknown>) => Promise<NormalizedToolResult>;
}

export interface VapiWebhookAuthResult {
  authorized: boolean;
  reason: string;
  requiresArchitectSandbox?: boolean;
}

export interface AssistantDeployInput {
  businessId: string;
  installedAgentId?: string;
  workflowId?: string;
  agentName?: string;
  systemPrompt?: string;
  voiceId?: string;
  voiceProvider?: string;
  model?: string;
  llmProvider?: string;
  temperature?: number;
  transcriberLanguage?: string;
  includeTools?: Record<string, boolean>;
}
