import {
  API_CALL_DEFAULT_OUTPUT_KEY,
  API_CALL_MAX_PER_RUN,
  API_CALL_NODE_TYPE,
  CALENDLY_LEGACY_TRIGGER_TYPES,
  CALENDLY_NODE_TYPES,
  CORE_CONNECTOR_ACTIONS,
  DEEPGRAM_NODE_TYPES,
  getNodeDoors,
  isBlockNodeType,
  isDesignBrainNodeType,
  nodeDoorsEnabled,
  resolveDeepgramMode,
  MAX_WORKFLOW_CHAIN_DEPTH,
  NODE_DOORS_DISABLED_KEY,
  SCHEDULE_NODE_TYPE,
  TELEGRAM_NODE_TYPES,
  WEBHOOK_NODE_TYPE,
  VOICE_NODE_TYPES,
  calendlyActionPaidPlanNote,
  normalizeTimeZone,
  zonedWallClockToUtc,
  type NodeDoorSpec
} from "@coreai/shared";
import { mayCallNumber } from "./call-consent";
import { maskPhone } from "../compliance/log-redaction";
import {
  createDoorBudget,
  runEntryDoor,
  runExitDoor,
  type DoorBudget,
  type DoorContext
} from "../agent-runtime/node-doors";
import { executeScript } from "../agent-runtime/script-executor";
import { safeFetch, SafeFetchError, type SafeFetchErrorCode } from "../../lib/safe-fetch";
import { getArchitectSecretValue, getPlatformYouTubeKey } from "./architect-secrets";
import { executeImageGeneration } from "../ai-provider-engine/langchain/langchain-image-executor";
import { transcribeWithDeepgram, speakWithDeepgram } from "../ai-provider-engine/deepgram-stt";
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
import { reserveSlotForInstant, topAlternativeLabels } from "../business/scheduling";
import { startVapiOutboundCall } from "./vapi-connector";
import {
  calendlyBookMeetingForInvitee,
  calendlyCancelScheduledEvent,
  calendlyCreateContact,
  calendlyCreateOneOffMeetingLink,
  calendlyCreateSchedulingLink,
  calendlyDeleteContact,
  calendlyFindInviteeByEmail,
  calendlyFindUser,
  calendlyGetAvailability,
  calendlyGetContact,
  calendlyGetEvent,
  calendlyGetInvitee,
  calendlyGetMeetingRecap,
  calendlyGetMeetingRecapTranscript,
  calendlyGetUser,
  calendlyListContacts,
  calendlyListEventTypes,
  calendlyListEvents,
  calendlyListInvitees,
  calendlyMarkInviteeNoShow,
  calendlyUpdateContact,
  isCalendlyPlanRestrictionError,
  isCalendlySampleResourceId,
  normalizeCalendlyResourceId
} from "../calendly/calendly-connector";
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
import { executeArchitectTelegramTestAction } from "./architect-telegram-test-actions";

/** Threaded through the runner to bound workflow-to-workflow chaining. */
type WorkflowChain = {
  depth: number;
  visited: string[];
  workflowId: string;
  /**
   * The door allowance this whole chain shares. It rides on the chain because
   * the chain is the one thing already threaded to every place a run can spawn
   * another one — so a child workflow can never quietly start a fresh budget.
   */
  doorBudget: DoorBudget;
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
  business?: unknown;
  contactName?: string;
  address?: string;
  servicesList?: string;
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
  userName?: string;
  customerName?: string;
  customerFirstName?: string;
  customerLastName?: string;
  history?: Array<{ direction: string; body: string }>;
  messages?: Array<{ direction: string; body: string }>;
  telegramChatId?: string;
  telegramConnectionId?: string;
  /** Encrypted Architect-owned test bot credential used for live Telegram tests. */
  architectTelegramTestConnectionId?: string;
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
  /**
   * An inbound delivery from the public /webhook/in/<token> route. The body is
   * whatever the other app sent; templates read it as {{webhook.body.x}}.
   */
  webhook?: {
    endpointId: string;
    deliveryId: string;
    receivedAt: string;
    headers: Record<string, string>;
    body: unknown;
  };
  /**
   * True when this run came from a widget embedded on a business's own
   * website. Such a run gets the business's REAL context — real calendar, real
   * leads — but never the outbound channels: the page is public, so a stranger
   * could otherwise make the business text or call any number in the world on
   * their account. See modules/agent-pages/embed-live.ts.
   */
  embedSource?: boolean;
  /** A tick from the schedule (timer) trigger — no human, no caller. */
  schedule?: {
    scheduleId: string;
    nodeId: string;
    cadence: string;
    timeZone: string;
    /** The slot this run belongs to, not the moment the sweep noticed it. */
    dueAt: string;
  };
  /** Free-form trigger message for manual / webhook-started runs. */
  message?: string;
  /** Calendly webhook event type mapped to a trigger node slug. */
  triggerType?: string;
  /** Raw Calendly webhook payload fields for downstream nodes. */
  calendly?: Record<string, unknown>;
  /** Architect Test console overrides for Calendly action nodes. */
  calendlyEventTypeUri?: string;
  calendlyEventUuid?: string;
  calendlyInviteeUuid?: string;
  calendlyStartTime?: string;
  calendlyEndTime?: string;
  calendlyStatus?: string;
  calendlyTimezone?: string;
  calendlyCancelReason?: string;
  calendlyContactUuid?: string;
  calendlyContactEmail?: string;
  calendlyContactFirstName?: string;
  calendlyContactLastName?: string;
  calendlyContactName?: string;
  calendlyDurationMinutes?: string;
  calendlyOneOffStartDate?: string;
  calendlyOneOffEndDate?: string;
  calendlyMeetingRecapUuid?: string;
  calendlyUserSearch?: string;
  calendlyUserUuid?: string;
  /** Architect Test console sample fields for Calendly trigger simulation. */
  calendlyTriggerEvent?: string;
  calendlyInviteeName?: string;
  calendlyInviteeEmail?: string;
  calendlyMeetingName?: string;
  calendlyLocationKind?: string;
  calendlyLocation?: string;
};

type RunnerNodeData = {
  label?: unknown;
  title?: unknown;
  nodeKind?: unknown;
  kind?: unknown;
  description?: unknown;
  prompt?: unknown;
  reference_image?: unknown;
  imageSize?: unknown;
  connector?: unknown;
  connectorAction?: unknown;
  // Outbound call target ("Who to call"), template-friendly.
  callTo?: unknown;
  // Schedule (timer) trigger config
  cadence?: unknown;
  timeZone?: unknown;
  hour?: unknown;
  minute?: unknown;
  weekday?: unknown;
  // API Call node config
  apiMethod?: unknown;
  apiUrl?: unknown;
  apiHeaders?: unknown;
  apiBody?: unknown;
  apiKeySource?: unknown;
  apiKeyName?: unknown;
  apiKeyInjection?: unknown;
  apiKeyParam?: unknown;
  apiKeyPrefix?: unknown;
  apiOutputKey?: unknown;
  gmailQuery?: unknown;
  gmailTo?: unknown;
  gmailSubject?: unknown;
  gmailBody?: unknown;
  calendlyEventTypeUri?: unknown;
  calendlyEventUuid?: unknown;
  calendlyInviteeUuid?: unknown;
  calendlyStartTime?: unknown;
  calendlyEndTime?: unknown;
  calendlyTimezone?: unknown;
  calendlyStatus?: unknown;
  calendlyEvent?: unknown;
  calendlyCancelReason?: unknown;
  calendlyContactUuid?: unknown;
  calendlyContactEmail?: unknown;
  calendlyContactFirstName?: unknown;
  calendlyContactLastName?: unknown;
  calendlyContactName?: unknown;
  calendlyDurationMinutes?: unknown;
  calendlyOneOffStartDate?: unknown;
  calendlyOneOffEndDate?: unknown;
  calendlyMeetingRecapUuid?: unknown;
  calendlyUserSearch?: unknown;
  calendlyUserUuid?: unknown;
  calendlyInviteeName?: unknown;
  calendlyInviteeEmail?: unknown;
  calendlyMeetingName?: unknown;
  calendlyLocationKind?: unknown;
  calendlyLocation?: unknown;
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
  // Code node fields (logic.script) — set from the workflow builder inspector
  scriptLanguage?: unknown;
  scriptCode?: unknown;
  scriptOutputKey?: unknown;
  scriptTimeoutMs?: unknown;
  audioSource?: unknown;
  smartFormat?: unknown;
  punctuate?: unknown;
  diarize?: unknown;
  textSource?: unknown;
  text?: unknown;
  mode?: unknown;
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
  /** Set when the run came in through the public webhook link. */
  webhook?: {
    endpointId: string;
    deliveryId: string;
    receivedAt: string;
    headers: Record<string, string>;
    body: unknown;
  };
  /** Set when the run came from a widget on a business's own website. */
  embedSource?: boolean;
  /** Set when the run came from the timer, not a person. */
  schedule?: {
    scheduleId: string;
    nodeId: string;
    cadence: string;
    timeZone: string;
    dueAt: string;
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
  architectTelegramTestConnectionId?: string;
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
  calendly?: Record<string, unknown>;
  calendlyEventTypeUri?: string;
  calendlyEventUuid?: string;
  calendlyInviteeUuid?: string;
  calendlyStartTime?: string;
  calendlyEndTime?: string;
  calendlyStatus?: string;
  calendlyTimezone?: string;
  calendlyCancelReason?: string;
  calendlyContactUuid?: string;
  calendlyContactEmail?: string;
  calendlyContactFirstName?: string;
  calendlyContactLastName?: string;
  calendlyContactName?: string;
  calendlyDurationMinutes?: string;
  calendlyOneOffStartDate?: string;
  calendlyOneOffEndDate?: string;
  calendlyMeetingRecapUuid?: string;
  calendlyUserSearch?: string;
  calendlyUserUuid?: string;
  calendlyInviteeName?: string;
  calendlyInviteeEmail?: string;
  calendlyMeetingName?: string;
  calendlyLocationKind?: string;
  calendlyLocation?: string;
  calendly_event_type_uri?: string;
  calendly_event_uuid?: string;
  calendly_invitee_uuid?: string;
  calendly_start_time?: string;
  calendly_end_time?: string;
  calendly_status?: string;
  calendly_cancel_reason?: string;
  calendly_contact_uuid?: string;
  calendly_contact_email?: string;
  calendly_contact_first_name?: string;
  calendly_contact_last_name?: string;
  calendly_contact_name?: string;
  calendly_duration_minutes?: string;
  calendly_one_off_start_date?: string;
  calendly_one_off_end_date?: string;
  calendly_meeting_recap_uuid?: string;
  calendly_user_search?: string;
  calendly_user_uuid?: string;
  calendly_invitee_name?: string;
  calendly_invitee_email?: string;
  calendly_meeting_name?: string;
  calendly_location_kind?: string;
  calendly_location?: string;
  triggerType?: string;
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
  /** Accumulated per-node outputs for Image Generation pipelines (ai.image_generation nodes). */
  imagePipeline?: Record<string, {
    label: string;
    imageUrl: string;
    prompt: string;
    model: string;
    revisedPrompt?: string;
  }>;
  [key: string]: unknown;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/** Prefer the first non-empty trimmed string (empty node fields must not block test overrides). */
function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Accepts YYYY-MM-DD or datetime-local values and returns YYYY-MM-DD. */
function toCalendlyDateOnly(raw: string): string {
  const match = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
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

export function groupNodesIntoExecutionWaves(
  nodes: RunnerNode[],
  edges: RunnerEdge[]
): RunnerNode[][] {
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

  const processed = new Set<string>();
  const waves: RunnerNode[][] = [];

  let currentWaveIds = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    .map((n) => n.id);

  while (currentWaveIds.length > 0) {
    const currentWaveNodes: RunnerNode[] = [];
    const nextWaveCandidates = new Set<string>();

    for (const id of currentWaveIds) {
      if (processed.has(id)) continue;
      processed.add(id);
      const node = nodeById.get(id);
      if (node) currentWaveNodes.push(node);

      for (const targetId of outgoing.get(id) ?? []) {
        const currentDeg = inDegree.get(targetId) ?? 1;
        const nextDeg = Math.max(0, currentDeg - 1);
        inDegree.set(targetId, nextDeg);
        if (nextDeg === 0 && !processed.has(targetId)) {
          nextWaveCandidates.add(targetId);
        }
      }
    }

    if (currentWaveNodes.length > 0) {
      waves.push(currentWaveNodes);
    }

    currentWaveIds = Array.from(nextWaveCandidates)
      .filter((id) => !processed.has(id))
      .sort((a, b) => {
        const aNode = nodeById.get(a);
        const bNode = nodeById.get(b);
        return (aNode?.position?.x ?? 0) - (bNode?.position?.x ?? 0);
      });
  }

  const disconnected = nodes.filter((node) => !processed.has(node.id));
  if (disconnected.length > 0) {
    disconnected.sort((a, b) => {
      const ax = a.position?.x ?? 0;
      const bx = b.position?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return (a.position?.y ?? 0) - (b.position?.y ?? 0);
    });
    for (const node of disconnected) {
      waves.push([node]);
    }
  }

  return waves;
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
  const configuredSystemPrompt = asString(node.data?.llmSystemPrompt);
  const hasAuthoredTask = Boolean(
    asString(node.data?.llmRequirements) ||
    asString(node.data?.llmPrompt) ||
    asString(node.data?.prompt) ||
    asString(node.data?.instructions) ||
    (configuredSystemPrompt && configuredSystemPrompt !== "You are a helpful assistant.")
  );

  const bName = asString(context.businessName ?? context.business_name ?? context.business?.name, "the business");
  const bType = asString(context.businessType ?? context.business_type ?? context.business?.type);
  const servicesArray: string[] = Array.isArray(context.services)
    ? context.services.map(String)
    : (Array.isArray(context.business?.services) ? context.business.services.map(String) : []);
  const servicesFormatted = servicesArray.length > 0
    ? servicesArray.map((s) => `• ${s}`).join("\n")
    : "";

  const businessContextSummary = [
    `Business Details:`,
    `- Business Name: ${bName}`,
    ...(bType ? [`- Business Type: ${bType}`] : []),
    ...(servicesFormatted ? [`- Available Services:\n${servicesFormatted}`] : [])
  ].join("\n");

  const telegramDefaultTask = context.telegram && !hasAuthoredTask
    ? [
        `You are a natural, helpful AI assistant for ${bName}.`,
        businessContextSummary,
        `Customer message: ${JSON.stringify(asString(context.latestMessage) || asString(context.telegram.text))}`,
        `Conversational Guidelines:`,
        `- Be warm, natural, helpful, and concise.`,
        `- Interactive Workflows & Validation: When collecting details (such as Product ID, issue description, warranty date, or phone number), guide the user conversationally. Validate inputs politely if anything is missing or unclear.`,
        `- Handling Refusal / Cancellation: If the user says "nope", "no", "cancel", "not now", or declines to share information, acknowledge politely and warmly without being pushy (e.g. "No problem at all! Whenever you're ready, feel free to reach back out or type /issue again. Is there anything else I can help you with today?"). Never reply with flat single-word answers like "Got it!".`,
        `- Use only the supplied business context, services, and knowledge. Do not invent details or fake confirmations.`,
        `- Return only the customer-facing reply in plain text.`
      ].join("\n")
    : "";

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

  const existingLlmContext = renderTemplate(node.data?.llmContext, context);
  const combinedLlmContext = existingLlmContext && existingLlmContext.includes(bName)
    ? existingLlmContext
    : [existingLlmContext, businessContextSummary].filter(Boolean).join("\n\n");

  // The customer's own words this run (one-shot Face runs, Telegram, SMS…).
  // Carried separately so the provider mapping can present them as the
  // authoritative user turn instead of leaving them buried — or dropped —
  // inside the workflow author's prompt template.
  const customerMessage = asString(context.latestMessage);

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
        llmRequirements: renderTemplate(node.data?.llmRequirements, context) || telegramDefaultTask,
        llmContext: combinedLlmContext,
        llmCustomerMessage: customerMessage,
        temperature: node.data?.llmTemperature ?? node.data?.temperature,
        maxTokens: finalMaxTokens,
        outputFormat: node.data?.llmOutputFormat ?? node.data?.outputFormat,
      }
    : {
        ...node.data,
        prompt: renderTemplate(node.data?.prompt, context),
        llmCustomerMessage: customerMessage,
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
  if (type === "ai.image_generation") return true;
  if (type === DEEPGRAM_NODE_TYPES.speech) return false;
  if (type === DEEPGRAM_NODE_TYPES.stt) return false;
  if (type === DEEPGRAM_NODE_TYPES.tts) return false;
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

    if (context.business) {
      if (context.business.name) {
        context.businessName = context.business.name;
        context.business_name = context.business.name;
      }
      if (context.business.type) {
        context.businessType = context.business.type;
        context.business_type = context.business.type;
      }
      if (Array.isArray(context.business.services) && context.business.services.length > 0) {
        context.services = context.business.services;
        context.business_services = context.business.services;
        if (!context.appointmentService) {
          context.appointmentService = context.business.services[0];
        }
      }
      if (context.business.timeZone) {
        context.timeZone = context.business.timeZone;
        context.time_zone = context.business.timeZone;
      }
    }
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
    context.architectTelegramTestConnectionId = optionalString(input?.architectTelegramTestConnectionId);
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

  if (Array.isArray(input?.attachments) && input.attachments.length > 0) {
    context.attachments = input.attachments;
    const audioAtt = input.attachments.find((att) => {
      const mime = typeof att.mimeType === "string" ? att.mimeType.toLowerCase() : "";
      const name = typeof att.name === "string" ? att.name.toLowerCase() : "";
      return mime.startsWith("audio/") || /\.(wav|mp3|m4a|ogg|webm|flac)$/.test(name);
    });
    if (audioAtt?.data) {
      context.audio = audioAtt.data;
      context.audioData = audioAtt.data;
      if (audioAtt.mimeType) context.audioMimeType = audioAtt.mimeType;
    }
  }

  if (input?.appointmentStartAt) context.appointmentStartAt = input.appointmentStartAt;
  if (input?.appointmentEndAt) context.appointmentEndAt = input.appointmentEndAt;
  if (input?.appointmentService) context.appointmentService = input.appointmentService;
  if (optionalString(input?.conversationId)) context.conversationId = optionalString(input?.conversationId);
  if (optionalString(input?.leadId)) context.leadId = optionalString(input?.leadId);
  if (optionalString(input?.installedAgentId)) context.installedAgentId = optionalString(input?.installedAgentId);
  if (optionalString(input?.listingId)) context.listingId = optionalString(input?.listingId);
  if (optionalString(input?.latestMessage)) context.latestMessage = optionalString(input?.latestMessage);
  // One-shot Face runs (/agent-pages/:slug/run and the builder's preview-run)
  // send the customer's words as `message`. Thread it into the slot templates
  // and AI nodes already read, so provided input is never silently dropped.
  if (!asString(context.latestMessage) && optionalString(input?.message)) {
    context.latestMessage = optionalString(input?.message);
  }
  if (optionalString(input?.testEmail)) context.testEmail = optionalString(input?.testEmail);
  if (input?.useTestCalendar === true) context.useTestCalendar = true;
  if (optionalString(input?.testSessionId)) context.testSessionId = optionalString(input?.testSessionId);

  if (optionalString(input?.calendlyEventTypeUri)) {
    context.calendlyEventTypeUri = optionalString(input?.calendlyEventTypeUri);
    context.calendly_event_type_uri = context.calendlyEventTypeUri;
  }
  if (optionalString(input?.calendlyEventUuid)) {
    context.calendlyEventUuid = optionalString(input?.calendlyEventUuid);
    context.calendly_event_uuid = context.calendlyEventUuid;
  }
  if (optionalString(input?.calendlyInviteeUuid)) {
    context.calendlyInviteeUuid = optionalString(input?.calendlyInviteeUuid);
    context.calendly_invitee_uuid = context.calendlyInviteeUuid;
  }
  if (optionalString(input?.calendlyStartTime)) {
    context.calendlyStartTime = optionalString(input?.calendlyStartTime);
    context.calendly_start_time = context.calendlyStartTime;
  }
  if (optionalString(input?.calendlyEndTime)) {
    context.calendlyEndTime = optionalString(input?.calendlyEndTime);
    context.calendly_end_time = context.calendlyEndTime;
  }
  if (optionalString(input?.calendlyStatus)) {
    context.calendlyStatus = optionalString(input?.calendlyStatus);
    context.calendly_status = context.calendlyStatus;
  }
  if (optionalString(input?.calendlyTimezone)) {
    context.calendlyTimezone = optionalString(input?.calendlyTimezone);
  }
  if (optionalString(input?.calendlyCancelReason)) {
    context.calendlyCancelReason = optionalString(input?.calendlyCancelReason);
    context.calendly_cancel_reason = context.calendlyCancelReason;
  }
  if (optionalString(input?.calendlyContactUuid)) {
    context.calendlyContactUuid = optionalString(input?.calendlyContactUuid);
    context.calendly_contact_uuid = context.calendlyContactUuid;
  }
  if (optionalString(input?.calendlyContactEmail)) {
    context.calendlyContactEmail = optionalString(input?.calendlyContactEmail);
    context.calendly_contact_email = context.calendlyContactEmail;
  }
  if (optionalString(input?.calendlyContactFirstName)) {
    context.calendlyContactFirstName = optionalString(input?.calendlyContactFirstName);
    context.calendly_contact_first_name = context.calendlyContactFirstName;
  }
  if (optionalString(input?.calendlyContactLastName)) {
    context.calendlyContactLastName = optionalString(input?.calendlyContactLastName);
    context.calendly_contact_last_name = context.calendlyContactLastName;
  }
  if (optionalString(input?.calendlyContactName)) {
    context.calendlyContactName = optionalString(input?.calendlyContactName);
    context.calendly_contact_name = context.calendlyContactName;
  }
  if (optionalString(input?.calendlyDurationMinutes)) {
    context.calendlyDurationMinutes = optionalString(input?.calendlyDurationMinutes);
    context.calendly_duration_minutes = context.calendlyDurationMinutes;
  }
  if (optionalString(input?.calendlyOneOffStartDate)) {
    context.calendlyOneOffStartDate = optionalString(input?.calendlyOneOffStartDate);
    context.calendly_one_off_start_date = context.calendlyOneOffStartDate;
  }
  if (optionalString(input?.calendlyOneOffEndDate)) {
    context.calendlyOneOffEndDate = optionalString(input?.calendlyOneOffEndDate);
    context.calendly_one_off_end_date = context.calendlyOneOffEndDate;
  }
  if (optionalString(input?.calendlyMeetingRecapUuid)) {
    context.calendlyMeetingRecapUuid = optionalString(input?.calendlyMeetingRecapUuid);
    context.calendly_meeting_recap_uuid = context.calendlyMeetingRecapUuid;
  }
  if (optionalString(input?.calendlyUserSearch)) {
    context.calendlyUserSearch = optionalString(input?.calendlyUserSearch);
    context.calendly_user_search = context.calendlyUserSearch;
  }
  if (optionalString(input?.calendlyUserUuid)) {
    context.calendlyUserUuid = optionalString(input?.calendlyUserUuid);
    context.calendly_user_uuid = context.calendlyUserUuid;
  }
  if (optionalString(input?.calendlyInviteeName)) {
    context.calendlyInviteeName = optionalString(input?.calendlyInviteeName);
    context.calendly_invitee_name = context.calendlyInviteeName;
  }
  if (optionalString(input?.calendlyInviteeEmail)) {
    context.calendlyInviteeEmail = optionalString(input?.calendlyInviteeEmail);
    context.calendly_invitee_email = context.calendlyInviteeEmail;
  }
  if (optionalString(input?.calendlyMeetingName)) {
    context.calendlyMeetingName = optionalString(input?.calendlyMeetingName);
    context.calendly_meeting_name = context.calendlyMeetingName;
  }
  if (optionalString(input?.calendlyLocationKind)) {
    context.calendlyLocationKind = optionalString(input?.calendlyLocationKind);
    context.calendly_location_kind = context.calendlyLocationKind;
  }
  if (optionalString(input?.calendlyLocation)) {
    context.calendlyLocation = optionalString(input?.calendlyLocation);
    context.calendly_location = context.calendlyLocation;
  }

  const inviteeName = optionalString(input?.calendlyInviteeName);
  const inviteeEmail = optionalString(input?.calendlyInviteeEmail);
  const meetingName = optionalString(input?.calendlyMeetingName);
  const triggerEventSlug =
    optionalString(input?.calendlyTriggerEvent) ||
    (typeof input?.calendly === "object" && input.calendly
      ? optionalString(String((input.calendly as Record<string, unknown>).calendlyEvent ?? ""))
      : undefined) ||
    "meeting_booked";

  const shouldSeedCalendlyTrigger =
    Boolean(input?.calendly) ||
    Boolean(inviteeName) ||
    Boolean(inviteeEmail) ||
    Boolean(meetingName) ||
    Boolean(optionalString(input?.calendlyTriggerEvent));

  if (shouldSeedCalendlyTrigger) {
    const eventUuid = optionalString(input?.calendlyEventUuid) || "SAMPLE_EVENT_UUID";
    const inviteeUuid = optionalString(input?.calendlyInviteeUuid) || "SAMPLE_INVITEE_UUID";
    const startTime =
      optionalString(input?.calendlyStartTime) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endTime =
      optionalString(input?.calendlyEndTime) || new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    const webhookEvent =
      triggerEventSlug === "meeting_cancelled"
        ? "invitee.canceled"
        : triggerEventSlug === "routing_form_submitted"
          ? "routing_form_submission.created"
          : "invitee.created";

    const seededCalendly = {
      event: webhookEvent,
      calendlyEvent: triggerEventSlug,
      invitee: {
        name: inviteeName || "Jordan Lee",
        email: inviteeEmail || "jordan@example.com",
        uri: `https://api.calendly.com/scheduled_events/${eventUuid}/invitees/${inviteeUuid}`,
        timezone: optionalString(input?.calendlyTimezone) || optionalString(input?.timeZone) || "America/Los_Angeles"
      },
      scheduledEvent: {
        name: meetingName || "30 Minute Meeting",
        uri: `https://api.calendly.com/scheduled_events/${eventUuid}`,
        start_time: startTime,
        end_time: endTime,
        status: optionalString(input?.calendlyStatus) || "active"
      },
      raw: { dryRun: true }
    };

    context.calendly = {
      ...(typeof context.calendly === "object" && context.calendly ? context.calendly : {}),
      ...seededCalendly,
      ...(typeof input?.calendly === "object" && input.calendly ? input.calendly : {})
    };
    // Prefer explicit input UUIDs; otherwise keep sample ids so action nodes can mock.
    if (!context.calendlyEventUuid) {
      context.calendlyEventUuid = eventUuid;
      context.calendly_event_uuid = eventUuid;
    }
    if (!context.calendlyInviteeUuid) {
      context.calendlyInviteeUuid = inviteeUuid;
      context.calendly_invitee_uuid = inviteeUuid;
    }
    context.triggerType = optionalString(input?.triggerType) || CALENDLY_NODE_TYPES.trigger;
    if (!context.latestMessage) {
      context.latestMessage =
        triggerEventSlug === "meeting_cancelled"
          ? "Calendly meeting cancelled"
          : triggerEventSlug === "routing_form_submitted"
            ? "Calendly routing form submitted"
            : triggerEventSlug === "meeting_rescheduled"
              ? "Calendly meeting rescheduled"
              : "Calendly meeting booked";
    }
  }

  if (input?.calendly && typeof input.calendly === "object" && !shouldSeedCalendlyTrigger) {
    context.calendly = { ...(context.calendly ?? {}), ...input.calendly };
  }

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

  if (input?.webhook) {
    context.webhook = input.webhook;
    // Templates reach the payload as {{webhook.body.<field>}}. The renderer's
    // token regex allows letters, digits, underscore and dot only, so a key
    // with a dash or a space is simply not addressable — that is the contract
    // we tell architects, not a bug to paper over here.
    const body = input.webhook.body;
    if (body !== null && body !== undefined) {
      // A plain text-ish payload doubles as the customer's words, so an AI
      // Brain wired to {{latestMessage}} works with zero extra mapping.
      const spoken =
        typeof body === "string"
          ? body
          : asString((body as Record<string, unknown>)?.message) ||
            asString((body as Record<string, unknown>)?.text) ||
            "";
      if (spoken) {
        context.latestMessage = spoken;
        context.text = spoken;
        context.lastOutput = spoken;
      }
    }
  }

  if (input?.schedule) {
    context.schedule = input.schedule;
  }

  if (input?.embedSource) {
    context.embedSource = true;
  }

  context._mode = mode;
  return context;
}

/**
 * May this run actually SEND something into the world — a text, a call, an
 * email, a WhatsApp message?
 *
 * Live runs normally may. The exception is a run that started from a widget on
 * a business's own website: that page is public, so a stranger could otherwise
 * type a phone number and make the business text or dial it, on the business's
 * account. Those runs still read the real calendar and save real leads — they
 * simply never reach outward. See modules/agent-pages/embed-live.ts.
 */
export function outboundSendsAllowed(context: RunnerContext, mode: WorkflowRunMode): boolean {
  return mode === "live" && context.embedSource !== true;
}

function runTriggerNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  // The two ways in that need no human. Both must answer here: every trigger
  // type that falls through this function lands on the missed-call branch at
  // the bottom and logs a red "Missing caller phone number" on a run that was
  // in fact perfectly fine.
  if (asString(node.data?.type) === SCHEDULE_NODE_TYPE) {
    logs.push(
      createLog(node, "success", "Timer fired.", {
        cadence: context.schedule?.cadence ?? asString(node.data?.cadence, "daily"),
        timeZone: context.schedule?.timeZone ?? asString(node.data?.timeZone, ""),
        dueAt: context.schedule?.dueAt ?? new Date().toISOString()
      })
    );
    return;
  }

  if (asString(node.data?.type) === WEBHOOK_NODE_TYPE) {
    const delivery = context.webhook;
    logs.push(
      createLog(node, "success", "Data received from another app.", {
        receivedAt: delivery?.receivedAt ?? new Date().toISOString(),
        // The body itself is the architect's material — show it, so the Test
        // panel teaches them exactly which {{webhook.body.x}} names exist.
        body: delivery?.body ?? null
      })
    );
    return;
  }

  if (asString(node.data?.type) === "trigger.telegram_message") {
    if (!context.telegram?.chat_id || !context.telegram.message_id) {
      logs.push(createLog(node, "error", "Telegram trigger is missing a chat ID or message ID."));
      return;
    }

    const msgText = asString(context.telegram.text) || asString(context.latestMessage);
    if (msgText) {
      context.lastOutput = msgText;
      context.text = msgText;
      context.output = msgText;
      context.latestMessage = msgText;
      context.telegramMessage = msgText;
      context[`node.${node.id}.output`] = msgText;
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
    const inputMsg =
      asString(context.latestMessage) ||
      asString((context.inboundSms as Record<string, unknown> | undefined)?.body) ||
      asString(context.text) ||
      asString(context.query) ||
      asString(context.prompt) ||
      "";

    if (inputMsg && inputMsg !== "No custom message") {
      context.lastOutput = inputMsg;
      context.text = inputMsg;
      context.output = inputMsg;
    }

    logs.push(
      createLog(node, "success", "Input fired.", {
        message: inputMsg || "No custom message"
      })
    );
    return;
  }

  if (asString(node.data?.type) === "trigger.whatsapp_message_received") {
    const connectionId =
      asString(node.data?.connectionId) || asString(context.whatsapp?.connectionId);
    if (!connectionId) {
      logs.push(
        createLog(
          node,
          "error",
          "WhatsApp trigger requires a connected Meta Cloud API number. Connect WhatsApp and select a connection on this node before testing."
        )
      );
      return;
    }

    const messageText =
      context.whatsapp?.message?.text ||
      context.message?.text ||
      context.inboundSms?.body ||
      context.latestMessage ||
      "";
    const contactPhone =
      context.whatsapp?.contact?.phone ||
      context.contact?.phone ||
      context.caller_number ||
      "";

    if (!contactPhone) {
      logs.push(createLog(node, "error", "WhatsApp trigger requires a sender phone number."));
      return;
    }

    if (!messageText) {
      logs.push(createLog(node, "error", "WhatsApp trigger requires a message body to simulate."));
      return;
    }

    logs.push(
      createLog(node, "success", "WhatsApp message received.", {
        connectionId,
        contact: context.contact ?? context.whatsapp?.contact ?? { name: context.caller_name ?? null, phone: contactPhone },
        message: context.message ?? context.whatsapp?.message ?? { id: "dry-run", type: "text", text: messageText, mediaUrl: null },
        timestamp: context.whatsapp?.timestamp ?? new Date().toISOString()
      })
    );
    return;
  }

  const triggerType = asString(node.data?.type);
  const isCalendlyTrigger =
    triggerType === CALENDLY_NODE_TYPES.trigger ||
    Boolean(CALENDLY_LEGACY_TRIGGER_TYPES[triggerType]) ||
    (asString(node.data?.nodeKind) === "trigger" &&
      asString(node.data?.connector).toLowerCase() === "calendly");

  if (isCalendlyTrigger) {
    // Prefer the Test console override (context.calendly) so dry-runs reflect the
    // selected trigger event, not only the node’s saved calendlyEvent.
    const nodeEvent =
      asString(context.calendly?.calendlyEvent) ||
      asString(node.data?.calendlyEvent) ||
      CALENDLY_LEGACY_TRIGGER_TYPES[triggerType] ||
      "meeting_booked";
    const invitee =
      context.calendly && typeof context.calendly.invitee === "object"
        ? (context.calendly.invitee as Record<string, unknown>)
        : undefined;
    const scheduledEvent =
      context.calendly && typeof context.calendly.scheduledEvent === "object"
        ? (context.calendly.scheduledEvent as Record<string, unknown>)
        : undefined;

    const eventMessage =
      nodeEvent === "meeting_cancelled"
        ? "Calendly meeting cancelled."
        : nodeEvent === "meeting_rescheduled"
          ? "Calendly meeting rescheduled."
          : nodeEvent === "routing_form_submitted"
            ? "Calendly routing form submitted."
            : "Calendly event received.";

    logs.push(
      createLog(node, "success", eventMessage, {
        calendlyEvent: nodeEvent,
        inviteeName: invitee?.name ?? null,
        inviteeEmail: invitee?.email ?? null,
        meetingName: scheduledEvent?.name ?? null,
        startTime: scheduledEvent?.start_time ?? null,
        endTime: scheduledEvent?.end_time ?? null,
        eventUri: scheduledEvent?.uri ?? null
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

async function runScriptNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const outputKey = asString(data.scriptOutputKey, "script.output");
  const label = asString(node.data?.title ?? node.data?.label, node.id);

  const result = await executeScript({
    language: data.scriptLanguage,
    code: data.scriptCode,
    timeoutMs: data.scriptTimeoutMs,
    input: context
  });

  if (result.status === "error") {
    logs.push(
      createLog(node, "error", result.error ?? "Code node failed.", {
        language: result.language,
        durationMs: result.durationMs,
        logs: result.logs
      })
    );
    return;
  }

  const output = result.output ?? null;
  context[outputKey] = output;
  context.lastOutput = output;
  context[`node.${node.id}.output`] = output;

  const labelKey = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "");
  if (labelKey) context[`node.${labelKey}.output`] = output;

  if (!context.scriptPipeline || typeof context.scriptPipeline !== "object") {
    context.scriptPipeline = {};
  }
  (context.scriptPipeline as Record<string, unknown>)[node.id] = {
    label,
    language: result.language,
    outputKey,
    output
  };

  logs.push(
    createLog(node, "success", `Ran ${result.language === "python" ? "Python" : "JavaScript"} in ${result.durationMs}ms.`, {
      outputKey,
      output,
      logs: result.logs,
      durationMs: result.durationMs
    })
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

  if (outboundSendsAllowed(context, mode)) {
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
  // A sales agent dials a person the run knows about; a receptionist calls the
  // person who just rang. Both land here, so an explicit target wins and the
  // inbound caller is the fallback.
  const targetFromNode = renderTemplate(node.data?.callTo, context).trim();
  const customerPhone = targetFromNode || customerPhoneFromContext(context);

  if (!customerPhone) {
    logs.push(
      createLog(
        node,
        "error",
        "This call has no number to dial. Set 'Who to call' on the node, or run it after a step that knows the person's number."
      )
    );
    return;
  }

  const assistantId = renderTemplate(node.data?.vapiAssistantId, context) || context.business?.vapiAssistantId;
  const phoneNumberId = renderTemplate(node.data?.vapiPhoneNumberId, context) || context.business?.vapiPhoneNumberId;

  if (!outboundSendsAllowed(context, mode)) {
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

  // THE LAW, ENFORCED IN CODE. An AI voice is an "artificial voice" under the
  // TCPA, so this business must hold this person's prior express consent. No
  // record, no call — an architect cannot switch this off, and it fails closed
  // on any doubt. See modules/architect/call-consent.ts.
  const consent = await mayCallNumber({
    businessId: context.business?.id,
    phoneNumber: customerPhone
  });
  if (!consent.allowed) {
    logs.push(
      createLog(
        node,
        "error",
        `No call placed — ${consent.reason}. A person must ask to be called before an AI can phone them.`,
        { phone: maskPhone(customerPhone) }
      )
    );
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

  const createLiveBooking = () =>
    createGoogleCalendarAppointment({
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

  const bookingBusinessId = optionalString(context.business?.id);

  // Live workflow bookings go through the same advisory-lock reservation as
  // voice/Telegram bookings — a calendar node must never double-book a slot.
  // Keyed by instant so the lock uses the schedule engine's own timezone,
  // never the node's fallback timezone.
  if (bookingBusinessId) {
    const reservation = await reserveSlotForInstant({
      businessId: bookingBusinessId,
      installedAgentId: context.installedAgentId ?? null,
      startAt,
      serviceName: service,
      createBooking: createLiveBooking
    });

    if (!reservation.ok) {
      const alternatives = topAlternativeLabels(reservation.result);
      context.calendarAppointment = {
        id: null,
        calendarId,
        summary,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timeZone,
        status: "FAILED",
        htmlLink: null,
        errorCode: "SLOT_UNAVAILABLE",
        remediation: alternatives.length
          ? `Nearby openings: ${alternatives.join(", ")}.`
          : "Offer the customer a different time."
      };
      logs.push(
        createLog(
          node,
          "error",
          `That time is not bookable — it is outside bookable hours or already taken.${
            alternatives.length ? ` Nearby openings: ${alternatives.join(", ")}.` : ""
          }`,
          context.calendarAppointment
        )
      );
      return;
    }

    context.calendarAppointment = { ...reservation.booking, status: "CREATED" };
    logs.push(createLog(node, "success", "Google Calendar appointment created.", context.calendarAppointment));
    return;
  }

  const appointment = await createLiveBooking();

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

function calendlyNeedsInputLog(
  node: RunnerNode,
  logs: WorkflowRunLog[],
  message: string,
  details: { needed: string; howTo: string; example?: string }
) {
  logs.push(
    createLog(node, "waiting", message, {
      needed: details.needed,
      howTo: details.howTo,
      ...(details.example ? { example: details.example } : {})
    })
  );
}

async function runCalendlyConnectorNode({
  userId,
  node,
  context,
  logs,
  mode = "test"
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
  mode?: WorkflowRunMode;
}) {
  const action = asString(node.data?.connectorAction, "get_my_profile");
  const eventTypeUri = firstNonEmptyString(
    node.data?.calendlyEventTypeUri,
    context.calendlyEventTypeUri,
    context.calendly_event_type_uri
  );
  const seededScheduledEvent =
    context.calendly && typeof context.calendly.scheduledEvent === "object"
      ? (context.calendly.scheduledEvent as Record<string, unknown>)
      : null;
  const seededInvitee =
    context.calendly && typeof context.calendly.invitee === "object"
      ? (context.calendly.invitee as Record<string, unknown>)
      : null;
  const seededEventUri =
    typeof seededScheduledEvent?.uri === "string" ? seededScheduledEvent.uri : "";
  const seededInviteeUri = typeof seededInvitee?.uri === "string" ? seededInvitee.uri : "";
  // Prefer runtime/webhook/test context over node-saved UUIDs so an architect's
  // dry-test event id cannot break buyer "Try out your agent" or live webhooks.
  const eventUuid = normalizeCalendlyResourceId(
    firstNonEmptyString(
      context.calendlyEventUuid,
      context.calendly_event_uuid,
      seededEventUri,
      node.data?.calendlyEventUuid
    )
  );
  const inviteeUuid = normalizeCalendlyResourceId(
    firstNonEmptyString(
      context.calendlyInviteeUuid,
      context.calendly_invitee_uuid,
      seededInviteeUri,
      node.data?.calendlyInviteeUuid
    )
  );
  const startTime = firstNonEmptyString(
    node.data?.calendlyStartTime,
    context.calendlyStartTime,
    context.calendly_start_time
  );
  const endTime = firstNonEmptyString(
    node.data?.calendlyEndTime,
    context.calendlyEndTime,
    context.calendly_end_time
  );
  const timezone =
    firstNonEmptyString(node.data?.calendlyTimezone, context.calendlyTimezone, context.timeZone) ||
    "UTC";
  const status = firstNonEmptyString(
    node.data?.calendlyStatus,
    context.calendlyStatus,
    context.calendly_status
  );
  const inviteeName = firstNonEmptyString(
    node.data?.calendlyInviteeName,
    context.calendlyInviteeName,
    context.calendly_invitee_name,
    typeof seededInvitee?.name === "string" ? seededInvitee.name : undefined
  );
  const inviteeEmail = firstNonEmptyString(
    node.data?.calendlyInviteeEmail,
    context.calendlyInviteeEmail,
    context.calendly_invitee_email,
    typeof seededInvitee?.email === "string" ? seededInvitee.email : undefined
  );
  const cancelReason = firstNonEmptyString(
    node.data?.calendlyCancelReason,
    context.calendlyCancelReason,
    context.calendly_cancel_reason
  );
  const contactUuid = firstNonEmptyString(
    node.data?.calendlyContactUuid,
    context.calendlyContactUuid,
    context.calendly_contact_uuid
  );
  const contactEmail = firstNonEmptyString(
    node.data?.calendlyContactEmail,
    context.calendlyContactEmail,
    context.calendly_contact_email
  );
  const contactFirstName = firstNonEmptyString(
    node.data?.calendlyContactFirstName,
    context.calendlyContactFirstName,
    context.calendly_contact_first_name
  );
  const contactLastName = firstNonEmptyString(
    node.data?.calendlyContactLastName,
    context.calendlyContactLastName,
    context.calendly_contact_last_name
  );
  const contactName = firstNonEmptyString(
    node.data?.calendlyContactName,
    context.calendlyContactName,
    context.calendly_contact_name
  );
  const meetingName = firstNonEmptyString(
    node.data?.calendlyMeetingName,
    context.calendlyMeetingName,
    context.calendly_meeting_name
  );
  const durationRaw =
    firstNonEmptyString(
      node.data?.calendlyDurationMinutes,
      context.calendlyDurationMinutes,
      context.calendly_duration_minutes
    ) || "30";
  const durationMinutes = Number(durationRaw);
  const oneOffStartDate = firstNonEmptyString(
    node.data?.calendlyOneOffStartDate,
    context.calendlyOneOffStartDate,
    context.calendly_one_off_start_date
  );
  const oneOffEndDate = firstNonEmptyString(
    node.data?.calendlyOneOffEndDate,
    context.calendlyOneOffEndDate,
    context.calendly_one_off_end_date
  );
  const meetingRecapUuid = firstNonEmptyString(
    node.data?.calendlyMeetingRecapUuid,
    context.calendlyMeetingRecapUuid,
    context.calendly_meeting_recap_uuid
  );
  const locationKind = firstNonEmptyString(
    node.data?.calendlyLocationKind,
    context.calendlyLocationKind,
    context.calendly_location_kind
  );
  const locationText = firstNonEmptyString(
    node.data?.calendlyLocation,
    context.calendlyLocation,
    context.calendly_location
  );
  const userSearch = firstNonEmptyString(
    node.data?.calendlyUserSearch,
    context.calendlyUserSearch,
    context.calendly_user_search
  );
  const userUuid = firstNonEmptyString(
    node.data?.calendlyUserUuid,
    context.calendlyUserUuid,
    context.calendly_user_uuid
  );

  const pickExampleEventLabel = async (): Promise<string | undefined> => {
    try {
      const listed = await calendlyListEvents(userId, { count: 5 });
      const first = listed.collection?.[0];
      if (!first || typeof first !== "object") return undefined;
      const name =
        typeof first.name === "string" && first.name.trim() ? first.name.trim() : "Meeting";
      const when =
        typeof first.start_time === "string" ? new Date(first.start_time).toLocaleString() : "";
      return [name, when].filter(Boolean).join(" · ");
    } catch {
      return undefined;
    }
  };

  const useSampleEventMock =
    mode === "test" &&
    (isCalendlySampleResourceId(eventUuid) ||
      Boolean(context.calendly?.raw && (context.calendly.raw as { dryRun?: boolean }).dryRun));

  const mockEventResult = () => ({
    resource: {
      ...(seededScheduledEvent ?? {}),
      uri:
        seededEventUri ||
        `https://api.calendly.com/scheduled_events/${eventUuid || "SAMPLE_EVENT_UUID"}`,
      name:
        (typeof seededScheduledEvent?.name === "string" && seededScheduledEvent.name) ||
        meetingName ||
        "Sample consultation",
      start_time: (typeof seededScheduledEvent?.start_time === "string" && seededScheduledEvent.start_time) || startTime,
      end_time: (typeof seededScheduledEvent?.end_time === "string" && seededScheduledEvent.end_time) || endTime,
      status: (typeof seededScheduledEvent?.status === "string" && seededScheduledEvent.status) || "active"
    },
    dryRun: true
  });

  const mockInviteeResult = () => ({
    resource: {
      ...(seededInvitee ?? {}),
      uri:
        seededInviteeUri ||
        `https://api.calendly.com/scheduled_events/${eventUuid || "SAMPLE_EVENT_UUID"}/invitees/${inviteeUuid || "SAMPLE_INVITEE_UUID"}`,
      name: inviteeName || "Alex Rivera",
      email: inviteeEmail || "alex.rivera@example.com",
      status: "active"
    },
    dryRun: true
  });

  try {
    let result: unknown;
    switch (action) {
      case "find_available_times":
        if (!eventTypeUri || !startTime || !endTime) {
          calendlyNeedsInputLog(node, logs, "Select an event type and time range to find available times.", {
            needed: "Event type, timezone, window start, and window end",
            howTo: "In the Test panel, choose an Event type, timezone, and calendar window, then run again."
          });
          return;
        }
        result = await calendlyGetAvailability(userId, {
          eventTypeUri,
          startTime,
          endTime,
          timezone
        });
        break;
      case "get_event":
      case "find_event":
        if (!eventUuid) {
          const example = mode === "test" ? await pickExampleEventLabel() : undefined;
          calendlyNeedsInputLog(node, logs, "Select a Calendly event to load its details.", {
            needed: "Event (UUID or name from the Event dropdown)",
            howTo: "In the Test panel, open Event and pick a meeting, then run again.",
            example
          });
          return;
        }
        if (useSampleEventMock && isCalendlySampleResourceId(eventUuid)) {
          result = mockEventResult();
          break;
        }
        result = await calendlyGetEvent(userId, eventUuid);
        break;
      case "list_events": {
        // Do not reuse booking/test-panel start/end slots as list filters — that
        // collapses the window to a single hour and returns no events.
        const listMin = asString(node.data?.calendlyStartTime) || undefined;
        const listMax = asString(node.data?.calendlyEndTime) || undefined;
        const listStatus = asString(node.data?.calendlyStatus) || undefined;
        result = await calendlyListEvents(userId, {
          minStartTime: listMin,
          maxStartTime: listMax,
          status: listStatus
        });
        break;
      }
      case "get_invitee":
        if (!eventUuid || !inviteeUuid) {
          const example = mode === "test" ? await pickExampleEventLabel() : undefined;
          calendlyNeedsInputLog(node, logs, "Select an event and invitee to load invitee details.", {
            needed: !eventUuid ? "Event and invitee" : "Invitee",
            howTo: "In the Test panel, choose Event, then Invitee, then run again.",
            example
          });
          return;
        }
        if (
          useSampleEventMock &&
          (isCalendlySampleResourceId(eventUuid) || isCalendlySampleResourceId(inviteeUuid))
        ) {
          result = mockInviteeResult();
          break;
        }
        result = await calendlyGetInvitee(userId, eventUuid, inviteeUuid);
        break;
      case "list_invitees":
        if (!eventUuid) {
          const example = mode === "test" ? await pickExampleEventLabel() : undefined;
          calendlyNeedsInputLog(node, logs, "Select a Calendly event to list its invitees.", {
            needed: "Event (UUID or name from the Event dropdown)",
            howTo: "In the Test panel, open Event and pick a meeting, then run again.",
            example
          });
          return;
        }
        if (useSampleEventMock && isCalendlySampleResourceId(eventUuid)) {
          result = { collection: [mockInviteeResult().resource], dryRun: true };
          break;
        }
        result = await calendlyListInvitees(userId, eventUuid);
        break;
      case "get_event_types":
        result = await calendlyListEventTypes(userId);
        break;
      case "create_scheduling_link":
        if (!eventTypeUri) {
          calendlyNeedsInputLog(node, logs, "Select an event type to create a scheduling link.", {
            needed: "Event type",
            howTo: "In the Test panel, choose an Event type, then run again."
          });
          return;
        }
        result = await calendlyCreateSchedulingLink(userId, eventTypeUri);
        break;
      case "book_meeting_for_invitee":
        if (!eventTypeUri || !startTime || !inviteeName || !inviteeEmail) {
          calendlyNeedsInputLog(
            node,
            logs,
            "Add event type, start time, invitee name, and invitee email to book a meeting.",
            {
              needed: "Event type, start time, invitee name, invitee email",
              howTo: "Fill those fields in the Test panel (or on the node), then run again."
            }
          );
          return;
        }
        result = await calendlyBookMeetingForInvitee(userId, {
          eventTypeUri,
          startTime,
          inviteeName,
          inviteeEmail,
          timezone
        });
        break;
      case "cancel_event":
      case "cancel_scheduled_event":
        if (!eventUuid) {
          const example = mode === "test" ? await pickExampleEventLabel() : undefined;
          calendlyNeedsInputLog(node, logs, "Select a Calendly event to cancel.", {
            needed: "Event (UUID or name from the Event dropdown)",
            howTo: "In the Test panel, open Event and pick the meeting to cancel, then run again.",
            example
          });
          return;
        }
        if (useSampleEventMock && isCalendlySampleResourceId(eventUuid)) {
          result = {
            resource: {
              ...mockEventResult().resource,
              status: "canceled",
              cancellation: { canceled_by: "host", reason: cancelReason || "Dry-run cancel" }
            },
            dryRun: true
          };
          break;
        }
        result = await calendlyCancelScheduledEvent(userId, eventUuid, cancelReason || undefined);
        break;
      case "create_contact":
        if (!contactEmail && !inviteeEmail) {
          calendlyNeedsInputLog(node, logs, "Enter an email to create a Calendly contact.", {
            needed: "Contact email",
            howTo: "In the Test panel, fill Contact email, then run again."
          });
          return;
        }
        result = await calendlyCreateContact(userId, {
          email: contactEmail || inviteeEmail,
          firstName: contactFirstName || undefined,
          lastName: contactLastName || undefined,
          name: contactName || inviteeName || undefined
        });
        break;
      case "update_contact":
        if (!contactUuid) {
          calendlyNeedsInputLog(node, logs, "Enter a contact UUID to update a Calendly contact.", {
            needed: "Contact UUID",
            howTo: "In the Test panel, paste Contact UUID, then run again."
          });
          return;
        }
        result = await calendlyUpdateContact(userId, contactUuid, {
          email: contactEmail || undefined,
          firstName: contactFirstName || undefined,
          lastName: contactLastName || undefined,
          name: contactName || undefined
        });
        break;
      case "delete_contact":
        if (!contactUuid) {
          calendlyNeedsInputLog(node, logs, "Enter a contact UUID to delete a Calendly contact.", {
            needed: "Contact UUID",
            howTo: "In the Test panel, paste Contact UUID, then run again."
          });
          return;
        }
        result = await calendlyDeleteContact(userId, contactUuid);
        break;
      case "find_contact":
        if (!contactUuid) {
          calendlyNeedsInputLog(node, logs, "Enter a contact UUID to find a Calendly contact.", {
            needed: "Contact UUID",
            howTo: "In the Test panel, paste Contact UUID, then run again."
          });
          return;
        }
        result = await calendlyGetContact(userId, contactUuid);
        break;
      case "list_contacts":
        result = await calendlyListContacts(userId);
        break;
      case "create_one_off_meeting_link": {
        const startDate = toCalendlyDateOnly(oneOffStartDate);
        const endDate = toCalendlyDateOnly(oneOffEndDate);
        const resolvedMeetingName = meetingName || "One-off meeting";
        if (!startDate || !endDate) {
          calendlyNeedsInputLog(
            node,
            logs,
            "Pick a window start and length to create a one-off link.",
            {
              needed: "Window start and window length",
              howTo: "In the Test panel, set Window start and Window length, then run again."
            }
          );
          return;
        }
        if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
          calendlyNeedsInputLog(node, logs, "Enter a valid meeting length in minutes.", {
            needed: "Meeting length (minutes)",
            howTo: "Set Meeting length in the Test panel or node inspector, then run again."
          });
          return;
        }
        result = await calendlyCreateOneOffMeetingLink(userId, {
          name: resolvedMeetingName,
          durationMinutes,
          startDate,
          endDate,
          timezone,
          locationKind: locationKind || "ask_invitee",
          location: locationText || undefined
        });
        break;
      }
      case "mark_invitee_no_show":
        if (!eventUuid || !inviteeUuid) {
          const example = mode === "test" ? await pickExampleEventLabel() : undefined;
          calendlyNeedsInputLog(node, logs, "Select an event and invitee to mark as no-show.", {
            needed: !eventUuid ? "Event and invitee" : "Invitee",
            howTo: "In the Test panel, choose Event, then Invitee, then run again.",
            example
          });
          return;
        }
        if (
          useSampleEventMock &&
          (isCalendlySampleResourceId(eventUuid) || isCalendlySampleResourceId(inviteeUuid))
        ) {
          result = { ...mockInviteeResult(), noShow: true };
          break;
        }
        result = await calendlyMarkInviteeNoShow(userId, eventUuid, inviteeUuid);
        break;
      case "find_invitee_by_email":
        if (!inviteeEmail) {
          calendlyNeedsInputLog(node, logs, "Enter an invitee email to search.", {
            needed: "Invitee email",
            howTo: "Enter invitee email in the Test panel or on the node, then run again."
          });
          return;
        }
        result = await calendlyFindInviteeByEmail(userId, {
          email: inviteeEmail,
          eventTypeUri: eventTypeUri || undefined
        });
        break;
      case "find_meeting_recap":
        if (!meetingRecapUuid) {
          calendlyNeedsInputLog(node, logs, "Enter a meeting recap UUID to load the recap.", {
            needed: "Meeting recap UUID",
            howTo: "In the Test panel, paste Meeting recap UUID, then run again."
          });
          return;
        }
        result = await calendlyGetMeetingRecap(userId, meetingRecapUuid);
        break;
      case "find_meeting_recap_transcript":
        if (!meetingRecapUuid) {
          calendlyNeedsInputLog(node, logs, "Enter a meeting recap UUID to load the transcript.", {
            needed: "Meeting recap UUID",
            howTo: "In the Test panel, paste Meeting recap UUID, then run again."
          });
          return;
        }
        result = await calendlyGetMeetingRecapTranscript(userId, meetingRecapUuid);
        break;
      case "find_user": {
        const emailGuess = userSearch.includes("@") ? userSearch : contactEmail || inviteeEmail;
        const nameGuess = userSearch && !userSearch.includes("@") ? userSearch : contactName || inviteeName;
        if (!userUuid && !emailGuess && !nameGuess) {
          calendlyNeedsInputLog(node, logs, "Enter an email, name, or user UUID to find a Calendly user.", {
            needed: "Email, name, or user UUID",
            howTo: "In the Test panel, fill User email or name, then run again."
          });
          return;
        }
        result = await calendlyFindUser(userId, {
          userUuid: userUuid || undefined,
          email: emailGuess || undefined,
          name: nameGuess || undefined
        });
        break;
      }
      case "get_my_profile":
      default:
        result = await calendlyGetUser(userId);
        break;
    }

    context.calendly = {
      ...(typeof context.calendly === "object" && context.calendly ? context.calendly : {}),
      action,
      result
    };
    logs.push(createLog(node, "success", `Calendly ${action} completed`, { result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendly action failed";
    const permissionDenied = /not allowed to view this event|permission|forbidden/i.test(message);
    const paidNote = calendlyActionPaidPlanNote(action);
    if (paidNote && isCalendlyPlanRestrictionError(message)) {
      calendlyNeedsInputLog(node, logs, paidNote, {
        needed: "A Calendly paid plan that includes this feature",
        howTo:
          "Upgrade the connected Calendly account, or switch this node to a free action (e.g. Create scheduling link / Get event details)."
      });
      return;
    }
    // Free accounts often get cryptic "organization: is not a supported query parameter"
    // instead of an explicit upgrade message — still treat as plan restriction.
    if (isCalendlyPlanRestrictionError(message)) {
      calendlyNeedsInputLog(
        node,
        logs,
        "This Calendly action needs a paid plan. Upgrade your Calendly account, or switch this step to a free action.",
        {
          needed: "A Calendly paid plan that includes this feature",
          howTo:
            "Upgrade the connected Calendly account, or switch this node to a free action (e.g. Create scheduling link / Get event details)."
        }
      );
      return;
    }
    // Sample / seeded dry-runs (and permission errors against someone else's event)
    // should complete with mock context instead of failing "Try out your agent".
    if (
      mode === "test" &&
      permissionDenied &&
      (seededScheduledEvent || isCalendlySampleResourceId(eventUuid))
    ) {
      const result =
        action === "list_invitees"
          ? { collection: [mockInviteeResult().resource], dryRun: true }
          : action === "get_invitee" || action === "mark_invitee_no_show"
            ? mockInviteeResult()
            : mockEventResult();
      context.calendly = {
        ...(typeof context.calendly === "object" && context.calendly ? context.calendly : {}),
        action,
        result
      };
      logs.push(
        createLog(node, "success", `Calendly ${action} completed (sample event — skipped live API)`, {
          result
        })
      );
      return;
    }
    if (permissionDenied) {
      calendlyNeedsInputLog(
        node,
        logs,
        "That Calendly event isn't on the connected account. Pick one of your own meetings.",
        {
          needed: "An event from your Calendly account",
          howTo:
            mode === "test"
              ? "In the Test panel, open Event and choose a meeting you own, then run again."
              : "Use the event from the Calendly webhook, or reconnect Calendly with the account that owns the meeting."
        }
      );
      return;
    }
    // Calendly rejects no-show until the meeting's start time has passed.
    if (/not started yet/i.test(message)) {
      calendlyNeedsInputLog(
        node,
        logs,
        "This meeting hasn't started yet — Calendly only allows marking a no-show after the start time.",
        {
          needed: "A meeting that has already started (or already ended)",
          howTo:
            mode === "test"
              ? "In the Test panel, pick a past meeting from Event, then choose the invitee and run again."
              : "Wait until the meeting start time, or use a past meeting from the Calendly webhook."
        }
      );
      return;
    }
    // Config-style API messages should not look like a broken run in the dry-test UI.
    if (/needs |required|missing|select /i.test(message)) {
      calendlyNeedsInputLog(node, logs, message.replace(/^Calendly\s+/i, ""), {
        needed: "Required Calendly fields",
        howTo: "Fill the missing fields in the Test panel or node inspector, then run again."
      });
      return;
    }
    logs.push(createLog(node, "error", message));
  }
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
    chainVisited: [...chain.visited, chain.workflowId],
    // One customer request, one door allowance — however many workflows it runs.
    doorBudget: chain.doorBudget
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

  if (!outboundSendsAllowed(context, mode)) {
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
    const telegramUserId = asString(context.telegram?.user_id);
    const customerPhone = asString(context.telegram?.phone_number) || asString(context.caller_number);
    const recipientFilters = [
      ...(telegramUserId ? [{ telegramUserId }] : []),
      ...(customerPhone
        ? [{ contextJson: { path: ["customerPhone"], equals: customerPhone } }]
        : [])
    ];
    if (recipientFilters.length === 0) {
      throw new Error("A Telegram user ID or customer phone is required to find the stored chat.");
    }
    const state = await prisma.telegramConversationState.findFirst({
      where: {
        businessId: context.business.id,
        installedAgentId: context.installedAgentId,
        telegramConnectionId: context.telegramConnectionId,
        OR: recipientFilters,
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
    parseModeValue === "HTML" || parseModeValue === "MarkdownV2" || parseModeValue === "Markdown"
      ? parseModeValue
      : undefined;
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

  if (mode === "test" && context.architectTelegramTestConnectionId) {
    const output = await executeArchitectTelegramTestAction({
      userId,
      connectionId: context.architectTelegramTestConnectionId,
      actionType,
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
    publishTelegramActionOutput(context, output);
    logs.push(createLog(node, "success", "Telegram action sent through the Architect test bot.", output));
    return;
  }

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
    await runTelegramConnectorNode({ userId, node, context, logs, mode });
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

  if (connector === "calendly") {
    await runCalendlyConnectorNode({
      userId,
      node,
      context,
      logs,
      mode
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

  // API Call — the universal "connect to a service" action. One node reaches
  // any service on the internet through the SSRF-hardened safeFetch. Matched by
  // type too, so a hand-written/Design-Brain graph that omits `connector` still
  // routes here instead of falling through to SMS.
  if (
    nodeType === API_CALL_NODE_TYPE ||
    connector === "api call" ||
    connector === "http" ||
    connector === "api"
  ) {
    await executeApiCallNode({ userId, node, context, logs });
    return;
  }

  logs.push(createLog(node, "error", `Unsupported connector: ${connector}`));
}

/* ------------------------------------------------------------------------ */
/* API Call node runtime                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Per-run counter of API Call executions, keyed by the run's context object.
 * A WeakMap (not a context key) so workflow-controlled template writes can
 * never reset the counter to dodge the per-run cap.
 */
const apiCallCountByContext = new WeakMap<object, number>();

/** Turn a multi-line "Name: Value" block into a header map, rendering templates. */
function parseApiHeaderLines(raw: string, context: RunnerContext): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    if (!name) continue;
    headers[name] = renderTemplate(trimmed.slice(idx + 1).trim(), context);
  }
  return headers;
}

/**
 * Path segments that could reach an object's prototype chain. The API Call
 * output key is architect-controlled (typed free-form in the Build inspector),
 * so a value like "__proto__.polluted" must never be walked — it would let a
 * single published page pollute a prototype shared by every tenant's run.
 */
const UNSAFE_CONTEXT_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Write `value` at a possibly-dotted context path, creating intermediate
 * objects. "api.response" -> context.api.response = value. Never clobbers a
 * sibling branch. Refuses the entire write when any segment could reach the
 * prototype chain (prototype-pollution guard).
 */
function setNestedContextValue(context: RunnerContext, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  if (parts.some((seg) => UNSAFE_CONTEXT_SEGMENTS.has(seg))) return;
  if (parts.length === 1) {
    (context as Record<string, unknown>)[parts[0]] = value;
    return;
  }
  let cursor: Record<string, unknown> = context as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const seg = parts[i];
    const next = cursor[seg];
    if (typeof next !== "object" || next === null) cursor[seg] = {};
    cursor = cursor[seg] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

/** Jargon-free message for each safeFetch block/failure. Never leaks the key. */
function friendlyApiCallError(code: SafeFetchErrorCode, label: string): string {
  switch (code) {
    case "BLOCKED_HOST":
    case "BLOCKED_SCHEME":
    case "BLOCKED_PORT":
    case "REDIRECT_INVALID":
      return `That web address isn't allowed for safety reasons (${label}).`;
    case "DNS_ERROR":
      return `Couldn't find that web address (${label}).`;
    case "TIMEOUT":
      return `The service took too long to respond (${label}).`;
    case "TOO_LARGE":
      return "The service's reply was too large to handle.";
    case "TOO_MANY_REDIRECTS":
      return `That web address redirected too many times (${label}).`;
    case "INVALID_URL":
      return "That doesn't look like a valid web address.";
    case "NETWORK_ERROR":
    default:
      return `Couldn't connect to the service (${label}).`;
  }
}

/**
 * Execute an API Call node: resolve templated url/headers/body, inject the
 * referenced key (an architect secret by name, or the platform YouTube key),
 * call safeFetch, parse the reply, and store it at the output key so a
 * downstream AI Brain can read it. Never throws — every failure is recorded
 * as a run log plus `<outputKey>_error` in context, keeping the run alive.
 */
export async function executeApiCallNode({
  userId,
  node,
  context,
  logs
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
}): Promise<void> {
  const outputKey =
    firstNonEmptyString(asString(node.data?.apiOutputKey)) || API_CALL_DEFAULT_OUTPUT_KEY;
  const errorKey = `${outputKey}_error`;

  const fail = (message: string) => {
    (context as Record<string, unknown>)[errorKey] = message;
    logs.push(createLog(node, "error", message));
  };

  // Per-run cap: count every execution, block once over the ceiling.
  const count = (apiCallCountByContext.get(context as object) ?? 0) + 1;
  apiCallCountByContext.set(context as object, count);
  if (count > API_CALL_MAX_PER_RUN) {
    fail(
      `This run already made ${API_CALL_MAX_PER_RUN} live data requests — skipping this one to keep the run safe.`
    );
    return;
  }

  const method = asString(node.data?.apiMethod, "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const rawUrl = renderTemplate(node.data?.apiUrl, context).trim();
  if (!rawUrl) {
    fail("Add the web address (URL) this step should call.");
    return;
  }

  const headers = parseApiHeaderLines(asString(node.data?.apiHeaders), context);
  const keySource = asString(node.data?.apiKeySource, "none");
  const keyInjection = asString(node.data?.apiKeyInjection, "query") === "header" ? "header" : "query";
  const keyParam = asString(node.data?.apiKeyParam).trim();
  const keyPrefix = asString(node.data?.apiKeyPrefix);

  // Resolve the key value at call time — decrypt here, never log or persist it.
  let keyValue: string | null = null;
  if (keySource === "my_key") {
    const keyName = asString(node.data?.apiKeyName).trim();
    if (!keyName) {
      fail("Choose which of your saved keys this step should use.");
      return;
    }
    try {
      keyValue = await getArchitectSecretValue(userId, keyName);
    } catch {
      keyValue = null;
    }
    if (!keyValue) {
      fail(`Couldn't find a saved key named "${keyName}" in My Keys.`);
      return;
    }
  } else if (keySource === "platform_youtube") {
    keyValue = getPlatformYouTubeKey();
    if (!keyValue) {
      fail("The platform YouTube key isn't set up yet — add your own key in My Keys instead.");
      return;
    }
  }

  // Build the request URL, injecting a query-param key when asked.
  let urlString = rawUrl;
  if (keyValue && keyInjection === "query") {
    try {
      const built = new URL(rawUrl);
      built.searchParams.set(keyParam || "key", keyValue);
      urlString = built.toString();
    } catch {
      // Invalid URL — leave as-is so safeFetch reports INVALID_URL cleanly.
      urlString = rawUrl;
    }
  }
  if (keyValue && keyInjection === "header") {
    const headerName = keyParam || "Authorization";
    headers[headerName] = keyPrefix ? `${keyPrefix}${keyValue}` : keyValue;
  }

  // Log/label only the origin + path — never the query (a key may live there)
  // and never the headers.
  let safeLabel = rawUrl;
  try {
    const parsedUrl = new URL(rawUrl);
    safeLabel = `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    /* keep rawUrl for the label */
  }

  const body = method === "POST" ? renderTemplate(node.data?.apiBody, context) : undefined;
  const requestHeaders: Record<string, string> = { ...headers };
  if (body && !Object.keys(requestHeaders).some((h) => h.toLowerCase() === "content-type")) {
    requestHeaders["Content-Type"] = "application/json";
  }

  // If the key rides in a header, name it sensitive so safeFetch drops it when
  // a redirect crosses to a different origin — the referenced key must never be
  // forwarded to a host the architect didn't point at.
  const sensitiveHeaders =
    keyValue && keyInjection === "header" ? [keyParam || "Authorization"] : undefined;

  let result;
  try {
    result = await safeFetch(urlString, { method, headers: requestHeaders, body, sensitiveHeaders });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      fail(friendlyApiCallError(err.code, safeLabel));
    } else {
      fail(`Couldn't reach ${safeLabel}. Please try again.`);
    }
    return;
  }

  // Parse JSON when the reply looks like JSON; otherwise keep it as text.
  let parsed: unknown = result.bodyText;
  const contentType = (result.headers["content-type"] || "").toLowerCase();
  const looksJson = contentType.includes("json") || /^\s*[[{]/.test(result.bodyText);
  if (looksJson) {
    try {
      parsed = JSON.parse(result.bodyText);
    } catch {
      parsed = result.bodyText;
    }
  }

  // Store two views: the structured value (nested, for deep field refs and the
  // Result Viewer) and a string mirror at the literal dotted key so a plain
  // {{api.response}} reference in an AI Brain reads back usable text.
  setNestedContextValue(context, outputKey, parsed);
  (context as Record<string, unknown>)[outputKey] =
    typeof parsed === "string" ? parsed : JSON.stringify(parsed);

  if (!result.ok) {
    (context as Record<string, unknown>)[errorKey] =
      `The service replied with ${result.status} ${result.statusText}.`.trim();
    logs.push(
      createLog(
        node,
        "error",
        `${safeLabel} replied ${result.status} ${result.statusText}. Saved the reply as ${outputKey}.`,
        { status: result.status, ok: result.ok, outputKey, bytes: result.bytesRead }
      )
    );
    return;
  }

  logs.push(
    createLog(
      node,
      "success",
      `Fetched live data from ${safeLabel} (${result.status}). Saved as ${outputKey}.`,
      { status: result.status, ok: result.ok, outputKey, bytes: result.bytesRead, data: parsed }
    )
  );
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

        if (!outboundSendsAllowed(context, mode)) {
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

        if (!outboundSendsAllowed(context, mode)) {
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

        if (!outboundSendsAllowed(context, mode)) {
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

      if (!outboundSendsAllowed(context, mode)) {
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

      if (!outboundSendsAllowed(context, mode)) {
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

      if (!outboundSendsAllowed(context, mode)) {
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

  const hasImagePipeline =
    context.imagePipeline &&
    typeof context.imagePipeline === "object" &&
    Object.keys(context.imagePipeline as Record<string, unknown>).length > 0;

  context.output = {
    key: outputKey,
    value: hasLlmPipeline
      ? {
          finalOutput: context.ai?.output ?? "",
          pipeline: context.llmPipeline,
        }
      : hasImagePipeline
      ? {
          image: context.image_url ?? context.image ?? "",
          pipeline: context.imagePipeline,
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

/* ------------------------------------------------------------------------ */
/* THE TWO DOORS — runtime wiring                                            */
/*                                                                           */
/* A node that talks to the outside world has an AI entry door and an AI     */
/* exit door built inside it. The entry door turns the customer's words and   */
/* the run so far into the exact request this step needs; the exit door       */
/* cleans the raw reply into the smallest useful thing later steps can read.  */
/* Neither is a canvas node: they run here, inside the node's own execution,  */
/* and show up only as a quiet sub-line on that node's log entry.             */
/*                                                                           */
/* Doors are an ENHANCEMENT, never a dependency. Every failure, timeout or    */
/* nonsense reply leaves the node running exactly as it does today, on the    */
/* config the architect saved.                                                */
/* ------------------------------------------------------------------------ */

/**
 * Node data keys an entry door may never rewrite. These decide WHICH node this
 * is and how the runner dispatches it (type/nodeKind/connector), what it is
 * called, and whether its doors run at all. A door fills in the request — it
 * never re-points the step at a different action, workflow or provider.
 * (Credential/connection fields are stripped a second time inside node-doors.)
 */
const DOOR_STRUCTURAL_NODE_DATA_KEYS = new Set<string>([
  "id",
  "type",
  "nodeKind",
  "connector",
  "connectorAction",
  "kind",
  "label",
  "title",
  "subtitle",
  "icon",
  "accent",
  "position",
  "backlinkNodeIds",
  "nextWorkflowId",
  "provider",
  "llmProvider",
  "llmModel",
  NODE_DOORS_DISABLED_KEY
]);

/**
 * Run values a door is never shown: binary blobs and pipelines that would
 * blow up the prompt, and the internal ids that mean nothing to a translator.
 */
const DOOR_CONTEXT_SKIP_KEYS = new Set<string>([
  "node",
  "audio",
  "audioData",
  "audioBase64",
  "audioMimeType",
  "audio_url",
  "image",
  "image_url",
  "attachments",
  "sttPipeline",
  "ttsPipeline",
  "imagePipeline",
  "llmPipeline",
  "workflowRunId",
  "testSessionId",
  "installedAgentId",
  "listingId",
  "conversationId",
  "leadId",
  "useTestCalendar"
]);

/** Run values whose NAME suggests a credential — never sent to a door. */
const DOOR_CONTEXT_SECRET_PATTERN = /(key|secret|token|credential|password|auth)/i;

/** Bounds on the run picture a door is shown, so prompts stay small. */
const DOOR_CONTEXT_MAX_VARIABLES = 40;
const DOOR_CONTEXT_MAX_VALUE_CHARS = 2000;

/**
 * Where each door-bearing node type leaves the reply the exit door cleans.
 * First key that exists in the run wins.
 *
 * Send WhatsApp is deliberately absent: its send receipt (`status`/`wamid`) is
 * merged INTO the shared `whatsapp` trigger object that holds the contact and
 * the inbound message, so replacing that key would destroy input later steps
 * read. The receipt is already the smallest useful thing, so an exit door
 * would skip it anyway — the entry door (composing the message) is the one
 * that earns its keep there.
 */
const DOOR_EXIT_OUTPUT_KEYS_BY_TYPE: Record<string, string[]> = {
  [VOICE_NODE_TYPES.sendEmail]: ["sentEmail"],
  [VOICE_NODE_TYPES.sendSms]: ["sentSms", "queuedSms"],
  [VOICE_NODE_TYPES.calendarAvailability]: ["calendarAvailability"],
  [VOICE_NODE_TYPES.bookAppointment]: ["calendarAppointment"],
  [TELEGRAM_NODE_TYPES.sendMessage]: ["telegramAction"],
  [CALENDLY_NODE_TYPES.action]: ["calendly.result"]
};

/**
 * The doors built into this node, or null when it has none, when the architect
 * turned them off ("Smart input & output"), or when the node is not engine work
 * at all. Product blocks are skipped here on purpose: the Result Viewer's entry
 * door is the presentation door, which runs where the result is rendered, not
 * as a canvas step.
 */
function doorsForNode(node: RunnerNode): { nodeType: string; spec: NodeDoorSpec } | null {
  const nodeType = asString(node.data?.type);
  const spec = getNodeDoors(nodeType);
  if (!spec) return null;
  if (!nodeDoorsEnabled(node.data)) return null;

  const nodeKind = asString(node.data?.nodeKind);
  if (nodeKind === "trigger" || nodeKind === "block") return null;
  if (isBlockNodeType(nodeType) || isDesignBrainNodeType(nodeType)) return null;

  return { nodeType, spec };
}

/** The node's settings a door may read and fill in — never its identity. */
function doorConfigFromNodeData(data: RunnerNodeData | undefined): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (DOOR_STRUCTURAL_NODE_DATA_KEYS.has(key)) continue;
    config[key] = value;
  }
  return config;
}

/** What the customer actually said, in their own words. */
function doorUserMessage(context: RunnerContext, input?: WorkflowRunInput): string {
  return firstNonEmptyString(
    context.latestMessage,
    input?.latestMessage,
    context.inboundSms?.body,
    context.telegram?.text,
    context.message?.text,
    context.whatsapp?.message?.text
  );
}

/** Suffix the exit door parks an uncleaned reply under, for debugging only. */
const DOOR_RAW_OUTPUT_SUFFIX = "_raw";

/**
 * Drop the `<key>_raw` copies an exit door parked for debugging.
 *
 * Without this, the very payload one door just paid to clean is handed back to
 * the NEXT door in full, one level down — the run pays twice for the same
 * bytes and the noise the cleaning removed comes straight back. The raw copy
 * stays in the run context for debugging; it just never reaches a prompt.
 */
function stripRawDoorCopies(value: unknown, depth = 0): unknown {
  if (depth >= 6 || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => stripRawDoorCopies(item, depth + 1));

  const pruned: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith(DOOR_RAW_OUTPUT_SUFFIX)) continue;
    pruned[key] = stripRawDoorCopies(inner, depth + 1);
  }
  return pruned;
}

/** The run so far, trimmed to what a translator can use and nothing more. */
function doorContextForRun(context: RunnerContext, input?: WorkflowRunInput): DoorContext {
  const variables: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    if (count >= DOOR_CONTEXT_MAX_VARIABLES) break;
    if (value === undefined || value === null || typeof value === "function") continue;
    if (DOOR_CONTEXT_SKIP_KEYS.has(key)) continue;
    if (DOOR_CONTEXT_SECRET_PATTERN.test(key)) continue;
    if (key.endsWith(DOOR_RAW_OUTPUT_SUFFIX)) continue;

    variables[key] =
      typeof value === "string" && value.length > DOOR_CONTEXT_MAX_VALUE_CHARS
        ? `${value.slice(0, DOOR_CONTEXT_MAX_VALUE_CHARS)}…`
        : stripRawDoorCopies(value);
    count += 1;
  }

  const userMessage = doorUserMessage(context, input);
  return {
    ...(userMessage ? { userMessage } : {}),
    ...(context.business?.name ? { businessName: context.business.name } : {}),
    variables
  };
}

/** Where this node leaves the reply an exit door would clean. */
function exitDoorOutputKeys(node: RunnerNode, nodeType: string): string[] {
  if (nodeType === API_CALL_NODE_TYPE) {
    return [firstNonEmptyString(asString(node.data?.apiOutputKey)) || API_CALL_DEFAULT_OUTPUT_KEY];
  }
  // Legacy Calendly slugs from older canvases run the same action node.
  if (nodeType.startsWith("action.calendly")) return DOOR_EXIT_OUTPUT_KEYS_BY_TYPE[CALENDLY_NODE_TYPES.action];
  return DOOR_EXIT_OUTPUT_KEYS_BY_TYPE[nodeType] ?? [];
}

/** JSON that can never throw, for the string mirror of a dotted output key. */
function stringifyForContext(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** Read a node's output — the structured value first, the string mirror after. */
function readDoorOutput(context: RunnerContext, key: string): unknown {
  const parts = key.split(".").filter(Boolean);
  let cursor: unknown = context;
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null) {
      cursor = undefined;
      break;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor !== undefined && cursor !== null) return cursor;
  return (context as Record<string, unknown>)[key];
}

/**
 * Write a node's output back the way the node itself does: the structured value
 * at the (possibly dotted) path, plus the string mirror at the literal key so a
 * plain {{api.response}} reference still reads back usable text.
 */
function writeDoorOutput(context: RunnerContext, key: string, value: unknown): void {
  const parts = key.split(".").filter(Boolean);
  if (parts.length === 0) return;
  if (parts.some((segment) => UNSAFE_CONTEXT_SEGMENTS.has(segment))) return;

  setNestedContextValue(context, key, value);
  // Only for dotted keys: for a single segment the literal key IS the nested
  // one, and the string mirror would replace the structured value.
  if (parts.length > 1) {
    (context as Record<string, unknown>)[key] = stringifyForContext(value);
  }
}

/** The origin of a saved address, ignoring any {{...}} still left inside it. */
function savedRequestOrigin(rawUrl: string): string | null {
  const withoutSlots = rawUrl.replace(/\{\{[^}]*\}\}/g, "").trim();
  if (!withoutSlots) return null;
  try {
    return new URL(withoutSlots).origin;
  } catch {
    return null;
  }
}

/**
 * A door fills in the request. It never changes WHO the request is sent to.
 *
 * This is the one door rule that protects a credential rather than a setting.
 * An API Call step attaches the architect's saved key — or the platform's own
 * YouTube key — to whatever address it is pointed at, and it attaches it AFTER
 * the entry door has run. So an address the door was free to rewrite from
 * scratch would be an address a stranger's words could steer, and the very next
 * thing the runner does is post the platform's key to it.
 *
 * The saved address therefore pins the origin: a door may rewrite the path, the
 * query and every parameter, but the scheme, host and port stay exactly where
 * the architect put them. When the architect saved no usable address at all,
 * the door may choose one only if this step carries no key — nothing to leak,
 * and safeFetch still refuses anything internal.
 */
function doorMayCallThisAddress(node: RunnerNode, candidate: string): boolean {
  const proposed = (() => {
    try {
      return new URL(candidate);
    } catch {
      // Not an address at all — the saved value is strictly better.
      return null;
    }
  })();
  if (!proposed) return false;

  const savedOrigin = savedRequestOrigin(asString(node.data?.apiUrl));
  if (savedOrigin) return proposed.origin === savedOrigin;

  // Nothing saved to pin to: allowed only when there is no key to carry away.
  return asString(node.data?.apiKeySource, "none") === "none";
}

/**
 * Strip any override this node type must not accept, whatever the model said.
 * Field NAMES are already filtered by the registry whitelist inside the door
 * engine; this is about a VALUE that would change the meaning of the step.
 */
function refuseUnsafeDoorOverrides(
  node: RunnerNode,
  nodeType: string,
  applied: Record<string, string>
): Record<string, string> {
  if (nodeType !== API_CALL_NODE_TYPE) return applied;
  if (!applied.apiUrl || doorMayCallThisAddress(node, applied.apiUrl)) return applied;

  const { apiUrl: _refused, ...rest } = applied;
  console.warn("[node-doors] entry no-change:address-outside-saved-origin", {
    nodeId: node.id,
    nodeType
  });
  return rest;
}

/**
 * Run the entry door and return the node this execution should use: a SHALLOW
 * COPY carrying the resolved settings, or the saved node untouched. The saved
 * graph is never mutated — the overrides live for this execution only.
 */
async function openNodeEntryDoor(params: {
  node: RunnerNode;
  doors: { nodeType: string; spec: NodeDoorSpec };
  context: RunnerContext;
  input?: WorkflowRunInput;
  budget: DoorBudget;
}): Promise<{ node: RunnerNode; opened: boolean }> {
  const { node, doors, context, input, budget } = params;
  if (!doors.spec.entry) return { node, opened: false };

  try {
    const { overrides } = await runEntryDoor({
      node: {
        id: node.id,
        label: asString(node.data?.title ?? node.data?.label, node.id),
        config: doorConfigFromNodeData(node.data)
      },
      nodeType: doors.nodeType,
      context: doorContextForRun(context, input),
      doorSpec: doors.spec,
      budget
    });

    const applied: Record<string, string> = {};
    for (const [field, value] of Object.entries(overrides)) {
      if (DOOR_STRUCTURAL_NODE_DATA_KEYS.has(field)) continue;
      applied[field] = value;
    }

    const safe = refuseUnsafeDoorOverrides(node, doors.nodeType, applied);
    if (Object.keys(safe).length === 0) return { node, opened: false };

    return { node: { ...node, data: { ...node.data, ...safe } }, opened: true };
  } catch {
    // A door can never break a node. Run on the saved config, as today.
    return { node, opened: false };
  }
}

/**
 * Run the exit door on what the node just produced. On a real cleaning the tidy
 * value replaces the node's output and the raw reply is kept at
 * `<key>_raw` for debugging — never shown to a customer.
 */
async function closeNodeExitDoor(params: {
  node: RunnerNode;
  doors: { nodeType: string; spec: NodeDoorSpec };
  context: RunnerContext;
  input?: WorkflowRunInput;
  budget: DoorBudget;
  /** The output keys as they stood BEFORE this node ran. */
  before: Map<string, unknown>;
}): Promise<boolean> {
  const { node, doors, context, input, budget, before } = params;
  if (!doors.spec.exit) return false;

  try {
    // Only what THIS node just wrote. A step that waited or wrote nothing must
    // never clean an earlier step's reply that happens to share the key.
    const key = exitDoorOutputKeys(node, doors.nodeType).find((candidate) => {
      const after = readDoorOutput(context, candidate);
      return after !== undefined && !Object.is(after, before.get(candidate));
    });
    if (!key) return false;

    const rawOutput = readDoorOutput(context, key);
    if (rawOutput === undefined || rawOutput === null) return false;

    const { value, changed } = await runExitDoor({
      node: {
        id: node.id,
        label: asString(node.data?.title ?? node.data?.label, node.id),
        config: doorConfigFromNodeData(node.data)
      },
      nodeType: doors.nodeType,
      rawOutput,
      context: doorContextForRun(context, input),
      doorSpec: doors.spec,
      budget
    });
    if (!changed) return false;

    // A door tidies a value, it never changes its kind: a step that produced
    // text still produces text, so a plain {{api.response}} reference keeps
    // reading back as words instead of "[object Object]".
    const cleaned =
      typeof rawOutput === "string" && typeof value !== "string" ? stringifyForContext(value) : value;

    writeDoorOutput(context, `${key}_raw`, rawOutput);
    writeDoorOutput(context, key, cleaned);
    return true;
  } catch {
    return false;
  }
}

/**
 * Door work is a sub-line of the node it belongs to — never its own log entry
 * and never its own node. Appended to that node's last line in plain words.
 */
function appendDoorNote(logs: WorkflowRunLog[], nodeId: string, notes: string[]): void {
  if (notes.length === 0) return;
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (logs[index].nodeId !== nodeId) continue;
    logs[index] = { ...logs[index], message: `${logs[index].message} · ${notes.join(" · ")}` };
    return;
  }
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
  chainVisited = [],
  doorBudget: inheritedDoorBudget
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
  /**
   * The door allowance to spend. A chained workflow INHERITS its parent's so
   * that one thing a customer asked for costs one allowance, however many
   * workflows it happens to be wired across — a "Next Workflow" node must never
   * be a way to mint 8 more door calls. Only the top-level run creates one.
   */
  doorBudget?: DoorBudget;
}) {
  const parsedWorkflow = parseRunnerWorkflowJson(workflowJson);
  const logs: WorkflowRunLog[] = [];
  const context: RunnerContext = seedMissedCallContext(input, parsedWorkflow.nodes, mode);
  const isTelegramWorkflow = Boolean(context.telegram);
  // ONE door allowance for the whole request, shared by every door in this run
  // AND by every workflow this run chains into. Only a top-level run mints one.
  const doorBudget = inheritedDoorBudget ?? createDoorBudget();
  const chain: WorkflowChain = { depth: chainDepth, visited: chainVisited, workflowId, doorBudget };

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
  const workflowStart = Date.now();

  try {
    const waves: RunnerNode[][] = isTelegramWorkflow
      ? sortTelegramNodesForRun(parsedWorkflow.nodes, parsedWorkflow.edges, context).map((n) => [n])
      : groupNodesIntoExecutionWaves(parsedWorkflow.nodes, parsedWorkflow.edges);

    console.log(`[WORKFLOW_PERF] [Workflow Test START] workflowId=${workflowId} totalNodes=${parsedWorkflow.nodes.length} waves=${waves.length}`);

    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx];
      if (runFailed) break;

      const waveStart = Date.now();
      console.log(`[WORKFLOW_PERF] [Wave ${waveIdx + 1}/${waves.length} START] nodes (${wave.length}): [${wave.map(n => `"${asString(n.data?.title ?? n.data?.label, n.id)}"`).join(", ")}]`);

      const waveResults = await Promise.all(
        wave.map((node) => {
          const currentExecutionOrder = executionOrder++;
          return executeSingleNodeInRunner({
            node,
            context,
            userId,
            input,
            mode,
            chain,
            workflowRunId,
            workflowId,
            threadId,
            executionOrder: currentExecutionOrder,
            doorBudget
          });
        })
      );

      const waveMs = Date.now() - waveStart;
      console.log(`[WORKFLOW_PERF] [Wave ${waveIdx + 1}/${waves.length} END] duration=${waveMs}ms`);

      for (const res of waveResults) {
        logs.push(...res.logs);
        if (res.runFailed) {
          runFailed = true;
        }
      }

      if (runFailed) break;
    }

    const totalWorkflowMs = Date.now() - workflowStart;
    console.log(`[WORKFLOW_PERF] [Workflow Test COMPLETE] workflowId=${workflowId} totalTime=${totalWorkflowMs}ms status=${runFailed ? "FAILED" : "SUCCESS"}`);
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
    context,
    // What this run has LEFT to spend on doors. The presentation door runs
    // after the engine returns (in resolveRunOutput), so it has to inherit the
    // same allowance the entry and exit doors have been spending — otherwise a
    // run that already used all 8 door calls would quietly get a 9th.
    doorBudget
  };
}

/**
 * Execute one node WITH its doors: the entry door resolves the request before
 * the node runs, the exit door cleans the reply after it. Both are optional,
 * both are silent about failure, and neither can add a step to the run — their
 * work shows up only as a sub-line on this node's own log entry.
 */
async function executeSingleNodeInRunner(params: {
  node: RunnerNode;
  context: RunnerContext;
  userId: string;
  input?: WorkflowRunInput;
  mode: WorkflowRunMode;
  chain: WorkflowChain;
  workflowRunId: string;
  workflowId: string;
  threadId?: string;
  executionOrder: number;
  /** The run's shared door allowance. */
  doorBudget: DoorBudget;
}): Promise<{ logs: WorkflowRunLog[]; runFailed: boolean }> {
  const { node, context, input, doorBudget } = params;
  const doors = doorsForNode(node);
  if (!doors) return executeNodeOnConfig(params);

  const entry = await openNodeEntryDoor({ node, doors, context, input, budget: doorBudget });

  // What the output keys held before this step ran, so the exit door can tell
  // this node's reply from one an earlier node left at the same key.
  const before = new Map<string, unknown>();
  if (doors.spec.exit) {
    for (const key of exitDoorOutputKeys(entry.node, doors.nodeType)) {
      before.set(key, readDoorOutput(context, key));
    }
  }

  const result = await executeNodeOnConfig({ ...params, node: entry.node });

  // Only a step that actually delivered has a reply worth cleaning. One that
  // failed or is still waiting for input produced nothing of its own, and its
  // log line should carry that, not a door note.
  const ownLogs = result.logs.filter((log) => log.nodeId === node.id);
  const nodeDelivered = ownLogs.length > 0 && ownLogs.every((log) => log.status === "success");
  const cleaned = nodeDelivered
    ? await closeNodeExitDoor({ node: entry.node, doors, context, input, budget: doorBudget, before })
    : false;

  appendDoorNote(result.logs, node.id, [
    ...(entry.opened ? ["understood the request"] : []),
    ...(cleaned ? ["cleaned the response"] : [])
  ]);

  return result;
}

async function executeNodeOnConfig(params: {
  node: RunnerNode;
  context: RunnerContext;
  userId: string;
  input?: WorkflowRunInput;
  mode: WorkflowRunMode;
  chain: WorkflowChain;
  workflowRunId: string;
  workflowId: string;
  threadId?: string;
  executionOrder: number;
}): Promise<{ logs: WorkflowRunLog[]; runFailed: boolean }> {
  const nodeStart = Date.now();
  const { node, context, userId, input, mode, chain, workflowRunId, workflowId, threadId, executionOrder } = params;
  const nodeLogs: WorkflowRunLog[] = [];
  let runFailed = false;
  const nodeKind = asString(node.data?.nodeKind);

  try {
    // Design Brain styles the customer page (via the design-chat endpoint) —
    // never engine work. Its own skip line keeps the run log friendly even on
    // hand-written graphs that lack nodeKind (the "block." prefix check below
    // would miss "design.brain").
    if (isDesignBrainNodeType(asString(node.data?.type))) {
      nodeLogs.push(
        createLog(node, "success", "Design Brain — it styles your page, nothing to run")
      );
      return { logs: nodeLogs, runFailed: false };
    }

    // Product blocks (block.*) are sections of the customer-facing page, not
    // engine work — skip them cleanly so a graph that mixes product sections
    // with AI nodes still runs its AI nodes without erroring.
    if (nodeKind === "block" || isBlockNodeType(asString(node.data?.type))) {
      nodeLogs.push(
        createLog(node, "success", "Product section — shown to your customer, nothing to run")
      );
      return { logs: nodeLogs, runFailed: false };
    }

    if (nodeKind === "trigger") {
      runTriggerNode(node, context, nodeLogs);
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
      if (context.services) triggerOutput.services = context.services;
      if (context.telegram) triggerOutput.telegram = context.telegram;
      if (context.telegramMessage) triggerOutput.telegramMessage = context.telegramMessage;
      if (context.calendly) triggerOutput.calendly = context.calendly;
      if (input?.latestMessage || context.latestMessage) triggerOutput.message = input?.latestMessage || context.latestMessage;

      await memoryBroker.saveNodeMemory({
        workflowRunId,
        nodeId: node.id,
        nodeType: asString(node.data?.type, "trigger"),
        nodeLabel: asString(node.data?.title ?? node.data?.label),
        status: "success",
        executionOrder,
        threadId,
        input: input as Record<string, unknown> | undefined,
        output: triggerOutput,
        files: triggerFiles,
        summary: "Trigger fired",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      return { logs: nodeLogs, runFailed: false };
    }

    if (nodeKind === "connector") {
      await runConnectorNode({
        userId,
        node,
        context,
        logs: nodeLogs,
        mode,
        chain
      });
      const hasErr = nodeLogs.some((l) => l.nodeId === node.id && l.status === "error");
      return { logs: nodeLogs, runFailed: hasErr };
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
          executionOrder,
          node,
          context,
          logs: nodeLogs
        });
        const hasErr = nodeLogs.some((l) => l.nodeId === node.id && l.status === "error");
        return { logs: nodeLogs, runFailed: hasErr };
      }

      if (resolveDeepgramMode(asString(node.data?.type), asString(node.data?.mode)) === "stt") {
        const model = asString(node.data?.model) || "nova-3";
        const language = asString(node.data?.language) || "en";
        const outputKey = asString(node.data?.outputKey) || "transcript";
        const audioSource = asString(node.data?.audioSource);
        const smartFormat = asString(node.data?.smartFormat, "true") !== "false";
        const punctuate = asString(node.data?.punctuate, "true") !== "false";
        const diarize = asString(node.data?.diarize, "false") === "true";

        let audioBase64 = "";
        let mimeType = "audio/wav";

        const resolveAudioValue = (val: unknown): { data: string; mimeType?: string } | null => {
          if (typeof val === "string" && val.trim()) {
            return { data: val.trim() };
          }
          if (Buffer.isBuffer(val)) {
            return { data: val.toString("base64") };
          }
          if (val && typeof val === "object") {
            const rec = val as Record<string, unknown>;
            if (typeof rec.data === "string" && rec.data.trim()) {
              return {
                data: rec.data.trim(),
                mimeType: typeof rec.mimeType === "string" ? rec.mimeType : undefined
              };
            }
            if (rec.type === "Buffer" && Array.isArray(rec.data)) {
              return { data: Buffer.from(rec.data as number[]).toString("base64") };
            }
          }
          return null;
        };

        if (audioSource) {
          const resolvedKey = renderTemplate(audioSource, context).replace(/^\{\{|\}\}$/g, "").trim();
          const fromSource =
            resolveAudioValue(context[resolvedKey]) ??
            resolveAudioValue(context[audioSource]) ??
            resolveAudioValue(context[`node.${resolvedKey}`]);
          if (fromSource) {
            audioBase64 = fromSource.data;
            if (fromSource.mimeType) mimeType = fromSource.mimeType;
          }
        }

        if (!audioBase64) {
          const fromContext =
            resolveAudioValue(context.audio) ??
            resolveAudioValue(context.audioData) ??
            resolveAudioValue(context.audioBase64);
          if (fromContext) {
            audioBase64 = fromContext.data;
            if (fromContext.mimeType) mimeType = fromContext.mimeType;
          }
        }

        if (!audioBase64) {
          const attachments = Array.isArray(context.attachments)
            ? (context.attachments as Array<Record<string, unknown>>)
            : Array.isArray((context.inboundSms as Record<string, unknown> | undefined)?.attachments)
              ? ((context.inboundSms as Record<string, unknown>).attachments as Array<Record<string, unknown>>)
              : [];
          const audioAtt = attachments.find((att) => {
            const mime = typeof att.mimeType === "string" ? att.mimeType.toLowerCase() : "";
            const name = typeof att.name === "string" ? att.name.toLowerCase() : "";
            return mime.startsWith("audio/") || /\.(wav|mp3|m4a|ogg|webm|flac)$/.test(name);
          });
          if (audioAtt && typeof audioAtt.data === "string") {
            audioBase64 = audioAtt.data;
            if (typeof audioAtt.mimeType === "string" && audioAtt.mimeType) {
              mimeType = audioAtt.mimeType;
            }
          }
        }

        if (!audioBase64) {
          // Buyer/architect text tests (Calendly sample run, chat, etc.) have no mic
          // audio. Skip STT instead of failing the whole graph so later steps still run.
          if (mode === "test") {
            const fallbackText = (
              asString(context.latestMessage) ||
              asString(context.message) ||
              asString(input?.latestMessage) ||
              asString(input?.message) ||
              asString(context.transcript) ||
              ""
            ).trim();
            context.transcript = fallbackText;
            context.confidence = null;
            context.model = model;
            context.language = language;
            context[outputKey] = fallbackText;
            context[`node.${node.id}.transcript`] = fallbackText;
            if (fallbackText) {
              context.lastOutput = fallbackText;
              context.ai = { output: fallbackText };
            }
            if (!context.sttPipeline || typeof context.sttPipeline !== "object") {
              context.sttPipeline = {};
            }
            (context.sttPipeline as Record<string, unknown>)[node.id] = {
              label: asString(node.data?.title ?? node.data?.label, node.id),
              transcript: fallbackText,
              confidence: null,
              model,
              language,
              skipped: true,
              reason: "no_audio_in_test"
            };
            nodeLogs.push(
              createLog(
                node,
                "success",
                fallbackText
                  ? "Skipped speech transcription (no audio in this test). Continued with the text message."
                  : "Skipped speech transcription (no audio in this test).",
                { model, language, outputKey, skipped: true, transcript: fallbackText }
              )
            );
            return { logs: nodeLogs, runFailed: false };
          }

          nodeLogs.push(
            createLog(
              node,
              "error",
              "Deepgram STT needs audio. Upload an audio file in Test, or set Audio source to a prior step variable.",
              { model, language, outputKey }
            )
          );
          return { logs: nodeLogs, runFailed: true };
        }

        const sttResult = await transcribeWithDeepgram({
          audioBase64,
          mimeType,
          model,
          language,
          smartFormat,
          punctuate,
          diarize
        });

        const transcript = sttResult.transcript;
        context.transcript = transcript;
        context.confidence = sttResult.confidence;
        context.model = sttResult.model;
        context.language = sttResult.language;
        context[outputKey] = transcript;
        context[`node.${node.id}.transcript`] = transcript;
        context.lastOutput = transcript;
        context.ai = { output: transcript };

        if (!context.sttPipeline || typeof context.sttPipeline !== "object") {
          context.sttPipeline = {};
        }
        (context.sttPipeline as Record<string, unknown>)[node.id] = {
          label: asString(node.data?.title ?? node.data?.label, node.id),
          transcript,
          confidence: sttResult.confidence,
          model: sttResult.model,
          language: sttResult.language,
          audioDurationSeconds: sttResult.audioDurationSeconds
        };

        nodeLogs.push(
          createLog(
            node,
            sttResult.status === "success" ? "success" : "error",
            sttResult.status === "success"
              ? `Transcribed audio with Deepgram ${sttResult.model}.`
              : sttResult.error ?? "Deepgram transcription failed.",
            {
              transcript,
              confidence: sttResult.confidence,
              model: sttResult.model,
              language: sttResult.language,
              outputKey
            }
          )
        );
        return { logs: nodeLogs, runFailed: sttResult.status !== "success" };
      }

      if (resolveDeepgramMode(asString(node.data?.type), asString(node.data?.mode)) === "tts") {
        const model = asString(node.data?.model) || "aura-2-thalia-en";
        const outputKey = asString(node.data?.outputKey) || "audio";
        const textSource = asString(node.data?.textSource);
        let text = renderTemplate(asString(node.data?.text), context).trim();

        if (!text && textSource) {
          const resolvedKey = renderTemplate(textSource, context).replace(/^\{\{|\}\}$/g, "").trim();
          const fromSource =
            asString(context[resolvedKey]) ||
            asString(context[textSource]) ||
            asString(context[`node.${resolvedKey}`]);
          if (fromSource.trim()) text = fromSource.trim();
        }

        if (!text) {
          text =
            asString(context.transcript) ||
            asString(context.lastOutput) ||
            asString((context.ai as Record<string, unknown> | undefined)?.output) ||
            asString(context.message) ||
            asString(context.text) ||
            "";
          text = text.trim();
        }

        if (!text) {
          nodeLogs.push(
            createLog(
              node,
              "error",
              "Deepgram TTS needs text. Set the Text field, text source, or feed transcript from a prior STT step.",
              { model, outputKey }
            )
          );
          return { logs: nodeLogs, runFailed: true };
        }

        const speakResult = await speakWithDeepgram({ text, model, encoding: "mp3" });
        const dataUri = speakResult.audioBase64
          ? `data:${speakResult.audioMimeType};base64,${speakResult.audioBase64}`
          : "";

        context.audio = speakResult.audioBase64;
        context.audioData = speakResult.audioBase64;
        context.audioMimeType = speakResult.audioMimeType;
        context.audio_url = dataUri;
        context.model = speakResult.model;
        context.text = text;
        context[outputKey] = speakResult.audioBase64;
        context[`node.${node.id}.audio`] = speakResult.audioBase64;
        context.lastOutput = text;

        if (!context.ttsPipeline || typeof context.ttsPipeline !== "object") {
          context.ttsPipeline = {};
        }
        (context.ttsPipeline as Record<string, unknown>)[node.id] = {
          label: asString(node.data?.title ?? node.data?.label, node.id),
          text,
          model: speakResult.model,
          audioUrl: dataUri,
          audioMimeType: speakResult.audioMimeType
        };

        nodeLogs.push(
          createLog(
            node,
            speakResult.status === "success" ? "success" : "error",
            speakResult.status === "success"
              ? `Synthesized speech with Deepgram ${speakResult.model}.`
              : speakResult.error ?? "Deepgram speech synthesis failed.",
            {
              text,
              model: speakResult.model,
              audioMimeType: speakResult.audioMimeType,
              outputKey,
              audio: speakResult.audioBase64 ? "[Binary Audio Data]" : ""
            }
          )
        );
        return { logs: nodeLogs, runFailed: speakResult.status !== "success" };
      }

      if (asString(node.data?.type) === "ai.image_generation") {
        const promptRaw = asString(node.data?.prompt);
        let prompt = renderTemplate(promptRaw, context);
        const model = asString(node.data?.model) || "imagen-3.0-generate-002";
        const refConfig = asString(node.data?.reference_image);
        let referenceImage: Buffer | string | undefined = undefined;

        if (refConfig) {
          const resolvedRefKey = renderTemplate(refConfig, context);
          const val = context[resolvedRefKey] ?? context[refConfig];
          if (
            Buffer.isBuffer(val) ||
            typeof val === "string" ||
            (typeof val === "object" && val !== null && (val as any).type === "Buffer")
          ) {
            referenceImage = val as any;
          }
        }
        if (
          !referenceImage &&
          (Buffer.isBuffer(context.image) ||
            typeof context.image === "string" ||
            (typeof context.image === "object" && context.image !== null && (context.image as any).type === "Buffer"))
        ) {
          referenceImage = context.image as any;
        }

        if (!prompt || !prompt.trim()) {
          const prevOutput =
            asString(context.lastOutput) ||
            asString((context.ai as Record<string, unknown> | undefined)?.output) ||
            asString(context.latestMessage) ||
            asString((context.inboundSms as Record<string, unknown> | undefined)?.body) ||
            asString(context.text) ||
            asString(context.query) ||
            asString(context.llmOutput) ||
            asString(context.output) ||
            asString(context.result) ||
            asString(context.message) ||
            asString((context.input as Record<string, unknown> | undefined)?.message) ||
            asString((context.input as Record<string, unknown> | undefined)?.text) ||
            asString(context.userInput);

          if (prevOutput && prevOutput.trim() && prevOutput !== "No custom message") {
            prompt = prevOutput.trim();
          } else {
            prompt = referenceImage ? "Generate variation of reference image" : "Generate image";
          }
        }

        const imgResult = await executeImageGeneration({ prompt, model, referenceImage });
        const binaryOutput = imgResult.imageBuffer ?? imgResult.imageUrl ?? "";
        const jsonOutput = {
          prompt,
          model: imgResult.modelName || model,
          revised_prompt: imgResult.revisedPrompt || prompt
        };

        const dataUri =
          imgResult.imageUrl ||
          (Buffer.isBuffer(imgResult.imageBuffer)
            ? `data:${imgResult.imageMimeType || "image/png"};base64,${imgResult.imageBuffer.toString("base64")}`
            : String(binaryOutput));

        context.image = binaryOutput;
        context.image_url = dataUri;
        context.prompt = jsonOutput.prompt;
        context.model = jsonOutput.model;
        context.revised_prompt = jsonOutput.revised_prompt;
        context[`node.${node.id}.image`] = binaryOutput;

        if (!context.imagePipeline || typeof context.imagePipeline !== "object") {
          context.imagePipeline = {};
        }
        (context.imagePipeline as Record<string, unknown>)[node.id] = {
          label: asString(node.data?.title ?? node.data?.label, node.id),
          imageUrl: dataUri,
          prompt,
          model: imgResult.modelName || model,
          revisedPrompt: imgResult.revisedPrompt || prompt,
        };

        const nodeLabelSlug = (asString(node.data?.title ?? node.data?.label) || node.id)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_");
        if (nodeLabelSlug) {
          context[`${nodeLabelSlug}.image`] = binaryOutput;
        }

        nodeLogs.push(
          createLog(
            node,
            imgResult.status === "success" ? "success" : "error",
            imgResult.status === "success"
              ? `Generated image using ${imgResult.modelName || model}.`
              : imgResult.error ?? "Image generation failed.",
            {
              ...jsonOutput,
              image: binaryOutput ? "[Binary Image Data]" : ""
            }
          )
        );
        return { logs: nodeLogs, runFailed: imgResult.status !== "success" };
      }

      if (shouldUseProviderEngine(node, mode)) {
        const aiConfig = toAiBrainNodeConfig(node, context);
        await deliverMemoryToAiConfig(aiConfig, context);

        const result = await runAiBrainNode({
          workflowRunId,
          threadId,
          executionOrder,
          node: aiConfig,
        });

        const isLlmCall = asString(node.data?.type) === "ai.llm_call";

        const simulatedReply =
          result.missingCredentials && mode === "test"
            ? scriptedAiFallback(node, context, isLlmCall)
            : null;

        const outputText = simulatedReply ?? result.text ?? "";

        context.ai = { output: outputText };
        context.lastOutput = outputText;

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

        nodeLogs.push(
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
        runAiNode(node, context, nodeLogs);
      }
      const hasErr = nodeLogs.some((l) => l.nodeId === node.id && l.status === "error");
      return { logs: nodeLogs, runFailed: hasErr || runFailed };
    }

    if (nodeKind === "condition") {
      runConditionNode(node, context, nodeLogs);
      const hasErr = nodeLogs.some((l) => l.nodeId === node.id && l.status === "error");
      return { logs: nodeLogs, runFailed: hasErr };
    }

    if (nodeKind === "output") {
      runOutputNode(node, context, nodeLogs);
      const hasErr = nodeLogs.some((l) => l.nodeId === node.id && l.status === "error");
      return { logs: nodeLogs, runFailed: hasErr };
    }

    nodeLogs.push(createLog(node, "error", `Unknown node kind: ${nodeKind}`));
    return { logs: nodeLogs, runFailed: true };
  } catch (error) {
    nodeLogs.push(
      createLog(
        node,
        "error",
        error instanceof Error ? error.message : "Node execution failed"
      )
    );
    return { logs: nodeLogs, runFailed: true };
  }
}
