import { createHmac, timingSafeEqual } from "node:crypto";
import { SMS_CONSENT_DISCLOSURE_VERSION, calendarEventTitleForMode } from "@coreai/shared";
import {
  clearConsentOffer,
  markConsentOffered,
  wasConsentOffered,
  type ConsentOfferKey
} from "../notifications/consent-offer-store";
import {
  parseTranscriptSegments,
  segmentsSmsDisclosureProgress,
  transcriptSmsDisclosureProgress,
  type SmsDisclosureProgress
} from "../notifications/sms-disclosure";
import { createTestCalendarEvent } from "./test-calendar-events";
import {
  appointmentAiRef,
  resolveAppointmentAiRef,
  toAiSafeAppointmentActionResult,
  toAiSafeAvailabilityResult,
  toAiSafeBookingResult
} from "../compliance/ai-safe-results";
import { redactForLog } from "../compliance/log-redaction";
import {
  isWorkspaceDerivedAllowedForLiveVoice,
  liveVoicePipelineBlockReason,
  parseStoredVoicePipeline,
  type ResolvedVoicePipeline
} from "../compliance/workspace-ai-guard";
import type { Context } from "hono";
import { env, isProduction } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest, type WorkflowRunInput } from "./workflow-runner";
import { DuplicateWorkflowRunError } from "../memory/work-flow-run-service";
import { workflowCapabilities } from "../agent-runtime/graph-runner";
import { formatKnowledgeEntries, retrieveRelevantKnowledge } from "../business/agent-knowledge";
import {
  checkBusinessExactTime,
  computeBusinessAvailability,
  resolveScheduleForBusiness,
  revalidateAndReserveSlot,
  serviceDurationFor
} from "../business/scheduling";
import { detectFactIntents, loadBusinessFacts, lookupStructuredFacts } from "../business/business-facts";
import { businessOpenStatusNow, specialEntriesFromRows } from "../business/business-hours-state";
import {
  buildAfterHoursSnapshotForBusiness,
  logAfterHoursRouting,
  resolveAfterHoursPolicyForBusiness
} from "../business/after-hours-state";
import {
  endLiveAfterHoursCall,
  extractStructuredCallTurns,
  gateLiveAfterHoursAction,
  resolveLiveAfterHoursGateContext,
  type LiveAfterHoursGateContext
} from "./after-hours-live-gate";
import { updateAfterHoursStaffNotificationStatus } from "../business/after-hours-call-state";
import {
  VOICE_NODE_TYPES,
  buildRedFlagStaffAlert,
  buildUrgentStaffAlert,
  verbalSmsConsentDisclosure,
  spokenDateTimeInTimeZone,
  spokenDateInTimeZone,
  type AfterHoursCallTurn
} from "@coreai/shared";
import {
  readCallContact,
  updateCallContact,
  clearCallContact,
  CallStateUnavailableError,
  type CanonicalCallContact
} from "./call-contact-store";
import { smsAttributionPrefix } from "../notifications/sms-format";
import {
  addDaysToDate,
  businessOpenStatus,
  dateInTimeZone,
  describeOpenStatus,
  normalizeWeeklyHours,
  resolveAfterHoursGreeting,
  type SpecialHoursEntry
} from "@coreai/shared";
import {
  escapeXml, normalizePhoneE164, validateSmsRecipientE164,
  isSmsDeliveryUnreliable
} from "./twilio-connector";
import {
  applyTwilioMessageStatus,
  sendAppointmentConfirmationSms,
  sendTrackedSms,
  type SmsSendOutcome
} from "../notifications/sms-notification-service";
import { sendBusinessAppointmentBookedEmail } from "../notifications/appointment-booked-email";
import {
  applySmsOptOut,
  applySmsReOptIn,
  classifyInboundSmsKeyword,
  getSmsConsentStatusLabel,
  maskPhone,
  recordVerbalSmsConsent,
  smsHelpReplyText
} from "../notifications/sms-consent";
import { createVapiInboundTwiml, isRealId, startVapiOutboundCall, type VapiCallerContext } from "./vapi-connector";
import { enqueueEmail } from "../email/email-queue";
import {
  applyBuyerEmailRecipients,
  extractBuyerEmailRecipients,
  extractSendEmailNodeConfig,
  fillEmailTemplate,
  resolveVariableRecipient,
  sanitizeOutboundHtml,
  type EmailTemplateVariables,
  type SendEmailNodeConfig
} from "../email/email-node-config";
import { TEAM_RECIPIENT } from "../email/ses-mail-service";
import {
  cancelGoogleCalendarAppointment,
  createGoogleCalendarAppointment,
  getDefaultAppointmentWindow,
  listAvailableSlots,
  rescheduleGoogleCalendarAppointment,
  zonedWallClockToUtc
} from "./google-calendar-connector";
import { parseRequestedAppointment } from "./appointment-parser";
import { recordVapiCallUsage } from "../business/usage-billing";

type TwilioBody = Record<string, unknown>;

type BusinessRuntimeContext = {
  businessId?: string;
  ownerId?: string;
  installedAgentId?: string;
  listingId?: string;
  businessName: string;
  businessType?: string;
  businessPhoneNumber?: string;
  bookingUrl?: string;
  teamPhone?: string;
  calendarId?: string;
  timeZone?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  services: string[];
  faqs: string[];
  tone?: string;
  escalationRules?: string;
  knowledge: string[];
  hours?: unknown;
  /** LIVE by default; architect sandbox agents run as ARCHITECT_DRY_RUN so
   * their bookings are marked as tests and excluded from production data. */
  executionMode?: "ARCHITECT_DRY_RUN" | "BUSINESS_TEST" | "LIVE";
};

type ResolvedAgent = {
  workflowId: string;
  userId: string;
  workflowJson: unknown;
  forwardToPhone?: string;
  /** Buyer's answering mode from InstalledAgent.configJson.phoneRouting.mode. */
  routingMode?: string;
  /** AI Call Coverage (configJson.phoneRouting.coverage): always | business_hours | custom. */
  coverage?: string;
  /** Optional custom AI answering schedule (configJson.phoneRouting.answeringHours). */
  answeringHours?: unknown;
  /** Buyer paused this agent — no AI answer, no text-back, no AI SMS replies. */
  agentPaused?: boolean;
  business?: BusinessRuntimeContext;
  /** How the number resolved (diagnostics only — never affects call behavior). */
  matchedBusinessPhoneNumberId?: string;
  matchedPlatformPhoneNumberId?: string;
  resolveReason?: string;
};

function normalizePhoneNumber(value: string) {
  return value.replace(/[^+\d]/g, "").trim();
}

const SMS_CAPABLE_NODE_TYPES = new Set([
  "trigger.twilio_inbound_sms",
  "trigger.twilio_missed_call",
  "send_sms"
]);

export function workflowSupportsSmsReplies(workflowJson: unknown): boolean {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;

  if (!Array.isArray(nodes) || nodes.length === 0) return true;

  return nodes.some((node) => {
    const data = (node as { data?: Record<string, unknown> } | null)?.data;
    return SMS_CAPABLE_NODE_TYPES.has(String(data?.type ?? ""));
  });
}

async function parseBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  return (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
}

function stringParams(body: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

export function buildPublicWebhookUrl(routePath: string, search = ""): string {
  const base = env.BACKEND_URL.replace(/\/$/, "");
  let basePath = "";
  try {
    basePath = new URL(base).pathname.replace(/\/$/, ""); // e.g. "/api" or ""
  } catch {
    basePath = "";
  }
  const path =
    basePath && (routePath === basePath || routePath.startsWith(`${basePath}/`))
      ? routePath.slice(basePath.length) // proxy didn't strip the prefix — don't double it
      : routePath;
  return `${base}${path}${search}`;
}

function twilioRequestUrl(c: Context): string {
  const parsed = new URL(c.req.url);
  return buildPublicWebhookUrl(parsed.pathname, parsed.search);
}

function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function isValidTwilioRequest(c: Context, body: Record<string, unknown>): boolean {
  if (!env.TWILIO_VALIDATE_SIGNATURE) return true;

  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn(
      "TWILIO_VALIDATE_SIGNATURE is enabled but TWILIO_AUTH_TOKEN is missing; rejecting Twilio webhook."
    );
    return false;
  }

  const signature = c.req.header("X-Twilio-Signature") ?? c.req.header("x-twilio-signature");
  if (!signature) return false;

  const expected = computeTwilioSignature(authToken, twilioRequestUrl(c), stringParams(body));
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);

  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

function readBodyString(body: TwilioBody, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function getNestedRecord(value: unknown, keys: string[]) {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstNestedString(body: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const value = getNestedRecord(body, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function jsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  return [];
}

function faqStrings(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          const question = typeof record.question === "string" ? record.question : "";
          const answer = typeof record.answer === "string" ? record.answer : "";
          return [question, answer].filter(Boolean).join(" - ");
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).filter((item): item is string => typeof item === "string");
  }

  return [];
}

function buildBusinessContext(
  business: any,
  phoneNumber?: string | null,
  installedAgent?: { id?: string; listingId?: string | null; configJson?: unknown } | null
): BusinessRuntimeContext {
  const profile = business?.profile;
  const knowledgeBases = Array.isArray(business?.knowledgeBases) ? business.knowledgeBases : [];
  const agentConfig =
    installedAgent?.configJson && typeof installedAgent.configJson === "object" && !Array.isArray(installedAgent.configJson)
      ? (installedAgent.configJson as Record<string, unknown>)
      : {};
  const executionMode: BusinessRuntimeContext["executionMode"] =
    agentConfig.executionMode === "ARCHITECT_DRY_RUN" || agentConfig.executionMode === "BUSINESS_TEST"
      ? agentConfig.executionMode
      : agentConfig.testMode === true
        ? "ARCHITECT_DRY_RUN"
        : "LIVE";

  return {
    businessId: business?.id,
    ownerId: business?.ownerId,
    installedAgentId: installedAgent?.id,
    listingId: installedAgent?.listingId ?? undefined,
    executionMode,
    businessName: business?.name ?? env.TWILIO_DEFAULT_BUSINESS_NAME ?? "the business",
    businessType: business?.type ?? undefined,
    businessPhoneNumber: phoneNumber ?? undefined,
    bookingUrl: profile?.bookingUrl ?? env.TWILIO_DEFAULT_BOOKING_URL ?? undefined,
    teamPhone: profile?.teamPhone ?? env.TWILIO_DEFAULT_TEAM_PHONE ?? undefined,
    calendarId: profile?.calendarId ?? env.GOOGLE_CALENDAR_ID ?? "primary",
    timeZone: profile?.timeZone ?? env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
    vapiAssistantId:
      (typeof agentConfig.vapiAssistantId === "string" ? agentConfig.vapiAssistantId.trim() : "") ||
      profile?.vapiAssistantId ||
      undefined,
    vapiPhoneNumberId:
      (typeof agentConfig.vapiPhoneNumberId === "string" ? agentConfig.vapiPhoneNumberId.trim() : "") ||
      profile?.vapiPhoneNumberId ||
      undefined,
    services: jsonStringArray(profile?.services),
    faqs: faqStrings(profile?.faqsJson),
    tone: profile?.tone ?? "friendly",
    escalationRules: profile?.escalationRules ?? undefined,
    hours: profile?.hoursJson ?? undefined,
    // Shared formatter — the live tool context reads the same knowledge set
    // (manual + document chunks) as the deployed prompt and browser tests.
    knowledge: formatKnowledgeEntries(knowledgeBases)
  };
}

async function latestActiveInstalledAgent(businessId: string) {
  const active = await prisma.installedAgent.findMany({
    where: { businessId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { workflow: true }
  });

  if (active.length === 1) return active[0];
  if (active.length > 1) {
    console.warn("[twilio-webhook] unlinked number in a multi-agent business — refusing to guess", {
      businessId,
      activeAgentCount: active.length
    });
  }
  return null;
}

export function isInstalledAgentActivityPaused(status?: string | null) {
  const normalized = status?.trim().toUpperCase();
  return normalized === "PAUSED" || normalized === "SUSPENDED_BILLING";
}

async function isVapiInstalledAgentPaused(businessId: string, installedAgentId?: string) {
  if (installedAgentId) {
    const agent = await prisma.installedAgent.findFirst({
      where: { id: installedAgentId, businessId },
      select: { status: true }
    });
    return isInstalledAgentActivityPaused(agent?.status);
  }

  // Older Vapi calls may not carry installedAgentId. Only treat the business
  // as paused when it has no active agent and at least one paused agent.
  const [active, paused] = await Promise.all([
    prisma.installedAgent.findFirst({ where: { businessId, status: "ACTIVE" }, select: { id: true } }),
    prisma.installedAgent.findFirst({
      where: { businessId, status: { in: ["PAUSED", "SUSPENDED_BILLING"] } },
      select: { id: true }
    })
  ]);
  return !active && Boolean(paused);
}

async function loadBusinessWithContext(businessId: string) {
  return prisma.business.findUnique({
    where: { id: businessId },
    include: { profile: true, knowledgeBases: true }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResolvedAgent(opts: {
  business: any;
  phoneNumber: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  installedAgent: any;
  forwardToPhone?: string | null;
  matchedBusinessPhoneNumberId?: string;
  matchedPlatformPhoneNumberId?: string;
  resolveReason: string;
}): ResolvedAgent {
  const { business, phoneNumber, installedAgent } = opts;
  return {
    workflowId: installedAgent.workflow?.id ?? installedAgent.workflowId ?? "",
    userId: installedAgent.workflow?.architectUserId ?? business?.ownerId ?? "",
    workflowJson: installedAgent.workflow?.workflowJson ?? null,
    forwardToPhone: opts.forwardToPhone ?? undefined,
    routingMode: readRoutingMode(installedAgent.configJson),
    coverage: readCoverage(installedAgent.configJson),
    answeringHours: readAnsweringHours(installedAgent.configJson),
    agentPaused: isInstalledAgentActivityPaused(installedAgent.status),
    business: buildBusinessContext(business, phoneNumber, installedAgent),
    matchedBusinessPhoneNumberId: opts.matchedBusinessPhoneNumberId,
    matchedPlatformPhoneNumberId: opts.matchedPlatformPhoneNumberId,
    resolveReason: opts.resolveReason
  };
}

async function resolveAgent({
  calledNumber,
  calledNumbers,
  workflowId
}: {
  calledNumber?: string;
  calledNumbers?: string[];
  workflowId?: string;
}): Promise<ResolvedAgent | null> {
  // Route by the assigned Triven/Twilio number (To/Called), with ForwardedFrom /
  // OriginalCalled as secondary candidates. NEVER by the caller's (From) number.
  const candidates = Array.from(
    new Set(
      [calledNumber, ...(calledNumbers ?? [])]
        .map((value) => (value ? normalizePhoneNumber(value) : ""))
        .filter(Boolean)
    )
  );

  for (const normalizedCalledNumber of candidates) {
    // ---- A / C: BusinessPhoneNumber exact match (active) ----
    const phoneNumber = await prisma.businessPhoneNumber.findUnique({
      where: { phoneNumber: normalizedCalledNumber },
      include: {
        business: { include: { profile: true, knowledgeBases: true } },
        installedAgent: { include: { workflow: true } }
      }
    });

    if (phoneNumber && phoneNumber.isActive) {
      // A: the mapping already points at an installed agent.
      if (phoneNumber.installedAgent) {
        return toResolvedAgent({
          business: phoneNumber.business,
          phoneNumber: phoneNumber.phoneNumber,
          installedAgent: phoneNumber.installedAgent,
          forwardToPhone: phoneNumber.forwardToPhone,
          matchedBusinessPhoneNumberId: phoneNumber.id,
          resolveReason: "business_phone_number"
        });
      }
      // C: mapping exists but installedAgentId is null — use the business's latest ACTIVE agent.
      if (phoneNumber.businessId) {
        const agent = await latestActiveInstalledAgent(phoneNumber.businessId);
        if (agent) {
          return toResolvedAgent({
            business: phoneNumber.business,
            phoneNumber: phoneNumber.phoneNumber,
            installedAgent: agent,
            forwardToPhone: phoneNumber.forwardToPhone,
            matchedBusinessPhoneNumberId: phoneNumber.id,
            resolveReason: "business_phone_number_latest_active_agent"
          });
        }
      }
    }

    const platform = await prisma.platformPhoneNumber.findUnique({
      where: { phoneNumber: normalizedCalledNumber }
    });
    if (platform?.businessId && platform.status === "ASSIGNED") {
      const bizPhone = await prisma.businessPhoneNumber.findFirst({
        where: { phoneNumber: platform.phoneNumber, isActive: true },
        include: {
          business: { include: { profile: true, knowledgeBases: true } },
          installedAgent: { include: { workflow: true } }
        }
      });
      const business = bizPhone?.business ?? (await loadBusinessWithContext(platform.businessId));
      const installedAgent =
        bizPhone?.installedAgent ?? (await latestActiveInstalledAgent(platform.businessId));
      if (business && installedAgent) {
        return toResolvedAgent({
          business,
          phoneNumber: platform.phoneNumber,
          installedAgent,
          forwardToPhone: bizPhone?.forwardToPhone,
          matchedBusinessPhoneNumberId: bizPhone?.id,
          matchedPlatformPhoneNumberId: platform.id,
          resolveReason: bizPhone?.installedAgent
            ? "platform_phone_number_business_mapping"
            : "platform_phone_number_latest_active_agent"
        });
      }
    }
  }

  const normalizedCalledNumber = candidates[0] ?? "";
  if (workflowId) {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        architectUserId: true,
        workflowJson: true
      }
    });

    if (workflow) {
      return {
        workflowId: workflow.id,
        userId: workflow.architectUserId,
        workflowJson: workflow.workflowJson,
        forwardToPhone: env.TWILIO_FORWARD_TO_PHONE,
        business: {
          businessName: env.TWILIO_DEFAULT_BUSINESS_NAME ?? normalizedCalledNumber ?? "the business",
          businessType: undefined,
          businessPhoneNumber: normalizedCalledNumber || env.TWILIO_PHONE_NUMBER,
          bookingUrl: env.TWILIO_DEFAULT_BOOKING_URL,
          teamPhone: env.TWILIO_DEFAULT_TEAM_PHONE,
          calendarId: env.GOOGLE_CALENDAR_ID ?? "primary",
          timeZone: env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
          // Assistants live in the database, one per installed agent — this
          // dev/bootstrap branch has no agent, so it has no assistant.
          vapiAssistantId: undefined,
          vapiPhoneNumberId: undefined,
          services: [],
          faqs: [],
          tone: "friendly",
          knowledge: []
        }
      };
    }
  }

  return null;
}

function runInputFromContext({
  agent,
  callerNumber,
  callerName,
  body,
  reason
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  body?: string;
  reason: string;
}): WorkflowRunInput {
  const business = agent.business;

  return {
    callerNumber,
    callerName,
    businessId: business?.businessId,
    businessOwnerId: business?.ownerId,
    installedAgentId: business?.installedAgentId,
    listingId: business?.listingId,
    businessName: business?.businessName,
    businessType: business?.businessType,
    businessPhoneNumber: business?.businessPhoneNumber,
    bookingUrl: business?.bookingUrl,
    teamPhone: business?.teamPhone,
    calendarId: business?.calendarId,
    timeZone: business?.timeZone,
    vapiAssistantId: business?.vapiAssistantId,
    vapiPhoneNumberId: business?.vapiPhoneNumberId,
    services: business?.services,
    faqs: business?.faqs,
    tone: business?.tone,
    escalationRules: business?.escalationRules,
    knowledge: business?.knowledge,
    businessHours: business?.hours,
    callStatus: "no-answer",
    callTimestamp: new Date().toISOString(),
    missedCallReason: reason,
    inboundSmsBody: body
  };
}

async function upsertConversation({
  businessId,
  customerPhone,
  direction,
  body,
  providerId
}: {
  businessId?: string;
  customerPhone: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  providerId?: string | null;
}) {
  if (!businessId) return null;

  const conversation = await prisma.conversation.upsert({
    where: {
      businessId_channel_customerPhone: {
        businessId,
        channel: "SMS",
        customerPhone
      }
    },
    update: {
      status: "OPEN"
    },
    create: {
      businessId,
      channel: "SMS",
      customerPhone,
      status: "OPEN"
    }
  });

  await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      direction,
      body,
      providerId: providerId ?? null
    }
  });

  return conversation;
}

async function upsertLead({
  businessId,
  phoneNumber,
  source,
  status,
  notes,
  name
}: {
  businessId?: string;
  phoneNumber: string;
  source: string;
  status: string;
  notes?: string;
  name?: string;
}) {
  if (!businessId) return null;

  return prisma.lead.upsert({
    where: {
      businessId_phoneNumber: {
        businessId,
        phoneNumber
      }
    },
    update: {
      status,
      notes,
      name: name || undefined
    },
    create: {
      businessId,
      phoneNumber,
      source,
      status,
      notes,
      name
    }
  });
}

type ConversationTurn = {
  direction: string;
  body: string;
};

/** Loads recent conversation messages (chronological) for reply context. */
async function loadConversationHistory(
  conversationId: string,
  limit = 12
): Promise<ConversationTurn[]> {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { direction: true, body: true }
  });

  return messages.reverse().map((message) => ({
    direction: message.direction,
    body: message.body
  }));
}

/** Best-effort match of the requested service against the business's offerings. */
function inferService(message: string, services: string[]): string {
  const normalized = message.toLowerCase();
  const match = services.find((service) => normalized.includes(service.toLowerCase()));
  return match || "Appointment";
}

function formatAppointmentTime(iso: string, timeZone?: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function formatAppointmentTimeOfDay(iso: string, timeZone?: string | null): string {
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatSpokenAppointmentTime(iso: string, timeZone?: string | null): string {
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  let timeLabel = "";
  try {
    timeLabel = new Date(iso).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  } catch {
    timeLabel = "";
  }
  return spokenDateTimeInTimeZone(iso, tz, timeLabel) || formatAppointmentTime(iso, timeZone);
}

function spokenDateForYmd(ymd: string, timeZone?: string | null): string {
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  try {
    return spokenDateInTimeZone(zonedWallClockToUtc(ymd, 12, 0, tz), tz);
  } catch {
    return spokenDateInTimeZone(`${ymd}T12:00:00Z`, tz);
  }
}

export function resolveRequestedProvider(args: Record<string, unknown>): string | null {
  const raw = argStr(args, [
    "doctor",
    "doctor_name",
    "doctorName",
    "provider",
    "provider_name",
    "providerName",
    "practitioner",
    "dentist",
    "staff_member",
    "staff_name",
    "with_whom"
  ]);
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (/^(any|anyone|either|whoever|no preference|none|no|first available|doesn'?t matter)$/i.test(cleaned)) {
    return null;
  }
  return cleaned.slice(0, 120);
}

async function createBusinessAppointment({
  business,
  customerPhone,
  customerName,
  service,
  providerName,
  bookingCallId,
  startAt,
  endAt,
  conversationId,
  description,
  titleOverride,
  reminderMinutes,
  notes
}: {
  business: BusinessRuntimeContext;
  customerPhone: string;
  customerName?: string | null;
  service: string;
  providerName?: string | null;
  bookingCallId?: string | null;
  startAt: Date | string;
  endAt: Date | string;
  conversationId?: string | null;
  description?: string | null;
  titleOverride?: string | null;
  reminderMinutes?: number | null | "off";
  notes?: string | null;
}) {
  if (!business.businessId || !business.ownerId) {
    throw new Error("Business is not fully configured for calendar booking.");
  }

  const executionMode = business.executionMode ?? "LIVE";
  const isTestMode = executionMode !== "LIVE";

  const calendarEvent = await createGoogleCalendarAppointment({
    userId: business.ownerId,
    calendarId: business.calendarId,
    timeZone: business.timeZone,
    businessName: business.businessName,
    customerName,
    customerPhone,
    service,
    providerName,
    startAt,
    endAt,
    summaryOverride: isTestMode
      ? calendarEventTitleForMode(executionMode, service)
      : titleOverride?.trim() || undefined,
    reminderMinutes: reminderMinutes ?? null,
    description: isTestMode
      ? [
        executionMode === "ARCHITECT_DRY_RUN"
          ? "Triven.ai architect sandbox test appointment."
          : "Triven.ai business test appointment.",
        "This is not a real customer booking.",
        `Phone: ${customerPhone}`
      ].join("\n")
      : description ?? `Booked by Triven AI Receptionist for ${business.businessName}. Phone: ${customerPhone}`
  });

  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.businessId,
      conversationId: conversationId ?? undefined,
      customerPhone,
      customerName: customerName ?? undefined,
      service,
      providerName: providerName ?? undefined,
      bookingCallId: bookingCallId ?? undefined,
      startAt: new Date(calendarEvent.startAt),
      endAt: new Date(calendarEvent.endAt),
      timeZone: calendarEvent.timeZone,
      calendarEventId: calendarEvent.id,
      calendarEventLink: calendarEvent.htmlLink ?? undefined,
      executionMode,
      notes: notes ?? undefined
    }
  });

  if (executionMode === "LIVE") {
    try {
      await sendBusinessAppointmentBookedEmail(appointment.id);
    } catch (error) {
      console.error("[appointment-email] buyer notification failed (appointment kept)", error);
    }
  }

  return { calendarEvent, appointment };
}

function buildInboundSmsReply(
  agent: ResolvedAgent,
  incomingBody: string,
  history: ConversationTurn[] = []
) {
  const business = agent.business;
  const businessName = business?.businessName ?? "the business";
  const businessType = business?.businessType ?? "business";
  const bookingUrl = business?.bookingUrl;
  const teamPhone = business?.teamPhone;
  const services = business?.services ?? [];
  const knowledge = [...(business?.faqs ?? []), ...(business?.knowledge ?? [])];
  const normalizedMessage = incomingBody.toLowerCase();

  const hasGreeted = history.some((turn) => turn.direction === "OUTBOUND");
  const askedForTime = history.some(
    (turn) => turn.direction === "OUTBOUND" && /time|day|when|book/i.test(turn.body)
  );

  if (/book|appointment|schedule|yes|visit|slot|available|reschedule/.test(normalizedMessage)) {
    if (bookingUrl) {
      return `Absolutely — you can book with ${businessName} here: ${bookingUrl}. If you prefer, reply with your preferred day and time and we'll set it up.`;
    }

    if (teamPhone) {
      return askedForTime
        ? `Great — just reply with the exact day and time you'd like and we'll lock it in, or our team can call you from ${teamPhone}.`
        : `Absolutely — ${businessName} can help schedule that. What day and time works best? Our team can also call you from ${teamPhone}.`;
    }

    return `Happy to help you book with ${businessName}. What day and time works best for you?`;
  }

  if (/price|cost|fee|charge|rate|quote|estimate|how much/.test(normalizedMessage)) {
    const hint = knowledge.find((item) => /price|cost|fee|charge|rate|quote|estimate|cleaning|install|repair/i.test(item));
    if (hint) return hint;
  }

  const matchingService = services.find((service) => normalizedMessage.includes(service.toLowerCase().split(" ")[0] ?? ""));
  if (matchingService) {
    return `${businessName} can help with ${matchingService}. ${bookingUrl ? `You can book here: ${bookingUrl}` : "Reply with a day and time that works and we'll schedule it."}`;
  }

  const firstKnowledge = knowledge[0];
  if (firstKnowledge && !hasGreeted) {
    return `${businessName} is a ${businessType}. ${firstKnowledge} ${bookingUrl ? `You can also book here: ${bookingUrl}` : "How can we help you next?"}`;
  }

  if (hasGreeted) {
    return `Thanks for the reply. Want me to book you in with ${businessName}, or is there a question I can answer?${bookingUrl ? ` Booking link: ${bookingUrl}` : ""}`;
  }

  return `Thanks for texting ${businessName}. How can we help you today?${bookingUrl ? ` You can also book here: ${bookingUrl}` : ""}`;
}

async function maybeStartVapiAfterMissedCall({
  agent,
  callerNumber,
  callerName,
  conversationId,
  reason,
  existingCallId
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  conversationId?: string | null;
  reason: string;
  existingCallId?: string | null;
}) {
  if (existingCallId || !agent.business) return existingCallId ?? null;

  if (agent.business.businessId) {
    const pausedNow = await isVapiInstalledAgentPaused(
      agent.business.businessId,
      agent.business.installedAgentId ?? undefined
    );
    if (pausedNow) {
      console.log("[pause] outbound Vapi callback aborted — agent paused just before provider call", {
        businessId: agent.business.businessId,
        installedAgentId: agent.business.installedAgentId ?? null
      });
      return null;
    }
  }

  let outboundHours: { state: "open" | "closed" | "unknown"; statusLine: string; nextOpenText: string } | null =
    null;
  try {
    const businessId = agent.business.businessId;
    const policy = businessId
      ? await resolveAfterHoursPolicyForBusiness(businessId, agent.business.installedAgentId)
      : null;
    if (businessId && policy?.enabled) {
      const snapshot = await buildAfterHoursSnapshotForBusiness(businessId, { simulate: null });
      outboundHours = {
        state: snapshot.state.toLowerCase() as "open" | "closed" | "unknown",
        statusLine: snapshot.statusLine,
        nextOpenText: snapshot.nextOpenText
      };
    }
  } catch (error) {
    console.error("[after-hours] outbound hours decision failed (non-fatal)", error);
  }

  const call = await startVapiOutboundCall({
    customerPhone: callerNumber,
    customerName: callerName,
    businessHours: outboundHours,
    business: {
      businessId: agent.business.businessId,
      businessName: agent.business.businessName,
      businessType: agent.business.businessType,
      bookingUrl: agent.business.bookingUrl,
      teamPhone: agent.business.teamPhone,
      services: agent.business.services,
      faqs: agent.business.faqs,
      knowledge: agent.business.knowledge,
      tone: agent.business.tone,
      escalationRules: agent.business.escalationRules,
      calendarId: agent.business.calendarId,
      timeZone: agent.business.timeZone
    },
    reason,
    assistantId: agent.business.vapiAssistantId,
    phoneNumberId: agent.business.vapiPhoneNumberId,
    metadata: {
      businessId: agent.business.businessId,
      businessOwnerId: agent.business.ownerId,
      conversationId,
      workflowId: agent.workflowId,
      installedAgentId: agent.business.installedAgentId,
      assignedPhoneNumber: agent.business.businessPhoneNumber
    }
  });

  if (agent.business.businessId && call.id) {
    await prisma.vapiCall.upsert({
      where: { callId: call.id },
      update: {
        status: call.status ?? "STARTED",
        conversationId: conversationId ?? undefined
      },
      create: {
        businessId: agent.business.businessId,
        installedAgentId: agent.business.installedAgentId ?? undefined,
        conversationId: conversationId ?? undefined,
        callId: call.id,
        customerPhone: callerNumber,
        status: call.status ?? "STARTED",
        metadataJson: {
          workflowId: agent.workflowId,
          reason
        }
      }
    });
  }

  return call.id;
}

async function runMissedCallAgent({
  agent,
  callerNumber,
  callerName,
  reason,
  callSid
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  reason: string;
  /** Twilio CallSid — dedupes retried/doubly-configured webhook deliveries. */
  callSid?: string | null;
}) {
  const conversation = await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone: callerNumber,
    direction: "SYSTEM",
    body: `Missed call detected. ${reason}`,
    providerId: null
  });

  let run: Awaited<ReturnType<typeof runWorkflowTest>>;
  try {
    run = await runWorkflowTest({
      userId: agent.business?.ownerId ?? agent.userId,
      workflowId: agent.workflowId,
      workflowJson: agent.workflowJson,
      mode: "live",
      executionMode: agent.business?.executionMode ?? "LIVE",
      callProvider: callSid ? "TWILIO" : undefined,
      externalCallId: callSid || undefined,
      input: runInputFromContext({
        agent,
        callerNumber,
        callerName,
        reason
      })
    });
  } catch (error) {
    if (error instanceof DuplicateWorkflowRunError) {
      console.log("[twilio-webhook] duplicate missed-call delivery ignored", {
        callSid,
        workflowId: agent.workflowId
      });
      return null;
    }
    throw error;
  }

  const sentSms = typeof run.context.sentSms === "object" && run.context.sentSms !== null
    ? (run.context.sentSms as { body?: string; id?: string | null })
    : null;

  // Skip if a Save Conversation node in the workflow already persisted the reply.
  if (sentSms?.body && !run.context.conversationSaved) {
    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone: callerNumber,
      direction: "OUTBOUND",
      body: sentSms.body,
      providerId: sentSms.id ?? null
    });
  }

  const existingVapiId = typeof run.context.vapiCall === "object" && run.context.vapiCall !== null
    ? (run.context.vapiCall as { id?: string | null }).id
    : null;

  await maybeStartVapiAfterMissedCall({
    agent,
    callerNumber,
    callerName,
    conversationId: conversation?.id,
    reason,
    existingCallId: existingVapiId
  }).catch((error) => {
    console.error("Vapi follow-up call failed", error);
  });

  // Skip if a Save Lead node in the workflow already persisted the lead.
  if (!run.context.leadSaved) {
    await upsertLead({
      businessId: agent.business?.businessId,
      phoneNumber: callerNumber,
      source: "TWILIO_MISSED_CALL",
      status: "CAPTURED",
      notes: reason,
      name: callerName
    });
  }

  return run;
}

export async function resolveCallerContext(
  businessId: string | null | undefined,
  callerPhone: string | null | undefined,
  timeZone?: string
): Promise<VapiCallerContext | null> {
  if (!businessId || !callerPhone) return null;
  const validated = validateSmsRecipientE164(callerPhone);
  if (!validated.ok || validated.e164.replace("+", "") === ANONYMOUS_CALLER_DIGITS) {
    return null;
  }
  const e164Phone = validated.e164;
  const now = new Date();
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  try {
    const activeAppointments = await prisma.appointment.findMany({
      where: {
        businessId,
        customerPhone: e164Phone,
        status: { in: CANCELLABLE_APPOINTMENT_STATUSES },
        startAt: { gte: now }
      },
      orderBy: { startAt: "asc" },
      take: 5,
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        service: true,
        startAt: true,
        timeZone: true
      }
    });

    const hasUpcoming = activeAppointments.length > 0;
    const firstMatch = activeAppointments[0];
    const customerName = firstMatch?.customerName || null;
    const customerEmail = firstMatch?.customerEmail || null;

    let summary: string | null = null;
    if (hasUpcoming) {
      const formatted = activeAppointments.map((appt) => {
        const d = formatApptDate(appt.startAt, appt.timeZone || tz);
        const t = formatApptTime(appt.startAt, appt.timeZone || tz);
        const s = appt.service || "appointment";
        return `${s} on ${d} at ${t}`;
      });
      summary = `${activeAppointments.length} upcoming appointment(s): ${formatted.join("; ")}`;
    }

    return {
      callerIsReturning: hasUpcoming || Boolean(customerName),
      callerName: customerName,
      callerEmail: customerEmail,
      existingAppointmentCount: activeAppointments.length,
      hasUpcomingAppointment: hasUpcoming,
      existingAppointmentsSummary: summary,
      activeAppointmentsJson: hasUpcoming ? JSON.stringify(activeAppointments) : null
    };
  } catch (error) {
    console.error("[vapi-webhook] resolveCallerContext failed (non-fatal)", error);
    return null;
  }
}

async function buildVapiAnswerTwiml({
  agent,
  callerNumber,
  callerName,
  calledNumber,
  reason
}: {
  agent: ResolvedAgent;
  callerNumber: string;
  callerName?: string;
  calledNumber?: string | null;
  reason: string;
}): Promise<string | null> {
  const business = agent.business;
  if (!business || !callerNumber) return null;

  if (business.businessId) {
    const pausedNow = await isVapiInstalledAgentPaused(business.businessId, business.installedAgentId ?? undefined);
    if (pausedNow) {
      console.log("[pause] inbound Vapi answer aborted — agent paused just before provider call", {
        businessId: business.businessId,
        installedAgentId: business.installedAgentId ?? null
      });
      return null;
    }
  }

  let hoursVariables: { state: "open" | "closed" | "unknown"; statusLine: string; nextOpenText: string } | null =
    null;
  let firstMessageOverride: string | null = null;

  try {
    const businessId = business.businessId;
    const policy = businessId
      ? await resolveAfterHoursPolicyForBusiness(businessId, business.installedAgentId)
      : null;
    if (businessId && policy?.enabled) {
      const snapshot = await buildAfterHoursSnapshotForBusiness(businessId, { simulate: null });
      hoursVariables = {
        state: snapshot.state.toLowerCase() as "open" | "closed" | "unknown",
        statusLine: snapshot.statusLine,
        nextOpenText: snapshot.nextOpenText
      };

      if (snapshot.state === "CLOSED") {
        firstMessageOverride = resolveAfterHoursGreeting({ policy, businessName: business.businessName });
      }

      logAfterHoursRouting({
        event: "live_call_hours_decision",
        businessId: business.businessId,
        installedAgentId: business.installedAgentId ?? null,
        timeZone: snapshot.timeZone,
        hoursState: snapshot.state,
        executionMode: "LIVE",
        callerPhone: callerNumber,
        ...(snapshot.state === "UNKNOWN"
          ? { warning: "business hours not configured/confirmed — neutral wording used, no closed claim" }
          : {})
      });
    }
  } catch (error) {
    console.error("[after-hours] live hours decision failed (non-fatal)", error);
  }

  const callerContext = await resolveCallerContext(business.businessId, callerNumber, business.timeZone);

  return createVapiInboundTwiml({
    callerNumber,
    callerName,
    reason,
    businessHours: hoursVariables,
    firstMessageOverride,
    callerContext,
    business: {
      businessId: business.businessId,
      businessName: business.businessName,
      businessType: business.businessType,
      bookingUrl: business.bookingUrl,
      teamPhone: business.teamPhone,
      services: business.services,
      faqs: business.faqs,
      knowledge: business.knowledge,
      tone: business.tone,
      escalationRules: business.escalationRules,
      calendarId: business.calendarId,
      timeZone: business.timeZone
    },
    assistantId: business.vapiAssistantId,
    phoneNumberId: business.vapiPhoneNumberId,
    phoneNumber: calledNumber,
    metadata: {
      businessId: business.businessId,
      businessOwnerId: business.ownerId,
      installedAgentId: business.installedAgentId,
      workflowId: agent.workflowId,
      assignedPhoneNumber: calledNumber || business.businessPhoneNumber
    }
  });
}

/** The buyer's persisted answering mode (InstalledAgent.configJson.phoneRouting.mode). */
function readRoutingMode(configJson: unknown): string | undefined {
  const routing = (configJson as Record<string, unknown> | null)?.phoneRouting;
  if (typeof routing === "object" && routing !== null) {
    const mode = (routing as Record<string, unknown>).mode;
    if (typeof mode === "string" && mode.trim()) return mode.trim().toUpperCase();
  }
  return undefined;
}

function readAnsweringHours(configJson: unknown): unknown {
  const routing = (configJson as Record<string, unknown> | null)?.phoneRouting;
  if (typeof routing === "object" && routing !== null) {
    return (routing as Record<string, unknown>).answeringHours ?? undefined;
  }
  return undefined;
}

/** AI Call Coverage (configJson.phoneRouting.coverage) — the buyer's answer-time window. */
function readCoverage(configJson: unknown): string | undefined {
  const routing = (configJson as Record<string, unknown> | null)?.phoneRouting;
  if (typeof routing === "object" && routing !== null) {
    const coverage = (routing as Record<string, unknown>).coverage;
    if (typeof coverage === "string" && coverage.trim()) return coverage.trim().toLowerCase();
  }
  return undefined;
}

function isWithinBusinessHours(
  hours: unknown,
  timeZone?: string,
  special: SpecialHoursEntry[] = []
): boolean | null {
  const weekly = normalizeWeeklyHours(hours);
  if (!weekly && special.length === 0) return null;

  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  try {
    const status = businessOpenStatus({ weekly, special, timeZone: tz });
    return status.state === "unknown" ? null : status.state === "open";
  } catch {
    return null;
  }
}

/** Today's + tomorrow's special-hours overrides for a business (may be empty). */
async function loadSpecialHoursForRouting(
  businessId: string | undefined,
  timeZone?: string
): Promise<SpecialHoursEntry[]> {
  if (!businessId) return [];
  const tz = timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  try {
    const today = dateInTimeZone(tz);
    const rows = await prisma.businessSpecialHours.findMany({
      where: { businessId, date: { in: [today, addDaysToDate(today, 1)] } },
      select: { date: true, kind: true, closed: true, periodsJson: true, note: true }
    });
    return specialEntriesFromRows(rows);
  } catch {
    return [];
  }
}

export async function shouldAnswerWithAiByMode(
  mode: string,
  agent: {
    business?: { businessId?: string; hours?: unknown; timeZone?: string };
    coverage?: string;
    answeringHours?: unknown;
  }
): Promise<boolean> {
  const modeAllows = await (async () => {
    switch (mode) {
      case "AI_FIRST":
      case "NO_ANSWER":
      case "BUSY":
      case "UNREACHABLE":
        return true;
      case "AFTER_HOURS": {
        const special = await loadSpecialHoursForRouting(agent.business?.businessId, agent.business?.timeZone);
        // Answer when outside hours OR when hours are unknown; skip only when open.
        return isWithinBusinessHours(agent.business?.hours, agent.business?.timeZone, special) !== true;
      }
      case "BUSINESS_HOURS": {
        const special = await loadSpecialHoursForRouting(agent.business?.businessId, agent.business?.timeZone);
        // Answer only while open; unknown hours → answer (never drop calls).
        return isWithinBusinessHours(agent.business?.hours, agent.business?.timeZone, special) !== false;
      }
      case "CUSTOM_HOURS":
        // Legacy combined mode (pre-coverage saves) — the schedule IS the gate.
        return isWithinBusinessHours(agent.answeringHours, agent.business?.timeZone) !== false;
      default:
        return true;
    }
  })();

  if (!modeAllows) return false;

  // AI Call Coverage is a second, independent time gate. Absent or "always"
  // keeps the legacy behavior; unknown hours never drop a call.
  switch (agent.coverage) {
    case "business_hours": {
      const special = await loadSpecialHoursForRouting(agent.business?.businessId, agent.business?.timeZone);
      return isWithinBusinessHours(agent.business?.hours, agent.business?.timeZone, special) !== false;
    }
    case "custom":
      return isWithinBusinessHours(agent.answeringHours, agent.business?.timeZone) !== false;
    default:
      return true;
  }
}

export async function getCallRoutingDiagnostics(rawNumber: string) {
  const normalizedNumber = normalizePhoneNumber(rawNumber);
  const agent = normalizedNumber ? await resolveAgent({ calledNumber: normalizedNumber }) : null;
  const assistantId = agent?.business?.vapiAssistantId;
  const routingMode = agent?.routingMode;
  const aiWouldAnswer = agent
    ? routingMode
      ? await shouldAnswerWithAiByMode(routingMode, agent)
      : true
    : false;

  return {
    normalizedNumber,
    resolved: Boolean(agent),
    matchedBusinessPhoneNumberId: agent?.matchedBusinessPhoneNumberId ?? null,
    matchedPlatformPhoneNumberId: agent?.matchedPlatformPhoneNumberId ?? null,
    businessId: agent?.business?.businessId ?? null,
    installedAgentId: agent?.business?.installedAgentId ?? null,
    routingMode: routingMode ?? null,
    aiCallCoverage: agent?.coverage ?? null,
    hasVapiAssistantId: isRealId(assistantId),
    hasVapiPhoneNumberId: isRealId(agent?.business?.vapiPhoneNumberId),
    aiWouldAnswer,
    resolveReason: agent?.resolveReason ?? null
  };
}

const NOT_DEPLOYED_MESSAGE = "This AI agent is not deployed yet.";

/** Valid 200 TwiML with a spoken message (used for every non-streaming outcome). */
function sayTwiml(c: Context, message: string) {
  return c.text(`<Response><Say>${escapeXml(message)}</Say></Response>`, 200, {
    "Content-Type": "text/xml"
  });
}

/** 200 TwiML that forwards the call to a human (the assigned forwarding number). */
function dialForward(c: Context, forwardToPhone: string, workflowId: string, calledNumber: string) {
  const actionUrl = `${env.BACKEND_URL}/architect/connectors/twilio/voice-action/${workflowId}?to=${encodeURIComponent(calledNumber)}`;
  const responseXml = [
    "<Response>",
    `<Dial timeout=\"${env.TWILIO_FORWARD_TIMEOUT_SECONDS}\" action=\"${escapeXml(actionUrl)}\" method=\"POST\" answerOnBridge=\"true\">`,
    `<Number>${escapeXml(forwardToPhone)}</Number>`,
    "</Dial>",
    "</Response>"
  ].join("");
  return c.text(responseXml, 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioVoice(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    // A genuine signature failure is a security rejection — never a setup 404.
    return c.text("<Response><Reject /></Response>", 403, {
      "Content-Type": "text/xml"
    });
  }

  const calledNumber = readBodyString(body, ["Called", "To", "to"]);
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]) || undefined;
  const forwardedFrom = readBodyString(body, ["ForwardedFrom", "OriginalCalled", "forwardedFrom"]);

  const normalizedCandidates = Array.from(
    new Set(
      [calledNumber, forwardedFrom].map((value) => (value ? normalizePhoneNumber(value) : "")).filter(Boolean)
    )
  );

  const agent = await resolveAgent({
    calledNumber,
    calledNumbers: forwardedFrom ? [forwardedFrom] : [],
    workflowId
  });

  const forwardToPhone = agent?.forwardToPhone ?? env.TWILIO_FORWARD_TO_PHONE;
  const assistantId = agent?.business?.vapiAssistantId;
  const hasVapiAssistantId = isRealId(assistantId);

  // Structured, secret-free diagnostics for every inbound voice webhook.
  const logDiag = (reasonIfRejected: string | null) => {
    console.log("[twilio.voice]", {
      to: calledNumber || null,
      called: calledNumber || null,
      from: callerNumber || null,
      normalizedCandidates,
      matchedBusinessPhoneNumberId: agent?.matchedBusinessPhoneNumberId ?? null,
      matchedPlatformPhoneNumberId: agent?.matchedPlatformPhoneNumberId ?? null,
      businessId: agent?.business?.businessId ?? null,
      installedAgentId: agent?.business?.installedAgentId ?? null,
      answeringMode: agent?.routingMode ?? null,
      hasConfigJson: Boolean(agent?.business?.installedAgentId),
      hasVapiAssistantId,
      hasVapiPhoneNumberId: isRealId(agent?.business?.vapiPhoneNumberId),
      resolveReason: agent?.resolveReason ?? null,
      reasonIfRejected
    });
  };

  // Never 404: an unresolved number returns friendly, valid 200 TwiML.
  if (!agent) {
    logDiag("no_agent_resolved");
    return sayTwiml(c, NOT_DEPLOYED_MESSAGE);
  }

  if (agent.agentPaused) {
    if (forwardToPhone) {
      logDiag("agent_paused_forwarding_to_human");
      return dialForward(c, forwardToPhone, agent.workflowId, calledNumber);
    }
    logDiag("agent_paused");
    return sayTwiml(c, "This assistant is temporarily unavailable. Please try again later.");
  }

  const hasDeployedAssistant = Boolean(assistantId);
  const aiShouldAnswer = agent.routingMode
    ? await shouldAnswerWithAiByMode(agent.routingMode, agent)
    : env.VAPI_ANSWER_INBOUND || hasDeployedAssistant || !forwardToPhone;

  if (aiShouldAnswer) {
    // Validate the Vapi assistant before attempting to stream.
    if (!hasVapiAssistantId) {
      if (forwardToPhone) {
        logDiag("no_vapi_assistant_forwarding_to_human");
        return dialForward(c, forwardToPhone, agent.workflowId, calledNumber);
      }
      logDiag("no_vapi_assistant");
      return sayTwiml(c, NOT_DEPLOYED_MESSAGE);
    }

    const aiTwiml = await buildVapiAnswerTwiml({
      agent,
      callerNumber,
      callerName,
      calledNumber,
      reason: "Inbound call answered live by the AI receptionist."
    });

    if (aiTwiml) {
      logDiag(null);
      return c.text(aiTwiml, 200, { "Content-Type": "text/xml" });
    }

    // Assistant present but Vapi couldn't build the stream — human fallback or say.
    if (forwardToPhone) {
      logDiag("vapi_stream_build_failed_forwarding_to_human");
      return dialForward(c, forwardToPhone, agent.workflowId, calledNumber);
    }
    logDiag("vapi_stream_build_failed");
    return sayTwiml(c, NOT_DEPLOYED_MESSAGE);
  }

  if (!forwardToPhone) {
    logDiag("ai_skipped_no_forward");
    return c.text("<Response><Say>Sorry, this business is not available right now.</Say></Response>", 200, {
      "Content-Type": "text/xml"
    });
  }

  logDiag("forwarded_to_human");
  return dialForward(c, forwardToPhone, agent.workflowId, calledNumber);
}

export async function handleTwilioVoiceAction(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  const calledNumber = readBodyString(body, ["Called", "To", "to"]) || c.req.query("to") || "";
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]);
  const dialStatus = readBodyString(body, ["DialCallStatus", "DialStatus", "CallStatus"]);
  const callSid = readBodyString(body, ["CallSid", "callSid"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  if (!agent || !callerNumber) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  if (dialStatus === "completed") {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  // Paused agents never run the missed-call text-back workflow.
  if (agent.agentPaused) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  await runMissedCallAgent({
    agent,
    callerNumber,
    callerName,
    callSid,
    reason: `Twilio forwarded the call but office did not answer. Dial status: ${dialStatus || "unknown"}.`
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioMissedCall(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  const calledNumber = readBodyString(body, ["Called", "To", "to"]);
  const callerNumber = readBodyString(body, ["From", "Caller", "from"]);
  const callerName = readBodyString(body, ["CallerName", "callerName"]);
  const callSid = readBodyString(body, ["CallSid", "callSid"]);
  const agent = await resolveAgent({ calledNumber, workflowId });

  // Paused agents never run the missed-call text-back workflow.
  if (!agent || !callerNumber || agent.agentPaused) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  await runMissedCallAgent({
    agent,
    callerNumber,
    callerName,
    callSid,
    reason: "Direct Twilio missed-call webhook triggered this agent."
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

function isSmsCancelRequest(body: string): boolean {
  return /^c$/i.test((body ?? "").trim().replace(/[.!]+$/, ""));
}
async function cancelAppointmentFromSms(
  customerPhone: string,
  businessId?: string | null
): Promise<string> {
  const validated = validateSmsRecipientE164(customerPhone);
  if (!validated.ok) {
    return "We couldn't verify this phone number, so nothing was cancelled. Please call the business for help.";
  }

  const upcoming = await prisma.appointment.findMany({
    where: {
      customerPhone: validated.e164,
      status: { in: CANCELLABLE_APPOINTMENT_STATUSES },
      startAt: { gte: new Date() },
      ...(businessId ? { businessId } : {})
    },
    orderBy: { startAt: "asc" },
    take: 3,
    include: { business: { select: { id: true, ownerId: true, name: true } } }
  });

  if (upcoming.length === 0) {
    return "We couldn't find an upcoming appointment for this number, so nothing was cancelled. Please call the business if you need help.";
  }

  if (upcoming.length > 1) {
    return "You have more than one upcoming appointment, so nothing was cancelled automatically. Please call the business to choose which one to cancel.";
  }

  const target = upcoming[0];
  const timeZone = target.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const dateLabel = formatApptDate(target.startAt, timeZone);
  const timeLabel = formatApptTime(target.startAt, timeZone);

  // Google Calendar first: if the linked event cannot be removed, the
  // appointment stays active and the customer must not hear that it worked.
  if (target.calendarEventId && target.business.ownerId) {
    try {
      const profile = await prisma.businessProfile.findUnique({
        where: { businessId: target.business.id },
        select: { calendarId: true }
      });
      await cancelGoogleCalendarAppointment({
        userId: target.business.ownerId,
        calendarId: profile?.calendarId,
        eventId: target.calendarEventId
      });
    } catch (error) {
      console.error("[inbound-sms] cancel-by-SMS calendar delete failed (appointment NOT cancelled)", error);
      return "We couldn't complete the cancellation just now. Please try again shortly or call the business and they'll take care of it.";
    }
  }

  await prisma.appointment.update({
    where: { id: target.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationSource: "CUSTOMER_SMS"
    }
  });

  const emailKey = `appointment-cancellation:${target.id}:team-email`;
  enqueueEmail(
    {
      kind: "internal_notification",
      input: {
        businessId: target.business.id,
        businessName: target.business.name,
        purpose: "INTERNAL_NOTIFICATION",
        idempotencyKey: emailKey,
        fields: {
          caller: target.customerName || null,
          phone: target.customerPhone,
          email: null,
          requestedService: target.service || null,
          summary: `Appointment on ${dateLabel} at ${timeLabel} was cancelled by the customer by SMS ("C").`,
          nextAction: "No action needed unless you want to follow up with the customer."
        }
      }
    },
    { idempotencyKey: emailKey }
  ).catch((error) => console.error("[inbound-sms] cancellation email failed (non-fatal)", error));

  return `Your ${target.service ? `${target.service} ` : ""}appointment on ${dateLabel} at ${timeLabel} has been cancelled. Reply HELP for assistance.`;
}

async function handleSharedSenderInboundSms(
  c: Context,
  customerPhone: string,
  incomingBody: string,
  optOutType?: string
) {
  const keyword = classifyInboundSmsKeyword(incomingBody, optOutType);
  if (keyword) {
    try {
      if (keyword === "STOP") {
        const { updated } = await applySmsOptOut({ phoneNumber: customerPhone, source: "SMS_STOP" });
        console.log("[twilio.sms] STOP on shared sender — consent revoked", {
          from: maskPhone(customerPhone),
          recordsUpdated: updated
        });
      } else if (keyword === "START") {
        const { updated } = await applySmsReOptIn({ phoneNumber: customerPhone });
        console.log("[twilio.sms] START on shared sender — prior STOP opt-outs restored", {
          from: maskPhone(customerPhone),
          recordsUpdated: updated
        });
      } else {
        console.log("[twilio.sms] HELP on shared sender", { from: maskPhone(customerPhone) });
      }
    } catch (error) {
      console.error("[twilio.sms] keyword consent sync failed", error);
    }
    if (keyword === "HELP" && env.SMS_KEYWORD_APP_REPLIES) {
      return c.text(
        `<Response><Message>${escapeXml(smsHelpReplyText())}</Message></Response>`,
        200,
        { "Content-Type": "text/xml" }
      );
    }
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  // "Reply C to cancel" — the confirmation SMS promises this exact shortcut.
  if (isSmsCancelRequest(incomingBody)) {
    const reply = await cancelAppointmentFromSms(customerPhone);
    return c.text(
      `<Response><Message>${escapeXml(reply)}</Message></Response>`,
      200,
      { "Content-Type": "text/xml" }
    );
  }

  console.log("[twilio.sms] unmatched shared-sender inbound message (not routed to any business)", {
    from: maskPhone(customerPhone),
    bodyLength: incomingBody.length
  });
  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioInboundSms(c: Context) {
  const workflowId = c.req.param("workflowId") || undefined;
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  const businessNumber = readBodyString(body, ["To", "to"]);
  const customerPhone = readBodyString(body, ["From", "from"]);
  const incomingBody = readBodyString(body, ["Body", "body"]);
  const optOutType = readBodyString(body, ["OptOutType", "optOutType"]);
  // Twilio retries the same inbound webhook (identical MessageSid) on timeout;
  // keying the AI reply on it makes the reply send — and its billable ledger
  // row — idempotent instead of duplicating on every retry.
  const inboundMessageSid = readBodyString(body, ["MessageSid", "SmsSid"]);

  const sharedSender = normalizePhoneE164(env.TWILIO_SHARED_SMS_NUMBER ?? "");
  if (sharedSender && normalizePhoneE164(businessNumber) === sharedSender) {
    if (!customerPhone || !incomingBody) {
      return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
    }
    return handleSharedSenderInboundSms(c, customerPhone, incomingBody, optOutType);
  }

  const agent = await resolveAgent({ calledNumber: businessNumber, workflowId });

  if (!agent || !customerPhone || !incomingBody) {
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }
  const keyword = classifyInboundSmsKeyword(incomingBody, optOutType);
  if (keyword) {
    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone,
      direction: "INBOUND",
      body: incomingBody,
      providerId: readBodyString(body, ["MessageSid", "SmsSid"])
    }).catch(() => null);

    if (agent.business?.businessId) {
      try {
        if (keyword === "STOP") {
          await applySmsOptOut({
            phoneNumber: customerPhone,
            businessId: agent.business.businessId,
            source: "SMS_STOP"
          });
        } else if (keyword === "START") {
          await applySmsReOptIn({ phoneNumber: customerPhone, businessId: agent.business.businessId });
        }
      } catch (error) {
        console.error("[inbound-sms] keyword consent sync failed", error);
      }
    }

    if (keyword === "HELP" && env.SMS_KEYWORD_APP_REPLIES) {
      return c.text(
        `<Response><Message>${escapeXml(smsHelpReplyText())}</Message></Response>`,
        200,
        { "Content-Type": "text/xml" }
      );
    }
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  if (isSmsCancelRequest(incomingBody)) {
    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone,
      direction: "INBOUND",
      body: incomingBody,
      providerId: readBodyString(body, ["MessageSid", "SmsSid"])
    }).catch(() => null);

    const reply = await cancelAppointmentFromSms(customerPhone, agent.business?.businessId ?? null);

    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone,
      direction: "OUTBOUND",
      body: reply,
      providerId: null
    }).catch(() => null);

    return c.text(
      `<Response><Message>${escapeXml(reply)}</Message></Response>`,
      200,
      { "Content-Type": "text/xml" }
    );
  }

  if (agent.agentPaused) {
    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone,
      direction: "INBOUND",
      body: incomingBody,
      providerId: readBodyString(body, ["MessageSid", "SmsSid"])
    }).catch(() => null);
    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  if (!workflowSupportsSmsReplies(agent.workflowJson)) {
    await upsertConversation({
      businessId: agent.business?.businessId,
      customerPhone,
      direction: "INBOUND",
      body: incomingBody,
      providerId: readBodyString(body, ["MessageSid", "SmsSid"])
    }).catch(() => null);

    console.log("[inbound-sms] no SMS-capable node in workflow — recorded without reply", {
      workflowId: agent.workflowId,
      businessId: agent.business?.businessId ?? null
    });

    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  }

  const conversation = await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone,
    direction: "INBOUND",
    body: incomingBody,
    providerId: readBodyString(body, ["MessageSid", "SmsSid"])
  });

  const history = conversation?.id ? await loadConversationHistory(conversation.id) : [];
  let replyBody: string;
  let bookedEventId: string | null = null;
  let bookedAppointmentId: string | null = null;

  const smsWorkflowCanBook = workflowCapabilities(agent.workflowJson, "sms").canBook;

  const requestedSlot =
    smsWorkflowCanBook && agent.business?.businessId && agent.business?.ownerId
      ? parseRequestedAppointment(
        incomingBody,
        agent.business.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE
      )
      : null;

  if (requestedSlot && agent.business) {
    try {
      const service = inferService(incomingBody, agent.business.services);
      const { calendarEvent, appointment } = await createBusinessAppointment({
        business: agent.business,
        customerPhone,
        service,
        startAt: requestedSlot.startAt,
        endAt: requestedSlot.endAt,
        conversationId: conversation?.id,
        description: `Booked from inbound SMS for ${agent.business.businessName}. Phone: ${customerPhone}`,
        notes: `Requested via SMS: "${incomingBody}"`
      });

      bookedEventId = calendarEvent.id;
      bookedAppointmentId = appointment.id;
      replyBody = `${smsAttributionPrefix(agent.business.businessName)}You're booked — ${service} on ${formatAppointmentTime(
        calendarEvent.startAt,
        agent.business.timeZone
      )}.${agent.business.businessPhoneNumber ? ` For assistance call ${agent.business.businessPhoneNumber}.` : ""}`;
    } catch (error) {
      console.error("Inbound SMS booking failed", error);
      replyBody = buildInboundSmsReply(agent, incomingBody, history);
    }
  } else if (detectFactIntents(incomingBody).includes("hours") && agent.business?.businessId) {
    // Hours questions answer from the confirmed structured schedule — the
    // same source live calls and demos use. Never guessed.
    const status = await businessOpenStatusNow(agent.business.businessId);
    replyBody =
      status.state === "unknown"
        ? `${agent.business.businessName}: our operating hours haven't been confirmed yet — we'll have the team follow up with exact times. Anything else we can help with?`
        : `${agent.business.businessName}: ${describeOpenStatus(status)}${agent.business.bookingUrl ? ` Book anytime: ${agent.business.bookingUrl}` : ""
        }`;
  } else {
    replyBody = buildInboundSmsReply(agent, incomingBody, history);
  }

  const sent = await sendTrackedSms({
    to: customerPhone,
    body: replyBody,
    messageType: bookedAppointmentId ? "APPOINTMENT_CONFIRMATION" : "WORKFLOW_SMS",
    businessId: agent.business?.businessId ?? null,
    businessName: agent.business?.businessName ?? null,
    smsPurpose: bookedAppointmentId ? "APPOINTMENT_CONFIRMATION" : "SUPPORT_RESPONSE",
    installedAgentId: agent.business?.installedAgentId ?? null,
    appointmentId: bookedAppointmentId,
    dedupeKey: bookedAppointmentId
      ? `appointment-confirmation:${bookedAppointmentId}`
      : inboundMessageSid
        ? `inbound-reply:${inboundMessageSid}`
        : null
  });

  await upsertConversation({
    businessId: agent.business?.businessId,
    customerPhone,
    direction: "OUTBOUND",
    body: replyBody,
    providerId: bookedEventId ?? sent.messageSid
  });

  await upsertLead({
    businessId: agent.business?.businessId,
    phoneNumber: customerPhone,
    source: "TWILIO_SMS",
    status: bookedEventId ? "BOOKED" : "ENGAGED",
    notes: incomingBody
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

export async function handleTwilioMessageStatus(c: Context) {
  const body = await parseBody(c);

  if (!isValidTwilioRequest(c, body)) {
    return c.text("<Response></Response>", 403, { "Content-Type": "text/xml" });
  }

  try {
    const params = stringParams(body);
    const result = await applyTwilioMessageStatus({
      MessageSid: params.MessageSid ?? params.SmsSid,
      MessageStatus: params.MessageStatus,
      SmsStatus: params.SmsStatus,
      ErrorCode: params.ErrorCode,
      ErrorMessage: params.ErrorMessage,
      From: params.From,
      To: params.To,
      NumSegments: params.NumSegments,
      Price: params.Price,
      PriceUnit: params.PriceUnit
    });
    console.log("[twilio.message-status]", {
      messageSid: params.MessageSid ?? params.SmsSid ?? null,
      status: params.MessageStatus ?? params.SmsStatus ?? null,
      errorCode: params.ErrorCode ?? null,
      executionId: result.executionId
    });
  } catch (error) {
    // Processing failures are logged but still answered 200 — Twilio retries
    // do not help a genuine bug, and the message itself already went out.
    console.error("[twilio.message-status] processing failed", error);
  }

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
}

function getVapiMetadata(body: Record<string, unknown>) {
  const paths: string[][] = [
    ["message", "assistant", "metadata"],
    ["assistant", "metadata"],
    ["message", "call", "assistantOverrides", "metadata"],
    ["message", "call", "metadata"],
    ["call", "metadata"],
    ["metadata"]
  ];

  const merged: Record<string, unknown> = {};

  for (const path of paths) {
    const metadata = getNestedRecord(body, path);
    if (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)) {
      Object.assign(merged, metadata as Record<string, unknown>);
    }
  }

  return merged;
}

function getFirstToolCall(body: Record<string, unknown>) {
  // Vapi OpenAI-style: message.toolCalls[0] = { id, function: { name, arguments } }
  // where `arguments` is a JSON string.
  for (const path of [["message", "toolCalls"], ["toolCalls"]]) {
    const calls = getNestedRecord(body, path);
    if (Array.isArray(calls) && calls.length > 0 && typeof calls[0] === "object" && calls[0] !== null) {
      const record = calls[0] as Record<string, unknown>;
      const fn =
        typeof record.function === "object" && record.function !== null
          ? (record.function as Record<string, unknown>)
          : {};
      const name = typeof fn.name === "string" ? fn.name : typeof record.name === "string" ? record.name : "";
      if (name) {
        let parameters: Record<string, unknown> = {};
        const raw = fn.arguments ?? record.arguments;
        if (typeof raw === "string") {
          try {
            parameters = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parameters = {};
          }
        } else if (typeof raw === "object" && raw !== null) {
          parameters = raw as Record<string, unknown>;
        }
        return {
          id: typeof record.id === "string" ? record.id : "",
          name,
          parameters
        };
      }
    }
  }

  const list = getNestedRecord(body, ["message", "toolCallList"]);
  if (Array.isArray(list) && list.length > 0 && typeof list[0] === "object" && list[0] !== null) {
    const record = list[0] as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : "",
      name: typeof record.name === "string" ? record.name : "",
      parameters:
        typeof record.parameters === "object" && record.parameters !== null
          ? (record.parameters as Record<string, unknown>)
          : {}
    };
  }

  const toolWithToolCallList = getNestedRecord(body, ["message", "toolWithToolCallList"]);
  if (Array.isArray(toolWithToolCallList) && toolWithToolCallList.length > 0 && typeof toolWithToolCallList[0] === "object" && toolWithToolCallList[0] !== null) {
    const record = toolWithToolCallList[0] as Record<string, unknown>;
    const toolCall = typeof record.toolCall === "object" && record.toolCall !== null ? (record.toolCall as Record<string, unknown>) : {};
    return {
      id: typeof toolCall.id === "string" ? toolCall.id : "",
      name: typeof record.name === "string" ? record.name : "",
      parameters:
        typeof toolCall.parameters === "object" && toolCall.parameters !== null
          ? (toolCall.parameters as Record<string, unknown>)
          : {}
    };
  }

  const legacyName = firstNestedString(body, [
    ["message", "toolCall", "function", "name"],
    ["toolCall", "function", "name"],
    ["function", "name"]
  ]);
  const legacyId = firstNestedString(body, [
    ["message", "toolCall", "id"],
    ["toolCall", "id"],
    ["id"]
  ]);
  const rawArguments =
    getNestedRecord(body, ["message", "toolCall", "function", "arguments"]) ??
    getNestedRecord(body, ["toolCall", "function", "arguments"]) ??
    body.arguments;

  let parameters: Record<string, unknown> = {};
  if (typeof rawArguments === "string") {
    try {
      parameters = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      parameters = {};
    }
  } else if (typeof rawArguments === "object" && rawArguments !== null) {
    parameters = rawArguments as Record<string, unknown>;
  }

  return {
    id: legacyId,
    name: legacyName,
    parameters
  };
}

async function findBusinessByVapiWebhook(body: Record<string, unknown>) {
  const metadata = getVapiMetadata(body);
  const businessId = typeof metadata.businessId === "string" ? metadata.businessId : "";

  if (businessId) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { profile: true, knowledgeBases: true }
    });

    if (business) {
      console.log("[vapi-webhook] business resolved via metadata.businessId");
      return business;
    }
  }

  // Browser web calls may not propagate metadata — resolve by the assistant id
  // that the deploy stored on BusinessProfile.vapiAssistantId.
  const assistantId = firstNestedString(body, [
    ["message", "call", "assistantId"],
    ["message", "assistant", "id"],
    ["call", "assistantId"],
    ["assistantId"]
  ]);

  if (assistantId) {
    const business = await prisma.business.findFirst({
      where: { profile: { is: { vapiAssistantId: assistantId } } },
      include: { profile: true, knowledgeBases: true }
    });

    if (business) {
      console.log("[vapi-webhook] business resolved via assistantId", assistantId);
      return business;
    }
  }

  console.log("[vapi-webhook] business not resolved (no metadata.businessId or assistantId match)");
  return null;
}

type DentalToolConfig = {
  dryRun: boolean;
  useTestCalendar: boolean;
  testSessionId: string | null;
  architectUserId: string | null;
  testTimeZone: string | null;
  bufferMinutes: number;
  slotsToOffer: number;
  openHour: number;
  closeHour: number;
  defaultDurationMinutes: number;
  doctorName: string;
  sendToPatient: boolean;
  sendToDentist: boolean;
  dentistPhone: string;
  patientTemplate: string;
  dentistTemplate: string;
  confirmationMessage: string;
  bookingLabel: string;
  eventTitleFormat: string;
  eventDescription: string;
  reminderMinutes: number | null | "off";
  emailNode: SendEmailNodeConfig | null;
};

export function workflowNodeDefaults(workflowJson: unknown): Record<string, unknown> {
  const nodes = (workflowJson as { nodes?: Array<{ data?: Record<string, unknown> }> } | null)?.nodes;
  if (!Array.isArray(nodes)) return {};

  const dataFor = (type: string): Record<string, unknown> =>
    nodes.find((node) => (node?.data?.type as string) === type)?.data ?? {};

  const booking = dataFor(VOICE_NODE_TYPES.bookAppointment);
  const sms = dataFor(VOICE_NODE_TYPES.sendSms);

  const pick = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;

  return {
    ...(pick(booking.eventTitleFormat) ? { eventTitleFormat: booking.eventTitleFormat } : {}),
    ...(pick(booking.eventDescription) ? { eventDescription: booking.eventDescription } : {}),
    ...(booking.reminderEnabled !== undefined ? { reminderEnabled: booking.reminderEnabled } : {}),
    ...(booking.reminderTiming !== undefined ? { reminderTiming: booking.reminderTiming } : {}),
    ...(pick(booking.confirmationMessage) ? { confirmationMessage: booking.confirmationMessage } : {}),
    ...(pick(sms.customerTemplate ?? sms.patientTemplate)
      ? { patientTemplate: sms.customerTemplate ?? sms.patientTemplate }
      : {}),
    ...(pick(sms.teamTemplate ?? sms.dentistTemplate)
      ? { dentistTemplate: sms.teamTemplate ?? sms.dentistTemplate }
      : {}),
    ...((sms.sendToTeam ?? sms.sendToDentist) !== undefined
      ? { sendToDentist: sms.sendToTeam ?? sms.sendToDentist }
      : {}),
    ...((sms.sendToCustomer ?? sms.sendToPatient) !== undefined
      ? { sendToPatient: sms.sendToCustomer ?? sms.sendToPatient }
      : {})
  };
}

/** "true"/true → true, "false"/false → false, anything else → undefined. */
function optionalFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

export async function loadDentalToolConfig(businessId: string): Promise<DentalToolConfig> {

  const agent =
    (await prisma.installedAgent.findFirst({
      where: { businessId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { configJson: true, workflow: { select: { workflowJson: true } } }
    })) ??
    (await prisma.installedAgent.findFirst({
      where: { businessId, status: "PROVISIONING" },
      orderBy: { createdAt: "desc" },
      select: { configJson: true, workflow: { select: { workflowJson: true } } }
    }));
  const configJson = (agent?.configJson as Record<string, unknown> | null) ?? {};
  const emailNode = applyBuyerEmailRecipients(
    extractSendEmailNodeConfig(agent?.workflow?.workflowJson ?? null),
    extractBuyerEmailRecipients(configJson)
  );
  const legacy = (configJson.dentalConfig ?? {}) as Record<string, unknown>;
  const scheduling = (configJson.scheduling ?? {}) as Record<string, unknown>;
  const cfg = { ...workflowNodeDefaults(agent?.workflow?.workflowJson ?? null), ...legacy, ...scheduling };
  const dryRun = configJson.testDryRun === true;
  const num = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
  const strOr = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value : fallback;
  const calendarConfig = (configJson.calendar ?? {}) as Record<string, unknown>;
  return {
    dryRun,
    useTestCalendar: configJson.useTestCalendar === true,
    testSessionId: str(configJson.testSessionId) || null,
    architectUserId: str(configJson.architectUserId) || str(calendarConfig.ownerUserId) || null,
    testTimeZone: dryRun ? str(calendarConfig.timeZone) || null : null,
    bufferMinutes: num(cfg.bufferMinutes, 10),
    slotsToOffer: num(cfg.maximumSlotsToShow ?? cfg.maxSlotsToShow ?? cfg.slotsToOffer, 6),
    openHour: num(cfg.openHour, 9),
    closeHour: num(cfg.closeHour, 17),
    defaultDurationMinutes: num(cfg.serviceDurationMinutes ?? cfg.defaultDurationMinutes, 30),
    doctorName: str(cfg.providerName ?? cfg.teamName ?? cfg.doctorName),
    sendToPatient: optionalFlag(cfg.sendToCustomer ?? cfg.sendToPatient) ?? true,
    sendToDentist: optionalFlag(cfg.sendToTeam ?? cfg.sendToDentist) ?? false,
    dentistPhone: normalizePhoneNumber(str(cfg.teamPhone ?? cfg.dentistPhone)),
    patientTemplate: strOr(
      cfg.customerTemplate ?? cfg.patientTemplate,
      "Confirmed: [Service] on [Date] at [Time] with [Business Name]. Reply C to cancel."
    ),
    dentistTemplate: strOr(
      cfg.teamTemplate ?? cfg.dentistTemplate,
      "New booking: [Customer Name], [Date] [Time], [Service]. Phone: [Customer Phone]"
    ),
    confirmationMessage: str(cfg.confirmationMessage),
    bookingLabel: strOr(cfg.bookingLabel ?? cfg.bookingType ?? customBookingLabelOf(configJson), "appointment"),
    eventTitleFormat: str(cfg.eventTitleFormat),
    eventDescription: str(cfg.eventDescription),
    /* Reminder OFF is explicit; otherwise a positive timing sets the override
       and anything else leaves the calendar's own defaults alone. */
    reminderMinutes: optionalFlag(cfg.reminderEnabled) === false ? "off" : num(cfg.reminderTiming, 0) || null,
    emailNode
  };
}

/** An architect-defined "Booking label" buyer setup field also sets the label. */
function customBookingLabelOf(configJson: Record<string, unknown>): string | undefined {
  if (!Array.isArray(configJson.customFields)) return undefined;
  const match = (configJson.customFields as Array<Record<string, unknown>>)
    .filter((item) => typeof item === "object" && item !== null)
    .find((item) => item.key === "booking-label" || item.key === "booking-type");
  return typeof match?.value === "string" ? match.value : undefined;
}

/** Fill [Bracketed] tokens in an SMS/confirmation template. */
function applyBracketTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\[([^\]]+)\]/g, (match, key: string) => {
    const normalized = key.trim().toLowerCase();
    return values[normalized] ?? match;
  });
}

function bracketTemplateValues(input: {
  service: string;
  customerName: string;
  customerPhone: string;
  teamName: string;
  /** The provider the caller chose for THIS booking — beats the configured default. */
  providerName?: string | null;
  date: string;
  time: string;
}): Record<string, string> {
  const provider = input.providerName?.trim() || input.teamName;
  return {
    service: input.service,
    date: input.date,
    time: input.time,
    name: input.customerName,
    "customer name": input.customerName,
    "patient name": input.customerName,
    "guest name": input.customerName,
    "client name": input.customerName,
    "lead name": input.customerName,
    phone: input.customerPhone,
    "customer phone": input.customerPhone,
    "patient phone": input.customerPhone,
    "business name": input.teamName,
    "doctor name": provider,
    "provider name": provider,
    doctor: provider,
    team: input.teamName,
    "team name": input.teamName,
    "staff name": provider
  };
}

/** Shape a Vapi tool result envelope. */
function vapiToolResult(toolCall: { id: string; name: string }, result: unknown) {
  return {
    results: [
      {
        name: toolCall.name,
        toolCallId: toolCall.id,
        result: typeof result === "string" ? result : JSON.stringify(result)
      }
    ]
  };
}

/** Day-1 demo fallback slots when the calendar can't be read (keeps the AI moving). */
const DEMO_AVAILABILITY_SLOTS = ["10:00 AM", "2:00 PM", "4:30 PM"];

/** Reject a slow provider call so Vapi never times out waiting on our webhook. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

/** Dry-run availability generated from the configured business hours — never a hard failure. */
function dryRunAvailabilitySlots(dental: DentalToolConfig | null): string[] {
  const openHour = dental?.openHour ?? 9;
  const closeHour = dental?.closeHour ?? 17;
  const duration = dental?.defaultDurationMinutes ?? 30;
  const buffer = dental?.bufferMinutes ?? 10;
  const maxSlots = dental?.slotsToOffer ?? 6;
  const step = Math.max(duration + Math.max(buffer, 0), 5);
  const slots: string[] = [];

  for (
    let minutes = openHour * 60;
    minutes + duration <= closeHour * 60 && slots.length < maxSlots;
    minutes += step
  ) {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const meridiem = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    slots.push(`${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`);
  }

  return slots.length ? slots : DEMO_AVAILABILITY_SLOTS;
}

/** Classify a Google Calendar failure so the tool result can tell the AI/builder what to do. */
function calendarStatusFromError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("not connected")) return "not_connected";
  if (
    message.includes("invalid_grant") ||
    message.includes("unauthorized") ||
    message.includes("invalid credentials") ||
    message.includes("token") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "needs_reconnect";
  }
  return "error";
}

const INVALID_DATE_RESULT = {
  success: false,
  calendar_status: "invalid_date",
  message: "Requested date is in the past. Please confirm the correct appointment date."
} as const;

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Today's date (YYYY-MM-DD) in the given timezone. */
function todayInZone(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

/** Today's weekday index (0=Sun) in the given timezone. */
function weekdayIndexInZone(timeZone: string): number {
  const name = new Date().toLocaleDateString("en-US", { timeZone, weekday: "long" }).toLowerCase();
  const idx = WEEKDAY_NAMES.indexOf(name);
  return idx < 0 ? 0 : idx;
}

/** Add `days` calendar days to a YYYY-MM-DD string (DST-safe via noon-UTC anchor). */
function addDaysToDateStr(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function nextWeekdayDateStr(text: string, today: string, timeZone: string): string | undefined {
  for (let i = 0; i < WEEKDAY_NAMES.length; i++) {
    if (new RegExp(`\\b${WEEKDAY_NAMES[i]}\\b`).test(text)) {
      const todayIdx = weekdayIndexInZone(timeZone);
      let delta = (i - todayIdx + 7) % 7;
      if (delta === 0) delta = 7; // "monday" said on a Monday means next Monday
      return addDaysToDateStr(today, delta);
    }
  }
  return undefined;
}

function resolveRequestedDate(opts: { rawDate?: string; relativeText: string; timeZone: string }): {
  date: string;
  isPast: boolean;
  normalized?: string;
  today: string;
} {
  const today = todayInZone(opts.timeZone);

  const rawDate =
    typeof opts.rawDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(opts.rawDate)
      ? opts.rawDate.slice(0, 10)
      : undefined;
  if (rawDate) return { date: rawDate, isPast: rawDate < today, normalized: rawDate, today };

  const text = (opts.relativeText || "").toLowerCase();
  let normalized: string | undefined;
  if (/\bday after tomorrow\b/.test(text)) normalized = addDaysToDateStr(today, 2);
  else if (/\btomorrow\b/.test(text)) normalized = addDaysToDateStr(today, 1);
  else if (/\b(today|tonight|this afternoon|this evening|this morning)\b/.test(text)) normalized = today;
  else normalized = nextWeekdayDateStr(text, today, opts.timeZone);

  const date = normalized ?? today;
  return { date, isPast: date < today, normalized, today };
}

/** Parse "16:30" / "4:30 PM" / "4 pm" / "16:30:00" into 24h hour/minute. */
function parseClockTime(raw?: string): { hour: number; minute: number } | undefined {
  if (!raw) return undefined;
  const match = raw.trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function argStr(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const NAME_ARG_KEYS = [
  "customer_name", "patient_name", "guest_name", "lead_name", "client_name", "name", "full_name",
  "customerName", "patientName", "guestName", "leadName", "clientName", "fullName", "patient_full_name"
];
const PHONE_ARG_KEYS = [
  "customer_phone", "patient_phone", "phone", "callback_phone", "caller_phone",
  "customerPhone", "patientPhone", "callbackPhone", "callerPhone"
];
const EMAIL_ARG_KEYS = [
  "customer_email", "patient_email", "guest_email", "client_email", "email",
  "customerEmail", "patientEmail", "guestEmail", "clientEmail"
];

/** Collect ALL tool calls in a Vapi webhook (one webhook can carry several). */
function getAllToolCalls(body: Record<string, unknown>): Array<{ id: string; name: string; parameters: Record<string, unknown> }> {
  const out: Array<{ id: string; name: string; parameters: Record<string, unknown> }> = [];
  const parseArgs = (raw: unknown): Record<string, unknown> => {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
    return {};
  };

  // OpenAI-style: message.toolCalls[] = { id, function: { name, arguments } }
  for (const path of [["message", "toolCalls"], ["toolCalls"]]) {
    const arr = getNestedRecord(body, path);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item !== "object" || item === null) continue;
        const rec = item as Record<string, unknown>;
        const fn = typeof rec.function === "object" && rec.function !== null ? (rec.function as Record<string, unknown>) : {};
        const name = typeof fn.name === "string" ? fn.name : typeof rec.name === "string" ? rec.name : "";
        if (!name) continue;
        out.push({ id: typeof rec.id === "string" ? rec.id : "", name, parameters: parseArgs(fn.arguments ?? rec.arguments ?? rec.parameters) });
      }
    }
    if (out.length) return out;
  }

  // Vapi native: message.toolCallList[] = { id, name, arguments|parameters }
  const list = getNestedRecord(body, ["message", "toolCallList"]);
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : "";
      if (!name) continue;
      out.push({ id: typeof rec.id === "string" ? rec.id : "", name, parameters: parseArgs(rec.arguments ?? rec.parameters) });
    }
    if (out.length) return out;
  }

  // message.toolWithToolCallList[]
  const tw = getNestedRecord(body, ["message", "toolWithToolCallList"]);
  if (Array.isArray(tw)) {
    for (const item of tw) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const tc = typeof rec.toolCall === "object" && rec.toolCall !== null ? (rec.toolCall as Record<string, unknown>) : {};
      const name = typeof rec.name === "string" ? rec.name : typeof tc.name === "string" ? tc.name : "";
      if (!name) continue;
      out.push({ id: typeof tc.id === "string" ? tc.id : "", name, parameters: parseArgs(tc.arguments ?? tc.parameters) });
    }
    if (out.length) return out;
  }

  // Legacy single-tool shapes.
  const single = getFirstToolCall(body);
  if (single.name) out.push(single);
  return out;
}

type VapiToolContext = {
  business: BusinessRuntimeContext | null;
  dental: DentalToolConfig | null;
  timeZone: string;
  customerPhone: string;
  patientPhone: string;
  conversationId?: string;
  callId?: string;
  summary: string;
  transcript: string;
  executionMode?: "LIVE" | "ARCHITECT_DRY_RUN" | "BUSINESS_TEST";
  installedAgentId?: string;
  /** Server-side after-hours gate state for this LIVE call (undefined = inactive). */
  afterHours?: LiveAfterHoursGateContext;
  callTurns?: AfterHoursCallTurn[];
  /** The deployed assistant's ACTUAL provider pipeline (stored at deploy). */
  voicePipeline?: ResolvedVoicePipeline | null;
};

function consentOfferKey(ctx: VapiToolContext): ConsentOfferKey | null {
  if (!ctx.callId || !ctx.business?.businessId) return null;
  return {
    businessId: ctx.business.businessId,
    callId: ctx.callId,
    disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION
  };
}

/**
 * Whether the assistant has provably spoken the complete disclosure, and
 * whether the caller has answered it yet.
 *
 * Both transcript sources are consulted and the STRONGER result wins. The flat
 * `message.transcript` string is Vapi's running transcriber output and lags —
 * the caller's "yes" that triggered this very tool call is routinely missing
 * from it — while `artifact.messages` is the model's own role-tagged context
 * and therefore contains that turn. Reading only the flat transcript made the
 * gate a full turn late, so a correctly-read disclosure was rejected and the
 * caller had to sit through it a second time.
 */
async function smsDisclosureState(ctx: VapiToolContext): Promise<SmsDisclosureProgress> {
  const key = consentOfferKey(ctx);
  if (key && (await wasConsentOffered(key))) return { state: "ANSWERED", missing: [] };

  const businessName = ctx.business?.businessName ?? "";
  const structured = segmentsSmsDisclosureProgress(
    (ctx.callTurns ?? []).map((turn) => ({ role: turn.role, text: turn.content })),
    businessName
  );
  const flat = transcriptSmsDisclosureProgress(ctx.transcript ?? "", businessName);

  const progress: SmsDisclosureProgress =
    structured.state === "ANSWERED" || flat.state === "ANSWERED"
      ? { state: "ANSWERED", missing: [] }
      : structured.state === "AWAITING_ANSWER" || flat.state === "AWAITING_ANSWER"
        ? { state: "AWAITING_ANSWER", missing: [] }
        : structured.state === "INTERRUPTED" || flat.state === "INTERRUPTED"
          // Whichever source heard more of it has the shorter missing list, and
          // its remainingLine is the one that keeps the confirmation shortest.
          ? (() => {
            const bothInterrupted = structured.state === "INTERRUPTED" && flat.state === "INTERRUPTED";
            const best = bothInterrupted
              ? (structured.missing.length <= flat.missing.length ? structured : flat)
              : (structured.state === "INTERRUPTED" ? structured : flat);
            return { state: "INTERRUPTED" as const, missing: best.missing, remainingLine: best.remainingLine };
          })()
          : { state: "NOT_PRESENTED", missing: [] };

  if (progress.state === "ANSWERED" && key) await markConsentOffered(key);
  return progress;
}

const NEEDS_CUSTOMER_NAME_RESULT = {
  success: false,
  needs_clarification: true,
  missing_field: "customer_name",
  message: "Please ask the caller for their full name."
} as const;

const NEEDS_CUSTOMER_PHONE_RESULT = {
  success: false,
  needs_clarification: true,
  missing_field: "customer_phone",
  message: "Please ask the caller for their phone number."
} as const;

const NEEDS_COUNTRY_CODE_RESULT = {
  success: false,
  needs_clarification: true,
  missing_field: "country_code",
  message:
    "The caller's phone number has no country code, so texts could go to the wrong number. Ask which country the number is from (for example 'plus one' for the US or Canada, 'plus nine one' for India), then call the tool again with the FULL number including the country code, like +16505551234 or +916396039675."
} as const;

export function hasExplicitCountryCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return true;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.replace(/[\s().-]/g, "").startsWith("00") && digits.length >= 11) return true;
  // 11+ digits necessarily include a country code (1 + US 10, 91 + IN 10, …).
  return digits.length >= 11;
}

const INVALID_PATIENT_NAMES = new Set([
  "john doe", "jane doe", "full name", "patient name", "patient full name", "test user",
  "customer name", "guest name", "lead name", "client name",
  "unknown", "the caller", "caller", "customer", "patient", "client", "guest", "lead", "n/a", "na", "name",
  "first name", "last name", "first last", "your name", "no name", "none", "na na"
]);

const GENERIC_NAME_WORDS = new Set([
  "name", "caller", "customer", "patient", "client", "guest", "lead", "unknown", "test", "user", "full", "first", "last", "none", "na"
]);

/** True only for a plausibly-real human name (not a placeholder/blocklisted value). */
function isValidPatientName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 3) return false;
  if (INVALID_PATIENT_NAMES.has(trimmed.toLowerCase())) return false;
  // Must contain at least 2 alphabetic characters.
  if ((trimmed.match(/[A-Za-zÀ-ɏ]/g) || []).length < 2) return false;
  const words = trimmed.split(" ").filter(Boolean);
  if (words.every((word) => GENERIC_NAME_WORDS.has(word.toLowerCase()))) return false;
  // One-word names are allowed only when not a generic word.
  if (words.length === 1 && GENERIC_NAME_WORDS.has(words[0].toLowerCase())) return false;
  return true;
}

/** Title-case and trim a spoken name candidate to its first 1-3 name words. */
function cleanNameCandidate(raw: string): string {
  const stop = new Set([
    "and", "calling", "here", "speaking", "please", "thanks", "thank", "you", "to", "for",
    "the", "a", "an", "my", "i", "im", "is", "was", "like", "want", "wanted", "need", "would",
    "book", "booking", "appointment", "cleaning", "calling"
  ]);
  const words: string[] = [];
  for (const token of raw.split(/\s+/)) {
    const word = token.replace(/[^A-Za-z'’.-]/g, "");
    if (!word) break;
    if (stop.has(word.toLowerCase())) break;
    words.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    if (words.length >= 3) break;
  }
  return words.join(" ").trim();
}

function extractPatientNameFromTranscript(transcript: string): string | null {
  if (typeof transcript !== "string" || !transcript.trim()) return null;
  const patterns = [
    /\bmy full name is\s+([A-Za-z][A-Za-z .'’-]{2,})/i,
    /\bfull name is\s+([A-Za-z][A-Za-z .'’-]{2,})/i,
    /\bmy name is\s+([A-Za-z][A-Za-z .'’-]{2,})/i,
    /\bname'?s\s+([A-Za-z][A-Za-z .'’-]{2,})/i,
    /\bthis is\s+([A-Za-z][A-Za-z .'’-]{2,})/i,
    /\bi am\s+([A-Za-z][A-Za-z .'’-]{2,})/i,
    /\bi'?m\s+([A-Za-z][A-Za-z .'’-]{2,})/i
  ];
  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match?.[1]) {
      const candidate = cleanNameCandidate(match[1]);
      if (isValidPatientName(candidate)) return candidate;
    }
  }
  return null;
}

function callerOnlyTranscript(transcript: string): string {
  if (!transcript.trim()) return "";
  const segments = parseTranscriptSegments(transcript);
  if (!segments.some((segment) => segment.role === "assistant" || segment.role === "user")) {
    return transcript;
  }
  return segments
    .filter((segment) => segment.role === "user")
    .map((segment) => segment.text)
    .join("\n");
}

function resolvePatientName(args: Record<string, unknown>, transcript: string, summary: string): string | null {
  const argName = argStr(args, NAME_ARG_KEYS);
  if (isValidPatientName(argName)) return (argName as string).trim().replace(/\s+/g, " ");
  return (
    extractPatientNameFromTranscript(callerOnlyTranscript(transcript)) ??
    extractPatientNameFromTranscript(summary)
  );
}

/** Prefer a clean caller-provided number; otherwise the Vapi call's customer number. */
function resolvePatientPhone(argPhone: string | undefined, callerPhone: string): string {
  return normalizePhoneE164(argPhone) || normalizePhoneE164(callerPhone) || callerPhone || "";
}

export async function runCheckAvailabilityTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  const relativeText = argStr(args, ["date", "when", "day", "relativeDate"]) ?? "";
  const { date, isPast } = resolveRequestedDate({ rawDate: argStr(args, ["date"]), relativeText, timeZone: ctx.timeZone });
  if (isPast) return INVALID_DATE_RESULT;

  const service = argStr(args, ["service_type", "service"]) || ctx.dental?.bookingLabel || "appointment";
  const businessId = ctx.business?.businessId;

  if (!businessId) {
    return {
      available_slots: [],
      date,
      service,
      calendar_status: "not_connected",
      message: "No business calendar is configured — do not state availability. Offer to take the caller's preferred time as a request."
    };
  }

  const workspaceRestricted =
    ctx.executionMode !== "ARCHITECT_DRY_RUN" && !isWorkspaceDerivedAllowedForLiveVoice(undefined, ctx.voicePipeline);
  if (workspaceRestricted) {
    console.warn("[vapi-tool] check_availability excluding external calendar (workspace guard)", {
      reason: liveVoicePipelineBlockReason(undefined, ctx.voicePipeline)
    });
  }

  const requestedTime = parseClockTime(argStr(args, ["time", "requested_time", "appointment_time"]));

  // Exact-time question ("Is 5 PM available?") → direct truthful verdict.
  if (requestedTime) {
    const check = await checkBusinessExactTime({
      businessId,
      installedAgentId: ctx.installedAgentId ?? null,
      date,
      hour: requestedTime.hour,
      minute: requestedTime.minute,
      serviceName: service,
      excludeExternalCalendar: workspaceRestricted
    });

    const openNote = check.closeLabel ? `The business is open until ${check.closeLabel} that day.` : "";
    const alternatives = check.alternatives.map((slot) => slot.label);
    const messages: Record<string, string> = {
      available: `${openNote} The requested time is FREE on the calendar — confirm it with the caller and book it.`,
      occupied: `${openNote} That exact time is already taken on the calendar. Offer the alternatives instead — do NOT say the rest of the day is booked.`,
      outside_hours: `${openNote} The requested time is outside appointment hours. Offer the alternatives.`,
      closed_day: "The business is closed that day. Offer another day.",
      insufficient_time_before_closing: `${openNote} This ${check.durationMinutes}-minute service cannot finish before closing if it starts then. Offer the alternatives.`,
      past: "That time is in the past. Ask for a future time.",
      too_soon: "That time is too soon to book. Offer the alternatives.",
      beyond_advance_limit: "That date is beyond the booking window. Offer an earlier date.",
      invalid: "The time could not be understood. Ask the caller to repeat it."
    };
    if (
      ctx.executionMode !== "ARCHITECT_DRY_RUN" &&
      (check.calendarStatus === "needs_reconnect" || check.calendarStatus === "error")
    ) {
      return {
        date,
        service,
        requested_time: `${String(requestedTime.hour).padStart(2, "0")}:${String(requestedTime.minute).padStart(2, "0")}`,
        verdict: "calendar_unavailable",
        calendar_status: check.calendarStatus,
        open_until: check.closeLabel,
        message:
          "Live calendar availability cannot be confirmed right now. Tell the caller honestly, take their preferred time as a REQUEST, and say the team will confirm."
      };
    }

    const scheduleOnlyNote =
      check.calendarStatus === "not_connected" || check.calendarStatus === "restricted"
        ? " (Times are based on the business's appointment hours and existing bookings — the external calendar was not consulted, so frame the booking as one the team will confirm.)"
        : "";

    console.log("[vapi-tool] check_availability exact-time", { date, time: requestedTime, verdict: check.verdict });
    return {
      date,
      service,
      requested_time: `${String(requestedTime.hour).padStart(2, "0")}:${String(requestedTime.minute).padStart(2, "0")}`,
      verdict: check.verdict,
      open_until: check.closeLabel,
      alternatives,
      calendar_status: check.calendarStatus,
      message: `${messages[check.verdict] ?? "Checked."}${scheduleOnlyNote}`
    };
  }

  // Full-day availability — computed WITHOUT any cap; the cap applies only to
  // the spoken sample below.
  const availability = await withTimeout(
    computeBusinessAvailability({
      businessId,
      installedAgentId: ctx.installedAgentId ?? null,
      date,
      serviceName: service,
      excludeExternalCalendar: workspaceRestricted
    }),
    8000,
    "availability computation"
  ).catch((error) => {
    console.error("[vapi-tool] check_availability failed", error);
    return null;
  });

  if (!availability) {
    if (ctx.executionMode === "ARCHITECT_DRY_RUN") {
      return {
        available_slots: dryRunAvailabilitySlots(ctx.dental),
        date,
        service,
        source: "simulated",
        calendar_status: "simulated",
        message: "SIMULATED test slots (architect dry run) — clearly not a real calendar."
      };
    }
    return {
      available_slots: [],
      date,
      service,
      calendar_status: "error",
      message:
        "Live calendar availability cannot be confirmed right now. Say so honestly, take the caller's preferred time as a REQUEST, and never invent open or booked slots."
    };
  }

  if (
    ctx.executionMode !== "ARCHITECT_DRY_RUN" &&
    (availability.calendarStatus === "needs_reconnect" || availability.calendarStatus === "error")
  ) {
    return {
      available_slots: [],
      date,
      service,
      calendar_status: availability.calendarStatus,
      open_until: availability.closeLabel,
      message:
        "Live calendar availability cannot be confirmed right now. Say so honestly, take the caller's preferred time as a REQUEST, and never invent open or booked slots."
    };
  }

  if (availability.closed) {
    return {
      available_slots: [],
      date,
      spoken_date: spokenDateForYmd(date, ctx.timeZone),
      service,
      closed: true,
      calendar_status: availability.calendarStatus,
      message: `The business is closed on ${spokenDateForYmd(date, ctx.timeZone)}. Offer another day. When you say the date aloud, say it exactly as "${spokenDateForYmd(date, ctx.timeZone)}".`
    };
  }

  console.log("[vapi-tool] check_availability full-day", {
    date,
    total: availability.totalFreeSlots,
    spoken: availability.spokenSlots.length
  });
  return {
    available_slots: availability.spokenSlots.map((slot) => slot.label),
    total_free_slots: availability.totalFreeSlots,
    date,
    // The model MUST speak this fully-spelled date, never the numeric date (#9).
    spoken_date: spokenDateForYmd(date, ctx.timeZone),
    service,
    duration: `${availability.durationMinutes} minutes`,
    open_from: availability.openLabel,
    open_until: availability.closeLabel,
    source:
      availability.calendarStatus === "not_connected" || availability.calendarStatus === "restricted"
        ? "business_schedule"
        : "calendar",
    calendar_status: availability.calendarStatus,
    message: `${availability.totalFreeSlots > availability.spokenSlots.length
        ? `These are ${availability.spokenSlots.length} of ${availability.totalFreeSlots} free times across the day. If the caller asks about a specific time not listed, call check_availability again with the time parameter — NEVER assume unlisted times are booked.`
        : "These are all the free times for that day."
      }${availability.calendarStatus === "not_connected" || availability.calendarStatus === "restricted"
        ? " (Times are based on the business's appointment hours and existing bookings — the external calendar was not consulted, so frame the booking as one the team will confirm.)"
        : ""
      }`
  };
}

async function resolveBookingDurationMinutes(
  ctx: VapiToolContext,
  args: Record<string, unknown>,
  service: string
): Promise<number> {
  const businessId = ctx.business?.businessId;
  if (businessId) {
    try {
      const { schedule } = await resolveScheduleForBusiness({
        businessId,
        installedAgentId: ctx.installedAgentId ?? null
      });
      const minutes = serviceDurationFor(schedule, service);
      if (Number.isFinite(minutes) && minutes > 0) return minutes;
    } catch (error) {
      console.warn("[vapi-tool] book_appointment schedule lookup failed; using legacy duration", {
        businessId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const explicit = Number(args.duration_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return ctx.dental?.defaultDurationMinutes || 30;
}

export async function runBookAppointmentTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  console.log("[vapi-tool] book_appointment raw args", JSON.stringify(redactForLog(args)));

  const serviceTypeArg = argStr(args, ["service_type", "service", "appointment_service", "appointmentType", "serviceType"]) ?? "";
  const notesArg = argStr(args, ["notes", "reason", "description"]) ?? "";
  if (/reschedul|change\s+appointment|move\s+appointment/i.test(`${serviceTypeArg} ${notesArg}`)) {
    return {
      success: false,
      code: "USE_RESCHEDULE_TOOL",
      message: "It looks like you are trying to reschedule an existing appointment. Please call the reschedule_appointment tool to move an existing booking instead of creating a new one."
    };
  }

  const relativeText = argStr(args, ["date", "when", "day", "relativeDate"]) ?? "";
  const { date, isPast } = resolveRequestedDate({ rawDate: argStr(args, ["date"]), relativeText, timeZone: ctx.timeZone });
  if (isPast) return INVALID_DATE_RESULT;

  const rememberedContact: Partial<CanonicalCallContact> =
    (await readCallContact(ctx.business?.businessId, ctx.callId)) ?? {};
  const patientName = resolvePatientName(args, ctx.transcript, ctx.summary) ?? rememberedContact.customerName ?? null;
  if (!patientName) {
    console.log("[vapi-tool] book_appointment missing fields", ["customer_name"]);
    console.warn("[vapi-webhook] book_appointment rejected: no valid customer name", {
      providedAnyName: Boolean(argStr(args, ["customer_name", "patient_name", "name", "full_name"]))
    });
    return NEEDS_CUSTOMER_NAME_RESULT;
  }
  await updateCallContact(ctx.business?.businessId, ctx.callId, { customerName: patientName });

  const rawPhone = argStr(args, PHONE_ARG_KEYS);

  const callerIdPhone = normalizePhoneE164(ctx.customerPhone);
  let patientPhone = "";
  const confirmedCanonical =
    rememberedContact.phoneSource === "confirmed" ? rememberedContact.canonicalPhoneE164 ?? "" : "";
  if (confirmedCanonical) {
    patientPhone = confirmedCanonical;
    const argFull = rawPhone && hasExplicitCountryCode(rawPhone) ? normalizePhoneE164(rawPhone) : "";
    if (argFull && argFull !== confirmedCanonical) {
      console.warn("[vapi-tool] book_appointment ignoring conflicting transcribed phone; using confirmed canonical", {
        confirmed: maskPhone(confirmedCanonical),
        supplied: maskPhone(argFull)
      });
    }
  } else if (rawPhone && !hasExplicitCountryCode(rawPhone)) {
    const dictatedDigits = rawPhone.replace(/\D/g, "");
    if (callerIdPhone && dictatedDigits.length >= 7 && callerIdPhone.endsWith(dictatedDigits)) {
      patientPhone = callerIdPhone;
    } else if (rememberedContact.canonicalPhoneE164) {
      // A full number was already confirmed earlier in this call.
      patientPhone = rememberedContact.canonicalPhoneE164;
    } else {
      console.log("[vapi-tool] book_appointment missing fields", ["country_code"]);
      return NEEDS_COUNTRY_CODE_RESULT;
    }
  } else {
    patientPhone = resolvePatientPhone(rawPhone, ctx.customerPhone) || rememberedContact.canonicalPhoneE164 || "";
  }

  if (!patientPhone && ctx.dental?.dryRun) {
    const digits = (rawPhone ?? "").replace(/\D/g, "");
    if (digits.length >= 7) patientPhone = digits;
  }

  if (!patientPhone) {
    console.log("[vapi-tool] book_appointment missing fields", ["customer_phone"]);
    return NEEDS_CUSTOMER_PHONE_RESULT;
  }
  await updateCallContact(ctx.business?.businessId, ctx.callId, {
    customerName: patientName,
    canonicalPhoneE164: patientPhone,
    phoneSource: rememberedContact.phoneSource === "confirmed" ? "confirmed" : "supplied"
  });

  const service =
    argStr(args, ["service_type", "service", "appointment_service", "appointmentType", "serviceType"]) ||
    ctx.dental?.bookingLabel ||
    "Appointment";
  const providerName = resolveRequestedProvider(args);
  const duration = await resolveBookingDurationMinutes(ctx, args, service);
  const time =
    parseClockTime(argStr(args, ["time", "appointment_time"])) ??
    parseClockTime(callerOnlyTranscript(ctx.transcript)) ??
    { hour: 9, minute: 0 };

  const startAt = zonedWallClockToUtc(date, time.hour, time.minute, ctx.timeZone);
  const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

  console.log("[vapi-tool] book_appointment normalized args", redactForLog({
    customerName: patientName,
    customerPhone: patientPhone,
    date,
    time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
    service
  }));

  if (startAt.getTime() < Date.now() - 60_000) return INVALID_DATE_RESULT;

  const teamName = ctx.dental?.doctorName || ctx.business?.businessName || "our team";
  const whenLabel = formatSpokenAppointmentTime(startAt.toISOString(), ctx.timeZone);
  const spokenDateLabel = spokenDateInTimeZone(startAt.toISOString(), ctx.timeZone) || whenLabel;
  const spokenTimeLabel = formatAppointmentTimeOfDay(startAt.toISOString(), ctx.timeZone);

  const bookingTemplateValues = bracketTemplateValues({
    service,
    customerName: patientName,
    customerPhone: patientPhone || "not provided",
    teamName,
    providerName,
    date: spokenDateLabel,
    time: spokenTimeLabel
  });

  const confirmation = ctx.dental?.confirmationMessage
    ? applyBracketTemplate(ctx.dental.confirmationMessage, bookingTemplateValues)
    : `Perfect, ${patientName} — you're booked for ${service}${providerName ? ` with ${providerName}` : ""} on ${whenLabel}.`;

  const bookingFacts = ctx.business?.businessId ? await loadBusinessFacts(ctx.business.businessId).catch(() => null) : null;

  const eventTitleOverride = ctx.dental?.eventTitleFormat
    ? applyBracketTemplate(ctx.dental.eventTitleFormat, bookingTemplateValues).trim()
    : "";

  const eventDescription = ctx.dental?.eventDescription
    ? applyBracketTemplate(ctx.dental.eventDescription, bookingTemplateValues)
    : [
      ...(bookingFacts?.addressFormatted ? [`Location: ${bookingFacts.addressFormatted}`] : []),
      `Customer: ${patientName}`,
      `Phone: ${patientPhone || "not provided"}`,
      ...(providerName ? [`With: ${providerName}`] : []),
      `Service: ${service}`,
      "Source: Triven AI voice receptionist",
      ctx.callId ? `Call ID: ${ctx.callId}` : null
    ]
      .filter(Boolean)
      .join("\n");

  if (ctx.dental?.dryRun) {
    const architectUserId = ctx.dental.architectUserId ?? ctx.business?.ownerId ?? null;

    if (!architectUserId) {
      return {
        success: false,
        dry_run: true,
        calendar_status: "not_connected",
        message: "This test agent has no calendar owner configured, so the test booking could not be recorded."
      };
    }

    const testEvent = await createTestCalendarEvent({
      executionMode: "ARCHITECT_DRY_RUN",
      ownerUserId: architectUserId,
      testSessionId: ctx.dental.testSessionId,
      serviceName: providerName ? `${service} with ${providerName}` : service,
      customerName: patientName,
      customerPhone: patientPhone,
      startAt,
      endAt,
      timeZone: ctx.timeZone,
      calendarId: ctx.business?.calendarId,
      businessName: ctx.business?.businessName ?? "the business",
      simulate: ctx.dental.useTestCalendar !== true
    });

    if (!testEvent.ok) {
      // Never claim the appointment was created when the calendar write failed.
      console.error("[vapi-tool] browser-test booking failed", { code: testEvent.error.code });
      return {
        success: false,
        dry_run: true,
        calendar_status: testEvent.error.code,
        message: `${testEvent.error.message} ${testEvent.error.remediation}`
      };
    }

    console.log("[vapi-tool] browser-test booking", redactForLog({
      customer_name: patientName,
      date,
      service_type: service,
      doctor: providerName ?? null,
      status: testEvent.event.status
    }));
    return {
      success: true,
      status: "confirmed",
      dry_run: true,
      customer_name: patientName,
      customer_phone: patientPhone,
      date,
      time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
      service_type: service,
      doctor: providerName ?? null,
      event_id: testEvent.event.googleEventId ?? testEvent.event.testEventId,
      event_link: testEvent.event.htmlLink,
      test_event_id: testEvent.event.testEventId,
      event_title: testEvent.event.title,
      event_status: testEvent.event.status,
      calendar_id: ctx.business?.calendarId ?? "primary",
      calendar_status: testEvent.event.status === "CREATED" ? "test_event_created" : "dry_run",
      source: "dry_run",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      message:
        testEvent.event.status === "CREATED"
          ? `Test booking confirmed for ${patientName} on ${whenLabel} — a marked test event was created on your calendar.`
          : `Booking confirmed for ${patientName} on ${whenLabel}.`,
      confirmation
    };
  }

  if (ctx.executionMode === "BUSINESS_TEST") {
    const ownerUserId = ctx.business?.ownerId ?? null;

    if (ctx.business?.businessId && isWorkspaceDerivedAllowedForLiveVoice(undefined, ctx.voicePipeline)) {
      const revalidation = await checkBusinessExactTime({
        businessId: ctx.business.businessId,
        installedAgentId: ctx.installedAgentId ?? null,
        date,
        hour: time.hour,
        minute: time.minute,
        serviceName: service
      });
      if (revalidation.verdict !== "available") {
        return {
          success: false,
          business_test: true,
          verdict: revalidation.verdict,
          open_until: revalidation.closeLabel,
          alternatives: revalidation.alternatives.map((slot) => slot.label),
          message:
            revalidation.verdict === "occupied"
              ? "That time was just taken. Offer the alternatives — do not claim the whole day is booked."
              : "That time cannot be booked (see verdict). Offer the alternatives."
        };
      }
    }

    if (!ownerUserId) {
      return {
        success: false,
        business_test: true,
        calendar_status: "not_connected",
        message: "This test agent has no calendar owner configured, so the test booking could not be recorded."
      };
    }

    const testEvent = await createTestCalendarEvent({
      executionMode: "BUSINESS_TEST",
      ownerUserId,
      businessId: ctx.business?.businessId ?? null,
      installedAgentId: ctx.business?.installedAgentId ?? null,
      testSessionId: ctx.dental?.testSessionId ?? null,
      serviceName: providerName ? `${service} with ${providerName}` : service,
      customerName: patientName,
      customerPhone: patientPhone,
      startAt,
      endAt,
      timeZone: ctx.timeZone,
      calendarId: ctx.business?.calendarId,
      businessName: ctx.business?.businessName ?? "the business",
      simulate: false
    });

    if (!testEvent.ok) {
      // Never claim the appointment was created when the calendar write failed.
      console.error("[vapi-tool] business-test booking failed", { code: testEvent.error.code });
      return {
        success: false,
        business_test: true,
        calendar_status: testEvent.error.code,
        message: `${testEvent.error.message} ${testEvent.error.remediation}`
      };
    }

    console.log("[vapi-tool] business-test booking", redactForLog({
      customer_name: patientName,
      date,
      service_type: service,
      doctor: providerName ?? null,
      status: testEvent.event.status
    }));
    return {
      success: true,
      status: "confirmed",
      business_test: true,
      customer_name: patientName,
      customer_phone: patientPhone,
      date,
      time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
      service_type: service,
      doctor: providerName ?? null,
      event_id: testEvent.event.googleEventId ?? testEvent.event.testEventId,
      event_link: testEvent.event.htmlLink,
      test_event_id: testEvent.event.testEventId,
      event_title: testEvent.event.title,
      event_status: testEvent.event.status,
      calendar_id: ctx.business?.calendarId ?? "primary",
      calendar_status: "test_event_created",
      source: "business_test",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      message: `Test booking confirmed for ${patientName} on ${whenLabel} — a marked test event was created on the business calendar.`,
      confirmation
    };
  }

  const bookingConsentStatus = ctx.business?.businessId
    ? await getSmsConsentStatusLabel(ctx.business.businessId, patientPhone)
    : "none";

  const sendBookingConfirmationSms = async (appointmentId: string, startAtIso: string) => {
    if (!ctx.business?.businessId || !patientPhone) return null;
    if (ctx.dental && ctx.dental.sendToPatient === false) return null;
    // #4: NEVER attempt a customer confirmation SMS before consent. A pre-consent
    // send only produces a SUPPRESSED SmsExecution and risks a false "text sent"
    // claim. The confirmation is sent by record_sms_consent AFTER affirmative
    // consent. Only a caller who ALREADY has standing consent gets it now.
    if (bookingConsentStatus !== "granted") return null;
    try {
      return await sendAppointmentConfirmationSms({
        appointmentId,
        businessId: ctx.business.businessId,
        installedAgentId: ctx.business.installedAgentId ?? ctx.installedAgentId ?? null,
        vapiCallId: ctx.callId ?? null,
        customerName: patientName,
        customerPhone: patientPhone,
        serviceName: service,
        appointmentDate: startAtIso,
        timeZone: ctx.timeZone
      });
    } catch (error) {
      console.error("[vapi-webhook] confirmation SMS failed (appointment kept)", error);
      return null;
    }
  };

  const smsResultShape = (outcome: SmsSendOutcome | null) => ({
    attempted: Boolean(outcome?.attempted),
    sent: Boolean(outcome && (outcome.sent || outcome.alreadySent)),
    // SMS_CONSENT_REQUIRED / SMS_OPTED_OUT when the consent gate blocked the
    // text — the assistant must not tell the caller a text was sent.
    blocked_reason: outcome?.suppressed ? outcome.errorCode : null,
    messageSid: outcome?.messageSid ?? null,
    status: outcome?.status ?? null,
    // Provider ACCEPTANCE (a messageSid, or simulated test credentials) —
    // the only basis for "your confirmation text has been submitted".
    provider_accepted: Boolean(outcome && (outcome.messageSid || outcome.simulated)),
    delivery_error_code: outcome?.errorCode ?? null
  });

  const smsDeliveryUnreliable = isSmsDeliveryUnreliable(patientPhone);
  const consentExtras = {
    consent_status: bookingConsentStatus,
    masked_recipient: `•••${patientPhone.slice(-4)}`,
    canonical_recipient_ending: patientPhone.slice(-4),
    // #4: booking never attempts a customer SMS before consent — the send is
    // owned by record_sms_consent. Standing-consent callers get it immediately.
    smsAttempted: bookingConsentStatus === "granted",
    ...(bookingConsentStatus === "none" && ctx.business?.businessName
      ? { required_disclosure: verbalSmsConsentDisclosure(ctx.business.businessName) }
      : {}),
    ...(smsDeliveryUnreliable
      ? {
        sms_delivery_note:
          "Carriers in this number's region often filter our texts, so delivery cannot be promised. Confirm every appointment detail verbally with the caller and never promise the text will arrive."
      }
      : {})
  };

  const localFallback = async (calendarStatus: string) => {
    let localAppointment: { id: string } | null = null;
    if (ctx.business?.businessId) {
      try {
        localAppointment = await prisma.appointment.create({
          data: {
            businessId: ctx.business.businessId,
            customerPhone: patientPhone || "unknown",
            customerName: patientName,
            service,
            providerName: providerName ?? undefined,
            bookingCallId: ctx.callId ?? undefined,
            startAt,
            endAt,
            timeZone: ctx.timeZone,
            notes: `Booked by Triven AI (calendar not connected — local record).\n${eventDescription}`
          },
          select: { id: true }
        });
        await updateCallContact(ctx.business?.businessId, ctx.callId, {
          appointmentId: localAppointment?.id,
          canonicalPhoneE164: patientPhone,
          phoneSource: "confirmed",
          smsRecipientE164: patientPhone
        });
      } catch (error) {
        console.error("[vapi-webhook] local appointment fallback failed (non-fatal)", error);
      }
    }
    const smsOutcome = localAppointment
      ? await sendBookingConfirmationSms(localAppointment.id, startAt.toISOString())
      : null;
    return {
      success: true,
      appointmentCreated: Boolean(localAppointment),
      ...(localAppointment ? { appointment_ref: appointmentAiRef(localAppointment.id) } : {}),
      ...consentExtras,
      event_id: null,
      event_link: null,
      calendar_id: ctx.business?.calendarId ?? "primary",
      calendar_status: calendarStatus,
      source: "local",
      patient_name: patientName,
      patient_phone: patientPhone,
      // Business-local wall-clock values — the ONLY date/time fields the
      // AI-safe sanitizer will surface (never derived from the UTC startAt).
      date,
      time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
      service_type: service,
      doctor: providerName ?? null,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      confirmation,
      sms: smsResultShape(smsOutcome)
    };
  };

  if (!isWorkspaceDerivedAllowedForLiveVoice(undefined, ctx.voicePipeline)) {
    console.warn("[vapi-tool] book_appointment using local fallback (workspace guard)", {
      reason: liveVoicePipelineBlockReason(undefined, ctx.voicePipeline)
    });
    return localFallback("restricted");
  }

  if (ctx.business?.businessId && ctx.business.ownerId && patientPhone) {
    try {
      const reservation = await revalidateAndReserveSlot({
        businessId: ctx.business.businessId,
        installedAgentId: ctx.installedAgentId ?? null,
        date,
        hour: time.hour,
        minute: time.minute,
        serviceName: service,
        createBooking: () =>
          createBusinessAppointment({
            business: ctx.business!,
            customerPhone: patientPhone,
            customerName: patientName,
            service,
            providerName,
            bookingCallId: ctx.callId ?? null,
            startAt,
            endAt,
            conversationId: ctx.conversationId,
            description: eventDescription,
            titleOverride: eventTitleOverride || null,
            reminderMinutes: ctx.dental?.reminderMinutes ?? null,
            notes: ctx.summary || ctx.transcript || null
          })
      });

      if (!reservation.ok) {
        const check = reservation.result;
        return {
          success: false,
          verdict: check.verdict,
          open_until: check.closeLabel,
          alternatives: check.alternatives.map((slot) => slot.label),
          calendar_status: check.calendarStatus,
          message:
            check.verdict === "occupied"
              ? "That time was just taken on the calendar. Offer the alternatives — do not claim the rest of the day is booked."
              : "That time cannot be booked (see verdict). Offer the alternatives."
        };
      }

      const { calendarEvent, appointment } = reservation.booking;
      await updateCallContact(ctx.business?.businessId, ctx.callId, {
        appointmentId: appointment.id,
        canonicalPhoneE164: patientPhone,
        phoneSource: "confirmed",
        smsRecipientE164: patientPhone
      });
      await upsertConversation({
        businessId: ctx.business.businessId,
        customerPhone: patientPhone,
        direction: "SYSTEM",
        body: `Voice booking: ${service} for ${patientName} on ${formatAppointmentTime(calendarEvent.startAt, ctx.timeZone)}.`,
        providerId: calendarEvent.id
      }).catch(() => null);
      const smsOutcome = await sendBookingConfirmationSms(appointment.id, calendarEvent.startAt);
      return {
        success: true,
        appointmentCreated: true,
        appointment_ref: appointmentAiRef(appointment.id),
        ...consentExtras,
        event_id: calendarEvent.id,
        event_link: calendarEvent.htmlLink ?? null,
        calendar_id: calendarEvent.calendarId,
        calendar_status: "connected",
        source: "google_calendar",
        patient_name: patientName,
        patient_phone: patientPhone,
        // Business-local wall-clock values — the ONLY date/time fields the
        // AI-safe sanitizer will surface (never derived from the UTC startAt).
        date,
        time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
        service_type: service,
        doctor: providerName ?? null,
        startAt: calendarEvent.startAt,
        endAt: calendarEvent.endAt,
        confirmation,
        sms: smsResultShape(smsOutcome)
      };
    } catch (error) {
      const status = calendarStatusFromError(error);
      console.error("[vapi-webhook] book_appointment calendar booking failed; using local fallback", error);
      return localFallback(status === "error" ? "needs_reconnect" : status);
    }
  }

  return localFallback("not_connected");
}

/* ------------------------- appointment cancellation ------------------------ */

/** Appointment statuses a customer may cancel by phone. */
const CANCELLABLE_APPOINTMENT_STATUSES = ["BOOKED", "REQUESTED"];

/** Twilio delivers suppressed caller ID as "anonymous"/"restricted"/+266696687. */
const ANONYMOUS_CALLER_DIGITS = "266696687";

const CANCEL_NO_MATCH_MESSAGE =
  "I’m unable to verify an appointment associated with the number you’re calling from. For privacy and security, I can’t provide any appointment or phone-number details. Please call again from the phone number used when the appointment was booked, or contact the business team for assistance.";

const CANCEL_CALLER_ID_UNAVAILABLE_MESSAGE =
  "I’m unable to verify the phone number for this call, so I can’t cancel an appointment automatically. Please call from the phone number used when booking or contact the business team for assistance.";

const CANCEL_FAILED_MESSAGE =
  "I couldn’t complete the cancellation just now. Please try again in a moment, or contact the business team and they’ll take care of it.";

function formatApptDate(startAt: Date, timeZone?: string | null): string {
  // Voice-facing (spoken in cancel/reschedule confirmations) → ordinal words
  // ("Saturday, July twenty-fifth") so TTS never says "July 20 fifth" (#7).
  const spoken = spokenDateInTimeZone(startAt, timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE);
  if (spoken) return spoken;
  try {
    return startAt.toLocaleDateString("en-US", {
      timeZone: timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  } catch {
    return startAt.toDateString();
  }
}

function formatApptTime(startAt: Date, timeZone?: string | null): string {
  try {
    return startAt.toLocaleTimeString("en-US", {
      timeZone: timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return startAt.toTimeString().slice(0, 5);
  }
}

function trustedCallerE164(ctx: VapiToolContext): string | null {
  const raw = (ctx.customerPhone ?? "").trim();
  if (!raw) return null;
  const validated = validateSmsRecipientE164(raw);
  if (!validated.ok) return null;
  if (validated.e164.replace("+", "") === ANONYMOUS_CALLER_DIGITS) return null;
  return validated.e164;
}

async function runCancelAppointmentTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  if (!ctx.business?.businessId) {
    return { cancelled: false, code: "BUSINESS_NOT_RESOLVED", message: CANCEL_FAILED_MESSAGE };
  }

  if (ctx.dental?.dryRun || ctx.executionMode === "BUSINESS_TEST" || ctx.executionMode === "ARCHITECT_DRY_RUN") {
    return {
      cancelled: false,
      dry_run: true,
      code: "CALLER_ID_UNAVAILABLE",
      message: CANCEL_CALLER_ID_UNAVAILABLE_MESSAGE
    };
  }

  const callerPhone = trustedCallerE164(ctx);
  if (!callerPhone) {
    return {
      cancelled: false,
      code: "CALLER_ID_UNAVAILABLE",
      message: CANCEL_CALLER_ID_UNAVAILABLE_MESSAGE
    };
  }

  const businessId = ctx.business.businessId;
  const timeZone = ctx.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  const dateFilter = argStr(args, ["date", "appointment_date"]);
  const serviceFilter = argStr(args, ["service_type", "service"]);
  const now = new Date();
  const dayRange =
    dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)
      ? {
        gte: zonedWallClockToUtc(dateFilter, 0, 0, timeZone),
        lte: zonedWallClockToUtc(dateFilter, 23, 59, timeZone)
      }
      : null;

  const eligible = await prisma.appointment.findMany({
    where: {
      businessId,
      customerPhone: callerPhone,
      status: { in: CANCELLABLE_APPOINTMENT_STATUSES },
      startAt: dayRange
        ? { gte: dayRange.gte > now ? dayRange.gte : now, lte: dayRange.lte }
        : { gte: now },
      ...(serviceFilter ? { service: { contains: serviceFilter, mode: "insensitive" as const } } : {})
    },
    orderBy: { startAt: "asc" },
    take: 10,
    select: { id: true, service: true, startAt: true, timeZone: true, status: true }
  });

  const describe = (appointment: (typeof eligible)[number]) => ({
    appointment_id: appointmentAiRef(appointment.id),
    service: appointment.service || "appointment",
    appointment_date: formatApptDate(appointment.startAt, appointment.timeZone || timeZone),
    appointment_time: formatApptTime(appointment.startAt, appointment.timeZone || timeZone)
  });

  const confirmed = args["confirmed"] === true;
  const requestedId = argStr(args, ["appointment_id", "appointmentId"]);
  const reason = (argStr(args, ["cancellation_reason", "reason"]) ?? "").slice(0, 500);

  /* ----------------------------- lookup phase ----------------------------- */

  if (!confirmed) {
    if (eligible.length === 0) {
      return { cancelled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
    }
    if (eligible.length === 1) {
      const found = describe(eligible[0]);
      return {
        cancelled: false,
        code: "CONFIRMATION_REQUIRED",
        appointment: found,
        message: `I found an upcoming appointment for ${found.service} on ${found.appointment_date} at ${found.appointment_time}. Would you like me to cancel this appointment?`
      };
    }
    return {
      cancelled: false,
      code: "MULTIPLE_APPOINTMENTS",
      appointments: eligible.map((appointment, index) => ({ number: index + 1, ...describe(appointment) })),
      message:
        "The caller has several upcoming appointments. Read the numbered list (service, date, time only) and ask which one they would like to cancel."
    };
  }

  /* ------------------------- confirmed cancellation ------------------------ */

  let targetId: string | null = null;
  if (requestedId) {
    targetId = resolveAppointmentAiRef(requestedId, eligible)?.id ?? requestedId;
  } else if (eligible.length === 1) {
    targetId = eligible[0].id;
  } else if (eligible.length === 0) {
    return { cancelled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
  } else {
    return {
      cancelled: false,
      code: "MULTIPLE_APPOINTMENTS",
      appointments: eligible.map((appointment, index) => ({ number: index + 1, ...describe(appointment) })),
      message: "Several appointments matched. Ask the caller which one to cancel, then confirm again."
    };
  }

  const target = await prisma.appointment.findFirst({
    where: { id: targetId, businessId, customerPhone: callerPhone },
    select: {
      id: true,
      service: true,
      startAt: true,
      timeZone: true,
      status: true,
      customerName: true,
      customerPhone: true,
      calendarEventId: true
    }
  });

  if (!target) {
    return { cancelled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
  }

  if (target.status === "CANCELLED") {
    return { cancelled: true, code: "ALREADY_CANCELLED", message: "Your appointment has been cancelled successfully." };
  }

  if (!CANCELLABLE_APPOINTMENT_STATUSES.includes(target.status) || target.startAt < new Date()) {
    return {
      cancelled: false,
      code: "NOT_CANCELLABLE",
      message:
        "That appointment can no longer be cancelled over the phone. Please contact the business team for assistance."
    };
  }

  if (target.calendarEventId && ctx.business.ownerId) {
    try {
      await cancelGoogleCalendarAppointment({
        userId: ctx.business.ownerId,
        calendarId: ctx.business.calendarId,
        eventId: target.calendarEventId
      });
    } catch (error) {
      console.error("[vapi-webhook] cancel_appointment calendar delete failed (appointment NOT cancelled)", error);
      await prisma.appointment
        .update({
          where: { id: target.id },
          data: {
            notes: `${new Date().toISOString()}: customer phone cancellation attempt — Google Calendar delete failed; appointment left active.`
          }
        })
        .catch(() => null);
      return { cancelled: false, code: "CANCELLATION_FAILED", message: CANCEL_FAILED_MESSAGE };
    }
  }

  await prisma.appointment.update({
    where: { id: target.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationSource: "CUSTOMER_PHONE_CALL",
      cancellationCallId: ctx.callId ?? null,
      ...(reason ? { cancellationReason: reason } : {})
    }
  });

  const cancelledDate = formatApptDate(target.startAt, target.timeZone || timeZone);
  const cancelledTime = formatApptTime(target.startAt, target.timeZone || timeZone);

  let smsSent = false;
  try {
    const smsOutcome = await sendTrackedSms({
      to: callerPhone,
      body: `${smsAttributionPrefix(ctx.business.businessName)}Hi ${target.customerName || "there"}, your ${target.service ? `${target.service} ` : ""}appointment on ${cancelledDate} at ${cancelledTime} has been cancelled. Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.`,
      messageType: "APPOINTMENT_CANCELLATION",
      businessId,
      businessName: ctx.business.businessName,
      smsPurpose: "CANCELLATION_CONFIRMATION",
      installedAgentId: ctx.business.installedAgentId ?? null,
      appointmentId: target.id,
      vapiCallId: ctx.callId ?? null,
      dedupeKey: `appointment-cancellation:${target.id}`
    });
    smsSent = smsOutcome.sent || smsOutcome.alreadySent;
  } catch (error) {
    console.error("[vapi-webhook] cancellation SMS failed (non-fatal)", error);
  }

  const emailIdempotencyKey = `appointment-cancellation:${target.id}:team-email`;
  enqueueEmail(
    {
      kind: "internal_notification",
      input: {
        businessId,
        businessName: ctx.business.businessName,
        purpose: "INTERNAL_NOTIFICATION",
        idempotencyKey: emailIdempotencyKey,
        fields: {
          caller: target.customerName || null,
          phone: target.customerPhone,
          email: null,
          requestedService: target.service || null,
          summary: `Appointment on ${cancelledDate} at ${cancelledTime} was cancelled by the customer during a phone call.${reason ? ` Reason: ${reason}` : ""}`,
          nextAction: "No action needed unless you want to follow up with the customer."
        }
      }
    },
    { idempotencyKey: emailIdempotencyKey }
  ).catch((error) => console.error("[vapi-webhook] cancellation email failed (non-fatal)", error));

  return {
    cancelled: true,
    code: "CANCELLED",
    appointment: {
      service: target.service || "appointment",
      appointment_date: cancelledDate,
      appointment_time: cancelledTime
    },
    sms_sent: smsSent,
    message: "Your appointment has been cancelled successfully."
  };
}

/* ------------------------- appointment rescheduling ------------------------ */

const RESCHEDULE_FAILED_MESSAGE =
  "I couldn’t complete the reschedule just now. Your original appointment is unchanged. Please try again in a moment, or contact the business team and they’ll take care of it.";

const RESCHEDULE_CALLER_ID_UNAVAILABLE_MESSAGE =
  "I’m unable to verify the phone number for this call, so I can’t reschedule an appointment automatically. Please call from the phone number used when booking or contact the business team for assistance.";

async function runRescheduleAppointmentTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  if (!ctx.business?.businessId) {
    return { rescheduled: false, code: "BUSINESS_NOT_RESOLVED", message: RESCHEDULE_FAILED_MESSAGE };
  }

  if (ctx.dental?.dryRun || ctx.executionMode === "BUSINESS_TEST" || ctx.executionMode === "ARCHITECT_DRY_RUN") {
    return {
      rescheduled: false,
      dry_run: true,
      code: "CALLER_ID_UNAVAILABLE",
      message: RESCHEDULE_CALLER_ID_UNAVAILABLE_MESSAGE
    };
  }

  const callerPhone = trustedCallerE164(ctx);
  if (!callerPhone) {
    return {
      rescheduled: false,
      code: "CALLER_ID_UNAVAILABLE",
      message: RESCHEDULE_CALLER_ID_UNAVAILABLE_MESSAGE
    };
  }

  const businessId = ctx.business.businessId;
  const timeZone = ctx.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;

  // Optional model-supplied REFINEMENTS (never identity) — same as cancel.
  const dateFilter = argStr(args, ["date", "appointment_date"]);
  const serviceFilter = argStr(args, ["service_type", "service"]);
  const now = new Date();
  const dayRange =
    dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)
      ? {
        gte: zonedWallClockToUtc(dateFilter, 0, 0, timeZone),
        lte: zonedWallClockToUtc(dateFilter, 23, 59, timeZone)
      }
      : null;

  const eligible = await prisma.appointment.findMany({
    where: {
      businessId,
      customerPhone: callerPhone,
      status: { in: CANCELLABLE_APPOINTMENT_STATUSES },
      startAt: dayRange
        ? { gte: dayRange.gte > now ? dayRange.gte : now, lte: dayRange.lte }
        : { gte: now },
      ...(serviceFilter ? { service: { contains: serviceFilter, mode: "insensitive" as const } } : {})
    },
    orderBy: { startAt: "asc" },
    take: 10,
    select: { id: true, service: true, startAt: true, timeZone: true, status: true }
  });

  // Internal DB ids never reach the model — opaque HMAC refs only (see cancel).
  const describe = (appointment: (typeof eligible)[number]) => ({
    appointment_id: appointmentAiRef(appointment.id),
    service: appointment.service || "appointment",
    appointment_date: formatApptDate(appointment.startAt, appointment.timeZone || timeZone),
    appointment_time: formatApptTime(appointment.startAt, appointment.timeZone || timeZone)
  });

  const confirmed = args["confirmed"] === true;
  const requestedId = argStr(args, ["appointment_id", "appointmentId"]);

  /* ----------------------------- lookup phase ----------------------------- */

  if (!confirmed) {
    if (eligible.length === 0) {
      return { rescheduled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
    }
    if (eligible.length === 1) {
      const found = describe(eligible[0]);
      return {
        rescheduled: false,
        code: "CONFIRMATION_REQUIRED",
        appointment: found,
        message: `I found an upcoming appointment for ${found.service} on ${found.appointment_date} at ${found.appointment_time}. What new day and time would work for you? Offer to check availability first if they are unsure.`
      };
    }
    return {
      rescheduled: false,
      code: "MULTIPLE_APPOINTMENTS",
      appointments: eligible.map((appointment, index) => ({ number: index + 1, ...describe(appointment) })),
      message:
        "The caller has several upcoming appointments. Read the numbered list (service, date, time only) and ask which one they would like to move, then ask for the new day and time."
    };
  }

  /* -------------------------- confirmed reschedule ------------------------- */

  let targetId: string | null = null;
  if (requestedId) {
    targetId = resolveAppointmentAiRef(requestedId, eligible)?.id ?? requestedId;
  } else if (eligible.length === 1) {
    targetId = eligible[0].id;
  } else if (eligible.length === 0) {
    return { rescheduled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
  } else {
    return {
      rescheduled: false,
      code: "MULTIPLE_APPOINTMENTS",
      appointments: eligible.map((appointment, index) => ({ number: index + 1, ...describe(appointment) })),
      message: "Several appointments matched. Ask the caller which one to move, then confirm again."
    };
  }

  const target = await prisma.appointment.findFirst({
    where: { id: targetId, businessId },
    select: {
      id: true,
      service: true,
      providerName: true,
      startAt: true,
      endAt: true,
      timeZone: true,
      status: true,
      customerName: true,
      customerPhone: true,
      calendarEventId: true,
      notes: true
    }
  });

  if (!target) {
    return { rescheduled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
  }

  const isCallerMatched = callerPhone && target.customerPhone === callerPhone;
  const isVerifiedRef = Boolean(requestedId && resolveAppointmentAiRef(requestedId, eligible)?.id === target.id);
  if (!isCallerMatched && !isVerifiedRef) {
    return { rescheduled: false, code: "CALLER_NUMBER_NOT_VERIFIED", message: CANCEL_NO_MATCH_MESSAGE };
  }

  if (!CANCELLABLE_APPOINTMENT_STATUSES.includes(target.status) || target.startAt < new Date()) {
    // Caller identity IS verified on this branch — a non-leaky status message is safe.
    return {
      rescheduled: false,
      code: "NOT_RESCHEDULABLE",
      message:
        "That appointment can no longer be rescheduled over the phone. Please contact the business team for assistance."
    };
  }

  // The new slot: explicit new_date/new_time from the caller's confirmation.
  const newDateRaw = argStr(args, ["new_date", "newDate"]);
  const newTimeRaw = argStr(args, ["new_time", "newTime"]);
  if (!newDateRaw || !newTimeRaw) {
    return {
      rescheduled: false,
      code: "NEW_TIME_REQUIRED",
      message: "Ask the caller for the new day and time before confirming the reschedule."
    };
  }

  // Only the new_date the model passed for THIS request — never the transcript.
  const relativeText = newDateRaw ?? "";
  const { date: newDate, isPast } = resolveRequestedDate({ rawDate: newDateRaw, relativeText, timeZone });
  const newTime = parseClockTime(newTimeRaw);
  if (isPast || !newTime) {
    return {
      rescheduled: false,
      code: "INVALID_NEW_TIME",
      message: "That new date or time didn’t come through clearly. Ask the caller for the day and time again."
    };
  }

  const durationMs = Math.max(
    5 * 60 * 1000,
    target.endAt.getTime() - target.startAt.getTime() ||
    (ctx.dental?.defaultDurationMinutes ?? 30) * 60 * 1000
  );
  const newStartAt = zonedWallClockToUtc(newDate, newTime.hour, newTime.minute, timeZone);
  const newEndAt = new Date(newStartAt.getTime() + durationMs);

  if (newStartAt.getTime() < Date.now() - 60_000) {
    return {
      rescheduled: false,
      code: "INVALID_NEW_TIME",
      message: "That new time is in the past. Ask the caller for an upcoming day and time."
    };
  }

  const newDateLabel = formatApptDate(newStartAt, timeZone);
  const newTimeLabel = formatApptTime(newStartAt, timeZone);
  const previousDateLabel = formatApptDate(target.startAt, target.timeZone || timeZone);
  const previousTimeLabel = formatApptTime(target.startAt, target.timeZone || timeZone);

  // Idempotent: confirming the same target time again is a success.
  if (Math.abs(target.startAt.getTime() - newStartAt.getTime()) < 60_000) {
    return {
      rescheduled: true,
      code: "ALREADY_RESCHEDULED",
      appointment: {
        service: target.service || "appointment",
        appointment_date: newDateLabel,
        appointment_time: newTimeLabel
      },
      message: `Your appointment is already set for ${newDateLabel} at ${newTimeLabel}.`
    };
  }

  let calendarEventId = target.calendarEventId;
  let calendarEventLink: string | null = null;
  if (target.calendarEventId && ctx.business.ownerId) {
    try {
      const moved = await rescheduleGoogleCalendarAppointment({
        userId: ctx.business.ownerId,
        calendarId: ctx.business.calendarId,
        eventId: target.calendarEventId,
        startAt: newStartAt,
        endAt: newEndAt,
        timeZone
      });

      if (moved.missing) {
        const recreated = await createGoogleCalendarAppointment({
          userId: ctx.business.ownerId,
          calendarId: ctx.business.calendarId,
          timeZone,
          businessName: ctx.business.businessName,
          customerName: target.customerName ?? undefined,
          customerPhone: target.customerPhone,
          service: target.service ?? undefined,
          providerName: target.providerName ?? undefined,
          startAt: newStartAt,
          endAt: newEndAt
        });
        calendarEventId = recreated.id ?? calendarEventId;
        calendarEventLink = recreated.htmlLink ?? null;
      } else {
        calendarEventLink = moved.htmlLink;
      }
    } catch (error) {
      console.error("[vapi-webhook] reschedule_appointment calendar move failed (appointment NOT moved)", error);
      await prisma.appointment
        .update({
          where: { id: target.id },
          data: {
            notes: `${new Date().toISOString()}: customer phone reschedule attempt to ${newDateLabel} ${newTimeLabel} — Google Calendar update failed; appointment left at the original time.`
          }
        })
        .catch(() => null);
      return { rescheduled: false, code: "RESCHEDULE_FAILED", message: RESCHEDULE_FAILED_MESSAGE };
    }
  }

  await prisma.appointment.update({
    where: { id: target.id },
    data: {
      startAt: newStartAt,
      endAt: newEndAt,
      timeZone,
      status: "BOOKED",
      ...(calendarEventId !== target.calendarEventId ? { calendarEventId } : {}),
      ...(calendarEventLink ? { calendarEventLink } : {}),
      notes: [
        target.notes,
        `${new Date().toISOString()}: rescheduled by the customer during a phone call from ${previousDateLabel} ${previousTimeLabel} to ${newDateLabel} ${newTimeLabel}.${ctx.callId ? ` Call ID: ${ctx.callId}` : ""}`
      ]
        .filter(Boolean)
        .join("\n")
    }
  });

  let smsSent = false;
  try {
    const smsOutcome = await sendTrackedSms({
      to: callerPhone,
      body: `${smsAttributionPrefix(ctx.business.businessName)}Hi ${target.customerName || "there"}, your ${target.service ? `${target.service} ` : ""}appointment has been moved to ${newDateLabel} at ${newTimeLabel}. Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.`,
      messageType: "APPOINTMENT_CONFIRMATION",
      businessId,
      businessName: ctx.business.businessName,
      smsPurpose: "RESCHEDULE_CONFIRMATION",
      installedAgentId: ctx.business.installedAgentId ?? null,
      appointmentId: target.id,
      vapiCallId: ctx.callId ?? null,
      dedupeKey: `appointment-reschedule:${target.id}:${newStartAt.toISOString()}`
    });
    smsSent = smsOutcome.sent || smsOutcome.alreadySent;
  } catch (error) {
    console.error("[vapi-webhook] reschedule SMS failed (non-fatal)", error);
  }

  const rescheduleEmailKey = `appointment-reschedule:${target.id}:${newStartAt.toISOString()}:team-email`;
  enqueueEmail(
    {
      kind: "internal_notification",
      input: {
        businessId,
        businessName: ctx.business.businessName,
        purpose: "INTERNAL_NOTIFICATION",
        idempotencyKey: rescheduleEmailKey,
        fields: {
          caller: target.customerName || null,
          phone: target.customerPhone,
          email: null,
          requestedService: target.service || null,
          summary: `Appointment moved by the customer during a phone call: from ${previousDateLabel} at ${previousTimeLabel} to ${newDateLabel} at ${newTimeLabel}.`,
          nextAction: "No action needed unless the new time conflicts with your schedule."
        }
      }
    },
    { idempotencyKey: rescheduleEmailKey }
  ).catch((error) => console.error("[vapi-webhook] reschedule email failed (non-fatal)", error));

  return {
    rescheduled: true,
    code: "RESCHEDULED",
    appointment: {
      service: target.service || "appointment",
      appointment_date: newDateLabel,
      appointment_time: newTimeLabel
    },
    previous: {
      appointment_date: previousDateLabel,
      appointment_time: previousTimeLabel
    },
    sms_sent: smsSent,
    message: `You're all set — the appointment has been moved to ${newDateLabel} at ${newTimeLabel}.`
  };
}

async function runVerifyAndLookupAppointmentTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  if (!ctx.business?.businessId) {
    return { verified: false, code: "BUSINESS_NOT_RESOLVED", message: "Business could not be verified." };
  }

  const fullNameRaw = argStr(args, ["full_name", "fullName", "name", "customer_name"]);
  const phoneRaw = argStr(args, ["booking_phone", "bookingPhone", "phone", "customer_phone"]);
  const emailRaw = argStr(args, ["booking_email", "bookingEmail", "email", "customer_email"]);

  if (!fullNameRaw || !phoneRaw || !emailRaw) {
    return {
      verified: false,
      code: "MISSING_VERIFICATION_FIELDS",
      message: "To look up an appointment under a different phone number, I need all three details: full name, phone number used during booking, and email address used during booking."
    };
  }

  const validatedPhone = validateSmsRecipientE164(phoneRaw);
  if (!validatedPhone.ok) {
    return {
      verified: false,
      code: "VERIFICATION_FAILED",
      message: "The provided name, phone number, and email address do not match any active booking in our system. Please check the details and try again."
    };
  }

  const bookingPhone = validatedPhone.e164;
  const bookingEmail = emailRaw.trim().toLowerCase();
  const fullNameNorm = fullNameRaw.trim().toLowerCase();
  const businessId = ctx.business.businessId;
  const timeZone = ctx.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE;
  const now = new Date();

  try {
    const eligible = await prisma.appointment.findMany({
      where: {
        businessId,
        customerPhone: bookingPhone,
        status: { in: CANCELLABLE_APPOINTMENT_STATUSES },
        startAt: { gte: now }
      },
      orderBy: { startAt: "asc" },
      take: 10
    });

    const matches = eligible.filter((appt) => {
      const apptEmail = (appt.customerEmail || "").trim().toLowerCase();
      const apptName = (appt.customerName || "").trim().toLowerCase();
      if (!apptEmail || apptEmail !== bookingEmail) return false;
      if (!apptName) return false;
      return apptName.includes(fullNameNorm) || fullNameNorm.includes(apptName);
    });

    if (matches.length === 0) {
      return {
        verified: false,
        code: "VERIFICATION_FAILED",
        message: "The provided name, phone number, and email address do not match any active booking in our system. Please check the details and try again."
      };
    }

    const describe = (appointment: (typeof matches)[number]) => ({
      appointment_id: appointmentAiRef(appointment.id),
      service: appointment.service || "appointment",
      appointment_date: formatApptDate(appointment.startAt, appointment.timeZone || timeZone),
      appointment_time: formatApptTime(appointment.startAt, appointment.timeZone || timeZone),
      customer_name: appointment.customerName || fullNameRaw
    });

    return {
      verified: true,
      code: "VERIFIED",
      count: matches.length,
      appointments: matches.map((appt, idx) => ({ number: idx + 1, ...describe(appt) })),
      message: `Verification successful. I found ${matches.length} upcoming appointment(s) booked under that name and email. Ask the caller for the new day and time they would like to move the appointment to, then call reschedule_appointment with appointment_id, new_date, new_time, and confirmed=true.`
    };
  } catch (error) {
    console.error("[vapi-webhook] verify_and_lookup_appointment failed", error);
    return {
      verified: false,
      code: "VERIFICATION_ERROR",
      message: "I encountered an error verifying the booking details. Please try again or contact our team directly."
    };
  }
}

async function runLookupKnowledgeTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  const query = argStr(args, ["query", "question", "topic", "search"]) || ctx.transcript.slice(-300);
  const businessId = ctx.business?.businessId;

  if (!businessId || !query.trim()) {
    return {
      found: false,
      sections: [],
      message: "No business documents are available. Use the fallback response instead of inventing details."
    };
  }

  const structured = await lookupStructuredFacts({ businessId, query });
  const documents = await retrieveRelevantKnowledge({
    businessId,
    installedAgentId: ctx.installedAgentId,
    query
  });
  const sections = [
    ...structured,
    ...documents.filter((section) => !structured.some((fact) => fact.title === section.title))
  ];

  if (sections.length === 0) {
    return {
      found: false,
      sections: [],
      message:
        "Nothing in the business documents matches this question. Do not invent an answer — use the configured fallback response."
    };
  }

  console.log("[vapi-tool] lookup_knowledge", { businessId, terms: query.slice(0, 60), sections: sections.length });
  return {
    found: true,
    sections: sections.map((section) => ({
      title: section.title,
      content: section.content,
      source: section.sourceFilename
    })),
    message:
      "Answer using ONLY these sections. Read across ALL of them before answering — when the caller asks who or what the business has, name every match found in these sections, not just the first one. If they do not cover the question, say you will have the team confirm."
  };
}

export async function runUpdateAppointmentContactTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  const businessId = ctx.business?.businessId;
  if (!businessId) {
    return { success: false, error: "BUSINESS_NOT_RESOLVED", message: "I couldn't update the appointment right now." };
  }
  const confirmed = args.confirmed === true || String(args.confirmed ?? "").toLowerCase() === "true";

  const contact = await readCallContact(businessId, ctx.callId);
  const appointmentSelect = { id: true, businessId: true, customerPhone: true } as const;
  const resolveAppointment = async () => {
    let appt = contact?.appointmentId
      ? await prisma.appointment.findUnique({ where: { id: contact.appointmentId }, select: appointmentSelect })
      : null;
    if (!appt && ctx.callId) {
      appt = await prisma.appointment.findFirst({
        where: { businessId, bookingCallId: ctx.callId, status: "BOOKED" },
        orderBy: { createdAt: "desc" },
        select: appointmentSelect
      });
    }
    return appt && appt.businessId === businessId ? appt : null;
  };

  // ---------------------------- PREPARE (validate) --------------------------
  // Validate the full E.164, store it as a PENDING correction in the distributed
  // call state, and read both masked numbers back. NO database change here.
  if (!confirmed) {
    const rawPhone = argStr(args, ["corrected_phone", ...PHONE_ARG_KEYS]);
    if (!rawPhone) {
      return {
        success: false,
        error: "PHONE_REQUIRED",
        message: "Ask the caller for the full corrected number including its country code, then call this again."
      };
    }
    if (!hasExplicitCountryCode(rawPhone)) return { ...NEEDS_COUNTRY_CODE_RESULT };
    const corrected = normalizePhoneE164(rawPhone);
    if (!corrected || corrected.replace(/\D/g, "").length < 8) {
      return { success: false, error: "INVALID_PHONE", message: "That number isn't a valid full number. Ask for it again with the country code." };
    }
    const appt = await resolveAppointment();
    if (!appt) {
      return { success: false, error: "APPOINTMENT_NOT_FOUND", message: "There's no booking on this call to update. Complete the booking first." };
    }
    await updateCallContact(businessId, ctx.callId, { pendingCorrectedPhoneE164: corrected });
    return {
      success: true,
      needs_confirmation: true,
      masked_old_recipient: `•••${appt.customerPhone.slice(-4)}`,
      masked_new_recipient: `•••${corrected.slice(-4)}`,
      customerSpeechCode: "CONFIRM_CORRECTED_NUMBER" as const,
      customerSafeMessage: `I'll change your appointment from the number ending ${appt.customerPhone.slice(-4)} to the one ending ${corrected.slice(-4)}. Is that right?`,
      message:
        "Read both masked numbers back and get an explicit yes. Then call update_appointment_contact again with confirmed=true — do NOT re-send the phone number; the validated number is loaded server-side."
    };
  }

  const pending = contact?.pendingCorrectedPhoneE164 ?? "";
  if (!pending) {
    return { success: false, error: "NO_PENDING_CORRECTION", message: "There's no corrected number to confirm yet. Ask for the corrected number first." };
  }
  const maskedRecipient = `•••${pending.slice(-4)}`;

  if (ctx.dental?.dryRun || ctx.executionMode === "BUSINESS_TEST" || ctx.executionMode === "ARCHITECT_DRY_RUN") {
    await updateCallContact(businessId, ctx.callId, { pendingCorrectedPhoneE164: null });
    return { success: true, dry_run: true, updated: false, masked_recipient: maskedRecipient };
  }

  const appt = await resolveAppointment();
  if (!appt) {
    return { success: false, error: "APPOINTMENT_NOT_FOUND", message: "There's no booking on this call to update. Complete the booking first." };
  }
  const previous = appt.customerPhone;

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appt.id }, data: { customerPhone: pending } });
    await tx.smsConsent.updateMany({
      where: { businessId, phoneNumber: previous, appointmentId: appt.id },
      data: { appointmentId: null }
    });
    await tx.smsExecution.updateMany({
      where: { businessId, appointmentId: appt.id, toPhone: previous, status: { in: ["QUEUED", "SENDING"] } },
      data: { status: "FAILED" }
    });
  });

  // Move canonical + SMS recipient together AFTER the transaction; clear pending.
  await updateCallContact(businessId, ctx.callId, {
    canonicalPhoneE164: pending,
    phoneSource: "confirmed",
    smsRecipientE164: pending,
    appointmentId: appt.id,
    pendingCorrectedPhoneE164: null
  });
  // The disclosure must be re-read for the NEW recipient — invalidate the offer.
  const offerKey = consentOfferKey(ctx);
  if (offerKey) await clearConsentOffer(offerKey);

  console.log("[vapi-tool] update_appointment_contact committed", {
    appointmentId: appt.id,
    from: maskPhone(previous),
    to: maskPhone(pending),
    callId: ctx.callId ?? null
  });

  return {
    success: true,
    updated: true,
    appointment_ref: appointmentAiRef(appt.id),
    masked_recipient: maskedRecipient,
    consent_status: "none",
    required_disclosure: verbalSmsConsentDisclosure(ctx.business?.businessName ?? ""),
    customerSpeechCode: "CONTACT_UPDATED" as const,
    customerSafeMessage: `Done — your appointment now uses the number ending ${pending.slice(-4)}.`,
    message:
      "Appointment recipient updated. The new number has NO SMS consent yet — do not promise a text. If the caller wants a confirmation text, read the disclosure in required_disclosure word-for-word, then call record_sms_consent with only appointment_id and affirmative."
  };
}

export async function runRecordSmsConsentTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  if (!ctx.business?.businessId) {
    return { success: false, error: "business_not_resolved", consent_recorded: false };
  }

  const affirmative = args["affirmative"];
  if (typeof affirmative !== "boolean") {
    return {
      success: false,
      error: "affirmative_must_be_boolean",
      consent_recorded: false,
      message: "Ask the yes/no consent question and call again with affirmative true or false."
    };
  }

  const disclosure = await smsDisclosureState(ctx);
  const disclosureState = disclosure.state;

  if (disclosureState === "INTERRUPTED") {
    console.warn("[vapi-webhook] record_sms_consent deferred — disclosure interrupted", {
      callId: ctx.callId ?? null,
      executionMode: ctx.executionMode ?? "LIVE",
      missing: disclosure.missing.length
    });
    return {
      success: false,
      error: "DISCLOSURE_INTERRUPTED",
      consent_recorded: false,
      sms_allowed: false,
      customerSpeechCode: "NONE" as const,
      confirmation_line: disclosure.remainingLine ?? "",
      message:
        "Consent was NOT saved yet — the caller answered before the disclosure finished. Do NOT read the disclosure again and do NOT apologize. Say the ONE sentence in confirmation_line, word-for-word, and nothing else. It is short by design: it carries only the terms they have not heard yet and ends by confirming their answer. Then call record_sms_consent again with that answer."
    };
  }

  if (disclosureState === "AWAITING_ANSWER") {
    console.warn("[vapi-webhook] record_sms_consent deferred — disclosure read, answer not yet in transcript", {
      callId: ctx.callId ?? null,
      executionMode: ctx.executionMode ?? "LIVE"
    });
    return {
      success: false,
      error: "DISCLOSURE_AWAITING_ANSWER",
      consent_recorded: false,
      sms_allowed: false,
      customerSpeechCode: "NONE" as const,
      message:
        "Consent was NOT saved yet. You have ALREADY read the disclosure in full on this call — do NOT read it again and do not apologize or re-explain. Simply wait for the caller's yes or no, then call record_sms_consent again with their answer. Say nothing to the caller about this."
    };
  }

  if (disclosureState === "NOT_PRESENTED") {
    console.warn("[vapi-webhook] record_sms_consent blocked — disclosure not presented", {
      callId: ctx.callId ?? null,
      executionMode: ctx.executionMode ?? "LIVE"
    });
    return {
      success: false,
      error: "DISCLOSURE_NOT_PRESENTED",
      consent_recorded: false,
      sms_allowed: false,
      required_disclosure: ctx.business?.businessName
        ? verbalSmsConsentDisclosure(ctx.business.businessName)
        : undefined,
      message:
        "Consent was NOT saved — the full SMS consent disclosure has not been read on this call. NEVER tell the caller consent was saved or that any text was or will be sent. Read the disclosure in required_disclosure to the caller WORD-FOR-WORD (never paraphrase, shorten, or summarize it), wait for their answer, then call record_sms_consent again."
    };
  }

  if (ctx.executionMode === "BUSINESS_TEST") {
    return {
      success: true,
      business_test: true,
      consent_recorded: false,
      sms_allowed: affirmative,
      message: affirmative
        ? "Test call — consent noted for this conversation only (not recorded). A real text would be sent on a live call; none is sent during tests."
        : "Test call — declined noted. Do not send texts. Continue the booking normally."
    };
  }

  const consentContact: Partial<CanonicalCallContact> =
    (await readCallContact(ctx.business.businessId, ctx.callId)) ?? {};

  const appointmentSelect = {
    id: true,
    customerPhone: true,
    customerName: true,
    service: true,
    startAt: true,
    timeZone: true
  } as const;
  let bookedAppointment:
    | { id: string; customerPhone: string; customerName: string | null; service: string | null; startAt: Date; timeZone: string | null }
    | null = null;
  if (consentContact.appointmentId) {
    bookedAppointment = await prisma.appointment.findUnique({
      where: { id: consentContact.appointmentId },
      select: appointmentSelect
    });
  }
  if (!bookedAppointment && ctx.callId) {
    bookedAppointment = await prisma.appointment.findFirst({
      where: { businessId: ctx.business.businessId, bookingCallId: ctx.callId, status: "BOOKED" },
      orderBy: { createdAt: "desc" },
      select: appointmentSelect
    });
  }

  const phone =
    bookedAppointment?.customerPhone ||
    consentContact.smsRecipientE164 ||
    consentContact.canonicalPhoneE164 ||
    normalizePhoneE164(ctx.customerPhone) ||
    "";
  if (!phone) {
    return {
      success: false,
      error: "RECIPIENT_UNRESOLVED",
      consent_recorded: false,
      sms_allowed: false,
      customerSpeechCode: "CONSENT_NO_RECIPIENT" as const,
      customerSafeMessage: "Your appointment is still booked, but I couldn't set up the confirmation text.",
      message:
        "No canonical recipient is available from the appointment, confirmed call contact, or verified caller ID. Do NOT accept a spoken phone number here. If the caller needs a different number, call update_appointment_contact to correct it first, then call record_sms_consent again with only appointment_id and affirmative."
    };
  }

  // Architect browser test: acknowledge without persisting.
  if (ctx.dental?.dryRun) {
    return { success: true, dry_run: true, consent_recorded: false, sms_allowed: affirmative };
  }

  const outcome = await recordVerbalSmsConsent({
    businessId: ctx.business.businessId,
    installedAgentId: ctx.business.installedAgentId ?? ctx.installedAgentId ?? null,
    phoneNumber: phone,
    businessName: ctx.business.businessName,
    vapiCallId: ctx.callId ?? null,
    // #5: bind the consent row to the appointment + canonical recipient so
    // Appointment, SmsConsent and SmsExecution all reference the same number.
    appointmentId: bookedAppointment?.id ?? null,
    affirmative
  });

  if (!outcome.ok) {
    console.log("[vapi-webhook] record_sms_consent rejected", { reason: outcome.error });
    return { success: false, error: outcome.error, consent_recorded: false };
  }

  const offerKey = consentOfferKey(ctx);
  if (offerKey) await clearConsentOffer(offerKey);

  console.log("[vapi-webhook] record_sms_consent stored", {
    businessId: ctx.business.businessId,
    phone: maskPhone(phone),
    optedIn: outcome.consent.status === "OPTED_IN",
    callId: ctx.callId ?? null
  });

  let confirmationSmsSent = false;
  let confirmationAttempted = false;
  let smsProviderAccepted = false;
  let smsMessageSidPresent = false;
  if (outcome.consent.status === "OPTED_IN") {
    try {
      const target =
        bookedAppointment ??
        (await prisma.appointment.findFirst({
          // Legacy fallback for appointments created before bookingCallId
          // existed: same business + the SAME canonical number, recent.
          where: {
            businessId: ctx.business.businessId,
            customerPhone: phone,
            status: "BOOKED",
            executionMode: "LIVE",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
          },
          orderBy: { createdAt: "desc" },
          select: appointmentSelect
        }));
      if (target) {
        confirmationAttempted = true;
        const smsOutcome = await sendAppointmentConfirmationSms({
          appointmentId: target.id,
          businessId: ctx.business.businessId,
          installedAgentId: ctx.business.installedAgentId ?? ctx.installedAgentId ?? null,
          vapiCallId: ctx.callId ?? null,
          customerName: target.customerName ?? "",
          customerPhone: target.customerPhone,
          serviceName: target.service ?? "appointment",
          appointmentDate: target.startAt,
          timeZone: target.timeZone || ctx.timeZone
        });
        smsMessageSidPresent = Boolean(smsOutcome.messageSid);
        smsProviderAccepted =
          Boolean(smsOutcome.sent && smsOutcome.messageSid) ||
          Boolean(smsOutcome.alreadySent && smsOutcome.messageSid);
        // #5 confirmation_sms_sent=true REQUIRES a stored provider messageSid,
        // ALWAYS. A send with no messageSid (including SIMULATED) is never
        // "submitted" — the assistant must never claim a text was sent.
        confirmationSmsSent = smsMessageSidPresent && smsProviderAccepted;
      }
    } catch (error) {
      console.error("[vapi-webhook] post-consent confirmation SMS failed (non-fatal)", error);
    }
  }

  const declined = outcome.consent.status !== "OPTED_IN";
  const speech = declined
    ? {
      customerSpeechCode: "CONSENT_DECLINED" as const,
      customerSafeMessage: "No problem — I won't send any texts. Your appointment is all set."
    }
    : confirmationSmsSent
      ? {
        customerSpeechCode: "CONFIRMATION_SUBMITTED" as const,
        customerSafeMessage: "Your confirmation text has been submitted."
      }
      : confirmationAttempted
        ? {
          customerSpeechCode: "CONFIRMATION_FAILED" as const,
          customerSafeMessage: "Your appointment is still booked, but I couldn't send the confirmation text."
        }
        : {
          customerSpeechCode: "CONSENT_RECORDED" as const,
          customerSafeMessage: "You're all set to receive text updates."
        };

  const recipientEnding = phone.slice(-4);
  return {
    success: true,
    consent_recorded: true,
    sms_allowed: !declined,
    confirmation_sms_sent: confirmationSmsSent,
    smsProviderAccepted,
    smsMessageSidPresent,
    masked_recipient: `•••${recipientEnding}`,
    ...speech,
    // The customerSafeMessage above is authoritative — say it verbatim.
    message: declined
      ? `Declined recorded. Do not send texts. Tell the caller EXACTLY: "${speech.customerSafeMessage}" The booking is not affected.`
      : `SMS consent recorded for the number ending ${recipientEnding}. Tell the caller EXACTLY: "${speech.customerSafeMessage}"${confirmationSmsSent ? " Never claim it was delivered." : " Never claim a text was sent."}`
  };
}

/** send_notification: SMS the customer and/or the business team. */
async function runSendNotificationTool(args: Record<string, unknown>, ctx: VapiToolContext) {
  let customerSmsSent = false;
  let teamSmsSent = false;
  let customerEmailSent = false;
  let teamEmailSent = false;
  let customerSmsBlockedReason: string | null = null;

  const service = argStr(args, ["service", "service_type"]) || ctx.dental?.bookingLabel || "appointment";
  const teamName =
    argStr(args, ["doctor_name", "provider_name", "team_name"]) ||
    ctx.dental?.doctorName ||
    ctx.business?.businessName ||
    "";

  const urgencyRaw = (argStr(args, ["urgency"]) || "").toLowerCase();
  const urgency = urgencyRaw === "urgent" || urgencyRaw === "emergency" ? urgencyRaw : null;
  if (ctx.dental?.dryRun || ctx.executionMode === "BUSINESS_TEST" || ctx.executionMode === "ARCHITECT_DRY_RUN") {
    const previewName = resolvePatientName(args, ctx.transcript, ctx.summary) ?? "";
    const previewPhone = resolvePatientPhone(argStr(args, PHONE_ARG_KEYS), ctx.customerPhone);
    const preview = applyBracketTemplate(
      ctx.dental?.patientTemplate ?? `${smsAttributionPrefix("[Business Name]")}Confirmed: [Service] on [Date] at [Time].`,
      bracketTemplateValues({
        service,
        customerName: previewName,
        customerPhone: previewPhone || "",
        teamName,
        date: argStr(args, ["appointment_date", "date"]) || "",
        time: argStr(args, ["appointment_time", "time"]) || ""
      })
    );
    console.log("[vapi-webhook] send_notification dry-run (browser test)", { to: previewPhone, preview });
    return {
      success: true,
      dry_run: true,
      sms_preview: preview,
      customer_sms_sent: false,
      team_sms_sent: false,
      patient_sms_sent: false,
      dentist_sms_sent: false
    };
  }

  if (ctx.business?.businessId) {
    // Only ever use a validated real name in SMS — never a placeholder.
    const customerName = resolvePatientName(args, ctx.transcript, ctx.summary) ?? "";
    const customerPhone = resolvePatientPhone(argStr(args, PHONE_ARG_KEYS), ctx.customerPhone);
    const values = bracketTemplateValues({
      service,
      customerName,
      customerPhone: customerPhone || "",
      teamName: teamName || ctx.business.businessName,
      date: argStr(args, ["appointment_date", "date"]) || "",
      time: argStr(args, ["appointment_time", "time"]) || ""
    });

    const afterHoursGate = ctx.afterHours ?? { active: false };
    const customerSmsGate = gateLiveAfterHoursAction(afterHoursGate, "customer_sms");
    const customerEmailGate = gateLiveAfterHoursAction(afterHoursGate, "customer_email");

    if (!customerSmsGate.allowed) {
      customerSmsBlockedReason = customerSmsGate.code;
      console.log("[vapi-webhook] send_notification: customer SMS blocked by after-hours gate", {
        code: customerSmsGate.code,
        callId: ctx.callId ?? null
      });
    }

    if (customerSmsGate.allowed && (ctx.dental?.sendToPatient ?? true) && customerPhone) {
      try {
        const recentAppointment = await prisma.appointment.findFirst({
          where: {
            businessId: ctx.business.businessId,
            customerPhone,
            createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, service: true, startAt: true, timeZone: true, customerName: true }
        });

        if (urgency && !recentAppointment) {
          console.log("[vapi-webhook] send_notification: customer SMS skipped for urgency-only notification", {
            urgency,
            callId: ctx.callId ?? null
          });
        } else if (recentAppointment) {
          const outcome = await sendAppointmentConfirmationSms({
            appointmentId: recentAppointment.id,
            businessId: ctx.business.businessId,
            installedAgentId: ctx.business.installedAgentId ?? null,
            vapiCallId: ctx.callId ?? null,
            customerName: customerName || recentAppointment.customerName || "",
            customerPhone,
            serviceName: recentAppointment.service || service,
            appointmentDate: recentAppointment.startAt,
            timeZone: recentAppointment.timeZone || ctx.timeZone
          });
          customerSmsSent = outcome.sent || outcome.alreadySent;
          if (outcome.suppressed) customerSmsBlockedReason = outcome.errorCode;
        } else {
          const sms = applyBracketTemplate(
            ctx.dental?.patientTemplate ?? `${smsAttributionPrefix("[Business Name]")}Confirmed: [Service] on [Date] at [Time].`,
            values
          );
          const outcome = await sendTrackedSms({
            to: customerPhone,
            body: sms,
            messageType: "WORKFLOW_SMS",
            businessId: ctx.business.businessId,
            businessName: ctx.business.businessName,
            smsPurpose: "APPOINTMENT_CONFIRMATION",
            installedAgentId: ctx.business.installedAgentId ?? null,
            vapiCallId: ctx.callId ?? null,
            dedupeKey: ctx.callId ? `send_notification:${ctx.callId}:customer` : null
          });
          customerSmsSent = outcome.sent || outcome.alreadySent;
          if (outcome.suppressed) customerSmsBlockedReason = outcome.errorCode;
          if (customerSmsSent) {
            await upsertConversation({
              businessId: ctx.business.businessId,
              customerPhone,
              direction: "OUTBOUND",
              body: sms,
              providerId: outcome.messageSid
            }).catch(() => null);
          }
        }
      } catch (error) {
        console.error("[vapi-webhook] customer SMS failed (non-fatal)", error);
      }
    }

    const teamPhone = ctx.dental?.dentistPhone;
    if ((ctx.dental?.sendToDentist ?? true) && teamPhone) {
      const redFlagRoute = ctx.afterHours?.state?.route === "RED_FLAG_DETECTED" || urgency === "emergency";
      const afterHoursUrgent = redFlagRoute || urgency === "urgent" || ctx.afterHours?.state?.route === "URGENT_DENTAL" || ctx.afterHours?.state?.route === "HUMAN_REVIEW";
      const includeCallback = ctx.afterHours?.policy?.includeCallbackInStaffAlert !== false;

      try {
        const sms = afterHoursUrgent
          ? redFlagRoute
            ? buildRedFlagStaffAlert({
              businessName: ctx.business.businessName,
              callerName: customerName || null,
              callbackNumber: customerPhone || null,
              callId: ctx.callId ?? null,
              includeCallback
            })
            : buildUrgentStaffAlert({
              businessName: ctx.business.businessName,
              callerName: customerName || null,
              callbackNumber: customerPhone || null,
              callId: ctx.callId ?? null,
              includeCallback
            })
          : applyBracketTemplate(
            ctx.dental?.dentistTemplate ??
            "New booking: [Customer Name], [Date] [Time], [Service]. Phone: [Customer Phone]",
            values
          );

        if (afterHoursUrgent && ctx.business.businessId && ctx.callId) {
          await updateAfterHoursStaffNotificationStatus(ctx.business.businessId, ctx.callId, "PENDING").catch(() => null);
        }

        const outcome = await sendTrackedSms({
          to: teamPhone,
          body: sms,
          messageType: "TEAM_NOTIFICATION",
          businessId: ctx.business.businessId,
          installedAgentId: ctx.business.installedAgentId ?? null,
          vapiCallId: ctx.callId ?? null,
          dedupeKey: ctx.callId ? `send_notification:${ctx.callId}:team` : null
        });
        // Delivery is claimed only when the provider confirmed the send.
        teamSmsSent = outcome.sent || outcome.alreadySent;
        if (afterHoursUrgent && ctx.business.businessId && ctx.callId) {
          await updateAfterHoursStaffNotificationStatus(
            ctx.business.businessId,
            ctx.callId,
            teamSmsSent ? "SENT" : "FAILED"
          ).catch(() => null);
        }
        if (afterHoursUrgent || urgency) {
          logAfterHoursRouting({
            event: "staff_notification",
            businessId: ctx.business.businessId,
            installedAgentId: ctx.business.installedAgentId ?? null,
            callId: ctx.callId ?? null,
            executionMode: ctx.executionMode ?? null,
            staffNotificationAttempted: true,
            outcome: teamSmsSent ? "sent" : "failed",
            callerPhone: customerPhone || null
          });
        }
      } catch (error) {
        console.error("[vapi-webhook] team SMS failed (non-fatal)", error);
        if (afterHoursUrgent && ctx.business.businessId && ctx.callId) {
          await updateAfterHoursStaffNotificationStatus(ctx.business.businessId, ctx.callId, "FAILED").catch(() => null);
        }
      }
    }

    const customerEmail = argStr(args, EMAIL_ARG_KEYS);
    const appointmentDate = argStr(args, ["appointment_date", "date"]) || "";
    const appointmentTime = argStr(args, ["appointment_time", "time"]) || "";
    const appointmentWhen = [appointmentDate, appointmentTime].filter(Boolean).join(" at ") || null;

    const emailNode = ctx.dental?.emailNode ?? null;
    const useNodeTemplate = Boolean(emailNode && (emailNode.bodyTemplate || emailNode.htmlTemplate));
    let templatedTeamHandled = false;

    if (useNodeTemplate && emailNode) {
      const templateVars: EmailTemplateVariables = {
        customerName: customerName || "",
        customerEmail: customerEmail || "",
        businessName: ctx.business.businessName,
        appointmentDate,
        appointmentTime,
        businessPhone: ctx.business.businessPhoneNumber || "",
        businessAddress: "",
        callSummary: ctx.summary || "",
        serviceName: service
      };

      const to =
        emailNode.recipientType === "team"
          ? TEAM_RECIPIENT
          : emailNode.recipientType === "custom"
            ? emailNode.customRecipient
            : emailNode.recipientType === "variable"
              ? resolveVariableRecipient(emailNode.recipientVariable, templateVars) ?? ""
              : customerEmail || "";

      if (!to) {
        console.log("[vapi-webhook] send_email node: no recipient resolved — skipped");
      } else if (emailNode.recipientType !== "team" && !customerEmailGate.allowed) {
        console.log("[vapi-webhook] send_email node: customer email blocked by after-hours gate", {
          code: customerEmailGate.allowed ? null : customerEmailGate.code,
          callId: ctx.callId ?? null
        });
      } else {
        const purpose =
          emailNode.purpose !== "auto"
            ? emailNode.purpose
            : emailNode.recipientType === "team"
              ? "INTERNAL_NOTIFICATION"
              : appointmentWhen
                ? "BOOKING_CONFIRMATION"
                : "CUSTOMER_FOLLOW_UP";
        const subject =
          fillEmailTemplate(emailNode.subjectTemplate, templateVars) ||
          (appointmentWhen
            ? `Appointment confirmation with ${ctx.business.businessName}`
            : `Message from ${ctx.business.businessName}`);
        const textBody = fillEmailTemplate(emailNode.bodyTemplate, templateVars);
        const htmlBody = emailNode.htmlTemplate
          ? sanitizeOutboundHtml(fillEmailTemplate(emailNode.htmlTemplate, templateVars))
          : undefined;
        const idempotencyKey = ctx.callId ? `send_email_node:${ctx.callId}:${to.toLowerCase()}` : null;

        try {
          const nodeResult = await enqueueEmail(
            {
              kind: "business_email",
              input: {
                businessId: ctx.business.businessId,
                to,
                cc: emailNode.cc,
                bcc: emailNode.bcc,
                subject,
                textBody: textBody || subject,
                htmlBody,
                purpose,
                idempotencyKey,
                metadata: { source: "send_email_node" }
              }
            },
            { idempotencyKey }
          );

          if (emailNode.recipientType === "team") {
            teamEmailSent = nodeResult.ok;
            templatedTeamHandled = nodeResult.ok;
          } else {
            customerEmailSent = nodeResult.ok;
          }

          if (!nodeResult.ok) {
            console.log(`[vapi-webhook] send_email node failed: ${nodeResult.error}`);
            if (emailNode.fallbackBehavior === "notify_team") {
              const fallbackKey = ctx.callId ? `send_email_fallback:${ctx.callId}` : null;
              await enqueueEmail(
                {
                  kind: "internal_notification",
                  input: {
                    businessId: ctx.business.businessId,
                    businessName: ctx.business.businessName,
                    purpose: "INTERNAL_NOTIFICATION",
                    idempotencyKey: fallbackKey,
                    fields: {
                      caller: customerName || null,
                      phone: customerPhone || null,
                      email: customerEmail || null,
                      requestedService: service,
                      summary: `Automated email could not be sent (${nodeResult.error ?? "unknown error"}).`,
                      nextAction: "Contact the customer manually"
                    }
                  }
                },
                { idempotencyKey: fallbackKey }
              ).catch(() => null);
            }
            if (!emailNode.continueOnFailure) {
              return {
                success: false,
                error: "email_failed",
                customer_sms_sent: customerSmsSent,
                team_sms_sent: teamSmsSent,
                customer_email_sent: false,
                team_email_sent: teamEmailSent,
                patient_sms_sent: customerSmsSent,
                dentist_sms_sent: teamSmsSent
              };
            }
          }
        } catch (error) {
          console.error("[vapi-webhook] send_email node error (non-fatal)", error);
        }
      }
    } else if (customerEmail && customerEmailGate.allowed) {
      try {
        // Vapi retries the same tool call on webhook timeouts — same call +
        // same recipient must never email twice.
        const idempotencyKey = ctx.callId
          ? `booking_confirmation:${ctx.callId}:${customerEmail.toLowerCase()}`
          : null;
        const emailResult = await enqueueEmail(
          {
            kind: "customer_follow_up",
            input: {
              businessId: ctx.business.businessId,
              customerEmail,
              customerName: customerName || null,
              businessName: ctx.business.businessName,
              serviceName: service,
              appointmentTime: appointmentWhen,
              idempotencyKey
            }
          },
          { idempotencyKey }
        );
        customerEmailSent = emailResult.ok;
        if (!emailResult.ok) console.log(`[vapi-webhook] customer email skipped: ${emailResult.error}`);
      } catch (error) {
        console.error("[vapi-webhook] customer email failed (non-fatal)", error);
      }
    }

    // The templated node email already covered the team when it targeted them.
    if (!templatedTeamHandled) try {
      const idempotencyKey = ctx.callId
        ? `internal_notification:${ctx.callId}:${appointmentDate}:${appointmentTime}`
        : null;
      const internalResult = await enqueueEmail(
        {
          kind: "internal_notification",
          input: {
            businessId: ctx.business.businessId,
            businessName: ctx.business.businessName,
            purpose: "INTERNAL_NOTIFICATION",
            idempotencyKey,
            fields: {
              caller: customerName || null,
              phone: customerPhone || null,
              email: customerEmail || null,
              requestedService: service,
              summary: ctx.summary || null,
              nextAction: appointmentWhen ? `Booking confirmed for ${appointmentWhen}` : "Follow up with the caller"
            }
          }
        },
        { idempotencyKey }
      );
      teamEmailSent = internalResult.ok;
      if (!internalResult.ok) console.log(`[vapi-webhook] internal email skipped: ${internalResult.error}`);
    } catch (error) {
      console.error("[vapi-webhook] internal email failed (non-fatal)", error);
    }
  }

  return {
    success: customerSmsSent || teamSmsSent || customerEmailSent || teamEmailSent,
    customer_sms_sent: customerSmsSent,
    customer_sms_blocked_reason: customerSmsBlockedReason,
    ...(customerSmsBlockedReason
      ? {
        message:
          "Customer SMS was not sent: no SMS consent on record (or the customer opted out). Do not promise a text. The booking itself is unaffected."
      }
      : {}),
    team_sms_sent: teamSmsSent,
    customer_email_sent: customerEmailSent,
    team_email_sent: teamEmailSent,
    patient_sms_sent: customerSmsSent,
    dentist_sms_sent: teamSmsSent
  };
}

function authorizeVapiWebhook(
  c: Context,
  body: Record<string, unknown>
): { authorized: boolean; reason: string; requiresArchitectSandbox?: boolean } {
  const secret = (env.VAPI_WEBHOOK_SECRET ?? "").trim();

  if (secret) {
    const bearer = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const vapiSecret = (c.req.header("x-vapi-secret") ?? "").trim();

    if (bearer === secret || vapiSecret === secret) {
      return { authorized: true, reason: "webhook secret match" };
    }
  }

  if (!isProduction) return { authorized: true, reason: "non-production" };

  const metadata = getVapiMetadata(body);
  if (metadata.purpose === "ARCHITECT_TEST") {
    return { authorized: true, reason: "architect test session (sandbox check pending)", requiresArchitectSandbox: true };
  }

  if (!secret) {
    console.error(
      "[vapi-webhook] VAPI_WEBHOOK_SECRET is not configured in production — rejecting unauthenticated webhook; no usage will be settled"
    );
    return { authorized: false, reason: "VAPI_WEBHOOK_SECRET missing in production" };
  }

  return { authorized: false, reason: "missing or invalid webhook secret" };
}

async function isArchitectSandboxBusiness(business: unknown): Promise<boolean> {
  const businessId = (business as { id?: unknown } | null)?.id;
  if (typeof businessId !== "string" || !businessId) return false;
  const sandboxAgent = await prisma.installedAgent.findFirst({
    where: { businessId, configJson: { path: ["purpose"], equals: "ARCHITECT_TEST" } },
    select: { id: true }
  });
  return Boolean(sandboxAgent);
}

function agentPurpose(configJson: unknown): string {
  const config =
    configJson && typeof configJson === "object" && !Array.isArray(configJson)
      ? (configJson as Record<string, unknown>)
      : {};
  return typeof config.purpose === "string" ? config.purpose : "";
}

export async function isSandboxExecutionBusiness(
  businessId: string,
  installedAgentId?: string
): Promise<boolean> {
  if (installedAgentId) {
    const agent = await prisma.installedAgent.findFirst({
      where: { id: installedAgentId, businessId },
      select: { configJson: true }
    });
    if (agent) return agentPurpose(agent.configJson) === "ARCHITECT_TEST";
  }

  const agents = await prisma.installedAgent.findMany({
    where: { businessId },
    select: { configJson: true }
  });
  if (agents.length === 0) return false;
  return agents.every((agent) => agentPurpose(agent.configJson) === "ARCHITECT_TEST");
}

export function resolveVapiCallExecutionMode(
  metadata: Record<string, unknown>,
  isSandboxBusiness: boolean,
  callType?: string
): "LIVE" | "ARCHITECT_DRY_RUN" | "BUSINESS_TEST" {
  const purpose = typeof metadata.purpose === "string" ? metadata.purpose : "";
  if (purpose === "ARCHITECT_TEST") return "ARCHITECT_DRY_RUN";
  if (purpose === "BUYER_SETUP_PREVIEW" || purpose === "MARKETPLACE_DEMO") return "BUSINESS_TEST";
  if ((callType ?? "").toLowerCase() === "webcall") return "BUSINESS_TEST";
  if (isSandboxBusiness) return "ARCHITECT_DRY_RUN";
  return "LIVE";
}

export async function handleVapiWebhook(c: Context) {
  const body = ((await parseBody(c).catch(() => ({}))) as Record<string, unknown>) ?? {};
  const toolCalls = getAllToolCalls(body);
  const receivedType = firstNestedString(body, [["message", "type"], ["type"]]) || "(unknown)";

  console.log("[vapi-webhook] received request", c.req.method, c.req.path);
  console.log("[vapi-webhook] received type", receivedType, `tools=${toolCalls.length}`);
  for (const toolCall of toolCalls) {
    console.log("[vapi-webhook] tool", toolCall.name, "args", JSON.stringify(redactForLog(toolCall.parameters)));
  }

  const auth = authorizeVapiWebhook(c, body);
  console.log("[vapi-webhook] authorized", auth.authorized ? "yes" : "no", `(${auth.reason})`);

  if (!auth.authorized) {
    console.log("[vapi-webhook] response status", 401, "(unauthorized)");
    return c.json({ success: false, error: "Unauthorized", code: "VAPI_WEBHOOK_UNAUTHORIZED" }, 401);
  }



  try {
    const metadata = getVapiMetadata(body);
    const business = await findBusinessByVapiWebhook(body);

    if (auth.requiresArchitectSandbox && !(business && (await isArchitectSandboxBusiness(business)))) {
      console.log("[vapi-webhook] response status", 401, "(architect-test purpose without sandbox business)");
      return c.json({ success: false, error: "Unauthorized", code: "VAPI_WEBHOOK_UNAUTHORIZED" }, 401);
    }

    const businessContext = business ? buildBusinessContext(business) : null;
    const metadataInstalledAgentId =
      typeof metadata.installedAgentId === "string" ? metadata.installedAgentId : undefined;
    const sandboxBusiness = businessContext?.businessId
      ? await isSandboxExecutionBusiness(businessContext.businessId, metadataInstalledAgentId)
      : false;
    const callType = firstNestedString(body, [["message", "call", "type"], ["call", "type"]]);
    const executionMode = resolveVapiCallExecutionMode(metadata, sandboxBusiness, callType);
    const callId = firstNestedString(body, [["message", "call", "id"], ["call", "id"], ["id"]]);
    const customerPhone =
      firstNestedString(body, [["message", "call", "customer", "number"], ["call", "customer", "number"]]) ||
      (typeof metadata.customerPhone === "string" ? metadata.customerPhone : "");
    const conversationId = typeof metadata.conversationId === "string" ? metadata.conversationId : undefined;
    const messageType = firstNestedString(body, [["message", "type"], ["type"]]);
    const summary = firstNestedString(body, [["message", "summary"], ["summary"]]);
    const transcript =
      firstNestedString(body, [["message", "transcript"], ["transcript"]]) ||
      extractStructuredCallTurns(body)
        .map((turn) => `${turn.role === "assistant" ? "AI" : "User"}: ${turn.content}`)
        .join("\n");

    const agentPaused = businessContext?.businessId
      ? await isVapiInstalledAgentPaused(businessContext.businessId, metadataInstalledAgentId)
      : false;

    const existingCallRow =
      agentPaused && callId
        ? await prisma.vapiCall.findUnique({ where: { callId }, select: { id: true } }).catch(() => null)
        : null;

    if (agentPaused && !existingCallRow) {
      console.log("[vapi-webhook] response status", 200, "(agent paused — blocked attempt, nothing recorded)");
      if (toolCalls.length === 0) return c.json({ ok: true, paused: true });

      return c.json({
        results: toolCalls.map((toolCall) => ({
          name: toolCall.name,
          toolCallId: toolCall.id,
          result: JSON.stringify({
            success: false,
            code: "AGENT_PAUSED",
            message: "This agent is paused. No workflow action was performed."
          })
        }))
      });
    }

    // Best-effort call logging — never blocks a tool response.
    if (businessContext?.businessId && callId) {
      try {
        await prisma.vapiCall.upsert({
          where: { callId },
          update: {
            status: messageType || "UPDATED",
            executionMode,
            transcript: transcript || undefined,
            summary: summary || undefined,
            endedAt: /end|ended|report/.test(messageType) ? new Date() : undefined,
            metadataJson: body as never
          },
          create: {
            businessId: businessContext.businessId,
            installedAgentId: metadataInstalledAgentId,
            conversationId,
            callId,
            customerPhone,
            executionMode,
            status: messageType || "STARTED",
            transcript: transcript || null,
            summary: summary || null,
            metadataJson: body as never
          }
        });
      } catch (error) {
        console.error("[vapi-webhook] vapiCall.upsert failed (non-fatal)", error);
      }
    }

    const isEndOfCallEvent = /end-of-call-report|end|ended|report/i.test(messageType ?? "");
    const settleLiveEndOfCall = async () => {
      if (!businessContext?.businessId || !callId || executionMode !== "LIVE" || !isEndOfCallEvent) return;

      try {
        const installedAgent = metadataInstalledAgentId
          ? await prisma.installedAgent.findFirst({
            where: { id: metadataInstalledAgentId, businessId: businessContext.businessId },
            select: { id: true, workflowId: true }
          })
          : await latestActiveInstalledAgent(businessContext.businessId);

        await recordVapiCallUsage({
          businessId: businessContext.businessId,
          installedAgentId: installedAgent?.id,
          callId,
          customerPhone,
          webhookBody: body
        });

        if (installedAgent?.workflowId) {
          await prisma.workflowRun.upsert({
            where: { callProvider_externalCallId: { callProvider: "VAPI", externalCallId: callId } },
            update: { status: "COMPLETED", finishedAt: new Date() },
            create: {
              workflowId: installedAgent.workflowId,
              installedAgentId: installedAgent.id,
              businessId: businessContext.businessId,
              mode: "LIVE",
              status: "COMPLETED",
              callProvider: "VAPI",
              externalCallId: callId,
              finishedAt: new Date(),
              inputJson: { source: "vapi_end_of_call", callId }
            }
          });
        }
      } catch (error) {
        console.error("[vapi-webhook] USAGE SETTLEMENT FAILED — needs reconciliation", {
          callId,
          businessId: businessContext.businessId,
          error: error instanceof Error ? error.message : error
        });
      }
    };

    const clearAfterHoursOnCallEnd = async () => {
      if (executionMode === "LIVE" && isEndOfCallEvent) {
        await endLiveAfterHoursCall(businessContext?.businessId, callId);
      }
    };

    if (toolCalls.length === 0) {
      await settleLiveEndOfCall();
      await clearAfterHoursOnCallEnd();

      if (businessContext?.businessId && /end|ended|report/.test(messageType) && (summary || transcript)) {
        enqueueEmail(
          {
            kind: "internal_notification",
            input: {
              businessId: businessContext.businessId,
              businessName: businessContext.businessName,
              purpose: "CALL_SUMMARY",
              idempotencyKey: callId ? `call_summary:${callId}:business-email` : null,
              fields: {
                caller: null,
                phone: customerPhone || null,
                email: null,
                requestedService: null,
                summary: summary || transcript?.slice(0, 2000) || null,
                nextAction: "Review the call summary and follow up if needed"
              }
            }
          },
          { idempotencyKey: callId ? `call_summary:${callId}:business-email` : null }
        )
          .then((result) => {
            if (!result.ok) console.log(`[vapi-webhook] call summary email skipped: ${result.error}`);
          })
          .catch((error) => console.error("[vapi-webhook] call summary email failed (non-fatal)", error));
      }

      console.log("[vapi-webhook] response status", 200, agentPaused ? "(non-tool event, paused settle)" : "(non-tool event)");
      return c.json(agentPaused ? { ok: true, paused: true } : { ok: true });
    }

    await settleLiveEndOfCall();

    if (agentPaused) {
      await clearAfterHoursOnCallEnd();
      console.log("[vapi-webhook] response status", 200, "(agent paused — tools blocked)");
      return c.json({
        results: toolCalls.map((toolCall) => ({
          name: toolCall.name,
          toolCallId: toolCall.id,
          result: JSON.stringify({
            success: false,
            code: "AGENT_PAUSED",
            message: "This agent is paused. No workflow action was performed."
          })
        }))
      });
    }

    const afterHoursGate = await resolveLiveAfterHoursGateContext({
      businessId: businessContext?.businessId,
      installedAgentId: metadataInstalledAgentId,
      callId,
      executionMode,
      body
    });

    const dental = businessContext?.businessId ? await loadDentalToolConfig(businessContext.businessId) : null;
    const baseCtx: VapiToolContext = {
      business: businessContext,
      dental,
      timeZone: dental?.testTimeZone || businessContext?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      customerPhone,
      patientPhone: customerPhone,
      conversationId,
      callId: callId || undefined,
      summary,
      transcript,
      executionMode,
      installedAgentId: metadataInstalledAgentId,
      afterHours: afterHoursGate,
      callTurns: extractStructuredCallTurns(body),
      voicePipeline: metadataInstalledAgentId
        ? await prisma.installedAgent
          .findUnique({ where: { id: metadataInstalledAgentId }, select: { configJson: true } })
          .then((row) => parseStoredVoicePipeline(row?.configJson))
          .catch(() => null)
        : null
    };

    const results: Array<{ name: string; toolCallId: string; result: string }> = [];
    for (const toolCall of toolCalls) {
      const fnName = toolCall.name.toLowerCase().replace(/[^a-z]/g, "");
      const isConsent = fnName.includes("consent");
      const isLookup = !isConsent && (fnName.includes("knowledge") || fnName.startsWith("lookup"));
      const isUpdateContact =
        !isConsent && !isLookup && fnName.includes("update") && fnName.includes("contact");
      const isCancel = !isConsent && !isLookup && !isUpdateContact && fnName.includes("cancel");
      const isReschedule = !isConsent && !isLookup && !isCancel && fnName.includes("resched");
      const isVerify = !isConsent && !isLookup && !isUpdateContact && !isCancel && !isReschedule && fnName.includes("verify");
      const isCheck = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && (fnName.startsWith("check") || fnName.includes("availab"));
      const isBook = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && fnName.startsWith("book");
      const isNotify = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && (fnName.startsWith("send") || fnName.includes("notif"));
      const ctx: VapiToolContext = {
        ...baseCtx,
        patientPhone: argStr(toolCall.parameters, PHONE_ARG_KEYS) || customerPhone
      };

      const gatedAction = isCheck
        ? ("check_availability" as const)
        : isBook || isCancel || isReschedule || isVerify
          ? ("book_appointment" as const)
          : null;
      const afterHoursBlock = gatedAction ? gateLiveAfterHoursAction(afterHoursGate, gatedAction) : { allowed: true as const };

      let payload: unknown;
      let afterHoursBlocked = false;
      let callStateUnavailable = false;
      if (!afterHoursBlock.allowed) {
        afterHoursBlocked = true;
        payload = { success: false, code: afterHoursBlock.code, message: afterHoursBlock.message };
        logAfterHoursRouting({
          event: "live_tool_blocked",
          businessId: businessContext?.businessId ?? null,
          installedAgentId: metadataInstalledAgentId ?? null,
          callId,
          route: afterHoursGate.state?.route ?? null,
          executionMode,
          outcome: afterHoursBlock.code,
          callerPhone: customerPhone || null
        });
      } else
        try {
          if (isConsent) payload = await runRecordSmsConsentTool(toolCall.parameters, ctx);
          else if (isLookup) payload = await runLookupKnowledgeTool(toolCall.parameters, ctx);
          else if (isUpdateContact) payload = await runUpdateAppointmentContactTool(toolCall.parameters, ctx);
          else if (isCancel) payload = await runCancelAppointmentTool(toolCall.parameters, ctx);
          else if (isReschedule) payload = await runRescheduleAppointmentTool(toolCall.parameters, ctx);
          else if (isVerify) payload = await runVerifyAndLookupAppointmentTool(toolCall.parameters, ctx);
          else if (isCheck) payload = await runCheckAvailabilityTool(toolCall.parameters, ctx);
          else if (isBook) payload = await runBookAppointmentTool(toolCall.parameters, ctx);
          else if (isNotify) payload = await runSendNotificationTool(toolCall.parameters, ctx);
          else payload = { ok: true };
        } catch (error) {
          // #8 Distributed call state unavailable → deterministic fail-closed
          // response (never an unhandled 500). The assistant must not book,
          // change a number, record consent, or send anything.
          if (error instanceof CallStateUnavailableError) {
            console.error(`[vapi-webhook] distributed call state unavailable — failing closed`, {
              tool: toolCall.name,
              callId
            });
            // This payload is already caller-safe; do NOT run it back through
            // the per-tool AI-safe transforms, which would strip `code` and the
            // fail-closed instructions.
            callStateUnavailable = true;
            payload = {
              success: false,
              code: "CALL_STATE_UNAVAILABLE",
              cancelled: false,
              rescheduled: false,
              consent_recorded: false,
              updated: false,
              sms_allowed: false,
              customerSpeechCode: "SYSTEM_UNAVAILABLE",
              customerSafeMessage:
                "I'm sorry, our booking system is briefly unavailable. I can't confirm or change anything right now.",
              message:
                "Distributed call state is unavailable. Do NOT book, update a phone number, record consent, or send any text. Apologize briefly, take the caller's name and callback number, and tell them the team will follow up."
            };
          } else {
            console.error(`[vapi-webhook] tool ${toolCall.name} failed (returning safe result)`, error);
            payload = isLookup
              ? { found: false, sections: [], message: "Knowledge lookup is unavailable right now. Use the business context you already have or the fallback response." }
              : isCheck
                ? { available_slots: dryRunAvailabilitySlots(ctx.dental), date: todayInZone(ctx.timeZone), source: "demo", calendar_status: "needs_reconnect" }
                : isBook
                  ? { success: false, message: "Could not complete the booking right now. Please try again." }
                  : isConsent
                    ? { success: false, consent_recorded: false, message: "Could not record consent. Do not send texts." }
                    : isCancel
                      ? { cancelled: false, code: "CANCELLATION_FAILED", message: CANCEL_FAILED_MESSAGE }
                      : isReschedule
                        ? { rescheduled: false, code: "RESCHEDULE_FAILED", message: RESCHEDULE_FAILED_MESSAGE }
                        : { success: false };
          }
        }

      if (payload && typeof payload === "object" && !afterHoursBlocked && !callStateUnavailable) {
        if (isCheck) payload = toAiSafeAvailabilityResult(payload as Record<string, unknown>);
        else if (isBook) payload = toAiSafeBookingResult(payload as Record<string, unknown>);
        else if (isCancel || isReschedule) {
          payload = toAiSafeAppointmentActionResult(payload as Record<string, unknown>);
        }
      }

      results.push({
        name: toolCall.name,
        toolCallId: toolCall.id,
        result: typeof payload === "string" ? payload : JSON.stringify(payload)
      });
    }

    // Mixed end-of-call payload: state clears after tools were processed.
    await clearAfterHoursOnCallEnd();

    console.log("[vapi-webhook] response status", 200, `results=${results.length}`);
    if (!isProduction) {
      // Names/sizes only — result payloads can carry caller-provided details.
      console.log("[vapi-webhook] response tools", results.map((r) => `${r.name}(${r.result.length}b)`).join(", "));
    }
    return c.json({ results });
  } catch (error) {
    // Last-resort guard: never reject a tool call with a 5xx/AggregateError.
    console.error("[vapi-webhook] error", error);
    console.log("[vapi-webhook] response status", 200, "(safe fallback results)");
    if (toolCalls.length === 0) return c.json({ ok: true });
    return c.json({
      results: toolCalls.map((toolCall) => ({
        name: toolCall.name,
        toolCallId: toolCall.id,
        result: JSON.stringify({ success: false, message: "Temporary issue handling the request." })
      }))
    });
  }
}
