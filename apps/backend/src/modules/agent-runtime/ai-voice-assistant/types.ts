import type { Context } from "hono";
import type { VOICE_TOOL_NAMES } from "@coreai/shared";

export type ExecutionMode = "LIVE" | "ARCHITECT_DRY_RUN" | "BUSINESS_TEST";

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number] | string;

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
  business: {
    businessId: string;
    businessName: string;
    timeZone: string;
    formattedHours?: string;
    address?: string;
    contactEmail?: string;
    contactPhone?: string;
    shortPolicy?: string;
  } | null;
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
  afterHours?: {
    isAfterHours: boolean;
    route?: string | null;
    state?: Record<string, unknown> | null;
  };
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
