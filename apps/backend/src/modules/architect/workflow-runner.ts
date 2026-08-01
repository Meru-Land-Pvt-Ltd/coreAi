import { CORE_CONNECTOR_ACTIONS, MAX_WORKFLOW_CHAIN_DEPTH, TELEGRAM_NODE_TYPES, VOICE_NODE_TYPES, normalizeTimeZone, zonedWallClockToUtc } from "@coreai/shared";
import { createTestCalendarEvent } from "./test-calendar-events";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import { getSmsConsentStatusLabel } from "../notifications/sms-consent";
import {
  applyBuyerEmailRecipients,
  extractBuyerEmailRecipients,
  extractSendEmailNodeConfig,
  fillEmailTemplate,
  resolveVariableRecipient,
  sanitizeOutboundHtml,
  type EmailTemplateVariables
} from "../email/email-node-config";
import { enqueueEmail } from "../email/email-queue";
import { isValidEmailAddress, TEAM_RECIPIENT } from "../email/ses-mail-service";
import { isPlatformMailConfigured, sendPlatformEmail } from "../../lib/mailer";
import {
  createGoogleCalendarAppointment,
  getDefaultAppointmentWindow,
  listAvailableSlots
} from "./google-calendar-connector";
import { startVapiOutboundCall } from "./vapi-connector";
import { MISSING_LLM_CREDENTIALS_MESSAGE } from "../ai-provider-engine/llm-credentials";
import { smsAttributionPrefix } from "../notifications/sms-format";
import {
  createWorkflowRun,
  completeWorkflowRun,
  failWorkflowRun,
  runAiBrainNode,
  memoryBroker,
  buildSmartMemory,
  resolveSmartMemoryForQuery,
  mergeMemoryIntoPrompt,
  type AiBrainNodeConfig,
} from "../memory";
import { WhatsAppService } from "../whatsapp/service";
import { WhatsAppServiceError } from "../whatsapp/types";
import {
  executeTelegramActionWithRetry,
  TELEGRAM_ACTION_TYPES,
  type TelegramActionInput,
  type TelegramButton
} from "./telegram-actions";

/** Threaded through the runner to bound workflow-to-workflow chaining. */
type WorkflowChain = {
  depth: number;
  visited: string[];
  workflowId: string;
};

export type WorkflowRunLog = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error";
  message: string;
  output?: unknown;
};

type WorkflowRunMode = "test" | "live";

export type WorkflowRunInput = {
  callerNumber?: string;
  callerName?: string;
  businessId?: string;
  businessOwnerId?: string;
  businessName?: string;
  businessType?: string;
  businessPhoneNumber?: string;
  calendarId?: string;
  timeZone?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  callStatus?: string;
  callTimestamp?: string;
  missedCallReason?: string;
  bookingUrl?: string;
  teamPhone?: string;
  services?: string[];
  faqs?: string[];
  tone?: string;
  escalationRules?: string;
  knowledge?: string[];
  inboundSmsBody?: string;
  appointmentStartAt?: string;
  appointmentEndAt?: string;
  appointmentService?: string;
  /** Test-mode only: the Send Email node delivers to this address for real. */
  testEmail?: string;
  /** Test-mode only: create a REAL [TRIVEN ARCHITECT TEST] event in the
   * architect's own connected calendar instead of a simulated preview. */
  useTestCalendar?: boolean;
  /** Groups this test run's records (test calendar events). */
  testSessionId?: string;
  businessHours?: unknown;
  conversationId?: string;
  leadId?: string;
  installedAgentId?: string;
  listingId?: string;
  latestMessage?: string;
  assistantName?: string;
  telegramChatId?: string;
  telegramConnectionId?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramMessageId?: string;
  telegramUpdateId?: string;
  telegramChatType?: string;
  telegramPhoneNumber?: string;
  trigger?: unknown;
  telegramEvent?: unknown;
  attachments?: Array<{
    name: string;
    mimeType: string;
    data: string; // base64 string
  }>;
  /** Inbound WhatsApp message event (from Meta webhook dispatch). */
  whatsapp?: {
    type: "WHATSAPP_MESSAGE";
    connectionId: string;
    contact: { name: string | null; phone: string };
    customer: { name: string | null; phone: string };
    message: {
      id: string;
      type: string;
      text: string | null;
      mediaUrl: string | null;
    };
    timestamp: string;
  };
};

type RunnerNodeData = {
  label?: unknown;
  title?: unknown;
  nodeKind?: unknown;
  kind?: unknown;
  description?: unknown;
  prompt?: unknown;
  connector?: unknown;
  connectorAction?: unknown;
  gmailQuery?: unknown;
  gmailTo?: unknown;
  gmailSubject?: unknown;
  gmailBody?: unknown;
  smsTo?: unknown;
  smsBody?: unknown;
  connectionId?: unknown;
  recipient?: unknown;
  message?: unknown;
  whatsappMessageType?: unknown;
  whatsappTo?: unknown;
  whatsappBody?: unknown;
  listenFor?: unknown;
  ignoreGroups?: unknown;
  ignoreStatusMessages?: unknown;
  mediaType?: unknown;
  mediaId?: unknown;
  mediaLink?: unknown;
  caption?: unknown;
  filename?: unknown;
  templateName?: unknown;
  languageCode?: unknown;
  messageId?: unknown;
  sendAt?: unknown;
  vapiAssistantId?: unknown;
  vapiPhoneNumberId?: unknown;
  calendarId?: unknown;
  calendarSummary?: unknown;
  calendarDescription?: unknown;
  appointmentStartAt?: unknown;
  appointmentEndAt?: unknown;
  appointmentService?: unknown;
  condition?: unknown;
  outputKey?: unknown;
  leadSource?: unknown;
  leadStatus?: unknown;
  conversationDirection?: unknown;
  conversationBody?: unknown;
  handoffReason?: unknown;
  nextWorkflowId?: unknown;
  // Generic node capability + voice-booking node fields (read in Test/Dry Run).
  type?: unknown;
  callHandlingMode?: unknown;
  firstMessage?: unknown;
  practiceName?: unknown;
  doctorName?: unknown;
  voice?: unknown;
  model?: unknown;
  language?: unknown;
  date?: unknown;
  slotsToOffer?: unknown;
  bufferMinutes?: unknown;
  sendToPatient?: unknown;
  sendToDentist?: unknown;
  dentistPhone?: unknown;
  patientTemplate?: unknown;
  dentistTemplate?: unknown;
  provider?: unknown;
  instructions?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  outputFormat?: unknown;
  backlinkNodeIds?: unknown;
  assistantName?: unknown;
  // LLM Call node fields (ai.llm_call) — set from the workflow builder inspector
  llmProvider?: unknown;
  llmModel?: unknown;
  llmRequirements?: unknown;
  llmSystemPrompt?: unknown;
  llmPrompt?: unknown;
  attachments?: unknown;
  customMemoryNotes?: unknown;
  notes?: unknown;
  customNotes?: unknown;
  llmContext?: unknown;
  llmTemperature?: unknown;
  llmMaxTokens?: unknown;
  llmOutputFormat?: unknown;
  llmOutputKey?: unknown;
  telegramRecipientSource?: unknown;
  telegramChatIdExpression?: unknown;
  telegramMessageIdExpression?: unknown;
  telegramCallbackIdExpression?: unknown;
  telegramMessageText?: unknown;
  telegramCallbackText?: unknown;
  telegramCaption?: unknown;
  telegramButtonsJson?: unknown;
  telegramParseMode?: unknown;
  telegramShowAlert?: unknown;
  telegramCallbackUrl?: unknown;
  telegramReplyToMessageId?: unknown;
  telegramDisableNotification?: unknown;
  telegramProtectContent?: unknown;
  telegramContactButtonText?: unknown;
  telegramPhotoSource?: unknown;
  telegramDocumentSource?: unknown;
  telegramVoiceSource?: unknown;
  telegramLatitude?: unknown;
  telegramLongitude?: unknown;
  telegramLivePeriod?: unknown;
};

type RunnerNode = {
  id: string;
  position?: {
    x?: number;
    y?: number;
  };
  data?: RunnerNodeData;
};

type RunnerEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

type RunnerContext = {
  caller_number?: string;
  caller_name?: string;
  business?: {
    id?: string;
    ownerId?: string;
    name: string;
    type?: string;
    phoneNumber?: string;
    bookingUrl?: string;
    teamPhone?: string;
    services?: string[];
    faqs?: string[];
    tone?: string;
    escalationRules?: string;
    knowledge?: string[];
    calendarId?: string;
    timeZone?: string;
    vapiAssistantId?: string;
    vapiPhoneNumberId?: string;
    hours?: unknown;
    assistantName?: string;
  };
  inboundSms?: {
    body: string;
    attachments?: any[];
  };
  contact?: {
    name?: string | null;
    phone?: string;
  };
  customer?: {
    name?: string | null;
    phone?: string;
  };
  message?: {
    id?: string;
    type?: string;
    text?: string | null;
    mediaUrl?: string | null;
  };
  whatsapp?: {
    type: "WHATSAPP_MESSAGE";
    connectionId: string;
    contact: { name: string | null; phone: string };
    customer: { name: string | null; phone: string };
    message: {
      id: string;
      type: string;
      text: string | null;
      mediaUrl: string | null;
    };
    timestamp: string;
  };
  missedCall?: {
    callerNumber: string;
    callerName?: string;
    businessName: string;
    status?: string;
    timestamp?: string;
    reason?: string;
  };
  telegram?: {
    chat_id: string;
    user_id: string;
    username?: string;
    message_id: string;
    update_id?: string;
    chat_type: string;
    text: string;
    phone_number?: string;
  };
  trigger?: {
    telegram?: unknown;
  };
  telegramEvent?: unknown;
  telegramConnectionId?: string;
  telegramAction?: {
    success: boolean;
    chatId: string;
    messageId: string | null;
    actionType: string;
    telegramConnectionId: string;
    dryRun?: boolean;
  };
  workflowRunId?: string;
  gmail?: {
    emails?: {
      id: string;
      from: string;
      senderEmail: string;
      subject: string;
      body: string;
    }[];
    senderEmail?: string;
    subject?: string;
    body?: string;
  };
  ai?: {
    output?: string;
  };
  condition?: {
    passed: boolean;
    label: string;
  };
  sentEmail?: {
    id: string | null;
    to: string;
    subject: string;
    body: string;
  };
  draftEmail?: {
    id: string | null;
    to: string;
    subject: string;
    body: string;
  };
  sentSms?: {
    id: string | null;
    messageSid?: string | null;
    to: string;
    body: string;
    mode: WorkflowRunMode;
    providerCalled: boolean;
    twilioTestMode: boolean;
    executionId?: string | null;
    status?: string | null;
  };
  queuedSms?: {
    to: string;
    body: string;
    sendAt: string;
    mode: WorkflowRunMode;
  };
  vapiCall?: {
    id: string | null;
    status: string | null;
    customerPhone: string;
    providerCalled: boolean;
  };
  calendarAppointment?: {
    id: string | null;
    calendarId: string;
    summary: string;
    startAt: string;
    endAt: string;
    timeZone: string;
    /** SIMULATED (dry preview), CREATED (real event), FAILED (write error). */
    status?: "SIMULATED" | "CREATED" | "FAILED";
    htmlLink?: string | null;
    /** TestCalendarEvent row id — enables the delete-test-event action. */
    testEventId?: string | null;
    errorCode?: string;
    remediation?: string;
  };
  useTestCalendar?: boolean;
  testSessionId?: string;
  capturedLead?: {
    callerNumber: string;
    callerName?: string;
    businessName: string;
    status: string;
    capturedAt: string;
  };
  conversationId?: string;
  leadId?: string;
  installedAgentId?: string;
  listingId?: string;
  latestMessage?: string;
  testEmail?: string;
  leadSaved?: boolean;
  conversationSaved?: boolean;
  handoff?: {
    reason: string;
    teamPhone?: string;
  };
  nextWorkflow?: {
    workflowId: string;
    name: string;
    ran: boolean;
  };
  output?: unknown;
  /** Accumulated per-node outputs for LLM Call pipelines (ai.llm_call nodes). */
  llmPipeline?: Record<string, {
    label: string;
    outputKey: string;
    output: string;
    providerId: string;
    modelName: string;
  }>;
  [key: string]: unknown;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isRunnerNode(value: unknown): value is RunnerNode {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Partial<RunnerNode>).id === "string";
}

function isRunnerEdge(value: unknown): value is RunnerEdge {
  if (typeof value !== "object" || value === null) return false;

  const edge = value as Partial<RunnerEdge>;

  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string"
  );
}

export function parseRunnerWorkflowJson(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return {
      nodes: [] as RunnerNode[],
      edges: [] as RunnerEdge[]
    };
  }

  const workflowJson = value as {
    nodes?: unknown;
    edges?: unknown;
  };

  return {
    nodes: Array.isArray(workflowJson.nodes)
      ? workflowJson.nodes.filter(isRunnerNode)
      : [],
    edges: Array.isArray(workflowJson.edges)
      ? workflowJson.edges.filter(isRunnerEdge)
      : []
  };
}

function sortNodesForRun(nodes: RunnerNode[], edges: RunnerEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Start nodes: nodes with in-degree 0 (triggers or root nodes)
  const queue: string[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    .map((n) => n.id);

  const executionOrder: RunnerNode[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    const current = nodeById.get(currentId);
    if (current) {
      executionOrder.push(current);
    }

    const nextIds = outgoing.get(currentId) ?? [];
    nextIds.sort((aId, bId) => {
      const aNode = nodeById.get(aId);
      const bNode = nodeById.get(bId);
      return (aNode?.position?.x ?? 0) - (bNode?.position?.x ?? 0);
    });

    for (const targetId of nextIds) {
      const currentDeg = inDegree.get(targetId) ?? 1;
      const nextDeg = Math.max(0, currentDeg - 1);
      inDegree.set(targetId, nextDeg);
      if (nextDeg === 0 && !visited.has(targetId)) {
        queue.push(targetId);
      }
    }
  }

  const disconnected = nodes.filter((node) => !visited.has(node.id));
  disconnected.sort((a, b) => {
    const ax = a.position?.x ?? 0;
    const bx = b.position?.x ?? 0;
    if (ax !== bx) return ax - bx;
    return (a.position?.y ?? 0) - (b.position?.y ?? 0);
  });

  return [...executionOrder, ...disconnected];
}

function telegramRouteCandidates(context: RunnerContext): Set<string> {
  const event = context.telegramEvent && typeof context.telegramEvent === "object"
    ? (context.telegramEvent as Record<string, unknown>)
    : {};
  const callback = event.callback && typeof event.callback === "object"
    ? (event.callback as Record<string, unknown>)
    : {};
  const eventType = asString(event.eventType, "message").toLowerCase();
  const callbackData = asString(callback.data).toLowerCase();
  const command = (context.telegram?.text ?? "")
    .trim()
    .split(/\s+/, 1)[0]
    ?.toLowerCase()
    .replace(/^\/+/, "")
    .split("@", 1)[0] ?? "";
  return new Set(
    [
      "*",
      "default",
      eventType,
      command,
      command ? `/${command}` : "",
      callbackData,
      callbackData ? `callback:${callbackData}` : "",
      callbackData.split(":", 1)[0] || ""
    ].filter(Boolean)
  );
}

/** Telegram graphs may route directly from the trigger with source handles. */
function sortTelegramNodesForRun(nodes: RunnerNode[], edges: RunnerEdge[], context: RunnerContext): RunnerNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const start =
    nodes.find((node) => asString(node.data?.type) === TELEGRAM_NODE_TYPES.trigger) ??
    nodes.find((node) => asString(node.data?.nodeKind) === "trigger");
  if (!start || edges.length === 0) return sortNodesForRun(nodes, edges);
  const routes = telegramRouteCandidates(context);
  const result: RunnerNode[] = [];
  const queue = [start.id];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (node) result.push(node);
    const outgoing = edges.filter((edge) => edge.source === nodeId);
    const handled = outgoing.filter((edge) => Boolean(edge.sourceHandle));
    const selected =
      handled.length > 0
        ? outgoing.filter((edge) => {
            if (!edge.sourceHandle) return false;
            return routes.has(edge.sourceHandle.trim().toLowerCase());
          })
        : outgoing;
    for (const edge of selected) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }
  return result;
}

function resolveContextPath(context: RunnerContext, path: string): unknown {
  if (path in context) {
    return (context as Record<string, unknown>)[path];
  }
  const parts = path.split(".");
  const first = parts[0];
  if (
    first &&
    context.node &&
    typeof context.node === "object" &&
    first in (context.node as Record<string, unknown>)
  ) {
    return parts.reduce<unknown>((current, segment) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, { node: context.node });
  }
  return parts.reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, context);
}

function renderTemplate(input: unknown, context: RunnerContext) {
  const template = asString(input);

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = resolveContextPath(context, path);

    if (value === undefined || value === null) return "";

    return String(value);
  });
}

function createLog(
  node: RunnerNode,
  status: WorkflowRunLog["status"],
  message: string,
  output?: unknown
): WorkflowRunLog {
  return {
    nodeId: node.id,
    label: asString(node.data?.title ?? node.data?.label, node.id),
    status,
    message,
    output
  };
}

/**
 * Memory scope for the active run, keyed by the run's context object. A
 * WeakMap (not a context key) so workflow-controlled writes — e.g. an LLM
 * node with llmOutputKey — can never redirect memory resolution to another
 * tenant's scope.
 */
const memoryScopeByContext = new WeakMap<object, string>();

/**
 * Automatic Memory Node → AI delivery: when a Memory Node ran earlier in this
 * run, resolve the memory for THIS AI node's own instruction (each AI node
 * gets memory selected for its own task) and merge it into the prompt. The
 * builder never has to reference {{memory}}; if they did, the placeholder's
 * raw expansion is swapped for the resolved version.
 */
export async function deliverMemoryToAiConfig(config: AiBrainNodeConfig, context: RunnerContext): Promise<void> {
  const scopeKey = memoryScopeByContext.get(context as object) ?? "";
  const rawMemory = asString(context.memory);
  if (!scopeKey || !rawMemory) return;

  const data = (config.data ?? {}) as Record<string, unknown>;
  const query = [asString(data.llmRequirements), asString(data.llmPrompt), asString(data.prompt), asString(data.instructions)]
    .filter(Boolean)
    .join("\n\n");

  const resolved = await resolveSmartMemoryForQuery({ scopeKey, query, rawMemory });

  // llmPrompt/llmSystemPrompt are included because the provider mapping reads
  // them ahead of the rendered fields for legacy LLM Call nodes.
  const promptFields = ["instructions", "prompt", "llmRequirements", "llmPrompt", "llmSystemPrompt"] as const;
  const builderPlacedMemory = promptFields.some((field) => asString(data[field]).includes(rawMemory));
  if (builderPlacedMemory) {
    for (const field of promptFields) {
      const value = asString(data[field]);
      if (value.includes(rawMemory)) {
        data[field] = mergeMemoryIntoPrompt(value, resolved.memory, rawMemory);
      }
    }
  } else {
    // llmContext reaches the provider request for every AI node shape
    // ("Additional context / knowledge"), regardless of which prompt fields
    // the builder filled in.
    data.llmContext = mergeMemoryIntoPrompt(asString(data.llmContext), resolved.memory, rawMemory);
  }
  config.data = data;
}

/** Test-only hook: associate a memory scope with a runner context. */
export function setMemoryScopeForContext(context: RunnerContext, scopeKey: string): void {
  memoryScopeByContext.set(context as object, scopeKey);
}

function toAiBrainNodeConfig(node: RunnerNode, context: RunnerContext): AiBrainNodeConfig {
  const isLlmCall = asString(node.data?.type) === "ai.llm_call";
  const isTestMode = context._mode === "test";

  const rawMaxTokens = isLlmCall
    ? (node.data?.llmMaxTokens ?? node.data?.maxTokens)
    : node.data?.maxTokens;

  // Convert rawMaxTokens to number safely
  const parsedMaxTokens = typeof rawMaxTokens === "number"
    ? rawMaxTokens
    : (typeof rawMaxTokens === "string" ? Number(rawMaxTokens) : NaN);

  // Boost maxTokens in test mode so outputs are not cut off
  const finalMaxTokens = isTestMode
    ? (isNaN(parsedMaxTokens) || parsedMaxTokens < 2048 ? 2048 : parsedMaxTokens)
    : rawMaxTokens;

  const data = isLlmCall
    ? {
        ...node.data,
        provider: node.data?.llmProvider ?? node.data?.provider,
        model: node.data?.llmModel ?? node.data?.model,
        instructions: renderTemplate(node.data?.llmSystemPrompt ?? node.data?.instructions, context),
        prompt: renderTemplate(node.data?.llmPrompt ?? node.data?.prompt, context),
        // The provider mapping reads these raw fields ahead of the rendered
        // ones — keep them rendered too so {{memory}} and friends resolve.
        llmSystemPrompt: renderTemplate(node.data?.llmSystemPrompt, context),
        llmPrompt: renderTemplate(node.data?.llmPrompt, context),
        llmRequirements: renderTemplate(node.data?.llmRequirements, context),
        temperature: node.data?.llmTemperature ?? node.data?.temperature,
        maxTokens: finalMaxTokens,
        outputFormat: node.data?.llmOutputFormat ?? node.data?.outputFormat,
      }
    : {
        ...node.data,
        prompt: renderTemplate(node.data?.prompt, context),
        maxTokens: finalMaxTokens,
      };

  return {
    id: node.id,
    nodeType: asString(node.data?.type, "ai.context_reply"),
    nodeLabel: asString(node.data?.title ?? node.data?.label),
    data,
  };
}

function shouldUseProviderEngine(node: RunnerNode, mode: WorkflowRunMode): boolean {
  const type = asString(node.data?.type);
  if (type === VOICE_NODE_TYPES.voiceConversation) return false;
  if (type === "ai.brain") return true;
  if (type === "ai.llm_call") return true;
  if (type === "ai.context_reply") return mode === "test";
  if (Boolean(asString(node.data?.provider))) return true;
  return false;
}

function isCallOrVoiceWorkflow(nodes?: RunnerNode[]): boolean {
  if (!nodes || nodes.length === 0) return false;
  return nodes.some((node) => {
    const type = asString(node.data?.type);
    return (
      type === VOICE_NODE_TYPES.phoneCallTrigger ||
      type === VOICE_NODE_TYPES.voiceConversation ||
      type === VOICE_NODE_TYPES.endFlow ||
      type === "trigger.twilio_missed_call" ||
      type === "twilio_missed_call" ||
      type === "trigger.twilio_inbound_sms" ||
      type === "twilio_inbound_sms" ||
      type === "connector.twilio_sms" ||
      type === "connector.vapi_call" ||
      type === "vapi_call"
    );
  });
}

/** A Telegram graph is identified by its trigger node, before any node runs. */
function isTelegramWorkflowNodes(nodes?: RunnerNode[]): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some((node) => asString(node.data?.type) === TELEGRAM_NODE_TYPES.trigger);
}

function seedMissedCallContext(
  input?: WorkflowRunInput,
  nodes?: RunnerNode[],
  mode: WorkflowRunMode = "test"
): RunnerContext {
  const isCallOrVoice = isCallOrVoiceWorkflow(nodes);
  const isTelegram = isTelegramWorkflowNodes(nodes);
  // Dry-run placeholders (chat id, "/services", a synthetic update) exist only
  // so an architect can test a Telegram graph without a real bot event.
  const isTest = mode === "test";

  const hasExplicitMissedCallInput = Boolean(
    optionalString(input?.missedCallReason) ||
      optionalString(input?.callStatus) ||
      optionalString(input?.callTimestamp)
  );

  const hasExplicitCallerInput = Boolean(
    optionalString(input?.callerNumber) || optionalString(input?.callerName)
  );

  const hasExplicitSmsInput = Boolean(
    optionalString(input?.inboundSmsBody) ||
      (Array.isArray(input?.attachments) && input.attachments.length > 0)
  );

  const hasExplicitBusinessInput = Boolean(
    optionalString(input?.businessId) ||
      optionalString(input?.businessOwnerId) ||
      optionalString(input?.businessName) ||
      optionalString(input?.businessType) ||
      optionalString(input?.businessPhoneNumber) ||
      optionalString(input?.bookingUrl) ||
      optionalString(input?.teamPhone) ||
      (Array.isArray(input?.services) && input.services.length > 0) ||
      (Array.isArray(input?.faqs) && input.faqs.length > 0) ||
      optionalString(input?.tone) ||
      optionalString(input?.escalationRules) ||
      (Array.isArray(input?.knowledge) && input.knowledge.length > 0) ||
      optionalString(input?.calendarId) ||
      optionalString(input?.timeZone) ||
      optionalString(input?.vapiAssistantId) ||
      optionalString(input?.vapiPhoneNumberId) ||
      input?.businessHours ||
      optionalString(input?.assistantName)
  );

  const callerNumber = optionalString(input?.callerNumber) ?? (isCallOrVoice ? "+15555550100" : undefined);
  const callerName = optionalString(input?.callerName) ?? (isCallOrVoice ? "Jordan Lee" : undefined);
  const businessName =
    optionalString(input?.businessName) ??
    (isCallOrVoice ? optionalString(env.TWILIO_DEFAULT_BUSINESS_NAME) ?? "the business" : undefined);

  const context: RunnerContext = {};

  if (hasExplicitBusinessInput || isCallOrVoice) {
    const bookingUrl = optionalString(input?.bookingUrl) ?? (isCallOrVoice ? optionalString(env.TWILIO_DEFAULT_BOOKING_URL) : undefined);
    const teamPhone = optionalString(input?.teamPhone) ?? (isCallOrVoice ? optionalString(env.TWILIO_DEFAULT_TEAM_PHONE) : undefined);
    const tone = optionalString(input?.tone) ?? (isCallOrVoice ? "friendly" : undefined);
    const calendarId = optionalString(input?.calendarId) ?? (isCallOrVoice ? env.GOOGLE_CALENDAR_ID ?? "primary" : undefined);
    const timeZone = optionalString(input?.timeZone) ?? (isCallOrVoice ? env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE : undefined);
    const vapiPhoneNumberId = optionalString(input?.vapiPhoneNumberId) ?? (isCallOrVoice ? env.VAPI_DEFAULT_PHONE_NUMBER_ID : undefined);

    context.business = {
      ...(optionalString(input?.businessId) ? { id: optionalString(input?.businessId) } : {}),
      ...(optionalString(input?.businessOwnerId) ? { ownerId: optionalString(input?.businessOwnerId) } : {}),
      ...(businessName ? { name: businessName } : {}),
      ...(optionalString(input?.businessType) ? { type: optionalString(input?.businessType) } : {}),
      ...(optionalString(input?.businessPhoneNumber) ? { phoneNumber: optionalString(input?.businessPhoneNumber) } : {}),
      ...(bookingUrl ? { bookingUrl } : {}),
      ...(teamPhone ? { teamPhone } : {}),
      ...(Array.isArray(input?.services) && input.services.length > 0 ? { services: input.services } : {}),
      ...(Array.isArray(input?.faqs) && input.faqs.length > 0 ? { faqs: input.faqs } : {}),
      ...(tone ? { tone } : {}),
      ...(optionalString(input?.escalationRules) ? { escalationRules: optionalString(input?.escalationRules) } : {}),
      ...(Array.isArray(input?.knowledge) && input.knowledge.length > 0 ? { knowledge: input.knowledge } : {}),
      ...(calendarId ? { calendarId } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(optionalString(input?.vapiAssistantId) ? { vapiAssistantId: optionalString(input?.vapiAssistantId) } : {}),
      ...(vapiPhoneNumberId ? { vapiPhoneNumberId } : {}),
      ...(input?.businessHours ? { hours: input.businessHours } : {}),
      ...(optionalString(input?.assistantName) ? { assistantName: optionalString(input?.assistantName) } : {})
    } as any;
  }

  /* Telegram runs are seeded here, before any node executes, because the
     Telegram trigger node READS context.telegram and fails the run when the
     chat/message ids are absent. A missed-call context is not built for these —
     the two are alternatives, not additions. */
  if (isTelegram) {
    const telegramPhone = optionalString(input?.telegramPhoneNumber);
    const text =
      optionalString(input?.latestMessage) ??
      optionalString(input?.inboundSmsBody) ??
      (isTest ? "/services" : "");

    context.telegram = {
      chat_id: optionalString(input?.telegramChatId) ?? (isTest ? "architect-dry-run-chat" : ""),
      user_id: optionalString(input?.telegramUserId) ?? (isTest ? "architect-dry-run-user" : ""),
      username: optionalString(input?.telegramUsername) ?? (isTest ? "test_customer" : undefined),
      message_id: optionalString(input?.telegramMessageId) ?? (isTest ? "1" : ""),
      update_id: optionalString(input?.telegramUpdateId),
      chat_type: optionalString(input?.telegramChatType) ?? "private",
      text,
      phone_number: telegramPhone
    };

    const liveEvent =
      input?.telegramEvent && typeof input.telegramEvent === "object" && !Array.isArray(input.telegramEvent)
        ? input.telegramEvent
        : null;
    const dryRunEvent = {
      provider: "TELEGRAM",
      updateId: optionalString(input?.telegramUpdateId) ?? "10001",
      eventType: text.startsWith("/") ? "command" : "message",
      businessId: optionalString(input?.businessId) ?? "dry-run-business",
      installedAgentId: optionalString(input?.installedAgentId) ?? "dry-run-installed-agent",
      telegramConnectionId: optionalString(input?.telegramConnectionId) ?? "dry-run-telegram-connection",
      bot: { id: "700000001", username: "dry_run_business_bot" },
      chat: { id: context.telegram.chat_id, type: context.telegram.chat_type },
      sender: {
        id: context.telegram.user_id,
        isBot: false,
        username: context.telegram.username ?? "",
        firstName: callerName ?? "",
        lastName: "",
        languageCode: "en"
      },
      message: {
        id: context.telegram.message_id,
        text,
        caption: "",
        date: optionalString(input?.callTimestamp) ?? new Date().toISOString()
      },
      callback: { id: "", data: "" },
      contact: {
        phoneNumber: telegramPhone ?? "",
        firstName: callerName ?? "",
        lastName: "",
        userId: context.telegram.user_id
      },
      media: { type: "", fileId: "", fileName: "", mimeType: "" },
      location: { latitude: null, longitude: null }
    };

    context.telegramEvent = liveEvent ?? dryRunEvent;
    context.trigger = { telegram: liveEvent ?? dryRunEvent };
    context.telegramConnectionId =
      optionalString(input?.telegramConnectionId) ?? (isTest ? "dry-run-telegram-connection" : undefined);
    context.latestMessage = text;
  } else if (hasExplicitMissedCallInput || hasExplicitCallerInput || isCallOrVoice) {
    const timestamp = optionalString(input?.callTimestamp) ?? (isCallOrVoice ? new Date().toISOString() : undefined);
    const status = optionalString(input?.callStatus) ?? (isCallOrVoice ? "no-answer" : undefined);
    const reason = optionalString(input?.missedCallReason) ?? (isCallOrVoice ? "No one picked up the customer call." : undefined);

    context.missedCall = {
      callerNumber: callerNumber ?? "",
      ...(callerName ? { callerName } : {}),
      businessName: businessName ?? "the business",
      ...(status ? { status } : {}),
      ...(timestamp ? { timestamp } : {}),
      ...(reason ? { reason } : {})
    };
  }

  if (callerNumber) context.caller_number = callerNumber;
  if (callerName) context.caller_name = callerName;

  if (hasExplicitSmsInput) {
    context.inboundSms = {
      body: optionalString(input?.inboundSmsBody) || "",
      attachments: input?.attachments
    };
  }

  if (input?.appointmentStartAt) context.appointmentStartAt = input.appointmentStartAt;
  if (input?.appointmentEndAt) context.appointmentEndAt = input.appointmentEndAt;
  if (input?.appointmentService) context.appointmentService = input.appointmentService;
  if (optionalString(input?.conversationId)) context.conversationId = optionalString(input?.conversationId);
  if (optionalString(input?.leadId)) context.leadId = optionalString(input?.leadId);
  if (optionalString(input?.installedAgentId)) context.installedAgentId = optionalString(input?.installedAgentId);
  if (optionalString(input?.listingId)) context.listingId = optionalString(input?.listingId);
  if (optionalString(input?.latestMessage)) context.latestMessage = optionalString(input?.latestMessage);
  if (optionalString(input?.testEmail)) context.testEmail = optionalString(input?.testEmail);
  if (input?.useTestCalendar === true) context.useTestCalendar = true;
  if (optionalString(input?.testSessionId)) context.testSessionId = optionalString(input?.testSessionId);

  if (input?.whatsapp) {
    context.whatsapp = input.whatsapp;
    context.contact = input.whatsapp.contact;
    context.customer = input.whatsapp.customer;
    context.message = input.whatsapp.message;
    context.caller_number = input.whatsapp.contact.phone;
    if (input.whatsapp.contact.name) context.caller_name = input.whatsapp.contact.name;
    if (input.whatsapp.message.text) {
      context.latestMessage = input.whatsapp.message.text;
      context.inboundSms = {
        body: input.whatsapp.message.text,
        attachments: context.inboundSms?.attachments
      };
    }
  }

  context._mode = mode;
  return context;
}

function runTriggerNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  if (asString(node.data?.type) === "trigger.telegram_message") {
    if (!context.telegram?.chat_id || !context.telegram.message_id) {
      logs.push(createLog(node, "error", "Telegram trigger is missing a chat ID or message ID."));
      return;
    }

    logs.push(
      createLog(node, "success", "Telegram bot event received.", {
        chatId: context.telegram.chat_id,
        userId: context.telegram.user_id,
        username: context.telegram.username,
        messageId: context.telegram.message_id,
        chatType: context.telegram.chat_type,
        text: context.telegram.text,
        hasSharedPhone: Boolean(context.telegram.phone_number),
        normalizedEvent: context.telegramEvent
      })
    );
    return;
  }

  if (asString(node.data?.type) === "trigger.manual") {
    logs.push(
      createLog(node, "success", "Input fired.", {
        message: context.inboundSms?.body || context.latestMessage || "No custom message"
      })
    );
    return;
  }

  if (asString(node.data?.type) === "trigger.whatsapp_message_received") {
    logs.push(
      createLog(node, "success", "WhatsApp message received.", {
        connectionId: context.whatsapp?.connectionId,
        contact: context.contact ?? context.whatsapp?.contact,
        message: context.message ?? context.whatsapp?.message,
        timestamp: context.whatsapp?.timestamp
      })
    );
    return;
  }

  // Voice booking: Phone Call Trigger simulates an inbound call (no missed-call wording).
  if (asString(node.data?.type) === VOICE_NODE_TYPES.phoneCallTrigger) {
    logs.push(
      createLog(node, "success", "Customer call simulated for the assigned Twilio number.", {
        businessName: context.business?.name,
        callerNumber: context.caller_number || context.missedCall?.callerNumber,
        callHandlingMode: asString(node.data?.callHandlingMode, "AI_ANSWERS")
      })
    );
    return;
  }

  const callerNumber = context.missedCall?.callerNumber;

  if (!callerNumber) {
    logs.push(
      createLog(node, "error", "Missing caller phone number. Use Twilio webhook From or enter a verified test recipient.")
    );
    return;
  }

  logs.push(
    createLog(node, "success", "Twilio missed-call event received.", {
      callerNumber,
      timestamp: context.missedCall?.timestamp,
      status: context.missedCall?.status,
      business: context.business
    })
  );
}

function runAiNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  // Voice booking: AI Voice Conversation previews the assistant config (not an SMS reply).
  if (asString(node.data?.type) === VOICE_NODE_TYPES.voiceConversation) {
    const voicePreview = {
      firstMessage: asString(node.data?.firstMessage, "Thanks for calling. How can I help you today?"),
      practiceName: asString(node.data?.practiceName),
      doctorName: asString(node.data?.doctorName),
      voice: asString(node.data?.voice, "triven-default"),
      model: asString(node.data?.model, "gpt-4o-mini"),
      language: asString(node.data?.language, "en-US")
    };
    context.voiceConversation = voicePreview;
    logs.push(
      createLog(
        node,
        "success",
        "Voice assistant prompt generated from AI Voice Conversation node config.",
        voicePreview
      )
    );
    return;
  }

  const prompt = asString(
    node.data?.prompt,
    "Write a friendly missed-call text-back message."
  );

  const business = context.business;
  const businessName = business?.name ?? "the business";
  const businessType = business?.type ? ` (${business.type})` : "";
  const callerName = context.caller_name ? `${context.caller_name}, ` : "";
  const services = business?.services?.length
    ? ` We can help with: ${business.services.slice(0, 5).join(", ")}.`
    : "";
  const booking = business?.bookingUrl
    ? ` You can book here: ${business.bookingUrl}`
    : "";
  const team = business?.teamPhone
    ? ` Or our team can call you from ${business.teamPhone}.`
    : "";

  let output: string;

  if (context.gmail?.subject || context.gmail?.body) {
    output = `Hi, thanks for reaching out to ${businessName}. We saw your message about "${context.gmail.subject ?? "your request"}". ${services}${booking || team ? `${booking}${team}` : "We will help you with the next step shortly."}`.trim();
  } else if (context.inboundSms?.body) {
    const message = context.inboundSms.body.toLowerCase();
    const wantsBooking = /book|appointment|schedule|yes|visit|call/.test(message);
    const asksPrice = /price|cost|fee|charge|rate|how much/.test(message);
    const faqHint = business?.faqs?.[0] ?? business?.knowledge?.[0] ?? "";

    if (wantsBooking && business?.bookingUrl) {
      output = `Absolutely — ${businessName}${businessType} can help. Please book here: ${business.bookingUrl}. ${team}`.trim();
    } else if (asksPrice && faqHint) {
      output = `${callerName}${faqHint} ${booking || team || "Reply with a preferred time and we will help you further."}`.trim();
    } else {
      output = `${callerName}thanks for texting ${businessName}. ${services}${faqHint ? ` ${faqHint}` : ""} ${booking || team || "How can we help you today?"}`.trim();
    }
  } else {
    output = `Hi ${callerName}this is ${businessName}. Sorry we missed your call. We can help by text or voice right now.${services} Would you like to book an appointment or ask a quick question?${booking ? ` ${booking}` : ""}`;
  }

  context.ai = {
    output
  };

  logs.push(
    createLog(node, "success", "Context-aware reply generated.", {
      prompt,
      business,
      inboundSms: context.inboundSms,
      output
    })
  );
}


function scriptedAiFallback(
  node: RunnerNode,
  context: RunnerContext,
  isLlmCall: boolean
): string {
  if (isLlmCall) {
    return "[Simulated output - no LLM key is configured on the backend.]";
  }

  const discardedLogs: WorkflowRunLog[] = [];
  runAiNode(node, context, discardedLogs);

  return asString(context.ai?.output);
}

function nowInZone(timeZone?: string) {
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  let hour = Number(map.hour);
  if (hour === 24) hour = 0;

  return {
    weekday: (map.weekday || "").toLowerCase(),
    minutes: hour * 60 + Number(map.minute)
  };
}

function parseHoursMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Real business-hours evaluation: uses the business's configured weekly hours
 * (from setup) when available, otherwise falls back to Mon–Fri 8:00–18:00.
 */
function evaluateBusinessHours(context: RunnerContext): boolean {
  const { weekday, minutes } = nowInZone(context.business?.timeZone);
  const hours = Array.isArray(context.business?.hours)
    ? (context.business?.hours as Array<Record<string, unknown>>)
    : null;

  if (hours) {
    const today = hours.find(
      (entry) => typeof entry?.day === "string" && entry.day.toLowerCase() === weekday
    );
    if (today) {
      if (today.closed === true) return false;
      const open = parseHoursMinutes(today.open);
      const close = parseHoursMinutes(today.close);
      if (open !== null && close !== null) return minutes >= open && minutes < close;
    }
  }

  const isWeekday = weekday !== "saturday" && weekday !== "sunday";
  return isWeekday && minutes >= 8 * 60 && minutes < 18 * 60;
}

function runConditionNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  const condition = asString(node.data?.condition, "Business hours check");
  const isBusinessHours = evaluateBusinessHours(context);

  context.condition = {
    passed: isBusinessHours,
    label: condition
  };

  logs.push(
    createLog(
      node,
      "success",
      isBusinessHours
        ? `Condition passed: ${condition}`
        : `Condition failed: ${condition}`,
      context.condition
    )
  );
}

async function runSmsConnectorNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "send_sms");

  // Voice booking: Send SMS notifies the customer + business team after booking.
  // Generic node keys are read first; legacy dental key names stay supported.
  if (action === "send_notification") {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const sendToPatient = asString(data.sendToCustomer ?? data.sendToPatient, "true") !== "false";
    const sendToDentist = asString(data.sendToTeam ?? data.sendToDentist, "false") === "true";
    const dentistPhone = asString(data.teamPhone ?? data.dentistPhone);
    const targets = [sendToPatient ? "customer" : null, sendToDentist && dentistPhone ? "team" : null].filter(Boolean);
    context.smsNotification = {
      sendToPatient,
      sendToDentist: sendToDentist && Boolean(dentistPhone),
      patientTemplate: asString(data.customerTemplate ?? data.patientTemplate),
      dentistTemplate: asString(data.teamTemplate ?? data.dentistTemplate),
      mode
    };
    if (mode === "live") {
      logs.push(
        createLog(node, "success", `SMS notification will be sent live to ${targets.join(" and ") || "no one"}.`, context.smsNotification)
      );
    } else {
      logs.push(
        createLog(
          node,
          "success",
          `Dry run passed. SMS would be sent to ${targets.join(" and ") || "no recipients"}.`,
          context.smsNotification
        )
      );
    }
    return;
  }

  if (action === "capture_lead") {
    if (!context.missedCall?.callerNumber) {
      logs.push(createLog(node, "error", "Lead capture failed because caller number is missing."));
      return;
    }

    context.capturedLead = {
      callerNumber: context.missedCall.callerNumber,
      callerName: context.missedCall.callerName,
      businessName: context.missedCall.businessName,
      status: "captured",
      capturedAt: new Date().toISOString()
    };

    logs.push(
      createLog(
        node,
        "success",
        "Lead captured. Conversation can continue by SMS, Vapi voice, booking, FAQ, or team routing.",
        context.capturedLead
      )
    );
    return;
  }

  const defaultBody = context.ai?.output ?? `${smsAttributionPrefix(context.business?.name ?? "The business")}Sorry we missed your call. We can help by text right now.`;
  const actionTo = renderTemplate(node.data?.smsTo, context) || context.caller_number || "";
  const actionBody = renderTemplate(node.data?.smsBody, context) || defaultBody;
  const sendAt = renderTemplate(node.data?.sendAt, context) || "8:00 AM next business day";

  if (!actionTo || !actionBody) {
    logs.push(createLog(node, "error", "SMS failed because To or Message is empty."));
    return;
  }

  if (action === "queue_sms") {
    context.queuedSms = {
      to: actionTo,
      body: actionBody,
      sendAt,
      mode
    };

    logs.push(
      createLog(node, "waiting", `SMS queued for ${sendAt}.`, context.queuedSms)
    );
    return;
  }

  if (mode === "live") {
    const outcome = await sendTrackedSms({
      to: actionTo,
      body: actionBody,
      messageType: "MISSED_CALL_TEXT_BACK",
      businessId: context.business?.id ?? null,
      businessName: context.business?.name ?? null,
      smsPurpose: "SUPPORT_RESPONSE",
      installedAgentId: context.installedAgentId ?? null
    });

    if (!outcome.sent) {
      context.sentSms = {
        id: null,
        to: actionTo,
        body: actionBody,
        mode,
        providerCalled: outcome.attempted,
        twilioTestMode: false,
        executionId: outcome.executionId,
        ...(outcome.suppressed ? { suppressedReason: outcome.errorCode } : {})
      };
      logs.push(
        outcome.suppressed
          ? createLog(
              node,
              "waiting",
              `SMS skipped (${outcome.errorCode}): ${outcome.error ?? "suppressed before the provider request"}`,
              context.sentSms
            )
          : createLog(node, "error", `Twilio SMS failed: ${outcome.error ?? "unknown error"}`, context.sentSms)
      );
      return;
    }

    context.sentSms = {
      id: outcome.messageSid,
      messageSid: outcome.messageSid,
      to: actionTo,
      body: actionBody,
      mode,
      providerCalled: !outcome.simulated,
      twilioTestMode: outcome.simulated,
      executionId: outcome.executionId,
      status: outcome.status
    };

    logs.push(
      createLog(
        node,
        "success",
        outcome.simulated
          ? "Twilio test mode accepted the SMS request. No real SMS was delivered."
          : "Twilio SMS sent through the shared Triven Messaging Service.",
        context.sentSms
      )
    );
    return;
  }

  context.sentSms = {
    id: null,
    to: actionTo,
    body: actionBody,
    mode,
    providerCalled: false,
    twilioTestMode: false
  };

  logs.push(
    createLog(
      node,
      "success",
      "Dry run passed. No Twilio request was made.",
      context.sentSms
    )
  );
}

async function runVapiConnectorNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "start_voice_call");
  const customerPhone = customerPhoneFromContext(context);

  if (!customerPhone) {
    logs.push(createLog(node, "error", "Vapi call failed because caller phone number is missing."));
    return;
  }

  const assistantId = renderTemplate(node.data?.vapiAssistantId, context) || context.business?.vapiAssistantId;
  const phoneNumberId = renderTemplate(node.data?.vapiPhoneNumberId, context) || context.business?.vapiPhoneNumberId;

  if (mode !== "live") {
    context.vapiCall = {
      id: null,
      status: "dry_run",
      customerPhone,
      providerCalled: false
    };
    logs.push(createLog(node, "success", "Dry run passed. No Vapi call was made.", context.vapiCall));
    return;
  }

  if (action !== "start_voice_call") {
    logs.push(createLog(node, "error", `Unsupported Vapi action: ${action}`));
    return;
  }

  const call = await startVapiOutboundCall({
    customerPhone,
    customerName: context.caller_name,
    smsConsentStatus: await getSmsConsentStatusLabel(context.business?.id, customerPhone),
    business: {
      businessId: context.business?.id,
      businessName: context.business?.name ?? "the business",
      businessType: context.business?.type,
      bookingUrl: context.business?.bookingUrl,
      teamPhone: context.business?.teamPhone,
      services: context.business?.services,
      faqs: context.business?.faqs,
      knowledge: context.business?.knowledge,
      tone: context.business?.tone,
      escalationRules: context.business?.escalationRules,
      calendarId: context.business?.calendarId,
      timeZone: context.business?.timeZone
    },
    reason: context.missedCall?.reason ?? "Missed call follow-up",
    assistantId,
    phoneNumberId,
    metadata: {
      businessId: context.business?.id,
      businessOwnerId: context.business?.ownerId,
      installedAgentId: context.installedAgentId,
      listingId: context.listingId,
      conversationId: context.conversationId,
      leadId: context.leadId,
      workflowSource: "workflow_runner"
    }
  });

  context.vapiCall = {
    id: call.id,
    status: call.status,
    customerPhone: call.customerPhone,
    providerCalled: call.providerCalled
  };

  logs.push(createLog(node, "success", "Vapi AI voice call started.", context.vapiCall));
}

async function runGoogleCalendarConnectorNode({
  userId,
  node,
  context,
  logs,
  mode
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "book_appointment");
  const normalizedAction = action.toLowerCase().replace(/[^a-z]/g, "");

  // Calendar Availability — supports check_availability / checkAvailability /
  // check_calendar / calendar.availability. Demo slots when not connected.
  if (normalizedAction.startsWith("check") || normalizedAction.includes("availab")) {
    const timeZoneAvail = context.business?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
    const date = asString(node.data?.date) || new Date().toISOString().slice(0, 10);
    const slotsToOffer = Number(node.data?.slotsToOffer) || 3;
    const demoSlots = ["10:00 AM", "2:00 PM", "4:30 PM"].slice(0, slotsToOffer);

    const ownerId = context.business?.ownerId;
    if (mode !== "live" || !ownerId) {
      context.calendarAvailability = {
        date,
        slots: demoSlots,
        source: "demo",
        calendar_status: ownerId ? undefined : "not_connected"
      };
      logs.push(
        createLog(
          node,
          "success",
          `Calendar not connected. Demo slots returned: ${demoSlots.join(", ")}.`,
          context.calendarAvailability
        )
      );
      return;
    }

    try {
      const availability = await listAvailableSlots({
        userId: ownerId,
        calendarId: renderTemplate(node.data?.calendarId, context) || context.business?.calendarId,
        timeZone: timeZoneAvail,
        date,
        bufferMinutes: Number(node.data?.bufferMinutes) || 10,
        maxSlots: slotsToOffer
      });
      const slots = availability.slots.length ? availability.slots : demoSlots;
      context.calendarAvailability = {
        date,
        slots,
        source: availability.slots.length ? "calendar" : "demo"
      };
      logs.push(
        createLog(node, "success", `Calendar checked. Available slots: ${slots.join(", ")}.`, context.calendarAvailability)
      );
    } catch (error) {
      context.calendarAvailability = { date, slots: demoSlots, source: "demo", calendar_status: "needs_reconnect" };
      logs.push(
        createLog(
          node,
          "success",
          `Calendar not connected. Demo slots returned: ${demoSlots.join(", ")}.`,
          { date, slots: demoSlots, source: "demo", calendar_status: "needs_reconnect", error: error instanceof Error ? error.message : String(error) }
        )
      );
    }
    return;
  }

  if (action !== "book_appointment") {
    logs.push(createLog(node, "error", `Unsupported Google Calendar action: ${action}`));
    return;
  }

  const customerPhone = customerPhoneFromContext(context);
  const businessName = context.business?.name ?? "the business";
  const calendarId = renderTemplate(node.data?.calendarId, context) || context.business?.calendarId || "primary";
  const timeZone = normalizeTimeZone(context.business?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE);
  const service = renderTemplate(node.data?.appointmentService, context) || asString(context.appointmentService, "Appointment");
  context.appointmentService = service;
  const defaultWindow = getDefaultAppointmentWindow(timeZone);
  const configuredStartAt =
    renderTemplate(node.data?.appointmentStartAt, context) || asString(context.appointmentStartAt);

  if (mode === "live" && context.telegram && !customerPhone) {
    logs.push(
      createLog(node, "waiting", "Waiting for the Telegram customer to share their phone number before booking.")
    );
    return;
  }

  if (mode === "live" && context.telegram && !configuredStartAt) {
    logs.push(
      createLog(node, "waiting", "Waiting for the Telegram customer to select an available appointment slot.")
    );
    return;
  }

  const startAtRaw = configuredStartAt || defaultWindow.startAt.toISOString();
  const endAtRaw = renderTemplate(node.data?.appointmentEndAt, context) || asString(context.appointmentEndAt);
  // A naive "YYYY-MM-DDTHH:mm[:ss]" is the tester's wall-clock time in the
  // execution timezone — never the server's local zone.
  const startAt = parseAppointmentInstant(startAtRaw, timeZone);
  // The end defaults to start + 30 min; an explicit end is honored only when
  // it actually follows the start (never the unrelated default-window end).
  const explicitEndAt = endAtRaw ? parseAppointmentInstant(endAtRaw, timeZone) : null;
  const endAt =
    explicitEndAt && !Number.isNaN(explicitEndAt.getTime()) && explicitEndAt.getTime() > startAt.getTime()
      ? explicitEndAt
      : new Date(startAt.getTime() + 30 * 60 * 1000);
  const summary = renderTemplate(node.data?.calendarSummary, context) || `${service} - ${context.caller_name || customerPhone}`;
  const description = renderTemplate(node.data?.calendarDescription, context) || `Booked by Triven AI Receptionist for ${businessName}.`;

  if (Number.isNaN(startAt.getTime())) {
    logs.push(createLog(node, "error", `Could not interpret the appointment start time "${startAtRaw}".`));
    return;
  }

  if (!customerPhone && mode === "live") {
    logs.push(createLog(node, "error", "Calendar booking failed because caller phone number is missing."));
    return;
  }

  if (mode !== "live") {
    const testEvent = await createTestCalendarEvent({
      executionMode: "ARCHITECT_DRY_RUN",
      ownerUserId: userId,
      testSessionId: context.testSessionId,
      serviceName: service,
      customerName: context.caller_name,
      customerPhone,
      startAt,
      endAt,
      timeZone,
      calendarId,
      businessName,
      simulate: context.useTestCalendar !== true
    });

    if (!testEvent.ok) {
      // Never claim the appointment was created when the calendar write failed.
      context.calendarAppointment = {
        id: null,
        calendarId,
        summary,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timeZone,
        status: "FAILED",
        htmlLink: null,
        testEventId: null,
        errorCode: testEvent.error.code,
        remediation: testEvent.error.remediation
      };
      logs.push(createLog(node, "error", `${testEvent.error.message} ${testEvent.error.remediation}`, context.calendarAppointment));
      return;
    }

    context.calendarAppointment = {
      id: testEvent.event.googleEventId,
      calendarId,
      summary: testEvent.event.title,
      startAt: testEvent.event.startAt,
      endAt: testEvent.event.endAt,
      timeZone: testEvent.event.timeZone,
      status: testEvent.event.status,
      htmlLink: testEvent.event.htmlLink,
      testEventId: testEvent.event.testEventId
    };
    logs.push(
      createLog(
        node,
        "success",
        testEvent.event.status === "CREATED"
          ? `Created test calendar event "${testEvent.event.title}" on your connected calendar.`
          : "Dry run passed. Simulated calendar event preview returned (no live calendar write).",
        context.calendarAppointment
      )
    );
    return;
  }

  const appointment = await createGoogleCalendarAppointment({
    userId: context.business?.ownerId || userId,
    calendarId,
    timeZone,
    businessName,
    customerName: context.caller_name,
    customerPhone,
    service,
    startAt,
    endAt,
    description
  });

  context.calendarAppointment = { ...appointment, status: "CREATED" };
  logs.push(createLog(node, "success", "Google Calendar appointment created.", context.calendarAppointment));
}

/**
 * "2026-07-19T15:02[:00]" (naive, no offset) is wall-clock time in `timeZone`;
 * strings with an explicit offset/Z parse as-is.
 */
function parseAppointmentInstant(raw: string, timeZone: string): Date {
  const naive = raw.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (naive) {
    return zonedWallClockToUtc(naive[1] ?? "", Number(naive[2]), Number(naive[3]), timeZone);
  }
  return new Date(raw);
}

async function runGmailConnectorNode({
  node,
  logs
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
}) {
  const action = asString(node.data?.connectorAction, "read_emails");

  logs.push(
    createLog(
      node,
      "error",
      `Gmail action "${action}" is no longer supported — Google connection only grants calendar access. Use the Send Email node instead.`
    )
  );
}

function customerPhoneFromContext(context: RunnerContext) {
  return context.telegram?.phone_number || context.caller_number || context.missedCall?.callerNumber || "";
}

async function runSaveLeadNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const businessId = context.business?.id;
  const phoneNumber = customerPhoneFromContext(context);

  if (mode === "live" && context.telegram && !phoneNumber) {
    logs.push(createLog(node, "waiting", "Waiting for the Telegram customer to share their phone number."));
    return;
  }

  if (mode === "live" && (!businessId || !phoneNumber)) {
    logs.push(createLog(node, "error", "Save Lead failed because business or caller phone is missing."));
    return;
  }

  const status = asString(node.data?.leadStatus, "CAPTURED");
  const source = asString(node.data?.leadSource, "WORKFLOW");
  const name = context.caller_name;

  if (mode === "live") {
    if (!businessId || !phoneNumber) {
      logs.push(createLog(node, "error", "Save Lead failed because business or caller phone is missing."));
      return;
    }
    const lead = await prisma.lead.upsert({
      where: { businessId_phoneNumber: { businessId, phoneNumber } },
      update: { status, name: name || undefined },
      create: { businessId, phoneNumber, source, status, name }
    });
    context.leadId = lead.id;
  }

  context.leadSaved = true;
  context.capturedLead = {
    callerNumber: phoneNumber,
    callerName: name,
    businessName: context.business?.name ?? "the business",
    status,
    capturedAt: new Date().toISOString()
  };

  logs.push(
    createLog(
      node,
      "success",
      mode === "live" ? "Lead saved." : "Dry run: lead not written.",
      context.capturedLead
    )
  );
}

async function runSaveConversationNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const businessId = context.business?.id;
  const phoneNumber = customerPhoneFromContext(context);

  if (!businessId || !phoneNumber) {
    logs.push(createLog(node, "error", "Save Conversation failed because business or caller phone is missing."));
    return;
  }

  const direction = asString(node.data?.conversationDirection, "OUTBOUND").toUpperCase();
  const body =
    renderTemplate(node.data?.conversationBody, context) ||
    context.sentSms?.body ||
    context.ai?.output ||
    "";

  if (!body) {
    logs.push(createLog(node, "error", "Save Conversation failed because the message body is empty."));
    return;
  }

  if (mode === "live") {
    const conversation = await prisma.conversation.upsert({
      where: {
        businessId_channel_customerPhone: { businessId, channel: "SMS", customerPhone: phoneNumber }
      },
      update: { status: "OPEN" },
      create: { businessId, channel: "SMS", customerPhone: phoneNumber, status: "OPEN" }
    });

    // Dedupe: skip if the latest stored message is identical (avoids double-writes
    // when handler orchestration also persists the same message).
    const latest = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" }
    });

    if (!(latest && latest.direction === direction && latest.body === body)) {
      await prisma.conversationMessage.create({
        data: { conversationId: conversation.id, direction, body }
      });
    }

    context.conversationId = conversation.id;
  }

  context.conversationSaved = true;
  context.latestMessage = body;

  logs.push(
    createLog(
      node,
      "success",
      mode === "live" ? `Conversation message saved (${direction}).` : "Dry run: message not written.",
      { direction, body }
    )
  );
}

async function runHumanHandoffNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const businessId = context.business?.id;
  const phoneNumber = customerPhoneFromContext(context);
  const reason =
    renderTemplate(node.data?.handoffReason, context) ||
    context.business?.escalationRules ||
    "Escalated to a human team member.";
  const teamPhone = context.business?.teamPhone;

  if (mode === "live" && businessId && phoneNumber) {
    await prisma.lead.upsert({
      where: { businessId_phoneNumber: { businessId, phoneNumber } },
      update: { status: "ESCALATED", notes: reason },
      create: {
        businessId,
        phoneNumber,
        source: "WORKFLOW",
        status: "ESCALATED",
        notes: reason,
        name: context.caller_name
      }
    });

    const conversation = await prisma.conversation.upsert({
      where: {
        businessId_channel_customerPhone: { businessId, channel: "SMS", customerPhone: phoneNumber }
      },
      update: { status: "OPEN" },
      create: { businessId, channel: "SMS", customerPhone: phoneNumber, status: "OPEN" }
    });

    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "SYSTEM",
        body: `Handoff to human${teamPhone ? ` (${teamPhone})` : ""}: ${reason}`
      }
    });

    context.conversationId = conversation.id;
  }

  context.handoff = { reason, teamPhone };

  logs.push(
    createLog(
      node,
      "success",
      `Human handoff recorded${teamPhone ? ` to ${teamPhone}` : ""}.`,
      context.handoff
    )
  );
}

function forwardInputFromContext(context: RunnerContext): WorkflowRunInput {
  return {
    callerNumber: context.caller_number,
    callerName: context.caller_name,
    businessId: context.business?.id,
    businessOwnerId: context.business?.ownerId,
    businessName: context.business?.name,
    businessType: context.business?.type,
    businessPhoneNumber: context.business?.phoneNumber,
    bookingUrl: context.business?.bookingUrl,
    teamPhone: context.business?.teamPhone,
    calendarId: context.business?.calendarId,
    timeZone: context.business?.timeZone,
    vapiAssistantId: context.business?.vapiAssistantId,
    vapiPhoneNumberId: context.business?.vapiPhoneNumberId,
    services: context.business?.services,
    faqs: context.business?.faqs,
    tone: context.business?.tone,
    escalationRules: context.business?.escalationRules,
    knowledge: context.business?.knowledge,
    businessHours: context.business?.hours,
    inboundSmsBody: context.inboundSms?.body,
    missedCallReason: context.missedCall?.reason,
    conversationId: context.conversationId,
    leadId: context.leadId,
    installedAgentId: context.installedAgentId,
    latestMessage: context.latestMessage ?? context.inboundSms?.body,
    assistantName: context.business?.assistantName
  };
}

async function runTriggerNextWorkflowNode({
  userId,
  node,
  context,
  logs,
  mode,
  chain
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
  chain: WorkflowChain;
}) {
  const targetWorkflowId = renderTemplate(node.data?.nextWorkflowId, context).trim();

  if (!targetWorkflowId) {
    logs.push(createLog(node, "error", "Next Workflow failed: no target workflow id is configured."));
    return;
  }

  if (chain.depth + 1 > MAX_WORKFLOW_CHAIN_DEPTH) {
    logs.push(
      createLog(node, "error", `Next Workflow stopped: max chain depth (${MAX_WORKFLOW_CHAIN_DEPTH}) reached.`)
    );
    return;
  }

  if (targetWorkflowId === chain.workflowId || chain.visited.includes(targetWorkflowId)) {
    logs.push(createLog(node, "error", "Next Workflow stopped: workflow loop detected."));
    return;
  }

  const target = await prisma.workflowDefinition.findUnique({
    where: { id: targetWorkflowId }
  });

  if (!target) {
    logs.push(createLog(node, "error", `Next Workflow failed: workflow ${targetWorkflowId} not found or inactive.`));
    return;
  }

  const childRun = await runWorkflowTest({
    userId,
    workflowId: target.id,
    workflowJson: target.workflowJson,
    input: forwardInputFromContext(context),
    mode,
    chainDepth: chain.depth + 1,
    chainVisited: [...chain.visited, chain.workflowId]
  });

  for (const childLog of childRun.logs) {
    logs.push({ ...childLog, label: `${target.name} › ${childLog.label}` });
  }

  context.nextWorkflow = { workflowId: target.id, name: target.name, ran: true };

  logs.push(
    createLog(node, "success", `Triggered next workflow: ${target.name}.`, {
      workflowId: target.id,
      name: target.name
    })
  );
}

async function runCoreConnectorNode({
  userId,
  node,
  context,
  logs,
  mode,
  chain
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
  chain: WorkflowChain;
}) {
  const action = asString(node.data?.connectorAction);

  if (action === CORE_CONNECTOR_ACTIONS.saveLead) {
    await runSaveLeadNode({ node, context, logs, mode });
    return;
  }

  if (action === CORE_CONNECTOR_ACTIONS.saveConversationMessage) {
    await runSaveConversationNode({ node, context, logs, mode });
    return;
  }

  if (action === CORE_CONNECTOR_ACTIONS.humanHandoff) {
    await runHumanHandoffNode({ node, context, logs, mode });
    return;
  }

  if (action === CORE_CONNECTOR_ACTIONS.triggerNextWorkflow) {
    await runTriggerNextWorkflowNode({ userId, node, context, logs, mode, chain });
    return;
  }

  logs.push(createLog(node, "error", `Triven AI action "${action}" is not executable yet.`));
}

/** "Jul 14, 2026" + "3:00 PM" parts for email templates, in the business zone. */
function emailDateParts(iso: string, timeZone?: string): { date: string; time: string } {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  try {
    return {
      date: parsed.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      time: parsed.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    };
  } catch {
    return { date: parsed.toDateString(), time: "" };
  }
}

async function runEmailConnectorNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  // Reuse the live path's validation by wrapping this one node as a graph.
  let emailConfig = extractSendEmailNodeConfig({ nodes: [node] });
  if (!emailConfig) {
    logs.push(createLog(node, "error", "Send Email node configuration could not be read."));
    return;
  }

  const business = context.business;
  const appointmentIso =
    context.calendarAppointment?.startAt || asString(context.appointmentStartAt) || "";
  const when = appointmentIso ? emailDateParts(appointmentIso, business?.timeZone) : { date: "", time: "" };

  const templateVars: EmailTemplateVariables = {
    customerName: context.caller_name ?? "",
    customerEmail: "",
    businessName: business?.name ?? "",
    appointmentDate: when.date,
    appointmentTime: when.time,
    businessPhone: business?.phoneNumber ?? business?.teamPhone ?? "",
    businessAddress: "",
    callSummary: "",
    serviceName: asString(context.appointmentService) || context.calendarAppointment?.summary || ""
  };

  const subject =
    fillEmailTemplate(emailConfig.subjectTemplate, templateVars) ||
    `Message from ${business?.name ?? "your business"}`;
  const textBody = fillEmailTemplate(emailConfig.bodyTemplate, templateVars);

  if (mode !== "live") {
    // A Test Email on the Test tab turns the dry preview into a real delivery
    // so the architect can verify the confirmation flow before publishing.
    const testRecipient = (context.testEmail ?? "").trim().toLowerCase();

    if (testRecipient && isValidEmailAddress(testRecipient)) {
      if (!isPlatformMailConfigured()) {
        logs.push(
          createLog(node, "waiting", `Email delivery is not configured on this server — the test email to ${testRecipient} was skipped.`)
        );
        return;
      }

      const testVars: EmailTemplateVariables = { ...templateVars, customerEmail: testRecipient };
      const testSubject =
        fillEmailTemplate(emailConfig.subjectTemplate, testVars) ||
        `Message from ${business?.name ?? "your business"}`;
      const testBody = fillEmailTemplate(emailConfig.bodyTemplate, testVars);
      const testHtml = emailConfig.htmlTemplate
        ? sanitizeOutboundHtml(fillEmailTemplate(emailConfig.htmlTemplate, testVars))
        : undefined;

      try {
        // Platform sender: architect tests have no business Mail Setup/alias.
        await sendPlatformEmail({
          purpose: "confirmation",
          to: testRecipient,
          subject: `[Test] ${testSubject}`,
          text: testBody || testSubject,
          html: testHtml
        });

        context.sentEmail = { id: null, to: testRecipient, subject: testSubject, body: testBody || testSubject };

        logs.push(
          createLog(node, "success", `Test email sent to ${testRecipient} — check the inbox to verify it. Live sends use the buyer-configured recipients.`, {
            to: testRecipient,
            subject: testSubject,
            bodyPreview: (testBody || testSubject).slice(0, 400),
            purpose: emailConfig.purpose
          })
        );
      } catch (error) {
        logs.push(
          createLog(
            node,
            "error",
            `Test email to ${testRecipient} could not be sent: ${error instanceof Error ? error.message : "unknown error"}`
          )
        );
      }
      return;
    }

    const recipientPreview =
      emailConfig.recipientType === "team"
        ? "Business team (Mail Setup forwarding address)"
        : emailConfig.recipientType === "custom"
          ? emailConfig.customRecipient || "(no valid custom recipient configured)"
          : emailConfig.recipientType === "variable"
            ? resolveVariableRecipient(emailConfig.recipientVariable, templateVars) ??
              `{{${emailConfig.recipientVariable || "customer.email"}}} (resolved during the live call)`
            : "Customer email (captured during the live call)";

    context.sentEmail = {
      id: null,
      to: recipientPreview,
      subject,
      body: textBody || "(body template is empty — the standard confirmation copy is used live)"
    };

    logs.push(
      createLog(node, "success", "Dry run passed — no email was sent. Enter a Test Email on the Test tab to receive this email for real.", {
        recipientType: emailConfig.recipientType,
        to: recipientPreview,
        ...(emailConfig.cc.length ? { cc: emailConfig.cc } : {}),
        ...(emailConfig.bcc.length ? { bcc: emailConfig.bcc } : {}),
        subject,
        bodyPreview: textBody.slice(0, 400),
        purpose: emailConfig.purpose
      })
    );
    return;
  }

  // Live runner flow (e.g. missed-call workflows) — real send via the alias.
  if (!business?.id) {
    logs.push(
      createLog(node, "error", "Email failed because this run has no business context. Deploy the agent to a business with Mail Setup completed.")
    );
    return;
  }

  // Recipients are buyer-owned: the buyer setup page stores To/CC/BCC on the
  // installed agent, overriding any legacy fields left on the architect node.
  if (context.installedAgentId) {
    const installed = await prisma.installedAgent
      .findUnique({ where: { id: context.installedAgentId }, select: { configJson: true } })
      .catch(() => null);
    emailConfig = applyBuyerEmailRecipients(emailConfig, extractBuyerEmailRecipients(installed?.configJson ?? null));
  }

  const to =
    emailConfig.recipientType === "team"
      ? TEAM_RECIPIENT
      : emailConfig.recipientType === "custom"
        ? emailConfig.customRecipient
        : resolveVariableRecipient(emailConfig.recipientVariable || "customerEmail", templateVars) ?? "";

  if (!to) {
    logs.push(
      createLog(
        node,
        emailConfig.continueOnFailure ? "waiting" : "error",
        "No email recipient could be resolved for this run — email skipped."
      )
    );
    return;
  }

  const htmlBody = emailConfig.htmlTemplate
    ? sanitizeOutboundHtml(fillEmailTemplate(emailConfig.htmlTemplate, templateVars))
    : undefined;
  const purpose =
    emailConfig.purpose !== "auto"
      ? emailConfig.purpose
      : emailConfig.recipientType === "team"
        ? "INTERNAL_NOTIFICATION"
        : "CUSTOMER_FOLLOW_UP";

  const result = await enqueueEmail(
    {
      kind: "business_email",
      input: {
        businessId: business.id,
        to,
        cc: emailConfig.cc,
        bcc: emailConfig.bcc,
        subject,
        textBody: textBody || subject,
        htmlBody,
        purpose,
        idempotencyKey: null,
        metadata: { source: "workflow_runner_send_email_node" }
      }
    },
    { idempotencyKey: null }
  );

  if (!result.ok) {
    logs.push(
      createLog(
        node,
        emailConfig.continueOnFailure ? "waiting" : "error",
        `Email could not be sent: ${result.error ?? "unknown error"}`
      )
    );
    return;
  }

  context.sentEmail = { id: null, to, subject, body: textBody || subject };
  logs.push(createLog(node, "success", "Email queued via the business's Triven proxy address.", { to, subject }));
}

function telegramBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function parseTelegramButtons(value: unknown, context: RunnerContext): TelegramButton[][] {
  const rendered = renderTemplate(value, context);
  if (!rendered.trim()) return [];
  const parsed = JSON.parse(rendered) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Telegram buttons must be a JSON array of rows.");
  return parsed.map((row) => {
    if (!Array.isArray(row)) throw new Error("Each Telegram button row must be a JSON array.");
    return row.map((button) => {
      if (!button || typeof button !== "object" || Array.isArray(button)) {
        throw new Error("Each Telegram button must be an object.");
      }
      const item = button as Record<string, unknown>;
      const buttonText = asString(item.text).trim();
      const callbackData = asString(item.callbackData ?? item.callback_data).trim();
      const url = asString(item.url).trim();
      if (!buttonText || (!callbackData && !url)) {
        throw new Error("Every Telegram button needs text and either callbackData or url.");
      }
      return {
        text: buttonText,
        ...(callbackData ? { callbackData } : {}),
        ...(url ? { url } : {})
      };
    });
  });
}

function telegramActionType(nodeType: string): TelegramActionInput["actionType"] | null {
  const mapping: Record<string, TelegramActionInput["actionType"]> = {
    [TELEGRAM_NODE_TYPES.sendMessage]: TELEGRAM_ACTION_TYPES.sendMessage,
    [TELEGRAM_NODE_TYPES.sendButtons]: TELEGRAM_ACTION_TYPES.sendButtons,
    [TELEGRAM_NODE_TYPES.answerCallback]: TELEGRAM_ACTION_TYPES.answerCallback,
    [TELEGRAM_NODE_TYPES.requestContact]: TELEGRAM_ACTION_TYPES.requestContact,
    [TELEGRAM_NODE_TYPES.sendPhoto]: TELEGRAM_ACTION_TYPES.sendPhoto,
    [TELEGRAM_NODE_TYPES.sendDocument]: TELEGRAM_ACTION_TYPES.sendDocument,
    [TELEGRAM_NODE_TYPES.sendVoice]: TELEGRAM_ACTION_TYPES.sendVoice,
    [TELEGRAM_NODE_TYPES.sendLocation]: TELEGRAM_ACTION_TYPES.sendLocation,
    [TELEGRAM_NODE_TYPES.editMessage]: TELEGRAM_ACTION_TYPES.editMessage,
    [TELEGRAM_NODE_TYPES.deleteMessage]: TELEGRAM_ACTION_TYPES.deleteMessage
  };
  return mapping[nodeType] ?? null;
}

async function resolveTelegramActionChatId(node: RunnerNode, context: RunnerContext): Promise<string> {
  const source = asString(node.data?.telegramRecipientSource, "trigger_chat");
  if (source === "business_owner") {
    if (!context.telegramConnectionId) throw new Error("Telegram connection is missing.");
    const connection = await prisma.telegramBotConnection.findFirst({
      where: {
        id: context.telegramConnectionId,
        businessId: context.business?.id,
        installedAgentId: context.installedAgentId
      },
      select: { ownerChatId: true, ownerNotificationStatus: true }
    });
    if (!connection?.ownerChatId || connection.ownerNotificationStatus !== "CONNECTED") {
      throw new Error("The business owner Telegram notification chat is not connected.");
    }
    return connection.ownerChatId;
  }
  if (source === "stored_customer") {
    if (!context.business?.id || !context.installedAgentId || !context.telegramConnectionId) {
      throw new Error("Telegram tenant context is incomplete.");
    }
    const state = await prisma.telegramConversationState.findFirst({
      where: {
        businessId: context.business.id,
        installedAgentId: context.installedAgentId,
        telegramConnectionId: context.telegramConnectionId,
        telegramUserId: context.telegram?.user_id,
        chatStatus: "ACTIVE"
      },
      orderBy: { updatedAt: "desc" },
      select: { telegramChatId: true }
    });
    if (!state) throw new Error("No stored Telegram chat was found for this customer.");
    return state.telegramChatId;
  }
  const expression = asString(
    node.data?.telegramChatIdExpression,
    source === "manual" ? "" : "{{trigger.telegram.chat.id}}"
  );
  return renderTemplate(expression, context).trim() || context.telegram?.chat_id || "";
}

function dryRunTelegramActionChatId(node: RunnerNode, context: RunnerContext): string {
  const source = asString(node.data?.telegramRecipientSource, "trigger_chat");
  if (source === "business_owner") return "architect-dry-run-owner-chat";
  if (source === "stored_customer") return "architect-dry-run-customer-chat";
  const expression = asString(
    node.data?.telegramChatIdExpression,
    source === "manual" ? "" : "{{trigger.telegram.chat.id}}"
  );
  return renderTemplate(expression, context).trim() || context.telegram?.chat_id || "architect-dry-run-chat";
}

function publishTelegramActionOutput(context: RunnerContext, output: RunnerContext["telegramAction"]) {
  context.telegramAction = output;
  context["telegram.action.success"] = output?.success ?? false;
  context["telegram.action.chatId"] = output?.chatId ?? "";
  context["telegram.action.messageId"] = output?.messageId ?? "";
  context["telegram.action.actionType"] = output?.actionType ?? "";
  context["telegram.action.telegramConnectionId"] = output?.telegramConnectionId ?? "";
}

async function runTelegramConnectorNode({
  node,
  context,
  logs,
  mode
}: {
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const nodeType = asString(node.data?.type);
  const actionType = telegramActionType(nodeType);
  if (!actionType) {
    logs.push(createLog(node, "error", `Unsupported Telegram action node: ${nodeType}`));
    return;
  }
  const chatId =
    mode === "test"
      ? dryRunTelegramActionChatId(node, context)
      : await resolveTelegramActionChatId(node, context);
  const messageId = renderTemplate(node.data?.telegramMessageIdExpression, context).trim();
  const callbackQueryId = renderTemplate(
    node.data?.telegramCallbackIdExpression ?? "{{trigger.telegram.callback.id}}",
    context
  ).trim();
  const textBody = renderTemplate(
    nodeType === TELEGRAM_NODE_TYPES.answerCallback
      ? node.data?.telegramCallbackText
      : node.data?.telegramMessageText,
    context
  );
  const parseModeValue = asString(node.data?.telegramParseMode);
  const parseMode =
    parseModeValue === "HTML" || parseModeValue === "MarkdownV2" ? parseModeValue : undefined;
  const source =
    nodeType === TELEGRAM_NODE_TYPES.sendPhoto
      ? renderTemplate(node.data?.telegramPhotoSource, context)
      : nodeType === TELEGRAM_NODE_TYPES.sendDocument
        ? renderTemplate(node.data?.telegramDocumentSource, context)
        : nodeType === TELEGRAM_NODE_TYPES.sendVoice
          ? renderTemplate(node.data?.telegramVoiceSource, context)
          : undefined;
  const buttons =
    nodeType === TELEGRAM_NODE_TYPES.sendButtons || nodeType === TELEGRAM_NODE_TYPES.editMessage
      ? parseTelegramButtons(node.data?.telegramButtonsJson, context)
      : undefined;

  if (mode === "test") {
    const output = {
      success: true,
      chatId: chatId || "architect-dry-run-chat",
      messageId:
        actionType === TELEGRAM_ACTION_TYPES.answerCallback ||
        actionType === TELEGRAM_ACTION_TYPES.deleteMessage
          ? null
          : `dry-run-${node.id}`,
      actionType,
      telegramConnectionId: context.telegramConnectionId || "dry-run-telegram-connection",
      dryRun: true
    };
    publishTelegramActionOutput(context, output);
    logs.push(
      createLog(node, "success", "Telegram action dry run passed - no Telegram API request was sent.", output)
    );
    return;
  }

  if (!context.business?.id || !context.installedAgentId || !context.telegramConnectionId) {
    throw new Error("Telegram live execution requires business, installed-agent, and connection context.");
  }
  if (
    nodeType === TELEGRAM_NODE_TYPES.requestContact &&
    context.telegram?.chat_type &&
    context.telegram.chat_type !== "private"
  ) {
    throw new Error("Telegram contact requests are only supported in private chats.");
  }
  const output = await executeTelegramActionWithRetry({
    actionType,
    businessId: context.business.id,
    installedAgentId: context.installedAgentId,
    telegramConnectionId: context.telegramConnectionId,
    nodeId: node.id,
    workflowExecutionId: context.workflowRunId,
    idempotencyKey: context.workflowRunId ? `${context.workflowRunId}:${node.id}` : undefined,
    chatId,
    messageId: messageId || undefined,
    callbackQueryId: callbackQueryId || undefined,
    text: textBody,
    caption: renderTemplate(node.data?.telegramCaption, context),
    parseMode,
    buttons,
    source,
    latitude: Number(renderTemplate(node.data?.telegramLatitude, context)),
    longitude: Number(renderTemplate(node.data?.telegramLongitude, context)),
    livePeriod: Number(renderTemplate(node.data?.telegramLivePeriod, context)) || undefined,
    showAlert: telegramBoolean(node.data?.telegramShowAlert),
    url: renderTemplate(node.data?.telegramCallbackUrl, context) || undefined,
    replyToMessageId: renderTemplate(node.data?.telegramReplyToMessageId, context) || undefined,
    disableNotification: telegramBoolean(node.data?.telegramDisableNotification),
    protectContent: telegramBoolean(node.data?.telegramProtectContent),
    contactButtonText: renderTemplate(node.data?.telegramContactButtonText, context) || undefined
  });
  const actionOutput = {
    success: output.success,
    chatId: output.chatId,
    messageId: output.messageId,
    actionType: output.actionType,
    telegramConnectionId: output.telegramConnectionId
  };
  publishTelegramActionOutput(context, actionOutput);
  logs.push(createLog(node, "success", "Telegram action completed.", actionOutput));
}

async function runConnectorNode({
  userId,
  node,
  context,
  logs,
  mode,
  chain
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
  chain: WorkflowChain;
}) {
  // Normalize separator variants ("google_calendar", "Google-Calendar") to the
  // canonical space-separated form before dispatching.
  const nodeType = asString(node.data?.type);
  const connector = asString(node.data?.connector, "SMS").toLowerCase().replace(/[_-]+/g, " ");

  if (telegramActionType(nodeType) || connector === "telegram" || connector === "telegram bot") {
    await runTelegramConnectorNode({ node, context, logs, mode });
    return;
  }

  if (connector === "triven" || connector === "coreai" || connector === "core") {
    await runCoreConnectorNode({ userId, node, context, logs, mode, chain });
    return;
  }

  if (connector === "gmail") {
    await runGmailConnectorNode({
      userId,
      node,
      context,
      logs
    });
    return;
  }

  if (connector === "sms" || connector === "twilio") {
    await runSmsConnectorNode({
      node,
      context,
      logs,
      mode
    });
    return;
  }

  if (connector === "vapi" || connector === "vapi ai") {
    await runVapiConnectorNode({
      node,
      context,
      logs,
      mode
    });
    return;
  }

  if (connector === "google calendar" || connector === "calendar") {
    await runGoogleCalendarConnectorNode({
      userId,
      node,
      context,
      logs,
      mode
    });
    return;
  }

  // Send Email node (Triven proxy email via SES) — registry connector "EMAIL".
  if (connector === "email" || connector === "proxy email") {
    await runEmailConnectorNode({
      node,
      context,
      logs,
      mode
    });
    return;
  }

  if (connector === "whatsapp") {
    await runWhatsAppConnectorNode({
      userId,
      node,
      context,
      logs,
      mode
    });
    return;
  }

  logs.push(createLog(node, "error", `Unsupported connector: ${connector}`));
}

async function runWhatsAppConnectorNode({
  userId,
  node,
  context,
  logs,
  mode
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "send_text");
  const connectionId =
    asString(node.data?.connectionId) || asString(context.whatsapp?.connectionId);

  const recipient =
    renderTemplate(node.data?.recipient ?? node.data?.whatsappTo, context) ||
    context.contact?.phone ||
    context.customer?.phone ||
    context.caller_number ||
    "";

  if (!connectionId) {
    logs.push(createLog(node, "error", "WhatsApp send failed: connectionId is required."));
    return;
  }
  try {
    const whatsappResult = { status: "sent" as string | null, wamid: null as string | null };
    const setContextResult = () => {
      const base = (context.whatsapp ?? {}) as Record<string, unknown>;
      context.whatsapp = {
        ...base,
        status: whatsappResult.status,
        wamid: whatsappResult.wamid
      } as any;
    };

    if (action === "send_text" || action === "send_whatsapp" || action === "send_message") {
      const whatsappMessageType = asString(node.data?.whatsappMessageType ?? "text").toLowerCase();
      const recipientValue = recipient;
      const messageFallback =
        renderTemplate(node.data?.message ?? node.data?.whatsappBody ?? node.data?.smsBody, context) ||
        context.ai?.output ||
        "";

      if (!recipientValue) {
        logs.push(createLog(node, "error", "WhatsApp send failed: recipient is required."));
        return;
      }

      if (whatsappMessageType === "text") {
        const message = messageFallback;
        if (!message) {
          logs.push(createLog(node, "error", "WhatsApp text send failed: message is required."));
          return;
        }

        if (mode !== "live") {
          whatsappResult.status = "dry_run";
          whatsappResult.wamid = null;
          setContextResult();
          logs.push(
            createLog(node, "success", "Dry run passed. WhatsApp text would be sent.", {
              connectionId,
              recipient: recipientValue,
              message
            })
          );
          return;
        }

        const result = await WhatsAppService.sendText({
          connectionId,
          recipient: recipientValue,
          message,
          architectUserId: userId
        });
        whatsappResult.status = "sent";
        whatsappResult.wamid = result.wamid;
        setContextResult();
        logs.push(createLog(node, "success", "WhatsApp message sent.", { wamid: result.wamid, to: result.to }));
        return;
      }

      if (whatsappMessageType === "image" || whatsappMessageType === "document" || whatsappMessageType === "audio" || whatsappMessageType === "video") {
        const mediaType = whatsappMessageType as "image" | "document" | "audio" | "video";
        const mediaId = renderTemplate(node.data?.mediaId, context) || "";
        const mediaLink = renderTemplate(node.data?.mediaLink, context) || "";
        const caption = renderTemplate(node.data?.caption ?? messageFallback, context) || undefined;
        const filename = renderTemplate(node.data?.filename, context) || undefined;

        if (!mediaId && !mediaLink) {
          logs.push(createLog(node, "error", "WhatsApp send failed: mediaId or mediaLink is required."));
          return;
        }

        if (mode !== "live") {
          whatsappResult.status = "dry_run";
          whatsappResult.wamid = null;
          setContextResult();
          logs.push(
            createLog(node, "success", `Dry run passed. WhatsApp ${mediaType} would be sent.`, {
              connectionId,
              recipient: recipientValue,
              mediaType
            })
          );
          return;
        }

        const result = await WhatsAppService.sendMedia({
          connectionId,
          architectUserId: userId,
          recipient: recipientValue,
          mediaType,
          mediaId: mediaId || undefined,
          mediaLink: mediaLink || undefined,
          caption,
          filename
        });
        whatsappResult.status = "sent";
        whatsappResult.wamid = result.wamid;
        setContextResult();
        logs.push(createLog(node, "success", `WhatsApp ${mediaType} sent.`, { wamid: result.wamid, to: result.to }));
        return;
      }

      if (whatsappMessageType === "template") {
        const templateName = asString(node.data?.templateName);
        const languageCode = renderTemplate(node.data?.languageCode, context) || "en_US";
        if (!templateName) {
          logs.push(createLog(node, "error", "WhatsApp template send failed: templateName is required."));
          return;
        }

        if (mode !== "live") {
          whatsappResult.status = "dry_run";
          whatsappResult.wamid = null;
          setContextResult();
          logs.push(
            createLog(node, "success", "Dry run passed. WhatsApp template would be sent.", {
              connectionId,
              recipient: recipientValue,
              templateName
            })
          );
          return;
        }

        const result = await WhatsAppService.sendTemplate({
          connectionId,
          architectUserId: userId,
          recipient: recipientValue,
          templateName,
          languageCode
        });
        whatsappResult.status = "sent";
        whatsappResult.wamid = result.wamid;
        setContextResult();
        logs.push(createLog(node, "success", "WhatsApp template sent.", { wamid: result.wamid, to: result.to }));
        return;
      }
    }

    if (action === "send_media") {
      const mediaType = asString(node.data?.mediaType);
      const mediaId = renderTemplate(node.data?.mediaId, context) || "";
      const mediaLink = renderTemplate(node.data?.mediaLink, context) || "";
      const caption = renderTemplate(node.data?.caption ?? node.data?.message, context) || undefined;
      const filename = renderTemplate(node.data?.filename, context) || undefined;

      if (!recipient) {
        logs.push(createLog(node, "error", "WhatsApp send failed: recipient is required."));
        return;
      }
      if (!mediaType) {
        logs.push(createLog(node, "error", "WhatsApp send failed: mediaType is required."));
        return;
      }
      if (!mediaId && !mediaLink) {
        logs.push(createLog(node, "error", "WhatsApp send failed: mediaId or mediaLink is required."));
        return;
      }

      if (mode !== "live") {
        whatsappResult.status = "dry_run";
        whatsappResult.wamid = null;
        setContextResult();
        logs.push(
          createLog(node, "success", `Dry run passed. WhatsApp ${mediaType} would be sent.`, {
            connectionId,
            recipient,
            mediaType
          })
        );
        return;
      }

      const result = await WhatsAppService.sendMedia({
        connectionId,
        architectUserId: userId,
        recipient,
        mediaType: mediaType as "image" | "document" | "audio" | "video",
        mediaId: mediaId || undefined,
        mediaLink: mediaLink || undefined,
        caption,
        filename
      });
      whatsappResult.status = "sent";
      whatsappResult.wamid = result.wamid;
      setContextResult();
      logs.push(createLog(node, "success", `WhatsApp ${mediaType} sent.`, { wamid: result.wamid, to: result.to }));
      return;
    }

    if (action === "send_template") {
      const templateName = asString(node.data?.templateName);
      const languageCode = renderTemplate(node.data?.languageCode, context) || "en_US";
      if (!recipient) {
        logs.push(createLog(node, "error", "WhatsApp template send failed: recipient is required."));
        return;
      }
      if (!templateName) {
        logs.push(createLog(node, "error", "WhatsApp template send failed: templateName is required."));
        return;
      }

      if (mode !== "live") {
        whatsappResult.status = "dry_run";
        whatsappResult.wamid = null;
        setContextResult();
        logs.push(
          createLog(node, "success", "Dry run passed. WhatsApp template would be sent.", {
            connectionId,
            recipient,
            templateName
          })
        );
        return;
      }

      const result = await WhatsAppService.sendTemplate({
        connectionId,
        architectUserId: userId,
        recipient,
        templateName,
        languageCode
      });
      whatsappResult.status = "sent";
      whatsappResult.wamid = result.wamid;
      setContextResult();
      logs.push(createLog(node, "success", "WhatsApp template sent.", { wamid: result.wamid, to: result.to }));
      return;
    }

    if (action === "mark_read") {
      const messageId = renderTemplate(node.data?.messageId, context);
      if (!messageId) {
        logs.push(createLog(node, "error", "WhatsApp mark_read failed: messageId is required."));
        return;
      }

      if (mode !== "live") {
        whatsappResult.status = "dry_run";
        whatsappResult.wamid = messageId;
        setContextResult();
        logs.push(createLog(node, "success", "Dry run passed. WhatsApp message would be marked as read.", { connectionId, messageId }));
        return;
      }

      await WhatsAppService.markRead({
        connectionId,
        messageId,
        architectUserId: userId
      });
      whatsappResult.status = "read";
      whatsappResult.wamid = messageId;
      setContextResult();
      logs.push(createLog(node, "success", "WhatsApp message marked as read.", { messageId }));
      return;
    }

    logs.push(createLog(node, "error", `Unsupported WhatsApp action: ${action}`));
  } catch (error) {
    const messageText =
      error instanceof WhatsAppServiceError
        ? error.message
        : error instanceof Error
          ? error.message
          : "WhatsApp send failed";
    logs.push(createLog(node, "error", messageText));
  }
}

function runOutputNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  const isTelegramWorkflow = Boolean(context.telegram);
  // Voice booking: End Flow closes a voice workflow (no missed-call output key/wording).
  const isEndFlow = asString(node.data?.type) === VOICE_NODE_TYPES.endFlow;
  const isVoiceWorkflow =
    !isTelegramWorkflow && (isEndFlow || Boolean(context.voiceConversation || context.calendarAvailability));

  const outputKey = asString(
    node.data?.outputKey,
    isTelegramWorkflow ? "telegramResult" : isVoiceWorkflow ? "voiceBookingResult" : "missedCallTextBackResult"
  );

  // If one or more LLM Call nodes ran, surface the final LLM output as the
  // primary result value, with the full pipeline map attached so every node's
  // output is visible in the test panel.
  const hasLlmPipeline =
    context.llmPipeline &&
    typeof context.llmPipeline === "object" &&
    Object.keys(context.llmPipeline as Record<string, unknown>).length > 0;

  context.output = {
    key: outputKey,
    value: hasLlmPipeline
      ? {
          finalOutput: context.ai?.output ?? "",
          pipeline: context.llmPipeline,
        }
      : (context.calendarAppointment ??
        context.calendarAvailability ??
        context.smsNotification ??
        context.voiceConversation ??
        context.capturedLead ??
        context.vapiCall ??
        context.sentSms ??
        context.queuedSms ??
        context.sentEmail ??
        context.draftEmail ??
        context.ai ??
        context.gmail ??
        context.telegram ??
        context.missedCall ??
        null)
  };

  if (isTelegramWorkflow) {
    logs.push(createLog(node, "success", "Telegram workflow run completed.", context.output));
    return;
  }

  if (isVoiceWorkflow) {
    logs.push(
      createLog(node, "success", "Voice booking workflow dry run completed.", context.output)
    );
    return;
  }

  if (hasLlmPipeline) {
    const pipelineCount = Object.keys(context.llmPipeline as Record<string, unknown>).length;
    logs.push(
      createLog(
        node,
        "success",
        `LLM pipeline complete — ${pipelineCount} node(s) ran. Final output saved as ${outputKey}.`,
        context.output
      )
    );
    return;
  }

  logs.push(createLog(node, "success", `Output saved as ${outputKey}.`, context.output));
}

function seedNodeVariablesInContext(context: Record<string, any>, nodes: any[]) {
  for (const node of nodes) {
    if (!node || !node.id) continue;

    const data = node.data || {};
    const id = node.id;
    const label = String(data.title ?? data.label ?? id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/(^\.|\.$)/g, "");

    const originalLabel = String(data.title ?? data.label ?? id);

    const nodeObj: Record<string, any> = {};

    for (const [propKey, propVal] of Object.entries(data)) {
      nodeObj[propKey] = propVal;

      if (propKey === "assistantName") {
        nodeObj["assistant"] = { name: propVal };
        nodeObj["assistent"] = { name: propVal };
        nodeObj["assistant.name"] = propVal;
        nodeObj["assistent.name"] = propVal;
        nodeObj["assistant_name"] = propVal;
        nodeObj["assistent_name"] = propVal;
        nodeObj["assistentName"] = propVal;
      }
      if (propKey === "businessName") {
        nodeObj["business"] = { name: propVal };
        nodeObj["business.name"] = propVal;
        nodeObj["business_name"] = propVal;
      }
    }

    if (!context.node || typeof context.node !== "object") {
      context.node = {};
    }
    context.node[id] = { ...context.node[id], ...nodeObj };
    context.node[label] = { ...context.node[label], ...nodeObj };
    if (originalLabel) {
      context.node[originalLabel] = { ...context.node[originalLabel], ...nodeObj };
    }
  }
}

async function runMemoryNodeInRunner({
  workflowRunId,
  workflowId,
  businessId,
  installedAgentId,
  triggeredByUserId,
  threadId,
  executionOrder,
  node,
  context,
  logs
}: {
  workflowRunId?: string;
  workflowId?: string;
  businessId?: string;
  installedAgentId?: string;
  triggeredByUserId?: string;
  threadId?: string;
  executionOrder: number;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
}) {
  const attachments = (Array.isArray(node.data?.attachments) ? node.data.attachments : []) as any[];
  const customNotes =
    asString(node.data?.customMemoryNotes) || asString(node.data?.notes) || asString(node.data?.customNotes);

  const smartMemory = await buildSmartMemory({
    executedNodes: logs.map((l) => ({ nodeId: l.nodeId, label: l.label, status: l.status, message: l.message, output: l.output })),
    variables: context as Record<string, unknown>,
    attachments,
    customNotes,
    scope: {
      businessId,
      installedAgentId,
      // Architect identity only when no business owns the run — keeps dry-run
      // memory separate per architect without mixing into buyer scopes.
      architectUserId: businessId ? undefined : triggeredByUserId,
      workflowId,
      workflowRunId,
      // No threadId here: the runner's threadId is a fresh synthetic id per
      // run, which would break cross-call continuity. Conversations continue
      // per test session (canvas runs) or per caller (live runs) instead.
      nodeId: node.id,
      testSessionId: asString(context.testSessionId) || undefined,
      callerKey: context.missedCall?.callerNumber || undefined
    }
  });
  const compactMemoryText = smartMemory.memory;
  memoryScopeByContext.set(context as object, smartMemory.scopeKey);

  context.memory = compactMemoryText;
  (context as Record<string, unknown>)["memory"] = compactMemoryText;

  if (workflowRunId) {
    await memoryBroker.saveNodeMemory({
      workflowRunId,
      nodeId: node.id,
      nodeType: "ai.memory",
      nodeLabel: asString(node.data?.title ?? node.data?.label) || node.id,
      status: "success",
      executionOrder,
      threadId,
      output: { memory: compactMemoryText },
      summary: "Memory Node aggregated previous node executions and attachments",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    });
  }

  logs.push(
    createLog(
      node,
      "success",
      "Stored and aggregated previous step executions and manual attachments into compact memory string {{memory}}.",
      { memory: compactMemoryText }
    )
  );
}

export async function runWorkflowTest({
  userId,
  workflowId,
  workflowJson,
  input,
  mode = "test",
  executionMode,
  callProvider,
  externalCallId,
  chainDepth = 0,
  chainVisited = []
}: {
  userId: string;
  workflowId: string;
  workflowJson: unknown;
  input?: WorkflowRunInput;
  mode?: WorkflowRunMode;
  /** Explicit run classification stored on WorkflowRun (wins over `mode`). */
  executionMode?: "ARCHITECT_DRY_RUN" | "BUSINESS_TEST" | "LIVE";
  /** External call linkage (e.g. TWILIO + CallSid): duplicate webhook
   * deliveries throw DuplicateWorkflowRunError before any side effect runs. */
  callProvider?: string;
  externalCallId?: string;
  chainDepth?: number;
  chainVisited?: string[];
}) {
  const parsedWorkflow = parseRunnerWorkflowJson(workflowJson);
  const logs: WorkflowRunLog[] = [];
  const context: RunnerContext = seedMissedCallContext(input, parsedWorkflow.nodes, mode);
  const isTelegramWorkflow = Boolean(context.telegram);
  const chain: WorkflowChain = { depth: chainDepth, visited: chainVisited, workflowId };

  // Set assistantName on context.business if not set
  const voiceNode = parsedWorkflow.nodes.find((n) => asString(n.data?.type) === VOICE_NODE_TYPES.voiceConversation);
  if (voiceNode && context.business) {
    const nodeAssistantName = asString(voiceNode.data?.assistantName);
    if (nodeAssistantName && !nodeAssistantName.includes("{{") && !context.business.assistantName) {
      context.business.assistantName = nodeAssistantName;
    }
  }

  // Seed all node-specific variables/properties to context for template resolution
  seedNodeVariablesInContext(context as any, parsedWorkflow.nodes);

  if (parsedWorkflow.nodes.length === 0) {
    return {
      workflowId,
      logs: [
        {
          nodeId: "empty",
          label: "Empty agent",
          status: "error" as const,
          message: "Please add at least one node before running a test."
        }
      ],
      context
    };
  }

  const { workflowRunId, threadId } = await createWorkflowRun({
    workflowId,
    triggeredByUserId: userId,
    businessId: input?.businessId,
    installedAgentId: input?.installedAgentId,
    mode,
    executionMode,
    callProvider,
    externalCallId,
    inputJson: input as Record<string, unknown> | undefined,
  });
  context.workflowRunId = workflowRunId;

  let executionOrder = 0;
  let runFailed = false;

  try {
    const nodesToRun = isTelegramWorkflow
      ? sortTelegramNodesForRun(parsedWorkflow.nodes, parsedWorkflow.edges, context)
      : sortNodesForRun(parsedWorkflow.nodes, parsedWorkflow.edges);
    for (const node of nodesToRun) {
      if (runFailed) {
        break;
      }

      const nodeKind = asString(node.data?.nodeKind);

      try {
        if (nodeKind === "trigger") {
          runTriggerNode(node, context, logs);
          const triggerFiles = Array.isArray(input?.attachments)
            ? input.attachments.map((att: any) => ({
                name: att.name,
                url: att.data,
                mimeType: att.mimeType,
              }))
            : undefined;

          const triggerOutput: Record<string, unknown> = {};
          if (context.caller_number) triggerOutput.callerNumber = context.caller_number;
          if (context.inboundSms) triggerOutput.inboundSms = context.inboundSms;
          if (context.missedCall) triggerOutput.missedCall = context.missedCall;
          if (context.business) triggerOutput.business = context.business;
          if (input?.latestMessage) triggerOutput.message = input.latestMessage;

          await memoryBroker.saveNodeMemory({
            workflowRunId,
            nodeId: node.id,
            nodeType: asString(node.data?.type, "trigger"),
            nodeLabel: asString(node.data?.title ?? node.data?.label),
            status: "success",
            executionOrder: executionOrder++,
            threadId,
            input: input as Record<string, unknown> | undefined,
            output: triggerOutput,
            files: triggerFiles,
            summary: "Trigger fired",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          });
          continue;
        }

        if (nodeKind === "connector") {
          await runConnectorNode({
            userId,
            node,
            context,
            logs,
            mode,
            chain
          });
          continue;
        }

        if (nodeKind === "ai") {
          if (asString(node.data?.type) === "ai.memory") {
            await runMemoryNodeInRunner({
              workflowRunId,
              workflowId,
              businessId: input?.businessId,
              installedAgentId: input?.installedAgentId,
              triggeredByUserId: userId,
              threadId,
              executionOrder: executionOrder++,
              node,
              context,
              logs
            });
            continue;
          }

          if (shouldUseProviderEngine(node, mode)) {
            const aiConfig = toAiBrainNodeConfig(node, context);
            await deliverMemoryToAiConfig(aiConfig, context);

            const result = await runAiBrainNode({
              workflowRunId,
              threadId,
              executionOrder: executionOrder++,
              node: aiConfig,
            });

            const isLlmCall = asString(node.data?.type) === "ai.llm_call";

            const simulatedReply =
              result.missingCredentials && mode === "test"
                ? scriptedAiFallback(node, context, isLlmCall)
                : null;

            const outputText = simulatedReply ?? result.text ?? "";

            // Always update context.ai so generic downstream nodes see it
            context.ai = { output: outputText };

            if (isLlmCall) {
              const outputKey = asString(node.data?.llmOutputKey, "ai.output");
              context[outputKey] = outputText;
              const nodeLabel = asString(node.data?.title ?? node.data?.label, node.id)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ".")
                .replace(/(^\.|\.$)/g, "");
              context[`node.${node.id}.output`] = outputText;
              context[`node.${nodeLabel}.output`] = outputText;

              if (!context.llmPipeline || typeof context.llmPipeline !== "object") {
                context.llmPipeline = {};
              }
              (context.llmPipeline as Record<string, unknown>)[node.id] = {
                label: asString(node.data?.title ?? node.data?.label, node.id),
                outputKey,
                output: outputText,
                providerId: result.providerId,
                modelName: result.modelName,
              };
            }

            const completedMessage = isLlmCall
              ? `LLM Call completed via ${result.providerId} (${result.modelName}).`
              : "AI Brain node completed.";

            logs.push(
              createLog(
                node,
                simulatedReply !== null || result.status === "success" ? "success" : "error",
                simulatedReply !== null
                  ? `Simulated reply - ${MISSING_LLM_CREDENTIALS_MESSAGE}`
                  : result.fallbackFromProviderId
                    ? `${completedMessage} ${result.fallbackFromProviderId} has no API key configured, so ${result.providerId} ran instead.`
                    : result.error ?? completedMessage,
                {
                  text: outputText,
                  providerId: result.providerId,
                  modelName: result.modelName,
                  nodeRunId: result.nodeRunId,
                  ...(simulatedReply !== null
                    ? { simulated: true, reason: "missing-llm-credentials" }
                    : {}),
                  ...(result.fallbackFromProviderId
                    ? { fallbackFromProviderId: result.fallbackFromProviderId }
                    : {}),
                  ...(isLlmCall ? { outputKey: asString(node.data?.llmOutputKey, "ai.output") } : {}),
                }
              )
            );

            if (simulatedReply === null && result.status === "error") runFailed = true;
          } else {
            runAiNode(node, context, logs);
          }
          continue;
        }

        if (nodeKind === "condition") {
          runConditionNode(node, context, logs);
          continue;
        }

        if (nodeKind === "output") {
          runOutputNode(node, context, logs);
          continue;
        }

        logs.push(createLog(node, "error", `Unknown node kind: ${nodeKind}`));
      } catch (error) {
        runFailed = true;
        logs.push(
          createLog(
            node,
            "error",
            error instanceof Error ? error.message : "Node execution failed"
          )
        );
      }

      // Check if this node execution produced an error log
      const hasErrorLog = logs.some(l => l.nodeId === node.id && l.status === "error");
      if (hasErrorLog || runFailed) {
        runFailed = true;
        break;
      }
    }
  } catch (error) {
    await failWorkflowRun(
      workflowRunId,
      error instanceof Error ? error.message : "Workflow run failed"
    );
    throw error;
  }

  if (runFailed) {
    await failWorkflowRun(workflowRunId, "One or more nodes failed");
  } else {
    await completeWorkflowRun(workflowRunId);
  }

  return {
    workflowId,
    workflowRunId,
    logs,
    context
  };
}
