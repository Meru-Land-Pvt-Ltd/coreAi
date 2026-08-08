import { Hono, type Context } from "hono";
import { z } from "zod";
import { formatKnowledgeEntries, retrieveRelevantKnowledge } from "./agent-knowledge";
import { calendarEventTitleForMode,
  AFTER_HOURS_CONTACT_METHODS,
  AFTER_HOURS_CONTACT_METHOD_UNSUPPORTED,
  AFTER_HOURS_EMERGENCY_CATEGORIES,
  deriveSetupVisibility,
  getSetupValidationPlan,
  isBuyerAnswerEmpty,
  isSupportedAfterHoursContactMethod,
  normalizeAfterHoursPolicy,
  normalizeBuyerSetupFields,
  normalizeTimeZone,
  requiredConnectorsForWorkflow,
  resolveSimulatedHoursState,
  validateBuyerSetupAnswers,
  workflowUsesVoice,
  getWorkflowTriggerKind,
  type ConnectorRequirement
} from "@coreai/shared";
import { env, isProduction } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { apiErrorStatus, errorMessage, isRecord } from "../../lib/error-utils";
import {
  findPhoneCountry,
  listPhoneCities,
  listPhoneCountries,
  listPhoneStates,
  supportsLocalityFilter
} from "../../lib/phone-locations";
import { PhoneNumberServiceError } from "../admin/twilio-number-service";
import { assignPlatformNumber } from "./phone-assignment";
import {
  getAgentPhoneAssignment,
  listBusinessPhoneAssignments,
  listUnassignedBusinessNumbers,
  getProvisioningRequestStatus,
  purchaseNumberForBusiness,
  searchNumbersForBusiness
} from "./phone-provisioning-flow";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createGmailOAuthUrl,
  disconnectGmail,
  getGmailConnectionStatus
} from "../architect/gmail-connector";
import {
  createCalendlyOAuthUrl,
  disconnectCalendly,
  getCalendlyConnectionStatus,
  listCalendlyEventTypeOptions
} from "../calendly/calendly-connector";
import { WhatsAppService } from "../whatsapp/service";
import { WhatsAppServiceError } from "../whatsapp/types";
import {
  RECEPTIONIST_WORKFLOW_DESCRIPTION,
  RECEPTIONIST_WORKFLOW_NAME,
  buildReceptionistWorkflowJson
} from "./receptionist-template";
import {
  createCheckoutSession,
  getBillingStatus,
  handleStripeWebhook
} from "./billing";
import {
  getBusinessExecutionInvoices,
  getBusinessExecutionUsage,
  payBusinessExecutionInvoice
} from "./execution-usage-routes";
import { getCallRoutingDiagnostics } from "../architect/twilio-business-routing";
import { resolveTwilioSmsMode, validateSmsRecipientE164 } from "../architect/twilio-connector";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import { Prisma, InstalledAgent } from "@prisma/client";
import { canBusinessDeployAgent } from "./deployment-access";
import { resolvePrimaryBusinessId } from "./primary-business";
import { GOOGLE_CALENDAR_INTEGRATION } from "@coreai/shared";
import {
  DisclosureConsentError,
  hasFreshDisclosureConsent,
  recordDisclosureConsent
} from "../compliance/disclosure-consent";
import { canBusinessRunSetup, hasAnyAgentAcquisition } from "./purchase-access";
import { transcribeWithDeepgram, speakWithDeepgram } from "../ai-provider-engine/deepgram-stt";
import { extractHoursFromDocuments, resolveScheduleForBusiness } from "./scheduling";
import { addressesMateriallyDiffer, extractAddressFromDocuments, loadBusinessFacts } from "./business-facts";
import { extractProfileFromDocuments, invalidateDocumentProfileCache } from "./document-profile-extractor";
import {
  KnowledgeFileError,
  MAX_FILE_BYTES,
  deleteKnowledgeFile,
  ingestKnowledgeFiles,
  replaceManualKnowledge,
  listKnowledgeFiles,
  reprocessKnowledgeFile,
  extractDocumentText,
  type KnowledgeFileKind
} from "./knowledge-files";
import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import { MarketplaceDemoError, startMarketplaceDemoCall } from "./marketplace-demo";
import {
  buildInstalledAgentChatTestSetup,
  deployInstalledAgentVoiceAssistant,
  refreshLiveAssistantKnowledge,
  SetupPreviewCallError,
  startInstalledAgentPreviewCall
} from "./deploy";
import { buildAfterHoursSnapshotForBusiness } from "./after-hours-state";
import { runArchitectConversationTest } from "../architect/workflow-conversation-test";
import { runWorkflowTest } from "../architect/workflow-runner";
import { deleteTestCalendarEvent } from "../architect/test-calendar-events";
import { ensureBusinessAndAgent, loadOwnedListing } from "../setup/routes";
import {
  findBuyerPlatformNumber,
  getPhoneNumberFeeForPlatformNumber,
  workflowNeedsPhoneNumber
} from "./phone-provisioning";
import {
  addPhoneNumberFeeToPendingInvoiceTx
} from "./phone-number-invoice";
import {
  createOrUpdateBusinessEmailAlias,
  generateSuggestedAlias,
  getBusinessEmailAlias,
  isLocalPartAvailable,
  isSesConfigured,
  isValidEmailAddress,
  normalizeEmailAliasLocalPart,
  sendBusinessEmail,
  validateLocalPart
} from "../email/ses-mail-service";
import { extractBuyerEmailRecipients, parseEmailList } from "../email/email-node-config";
import {
  buildDashboardActivities,
  sumInvoiceTotalCents
} from "../../lib/billing-invoices";
import { businessSettingsRoutes } from "./settings-routes";
import { businessOnboardingRoutes } from "./onboarding-routes";
import { businessHoursRoutes } from "./business-hours";
import { fetchVapiCallById, isPresignedRecordingUrl } from "../architect/vapi-connector";
import { updateBusinessSpendingAlert } from "./spending-alert";
import {
  connectTelegramManualBot,
  createTelegramOwnerAuthorization,
  disconnectTelegramBot,
  getTelegramConnectionStatus,
  refreshTelegramConnectionHealth,
  sendTelegramConnectionTest,
  TelegramConnectorError,
  updateTelegramBusinessSettings
} from "../architect/telegram-connector";

export const businessRoutes = new Hono();

/** Phone columns that exist before phone_number_inventory_metadata migration. */
const businessPhoneNumberLegacySelect = {
  id: true,
  businessId: true,
  installedAgentId: true,
  phoneNumber: true,
  twilioPhoneNumberSid: true,
  forwardToPhone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

const WEEKDAY_INDEX_BY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

/** Machine marker written into appointment notes on reschedule. */
const PREV_WINDOW_MARKER_RE = /\[prevWindow:([^/\]]+)\/([^\]]+)\]/i;

function formatScheduleLabel(startAt: Date, endAt: Date, timeZone?: string | null): string {
  const optionsBase: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    ...optionsBase,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(startAt);
  const startClock = new Intl.DateTimeFormat("en-US", {
    ...optionsBase,
    hour: "numeric",
    minute: "2-digit"
  }).format(startAt);
  const endClock = new Intl.DateTimeFormat("en-US", {
    ...optionsBase,
    hour: "numeric",
    minute: "2-digit"
  }).format(endAt);
  return `${dateLabel} · ${startClock} – ${endClock}`;
}

function extractMarkedPreviousWindow(notes: string | null): { previousStartAt: Date; previousEndAt: Date } | null {
  if (!notes) return null;
  const match = notes.match(PREV_WINDOW_MARKER_RE);
  if (!match) return null;
  const previousStartAt = new Date(match[1]!);
  const previousEndAt = new Date(match[2]!);
  if (Number.isNaN(previousStartAt.getTime()) || Number.isNaN(previousEndAt.getTime())) return null;
  return { previousStartAt, previousEndAt };
}

function extractPreviousBookingTime(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/rescheduled by the customer.*? from (.+?) to .+?(?:\.|$)/i);
  return match?.[1]?.trim() ?? null;
}

function weekdayIndexFromShortName(weekday: string): number {
  const key = weekday.toLowerCase();
  if (key.startsWith("sun")) return 0;
  if (key.startsWith("mon")) return 1;
  if (key.startsWith("tue")) return 2;
  if (key.startsWith("wed")) return 3;
  if (key.startsWith("thu")) return 4;
  if (key.startsWith("fri")) return 5;
  return 6;
}

function parseWeekdayTimeLabel(
  label: string,
  referenceStartAt: Date,
  durationMs: number,
  timeZone?: string | null
): { previousStartAt: Date; previousEndAt: Date } | null {
  const match = label.match(
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!match) return null;

  const [, weekdayNameRaw, hourRaw, minuteRaw, meridiemRaw] = match;
  const weekdayIndex = WEEKDAY_INDEX_BY_NAME[weekdayNameRaw!.toLowerCase()];
  if (weekdayIndex == null) return null;

  const tz = timeZone || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(referenceStartAt);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const currentWeekday = weekdayIndexFromShortName(part("weekday"));
  const dayDelta = (currentWeekday - weekdayIndex + 7) % 7 || 7;

  const inputHour = Number(hourRaw) % 12;
  const minutes = Number(minuteRaw);
  const normalizedHour = meridiemRaw!.toUpperCase() === "PM" ? inputHour + 12 : inputHour;

  // Approximate wall-clock in timezone, then correct by measured offset.
  const tentative = new Date(Date.UTC(year, month - 1, day - dayDelta, normalizedHour, minutes, 0, 0));
  const asParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(tentative);
  const asValue = (type: Intl.DateTimeFormatPartTypes) =>
    Number(asParts.find((entry) => entry.type === type)?.value ?? "0");
  const desiredAsUtc = Date.UTC(year, month - 1, day - dayDelta, normalizedHour, minutes, 0, 0);
  const actualAsUtc = Date.UTC(
    asValue("year"),
    asValue("month") - 1,
    asValue("day"),
    asValue("hour"),
    asValue("minute"),
    0,
    0
  );
  const previousStartAt = new Date(tentative.getTime() + (desiredAsUtc - actualAsUtc));
  const previousEndAt = new Date(previousStartAt.getTime() + Math.max(durationMs, 0));
  return { previousStartAt, previousEndAt };
}

function parsePreviousBookingWindow(params: {
  notes: string | null;
  startAt: Date;
  endAt: Date;
  timeZone?: string | null;
}): { previousStartAt: string; previousEndAt: string; previousScheduleLabel: string } | null {
  const durationMs = Math.max(params.endAt.getTime() - params.startAt.getTime(), 0);
  const marked = extractMarkedPreviousWindow(params.notes);
  const fromLabel = !marked
    ? (() => {
        const previousLabel = extractPreviousBookingTime(params.notes);
        if (!previousLabel) return null;
        return parseWeekdayTimeLabel(previousLabel, params.startAt, durationMs, params.timeZone);
      })()
    : null;
  const window = marked ?? fromLabel;
  if (!window) return null;
  return {
    previousStartAt: window.previousStartAt.toISOString(),
    previousEndAt: window.previousEndAt.toISOString(),
    previousScheduleLabel: formatScheduleLabel(window.previousStartAt, window.previousEndAt, params.timeZone)
  };
}

/** "inbound" | "outbound" from the stored Vapi webhook body; inbound when unknown. */
function vapiCallDirection(metadataJson: unknown): "inbound" | "outbound" {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return "inbound";
  const body = metadataJson as Record<string, unknown>;

  const candidates: unknown[] = [];
  const message = body.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    candidates.push((message as Record<string, unknown>).call);
  }
  candidates.push(body.call, body);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const type = (candidate as Record<string, unknown>).type;
    if (typeof type === "string" && /outbound/i.test(type)) return "outbound";
  }
  return "inbound";
}

function includeActivePhoneNumbers(options?: { take?: number }) {
  return {
    where: { isActive: true as const },
    orderBy: { createdAt: "desc" as const },
    select: businessPhoneNumberLegacySelect,
    ...(options?.take ? { take: options.take } : {})
  };
}

const BUSINESS_SETTINGS_INTEGRATIONS_PATH = "/business/setting?tab=integrations";
const DEFAULT_ASSISTANT_NAME = "AI Assistant";

businessRoutes.post("/billing/webhook", handleStripeWebhook);

businessRoutes.use("*", requireAuth);
businessRoutes.use("*", requireRole(["BUSINESS"]));

businessRoutes.post("/billing/checkout", createCheckoutSession);
businessRoutes.get("/billing/status", getBillingStatus);

const telegramBotSetupSchema = z.object({
  botDisplayName: z.string().trim().min(1, "Bot name is required").max(64)
});

const telegramManualSetupSchema = telegramBotSetupSchema.extend({
  botToken: z
    .string()
    .trim()
    .min(20, "Enter the token provided by BotFather")
    .max(256)
});

export const telegramBusinessSettingsSchema = z.object({
  botDisplayName: z.string().trim().min(1, "Bot name is required").max(64),
  telegramWelcomeMessage: z.string().trim().max(4096),
  telegramFallbackMessage: z.string().trim().max(4096),
  telegramBookingMode: z.boolean(),
  telegramServicesCommand: z.boolean(),
  telegramBookCommand: z.boolean(),
  telegramMyBookingsCommand: z.boolean(),
  telegramRescheduleCommand: z.boolean(),
  telegramCancelCommand: z.boolean(),
  telegramHelpCommand: z.boolean(),
  telegramCustomCommands: z.array(z.object({
    command: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,32}$/, "Use 1-32 lowercase letters, numbers, or underscores for a custom command"),
    description: z.string().trim().max(256).default(""),
    action: z.enum(["reply", "services", "book", "help"]),
    response: z.string().trim().max(4096)
  }).superRefine((command, context) => {
    if (command.action === "reply" && !command.response && command.command !== "commands") {
      context.addIssue({ code: "custom", message: `Add the bot reply for /${command.command}.`, path: ["response"] });
    }
    if (command.command === "start") {
      context.addIssue({ code: "custom", message: `/${command.command} is a fixed Telegram command and cannot be re-defined.`, path: ["command"] });
    }
  })).max(20).superRefine((commands, context) => {
    const seen = new Set<string>();
    commands.forEach((command, index) => {
      if (seen.has(command.command)) {
        context.addIssue({ code: "custom", message: `/${command.command} is duplicated.`, path: [index, "command"] });
      }
      seen.add(command.command);
    });
  }),
  services: z.array(z.string().trim().min(1).max(120)).max(30),
  telegramRequestPhone: z.boolean(),
  telegramRequestEmail: z.boolean(),
  telegramRequestNotes: z.boolean()
});

businessRoutes.get("/agents/:installedAgentId/telegram/status", async (c) => {
  const authUser = c.get("authUser");
  const status = await getTelegramConnectionStatus(
    authUser.id,
    c.req.param("installedAgentId")
  );
  return successResponse(c, status);
});

businessRoutes.post("/agents/:installedAgentId/telegram/settings", async (c) => {
  const authUser = c.get("authUser");
  const parsed = telegramBusinessSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message || "Invalid Telegram bot settings.",
      422,
      "VALIDATION_ERROR"
    );
  }
  try {
    const { botDisplayName, services, ...telegramSettings } = parsed.data;
    const bookingEnabled =
      parsed.data.telegramBookingMode ||
      parsed.data.telegramBookCommand ||
      parsed.data.telegramMyBookingsCommand ||
      parsed.data.telegramRescheduleCommand ||
      parsed.data.telegramCancelCommand;
    return successResponse(
      c,
      await updateTelegramBusinessSettings({
        ownerId: authUser.id,
        installedAgentId: c.req.param("installedAgentId"),
        botDisplayName,
        services,
        settings: {
          ...telegramSettings,
          telegramBookingMode: bookingEnabled,
          // Phone is the stable booking lookup key and is required by the
          // appointment/calendar persistence model whenever booking is on.
          telegramRequestPhone: bookingEnabled
            ? true
            : parsed.data.telegramRequestPhone
        }
      }),
      "Telegram bot settings saved."
    );
  } catch (error) {
    const status = error instanceof TelegramConnectorError ? error.status : 500;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Telegram bot settings could not be saved.",
      apiErrorStatus(status, 500),
      error instanceof TelegramConnectorError ? error.code : "TELEGRAM_SETTINGS_FAILED"
    );
  }
});

businessRoutes.post("/agents/:installedAgentId/telegram/generate-commands", async (c) => {
  const authUser = c.get("authUser");
  const installedAgentId = c.req.param("installedAgentId");
  const agent = await prisma.installedAgent.findFirst({
    where: {
      id: installedAgentId,
      business: { ownerId: authUser.id }
    },
    include: {
      business: {
        include: {
          profile: true
        }
      }
    }
  });

  if (!agent) {
    return errorResponse(c, "Agent not found or unauthorized.", 404, "AGENT_NOT_FOUND");
  }

  let businessInfo = "";
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    businessInfo = typeof body.businessInfo === "string" ? body.businessInfo : "";

    const file = body.file;
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const filename = (file as any).name || "uploaded_file.txt";
      const ext = filename.split(".").pop()?.toLowerCase();
      
      const fileBytes = Buffer.from(await (file as any).arrayBuffer());
      
      let kind: KnowledgeFileKind | undefined;
      if (ext === "pdf" || ext === "docx" || ext === "txt") {
        kind = ext as KnowledgeFileKind;
      }
      
      if (kind) {
        try {
          const parsed = await extractDocumentText(kind, fileBytes);
          businessInfo += "\n\nExtracted content from file " + filename + ":\n" + parsed.text;
        } catch (err) {
          console.warn("[telegram-generation] failed to extract file content", err);
        }
      }
    }
  } else {
    const body = await c.req.json().catch(() => null);
    businessInfo = body?.businessInfo || "";
  }

  if (!businessInfo.trim()) {
    const profile = agent.business.profile;
    const services = profile?.services || [];
    const faqs = Array.isArray(profile?.faqsJson) ? profile.faqsJson : [];
    businessInfo = `Business Name: ${agent.business.name}\n` +
      `Business Type: ${agent.business.type || "Service Business"}\n` +
      (services.length > 0 ? `Services Offered: ${services.join(", ")}\n` : "") +
      (faqs.length > 0 ? `FAQs:\n${faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join("\n")}\n` : "");
  }

  if (!businessInfo.trim()) {
    return errorResponse(c, "Please provide business info or upload a document to analyze.", 400, "BAD_REQUEST");
  }

  try {
    const systemPrompt = `You are an expert AI system that analyzes business details and generates optimized Telegram commands for a customer assistant bot.
Analyze the business details provided. Generate a JSON object containing:
1. "welcomeMessage": A friendly, helpful welcome message for the bot. Do not use emojis.
2. "fallbackMessage": A fallback message when the bot doesn't understand a message. Do not use emojis.
3. "commands": An array of up to 7 commands. Each command has:
   - "command": lowercase alphanumeric command name (e.g. "services", "doctors", "team", "book", "hours", "contact", "pricing", "location", "insurance", "faq"). Do not include leading slash. Do not include "start" or "help" or "commands" as they are reserved/automatic.
   - "description": A brief explanation of the command for the Telegram menu. Do not use emojis.
   - "action": "reply" (for static responses) or "book" (for dynamic AI actions).
   - "response": 
     - If action is "reply", this must be the exact, fully detailed static response text. Do not use emojis. Use clean, professional plain text formatting.
     - If action is "book", this must be custom instructions for the AI on how to handle the request (e.g., "Guide the user to book a dental cleaning, ask for name/phone, and check availability").

CRITICAL FORMATTING & INFORMATION SEPARATION RULES:
1. ABSOLUTELY NO EMOJIS. Keep all responses formal, professional, and clean.
2. DEDICATED COMMANDS FOR SEPARATE CONCEPTS:
   - If there are doctors, practitioners, or team members in the text, you MUST generate a dedicated "doctors" or "team" command listing them (e.g. "• Dr. Emily Carter: Specialist in Orthodontics"). Do NOT mix doctor names into the "services" command response.
   - The "services" command response must ONLY list SERVICE CATEGORIES (not individual service items). Group all individual services under their parent category. Each bullet must be: "• Category Name: Service 1, Service 2, Service 3". ALL services from the document must be included under the correct category. Do not omit any.
   - Example for a dental clinic services response:
     Our dental services:
     • Preventive Dentistry: Dental Exams, Professional Cleaning, Fluoride Treatment, Sealants, Oral Cancer Screening
     • Cosmetic Dentistry: Teeth Whitening, Porcelain Veneers, Smile Design, Cosmetic Bonding
     • Restorative Dentistry: Tooth-Colored Fillings, Dental Crowns, Dental Bridges, Root Canal Treatment, Dentures
     • Orthodontics: Invisalign, Clear Aligners, Retainers
     • Oral Surgery: Tooth Extraction, Wisdom Tooth Removal, Dental Implants
     • Pediatric Dentistry: Children's Exams, Fluoride Treatment, Fillings
   - NEVER list individual services as their own bullet points. Always group under a named category.
   - Do not mix unrelated concepts (hours, address, doctor profiles) in a single response. Each command response must stay focused on its topic.
3. For FAQ command: each bullet must be "• Question: Answer" format.
4. For doctors/team command: each bullet must be "• Name: Role or Specialization" format.
5. Use structured grouped lists for all multi-item responses.

Format the output strictly as a JSON object matching this schema:
{
  "welcomeMessage": string,
  "fallbackMessage": string,
  "commands": Array<{
    "command": string,
    "description": string,
    "action": "reply" | "book",
    "response": string
  }>
}`;

    const engine = getProviderEngine();
    const response = await engine.executeAI({
      systemPrompt,
      messages: [{ role: "user", content: `Generate Telegram bot configuration for this business information:\n\n${businessInfo}` }],
      outputFormat: "json",
      temperature: 0.1
    });

    if (response.status !== "success" || !response.text) {
      throw new Error(response.error || "Failed to generate commands from LLM.");
    }

    let cleanJson = response.text.trim();
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```[a-zA-Z]*\s*/, "");
      cleanJson = cleanJson.replace(/\s*```$/, "");
    }
    const data = JSON.parse(cleanJson.trim());
    return successResponse(c, data);
  } catch (err) {
    console.error("[telegram-generation] error during command generation", err);
    return errorResponse(c, err instanceof Error ? err.message : "Failed to generate commands via AI.", 500, "GENERATION_FAILED");
  }
});

businessRoutes.post("/agents/:installedAgentId/telegram/manual", async (c) => {
  const authUser = c.get("authUser");
  const parsed = telegramManualSetupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message || "Invalid Telegram setup request.",
      422,
      "VALIDATION_ERROR"
    );
  }
  try {
    const result = await connectTelegramManualBot({
      ownerId: authUser.id,
      installedAgentId: c.req.param("installedAgentId"),
      botDisplayName: parsed.data.botDisplayName,
      botToken: parsed.data.botToken
    });
    return successResponse(c, result, "Telegram bot connected.");
  } catch (error) {
    const status = error instanceof TelegramConnectorError ? error.status : 500;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Telegram bot connection failed.",
      apiErrorStatus(status, 500),
      error instanceof TelegramConnectorError ? error.code : "TELEGRAM_SETUP_FAILED"
    );
  }
});

businessRoutes.post("/agents/:installedAgentId/telegram/health", async (c) => {
  const authUser = c.get("authUser");
  try {
    return successResponse(
      c,
      await refreshTelegramConnectionHealth(authUser.id, c.req.param("installedAgentId"))
    );
  } catch (error) {
    const status = error instanceof TelegramConnectorError ? error.status : 502;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Telegram health check failed.",
      apiErrorStatus(status, 500),
      error instanceof TelegramConnectorError ? error.code : "TELEGRAM_HEALTH_FAILED"
    );
  }
});

businessRoutes.post("/agents/:installedAgentId/telegram/owner-authorization", async (c) => {
  const authUser = c.get("authUser");
  try {
    return successResponse(
      c,
      await createTelegramOwnerAuthorization(authUser.id, c.req.param("installedAgentId")),
      "Owner notification authorization started."
    );
  } catch (error) {
    const status = error instanceof TelegramConnectorError ? error.status : 500;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Owner authorization failed.",
      apiErrorStatus(status, 500),
      error instanceof TelegramConnectorError ? error.code : "TELEGRAM_OWNER_SETUP_FAILED"
    );
  }
});

businessRoutes.post("/agents/:installedAgentId/telegram/test-message", async (c) => {
  const authUser = c.get("authUser");
  try {
    return successResponse(
      c,
      await sendTelegramConnectionTest(authUser.id, c.req.param("installedAgentId")),
      "Live Telegram test message sent."
    );
  } catch (error) {
    const status = error instanceof TelegramConnectorError ? error.status : 502;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Telegram test message failed.",
      apiErrorStatus(status, 500),
      error instanceof TelegramConnectorError ? error.code : "TELEGRAM_TEST_FAILED"
    );
  }
});

businessRoutes.delete("/agents/:installedAgentId/telegram", async (c) => {
  const authUser = c.get("authUser");
  const disconnected = await disconnectTelegramBot(
    authUser.id,
    c.req.param("installedAgentId")
  );
  if (!disconnected) {
    return errorResponse(c, "Telegram bot connection was not found.", 404, "TELEGRAM_CONNECTION_NOT_FOUND");
  }
  return successResponse(c, { disconnected: true }, "Telegram bot disconnected.");
});
businessRoutes.get("/billing/usage", getBusinessExecutionUsage);
businessRoutes.get("/billing/usage-invoices", getBusinessExecutionInvoices);
businessRoutes.post("/billing/usage-invoices/:id/pay", payBusinessExecutionInvoice);
businessRoutes.put("/billing/spending-alert", updateBusinessSpendingAlert);
businessRoutes.post("/billing/spending-alert", updateBusinessSpendingAlert);
businessRoutes.route("/settings", businessSettingsRoutes);
businessRoutes.route("/onboarding", businessOnboardingRoutes);
businessRoutes.route("/hours", businessHoursRoutes);

/** First moment of the current calendar month (UTC). */
function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** First moment of the previous calendar month (UTC). */
function previousMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

/** Daily buckets (UTC dates) for the agent activity chart, oldest first. */
function buildActivityChartDays(params: {
  days: number;
  appointments: Array<{ createdAt: Date }>;
  missedCallLeads: Array<{ createdAt: Date }>;
  vapiCalls: Array<{ createdAt: Date; billedCostMicroUsd: number | null }>;
}) {
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const today = new Date();
  const buckets = new Map<
    string,
    { date: string; executions: number; bookings: number; costMicroUsd: number }
  >();

  for (let offset = params.days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const key = dayKey(day);
    buckets.set(key, { date: key, executions: 0, bookings: 0, costMicroUsd: 0 });
  }

  for (const appointment of params.appointments) {
    const bucket = buckets.get(dayKey(appointment.createdAt));
    if (bucket) {
      // A booking happens during a call that is already counted as one
      // execution below — count it only as a booking, never a second run.
      bucket.bookings += 1;
    }
  }

  for (const lead of params.missedCallLeads) {
    const bucket = buckets.get(dayKey(lead.createdAt));
    if (bucket) bucket.executions += 1;
  }

  for (const call of params.vapiCalls) {
    const bucket = buckets.get(dayKey(call.createdAt));
    if (bucket) {
      bucket.executions += 1;
      bucket.costMicroUsd += call.billedCostMicroUsd ?? 0;
    }
  }

  return Array.from(buckets.values());
}

/** Agent-generated events (bookings, missed calls, AI calls) as activity items. */
function buildAgentEventActivities(params: {
  agentName: string;
  appointments: Array<{
    id: string;
    customerName: string | null;
    customerPhone: string;
    service: string | null;
    startAt: Date;
    timeZone: string | null;
    createdAt: Date;
  }>;
  missedCallLeads: Array<{ id: string; phoneNumber: string; name: string | null; createdAt: Date }>;
  vapiCalls: Array<{
    id: string;
    customerPhone: string;
    status: string;
    createdAt: Date;
    recordingUrl?: string | null;
  }>;
}) {
  const activities: Array<{
    id: string;
    type: string;
    text: string;
    badge: string;
    tone: "green" | "amber" | "slate";
    check?: boolean;
    createdAt: string;
    /** Call recording playback — present only when recording was enabled for the call. */
    recordingUrl?: string;
    /** VapiCall row id — lets the client mint a fresh recording URL at play time. */
    vapiCallId?: string;
  }> = [];

  for (const appointment of params.appointments) {
    const who = appointment.customerName?.trim() || appointment.customerPhone;
    const when = appointment.startAt.toLocaleString("en-US", {
      timeZone: normalizeTimeZone(appointment.timeZone),
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    activities.push({
      id: `booking-${appointment.id}`,
      type: "appointment_booked",
      text: `${params.agentName} booked ${appointment.service?.trim() || "an appointment"} for ${who} — ${when}`,
      badge: "Booking",
      tone: "green",
      check: true,
      createdAt: appointment.createdAt.toISOString()
    });
  }

  for (const lead of params.missedCallLeads) {
    const who = lead.name?.trim() || lead.phoneNumber;
    activities.push({
      id: `missed-${lead.id}`,
      type: "missed_call_captured",
      text: `${params.agentName} captured a missed call from ${who}`,
      badge: "Missed call",
      tone: "amber",
      createdAt: lead.createdAt.toISOString()
    });
  }

  for (const call of params.vapiCalls) {
    activities.push({
      id: `aicall-${call.id}`,
      type: "ai_call",
      text: `${params.agentName} handled an AI voice call with ${call.customerPhone}`,
      badge: "AI call",
      tone: "slate",
      vapiCallId: call.id,
      createdAt: call.createdAt.toISOString(),
      ...(call.recordingUrl ? { recordingUrl: call.recordingUrl } : {})
    });
  }

  return activities;
}

async function recordingUrlPlayable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      signal: AbortSignal.timeout(6000)
    });
    return response.status === 200 || response.status === 206;
  } catch {
    return false;
  }
}

businessRoutes.get("/calls/:id/recording-url", async (c) => {
  const authUser = c.get("authUser");
  const idParam = (c.req.param("id") ?? "").trim();

  const businessId = await resolvePrimaryBusinessId(authUser.id);
  if (!businessId || !idParam) {
    return errorResponse(c, "Call not found", 404, "CALL_NOT_FOUND");
  }

  const call = await prisma.vapiCall.findFirst({
    where: { businessId, OR: [{ id: idParam }, { callId: idParam }] },
    select: { id: true, callId: true, recordingUrl: true }
  });
  if (!call) {
    return errorResponse(c, "Call not found", 404, "CALL_NOT_FOUND");
  }

  const fresh = await fetchVapiCallById(call.callId).catch(() => null);
  // Presigned candidates are probed first, and limiting happens AFTER the
  // sort — a playable signed URL must never be sliced away by bare ones.
  const candidates = Array.from(
    new Set([...(fresh?.recordingUrls ?? []), ...(call.recordingUrl ? [call.recordingUrl] : [])])
  )
    .sort((a, b) => Number(isPresignedRecordingUrl(b)) - Number(isPresignedRecordingUrl(a)))
    .slice(0, 10);

  let url: string | null = null;
  for (const candidate of candidates) {
    if (await recordingUrlPlayable(candidate)) {
      url = candidate;
      break;
    }
  }

  if (!url && candidates.length > 0) {
    console.warn("[recording-url] no playable candidate", {
      callId: call.callId,
      candidates: candidates.map((candidate) => candidate.split("?")[0])
    });
  }

  if (!call.recordingUrl && url && !isPresignedRecordingUrl(url)) {
    await prisma.vapiCall
      .update({ where: { id: call.id }, data: { recordingUrl: url.split("?")[0] || url } })
      .catch(() => undefined);
  }

  return successResponse(c, { url });
});

businessRoutes.get("/dashboard", async (c) => {
  const authUser = c.get("authUser");

  const [business, payments] = await Promise.all([
    prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
      include: {
        installedAgents: { orderBy: { createdAt: "desc" } },
        phoneNumbers: includeActivePhoneNumbers({ take: 1 })
      }
    }),
    prisma.payment.findMany({
      where: { userId: authUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        listing: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
  ]);

  const calendar = await getGmailConnectionStatus(authUser.id);
  const totalSpendCents = sumInvoiceTotalCents(payments);
  const activities = buildDashboardActivities(payments, business?.installedAgents ?? []);

  if (!business) {
    return successResponse(c, {
      business: null,
      installedAgent: null,
      phoneNumber: null,
      subscription: { status: "inactive", active: false },
      counts: { leads: 0, conversations: 0, appointments: 0 },
      recentLeads: [],
      recentAppointments: [],
      recentMissedCalls: [],
      bookings: { month: new Date().toISOString().slice(0, 7), total: 0, upcoming: 0, items: [] },
      monthlyMetrics: {
        callsHandled: 0,
        callsHandledPrevMonth: 0,
        bookings: 0,
        bookingsPrevMonth: 0
      },
      activityChart: { days: buildActivityChartDays({ days: 30, appointments: [], missedCallLeads: [], vapiCalls: [] }) },
      agentActivity: [],
      callHistory: [],
      executions: [],
      calendarConnected: calendar.connected,
      totalSpendCents,
      activities
    });
  }

  const monthStart = currentMonthStart();
  const prevMonthStart = previousMonthStart();
  const chartStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    leadCount,
    conversationCount,
    appointmentCount,
    recentLeads,
    recentAppointments,
    recentMissedCalls,
    monthBookings,
    chartAppointments,
    chartMissedCallLeads,
    chartVapiCalls,
    monthVapiCallCount,
    monthMissedCallCount,
    prevMonthVapiCallCount,
    prevMonthMissedCallCount,
    prevMonthBookingCount
  ] = await Promise.all([
    prisma.lead.count({ where: { businessId: business.id } }),
    prisma.conversation.count({ where: { businessId: business.id } }),
    prisma.appointment.count({ where: { businessId: business.id, executionMode: "LIVE" } }),
    prisma.lead.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, phoneNumber: true, name: true, source: true, status: true, createdAt: true }
    }),
    prisma.appointment.findMany({
      where: { businessId: business.id },
      orderBy: { startAt: "desc" },
      take: 5,
      select: { id: true, customerName: true, startAt: true, status: true, createdAt: true }
    }),
    prisma.lead.findMany({
      where: { businessId: business.id, source: { contains: "MISSED_CALL" } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, phoneNumber: true, name: true, status: true, createdAt: true }
    }),
    // Bookings created this month by the agent (Google Calendar-backed appointments).
    prisma.appointment.findMany({
      where: { businessId: business.id, createdAt: { gte: monthStart }, executionMode: "LIVE" },
      orderBy: { startAt: "desc" },
      take: 50,
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        service: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        status: true,
        calendarEventId: true,
        calendarEventLink: true,
        notes: true,
        createdAt: true
      }
    }),
    prisma.appointment.findMany({
      where: { businessId: business.id, createdAt: { gte: chartStart }, executionMode: "LIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerName: true,
        customerPhone: true,
        service: true,
        startAt: true,
        timeZone: true,
        createdAt: true
      }
    }),
    prisma.lead.findMany({
      where: { businessId: business.id, source: { contains: "MISSED_CALL" }, createdAt: { gte: chartStart } },
      orderBy: { createdAt: "desc" },
      select: { id: true, phoneNumber: true, name: true, createdAt: true }
    }),
    prisma.vapiCall.findMany({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: chartStart } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerPhone: true,
        status: true,
        createdAt: true,
        billedCostMicroUsd: true,
        recordingUrl: true
      }
    }),
    // Month-over-month metric counts (calls handled = AI voice calls + missed calls captured).
    prisma.vapiCall.count({ where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: monthStart } } }),
    prisma.lead.count({
      where: { businessId: business.id, source: { contains: "MISSED_CALL" }, createdAt: { gte: monthStart } }
    }),
    prisma.vapiCall.count({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: prevMonthStart, lt: monthStart } }
    }),
    prisma.lead.count({
      where: {
        businessId: business.id,
        source: { contains: "MISSED_CALL" },
        createdAt: { gte: prevMonthStart, lt: monthStart }
      }
    }),
    prisma.appointment.count({
      where: { businessId: business.id, executionMode: "LIVE", createdAt: { gte: prevMonthStart, lt: monthStart } }
    })
  ]);

  // Call history + workflow executions for the dashboard panels. Only real
  // phone traffic (LIVE) appears; browser tests and dry runs never do.
  const [historyCalls, workflowRuns] = await Promise.all([
    prisma.vapiCall.findMany({
      where: { businessId: business.id, executionMode: "LIVE" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        callId: true,
        customerPhone: true,
        status: true,
        durationSeconds: true,
        recordingUrl: true,
        summary: true,
        createdAt: true,
        metadataJson: true
      }
    }),
    prisma.workflowRun.findMany({
      where: {
        mode: "LIVE",
        OR: [
          { businessId: business.id },
          { installedAgentId: { in: business.installedAgents.map((agent) => agent.id) } }
        ]
      },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        errorMessage: true,
        externalCallId: true,
        workflow: { select: { name: true } }
      }
    })
  ]);

  const callHistory = historyCalls.map((call) => ({
    id: call.id,
    customerPhone: call.customerPhone,
    direction: vapiCallDirection(call.metadataJson),
    status: call.status,
    durationSeconds: call.durationSeconds,
    recordingUrl: call.recordingUrl,
    summary: call.summary,
    createdAt: call.createdAt.toISOString()
  }));

  const executions = workflowRuns.map((run) => ({
    id: run.id,
    status: run.status,
    workflowName: run.workflow?.name ?? "Workflow",
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.durationMs,
    errorMessage: run.errorMessage,
    externalCallId: run.externalCallId
  }));

  const installedAgent = business.installedAgents[0] ?? null;
  const phoneNumber = business.phoneNumbers[0] ?? null;
  const subscriptionStatus = business.subscriptionStatus ?? "inactive";

  const now = new Date();
  // Agent events over the last 30 days (matches the activity chart window).
  const agentEventActivities = buildAgentEventActivities({
    agentName: installedAgent?.name ?? "Your agent",
    appointments: chartAppointments,
    missedCallLeads: chartMissedCallLeads,
    vapiCalls: chartVapiCalls
  }).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const mergedActivities = [...agentEventActivities, ...activities]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 30);

  const confirmationSmsRows = monthBookings.length
    ? await prisma.smsExecution.findMany({
        where: {
          dedupeKey: { in: monthBookings.map((booking) => `appointment-confirmation:${booking.id}`) }
        },
        select: { dedupeKey: true, status: true, errorCode: true }
      })
    : [];
  const confirmationSmsByAppointmentId = new Map(
    confirmationSmsRows.map((row) => [
      String(row.dedupeKey).replace("appointment-confirmation:", ""),
      { status: row.status, errorCode: row.errorCode }
    ])
  );

  return successResponse(c, {
    business: { id: business.id, name: business.name, type: business.type },
    installedAgent: installedAgent
      ? {
        id: installedAgent.id,
        name: installedAgent.name,
        status: installedAgent.status,
        vapiAssistantId:
          installedAgent.configJson &&
            typeof installedAgent.configJson === "object" &&
            !Array.isArray(installedAgent.configJson)
            ? ((installedAgent.configJson as Record<string, unknown>).vapiAssistantId as string | null) ?? null
            : null
      }
      : null,
    phoneNumber: phoneNumber
      ? { phoneNumber: phoneNumber.phoneNumber, forwardToPhone: phoneNumber.forwardToPhone }
      : null,
    subscription: {
      status: subscriptionStatus,
      active: subscriptionStatus === "active" || subscriptionStatus === "trialing",
      currentPeriodEnd: business.currentPeriodEnd
    },
    counts: { leads: leadCount, conversations: conversationCount, appointments: appointmentCount },
    monthlyMetrics: {
      callsHandled: monthVapiCallCount + monthMissedCallCount,
      callsHandledPrevMonth: prevMonthVapiCallCount + prevMonthMissedCallCount,
      bookings: monthBookings.length,
      bookingsPrevMonth: prevMonthBookingCount
    },
    recentLeads,
    recentAppointments,
    recentMissedCalls,
    bookings: {
      month: monthStart.toISOString().slice(0, 7),
      total: monthBookings.length,
      upcoming: monthBookings.filter((booking) => booking.startAt > now).length,
      agentName: installedAgent?.name ?? null,
      calendarConnected: calendar.connected,
      items: monthBookings.map((booking) => {
        const confirmationSms = confirmationSmsByAppointmentId.get(booking.id) ?? null;
        const previousSchedule = parsePreviousBookingWindow({
          notes: booking.notes,
          startAt: booking.startAt,
          endAt: booking.endAt,
          timeZone: booking.timeZone
        });
        return {
          id: booking.id,
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          service: booking.service,
          startAt: booking.startAt.toISOString(),
          endAt: booking.endAt.toISOString(),
          timeZone: booking.timeZone,
          status: booking.status,
          onCalendar: Boolean(booking.calendarEventId),
          calendarEventLink: booking.calendarEventLink,
          // Terminal SMS delivery state for the confirmation text (e.g.
          // UNDELIVERED with Twilio error 30007) — surfaced so the business
          // knows a customer never got their confirmation.
          confirmationSms: confirmationSms
            ? { status: confirmationSms.status, errorCode: confirmationSms.errorCode }
            : null,
          previousScheduledAt: previousSchedule?.previousStartAt ?? null,
          previousScheduledEndAt: previousSchedule?.previousEndAt ?? null,
          previousScheduleLabel: previousSchedule?.previousScheduleLabel ?? null,
          createdAt: booking.createdAt.toISOString()
        };
      })
    },
    activityChart: {
      days: buildActivityChartDays({
        days: 30,
        appointments: chartAppointments,
        missedCallLeads: chartMissedCallLeads,
        vapiCalls: chartVapiCalls
      })
    },
    agentActivity: agentEventActivities.slice(0, 30),
    callHistory,
    executions,
    calendarConnected: calendar.connected,
    totalSpendCents,
    activities: mergedActivities
  });
});

const faqItemSchema = z.object({
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1)
});

const businessAddressSchema = z.object({
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(80).optional(),
  landmark: z.string().trim().max(200).optional(),
  directions: z.string().trim().max(500).optional(),
  mapsLink: z.string().trim().url().max(500).optional().or(z.literal("")),
  /** "manual" or "pdf_suggestion" — how the buyer filled the form. */
  source: z.enum(["manual", "pdf_suggestion"]).default("manual"),
  confirm: z.boolean().default(true)
}).refine((value) => Boolean(value.state?.trim() || value.postalCode?.trim()), {
  message: "Provide at least a state/province or a postal code."
});

/** Write the ONE authoritative Business Address (Settings + Setup share it). */
async function saveBusinessAddress(
  businessId: string,
  input: z.infer<typeof businessAddressSchema>
): Promise<void> {
  const data = {
    addressLine1: input.line1,
    addressLine2: input.line2?.trim() || null,
    addressCity: input.city,
    addressState: input.state?.trim() || null,
    addressPostalCode: input.postalCode?.trim() || null,
    addressCountry: input.country?.trim() || null,
    addressLandmark: input.landmark?.trim() || null,
    addressDirections: input.directions?.trim() || null,
    addressMapsLink: input.mapsLink?.trim() || null,
    addressSource: input.source,
    addressConfirmedAt: input.confirm ? new Date() : null
  };
  await prisma.businessProfile.upsert({
    where: { businessId },
    update: data,
    create: { businessId, ...data }
  });
}

const dayHoursSchema = z.object({
  open: z.string().regex(/^\d{1,2}:\d{2}$/),
  close: z.string().regex(/^\d{1,2}:\d{2}$/),
  closed: z.boolean().default(false)
});

const appointmentScheduleSchema = z.object({
  useBusinessHours: z.boolean().optional(),
  days: z
    .object({
      sunday: dayHoursSchema.optional(),
      monday: dayHoursSchema.optional(),
      tuesday: dayHoursSchema.optional(),
      wednesday: dayHoursSchema.optional(),
      thursday: dayHoursSchema.optional(),
      friday: dayHoursSchema.optional(),
      saturday: dayHoursSchema.optional()
    })
    .optional(),
  defaultDurationMinutes: z.number().int().min(5).max(480).optional(),
  serviceDurations: z.record(z.string(), z.number().int().min(5).max(480)).optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  slotIntervalMinutes: z.number().int().min(5).max(240).optional(),
  minNoticeMinutes: z.number().int().min(0).max(10080).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
  maxSpokenSuggestions: z.number().int().min(2).max(10).optional(),
  confirmed: z.boolean().optional()
});

const knowledgeItemSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1)
});

const hoursItemSchema = z.object({
  day: z.string().trim().min(1),
  open: z.string().trim().optional().or(z.literal("")),
  close: z.string().trim().optional().or(z.literal("")),
  closed: z.boolean().default(false)
});

const businessSetupSchema = z.object({
  deploy: z.boolean().default(false),

  businessName: z.string().trim().optional().or(z.literal("")).default(""),
  businessType: z.string().trim().optional().or(z.literal("")).default(""),
  assistantName: z.string().trim().optional().or(z.literal("")),

  forwardToPhone: z.string().trim().optional().or(z.literal("")),
  bookingUrl: z.string().trim().url().optional().or(z.literal("")),
  teamPhone: z.string().trim().optional().or(z.literal("")),
  // Optional: the authoritative timezone editor is the Business Hours section
  // (PUT /business/hours). A setup save without it preserves the saved value.
  timeZone: z.string().trim().optional().or(z.literal("")),
  tone: z.string().trim().default("friendly"),
  escalationRules: z.string().trim().optional().or(z.literal("")),

  services: z.array(z.string().trim().min(1)).default([]),
  faqs: z.array(faqItemSchema).default([]),
  hours: z.array(hoursItemSchema).default([]),
  knowledge: z.array(knowledgeItemSchema).default([]),
  appointmentSchedule: appointmentScheduleSchema.optional(),
  businessAddress: businessAddressSchema.optional(),

  vapiAssistantId: z.string().trim().optional().or(z.literal("")),
  vapiPhoneNumberId: z.string().trim().optional().or(z.literal("")),

  voice: z.string().trim().optional().or(z.literal("")),
  voiceId: z.string().trim().optional().or(z.literal("")),
  voiceProvider: z.string().trim().optional().or(z.literal("")),

  answeringMode: z.string().trim().optional().or(z.literal("")),
  answeringHours: z.array(hoursItemSchema).optional(),
  aiCallCoverage: z
    .object({
      kind: z.enum(["always", "business_hours", "custom"]),
      answeringHours: z.array(hoursItemSchema).optional()
    })
    .optional(),
  contactName: z.string().trim().optional().or(z.literal("")),
  allContactNames: z.array(z.string().trim()).optional(),
  customInstructions: z.string().trim().optional().or(z.literal("")),

  silenceRepromptCount: z.coerce.number().int().min(0).max(3).optional(),
  silenceRepromptMessage1: z.string().trim().optional().or(z.literal("")),
  silenceRepromptMessage2: z.string().trim().optional().or(z.literal("")),
  goodbyeMessage: z.string().trim().optional().or(z.literal("")),

  scheduling: z
    .object({
      serviceDurationMinutes: z.coerce.number().int().min(5).max(480).optional(),
      bufferMinutes: z.coerce.number().int().min(0).max(120).optional(),
      maximumSlotsToShow: z.coerce.number().int().min(1).max(20).optional(),
      openHour: z.coerce.number().int().min(0).max(23).optional(),
      closeHour: z.coerce.number().int().min(1).max(24).optional(),
      bookingLabel: z.string().trim().max(60).optional().or(z.literal(""))
    })
    .optional(),

  emailRecipients: z
    .object({
      recipientType: z.enum(["customer", "team", "custom"]).default("customer"),
      customRecipient: z.string().trim().max(320).optional().or(z.literal("")),
      cc: z.string().trim().max(2000).optional().or(z.literal("")),
      bcc: z.string().trim().max(2000).optional().or(z.literal(""))
    })
    .optional(),

  afterHoursPolicy: z
    .object({
      enabled: z.boolean(),
      timezone: z.string().trim().max(80).optional().or(z.literal("")),
      greeting: z.string().trim().max(600).optional().or(z.literal("")),
      emergencyScreeningEnabled: z.boolean().optional(),
      emergencyCategory: z.enum(AFTER_HOURS_EMERGENCY_CATEGORIES).optional(),
      emergencyContactMethod: z.enum(AFTER_HOURS_CONTACT_METHODS).optional(),
      emergencyContact: z.string().trim().max(200).optional().or(z.literal("")),
      offerAppointmentBooking: z.boolean().optional(),
      preferEarliestAvailableSlot: z.boolean().optional(),
      useEmergencySlots: z.boolean().optional(),
      allowUrgentCallbackRequest: z.boolean().optional(),
      lifeThreateningInstruction: z.string().trim().max(600).optional().or(z.literal("")),
      includeCallbackInStaffAlert: z.boolean().optional()
    })
    .optional(),

  customFields: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(120),
        value: z.union([
          z.string().trim().max(2000),
          z.array(z.string().trim().max(200)).max(50),
          z.boolean(),
          z.number()
        ])
      })
    )
    .max(40)
    .default([]),

  selectedPlatformPhoneNumberId: z.string().trim().optional().or(z.literal("")),
  selectedPhoneNumber: z.string().trim().optional().or(z.literal("")),
  calendarId: z.string().trim().optional().or(z.literal("")),
  workflowId: z.string().trim().optional().or(z.literal("")),
  listingId: z.string().trim().optional().or(z.literal("")),
  calendlyEventTypeUri: z.string().trim().optional().or(z.literal("")),
  calendlyEventTypeName: z.string().trim().optional().or(z.literal("")),
  calendlySchedulingUrl: z.string().trim().url().optional().or(z.literal(""))
});

function normalizePhoneNumber(value: string) {
  return value.replace(/[^+\d]/g, "").trim();
}

function cleanOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Merge all extracted names (e.g. from a document) into a single comma-separated
 * string so none are lost when multiple doctors/staff are detected.
 * Falls back to the plain `contactName` field when no array is supplied.
 */
function resolveContactName(
  contactName?: string | null,
  allContactNames?: string[] | null
): string | null {
  const names = (allContactNames ?? [])
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length > 0) {
    return names.join(", ");
  }
  return cleanOptional(contactName);
}


function cleanAssistantName(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length >= 2 ? trimmed : DEFAULT_ASSISTANT_NAME;
}

function buildWebhookUrls() {
  const base = env.BACKEND_URL.replace(/\/$/, "");
  return {
    voice: `${base}/architect/connectors/twilio/voice`,
    voiceAction: `${base}/architect/connectors/twilio/voice-action`,
    sms: `${base}/architect/connectors/twilio/inbound-sms`,
    vapi: `${base}/architect/connectors/vapi/webhook`
  };
}

async function resolveReceptionistWorkflow(opts: {
  ownerId: string;
  workflowId?: string;
  listingId?: string;
}) {
  if (opts.workflowId) {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: opts.workflowId }
    });

    if (workflow) return { workflow, listingId: undefined as string | undefined };
  }

  if (opts.listingId) {
    const listing = await prisma.agentListing.findUnique({
      where: { id: opts.listingId }
    });

    if (listing?.workflowId) {
      const workflow = await prisma.workflowDefinition.findUnique({
        where: { id: listing.workflowId }
      });

      if (workflow) return { workflow, listingId: listing.id };
    }
  }

  const listing = await prisma.agentListing.findFirst({
    where: {
      status: "APPROVED",
      workflowId: { not: null },
      OR: [
        { name: { contains: "missed call", mode: "insensitive" } },
        { name: { contains: "receptionist", mode: "insensitive" } },
        { tags: { has: "receptionist" } }
      ]
    },
    orderBy: { createdAt: "desc" }
  });

  if (listing?.workflowId) {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: listing.workflowId }
    });

    if (workflow) return { workflow, listingId: listing.id };
  }

  const template = await prisma.workflowDefinition.findFirst({
    where: { isTemplate: true },
    orderBy: { createdAt: "desc" }
  });

  if (template) return { workflow: template, listingId: undefined };

  const created = await prisma.workflowDefinition.create({
    data: {
      architectUserId: opts.ownerId,
      name: RECEPTIONIST_WORKFLOW_NAME,
      description: RECEPTIONIST_WORKFLOW_DESCRIPTION,
      isTemplate: false,
      workflowJson: buildReceptionistWorkflowJson() as never
    }
  });

  return { workflow: created, listingId: undefined };
}

async function loadBusinessForOwner(ownerId: string) {
  const primaryId = await resolvePrimaryBusinessId(ownerId);
  return prisma.business.findFirst({
    where: { id: primaryId ?? "" },
    include: {
      profile: true,
      knowledgeBases: { orderBy: { createdAt: "asc" } },
      phoneNumbers: includeActivePhoneNumbers(),
      installedAgents: {
        orderBy: { createdAt: "desc" },
        include: { workflow: true, listing: true, telegramBot: true }
      }
    }
  });
}

type LoadedBusiness = NonNullable<Awaited<ReturnType<typeof loadBusinessForOwner>>>;

async function loadPhoneOptions(businessId: string | null, installedAgentId?: string | null) {
  const [numbers, assignments] = await Promise.all([
    prisma.platformPhoneNumber.findMany({
      where: {
        provider: "TWILIO",
        // The reserved shared Triven SMS sender is never shown to buyers.
        isPlatformSmsSender: false,
        OR: [{ status: "AVAILABLE" }, ...(businessId ? [{ businessId }] : [])]
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }]
    }),
    /* BusinessPhoneNumber is the authoritative owner record — it carries the
       one-active-number-per-agent unique index. PlatformPhoneNumber.installedAgentId
       can still be null on assignments made before per-agent scoping, so
       trusting it alone would let a second agent inherit a sibling's number. */
    businessId
      ? prisma.businessPhoneNumber.findMany({
        where: { businessId, isActive: true },
        select: { phoneNumber: true, installedAgentId: true }
      })
      : Promise.resolve([])
  ]);

  const agentByNumber = new Map(
    assignments.map((row) => [row.phoneNumber, row.installedAgentId ?? null])
  );
  /** Owner of this number: the assignment record wins, the platform row is the fallback. */
  const ownerAgentOf = (number: { phoneNumber: string; installedAgentId: string | null }) =>
    agentByNumber.get(number.phoneNumber) ?? number.installedAgentId ?? null;

  const mapped = numbers.map((number) => ({
    id: number.id,
    phoneNumber: number.phoneNumber,
    provider: number.provider,
    status: number.status,
    assignedToThisBusiness: Boolean(businessId && number.businessId === businessId),
    assignedToThisAgent: Boolean(installedAgentId && ownerAgentOf(number) === installedAgentId),
    /* Owned by a SIBLING agent — surfaced so the buyer can see it is taken, but
       it must never be pre-selected for this agent. */
    assignedToOtherAgent: Boolean(ownerAgentOf(number) && ownerAgentOf(number) !== installedAgentId),
    capabilities: number.capabilities ?? null,
    country: number.country ?? null,
    region: number.region ?? null,
    locality: number.locality ?? null
  }));

  /* One number per agent. Selecting the business's first number made a second
     agent's Connect step show the first agent's number as already chosen.
     Prefer this agent's own number; fall back to a business number that no
     agent claims yet (single-agent installs predating per-agent assignment);
     never inherit a sibling agent's number. */
  const selectedPlatformPhoneNumberId =
    mapped.find((number) => number.assignedToThisAgent)?.id ??
    (installedAgentId
      ? mapped.find((number) => number.assignedToThisBusiness && !number.assignedToOtherAgent)?.id ?? null
      : mapped.find((number) => number.assignedToThisBusiness)?.id ?? null);

  const availablePhoneNumbers = mapped.map((number) => ({
    ...number,
    selected: number.id === selectedPlatformPhoneNumberId
  }));

  return { availablePhoneNumbers, selectedPlatformPhoneNumberId };
}
async function loadOwnedInstalledAgent(ownerId: string, installedAgentId: string) {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: { id: true, status: true, business: { select: { ownerId: true } } }
  });
  // One business can never see or modify another business's agent.
  if (!agent || agent.business.ownerId !== ownerId) return null;
  return agent;
}

async function requireOwnedBusinessId(ownerId: string): Promise<string | null> {
  return resolvePrimaryBusinessId(ownerId);
}

async function resolveOrBootstrapBusiness(
  ownerId: string,
  listingId: string | undefined
): Promise<{ businessId: string; bootstrappedAgentId: string | null } | null> {
  const existing = await requireOwnedBusinessId(ownerId);
  if (existing) return { businessId: existing, bootstrappedAgentId: null };

  if (!listingId) return null;

  const listing = await loadOwnedListing(ownerId, listingId);
  if (!listing) return null;

  const { business, agent } = await ensureBusinessAndAgent({ ownerId, listing });
  return { businessId: business.id, bootstrappedAgentId: agent?.id ?? null };
}

/** Ownership guard: an installedAgentId from the client must belong to the caller. */
async function resolveOwnedInstalledAgentId(
  ownerId: string,
  businessId: string,
  installedAgentId: string | undefined
): Promise<string | null | undefined> {
  if (!installedAgentId) return undefined;
  const agent = await prisma.installedAgent.findFirst({
    where: { id: installedAgentId, businessId, business: { ownerId } },
    select: { id: true }
  });
  return agent ? agent.id : null;
}

businessRoutes.get("/phone-numbers/locations", async (c) => {
  const country = c.req.query("country")?.trim().toUpperCase() ?? "";
  const state = c.req.query("state")?.trim().toUpperCase() ?? "";

  if (country && !findPhoneCountry(country)) {
    return errorResponse(c, "Select a valid country.", 422, "UNSUPPORTED_COUNTRY");
  }

  if (country && state) {
    return successResponse(c, { cities: listPhoneCities(country, state) });
  }

  if (country) {
    return successResponse(c, {
      states: listPhoneStates(country),
      supportsCityFilter: supportsLocalityFilter(country)
    });
  }

  return successResponse(c, {
    countries: listPhoneCountries(),
    note: "Number availability depends on carrier inventory and local regulatory requirements."
  });
});


/** Buyer responses never name internal vendors — scrub pass-through messages. */
function neutralizeProviderText(message: string): string {
  return message
    .replace(/twilio/gi, "our phone carrier")
    .replace(/vapi/gi, "the voice platform")
    .replace(/elevenlabs/gi, "the voice provider");
}

const phoneSearchSchema = z.object({
  installedAgentId: z.string().trim().min(1).optional(),
  /** Purchased listing id — bootstraps the business on first-time setup. */
  listingId: z.string().trim().min(1).optional(),
  country: z.string().trim().min(2).max(2),
  state: z.string().trim().max(8).optional(),
  city: z.string().trim().max(80).optional()
});

businessRoutes.post("/phone-numbers/search", async (c) => {
  const authUser = c.get("authUser");
  const parsed = phoneSearchSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, "Invalid phone search payload", 422, "VALIDATION_ERROR");
  }

  const resolved = await resolveOrBootstrapBusiness(authUser.id, parsed.data.listingId);
  if (!resolved) {
    return errorResponse(c, "Purchase an agent before choosing a number.", 404, "BUSINESS_NOT_FOUND");
  }

  const installedAgentId = await resolveOwnedInstalledAgentId(authUser.id, resolved.businessId, parsed.data.installedAgentId);
  if (installedAgentId === null) {
    return errorResponse(c, "Installed agent not found for your business.", 404, "AGENT_NOT_FOUND");
  }

  try {
    const outcome = await searchNumbersForBusiness({
      businessId: resolved.businessId,
      installedAgentId: installedAgentId ?? resolved.bootstrappedAgentId,
      country: parsed.data.country,
      state: parsed.data.state,
      city: parsed.data.city
    });
    return successResponse(c, outcome);
  } catch (error) {
    if (error instanceof PhoneNumberServiceError) {
      return errorResponse(c, neutralizeProviderText(error.message), apiErrorStatus(error.status, 500), error.code ?? "PHONE_SEARCH_FAILED");
    }
    console.error("[phone-search] failed", error);
    return errorResponse(c, "Could not search available numbers.", 503, "PHONE_SEARCH_FAILED");
  }
});

const phonePurchaseSchema = z.object({
  installedAgentId: z.string().trim().min(1).optional(),
  /** Purchased listing id — bootstraps the business on first-time setup. */
  listingId: z.string().trim().min(1).optional(),
  clientRequestId: z.string().trim().min(8).max(64),
  phoneNumber: z.string().trim().min(8).max(20),
  country: z.string().trim().min(2).max(2),
  state: z.string().trim().max(8).optional(),
  city: z.string().trim().max(80).optional(),
  fallbackType: z.enum(["NEARBY_CITY", "SAME_STATE", "NATIONAL", "TOLL_FREE"]).optional(),
  /** The buyer's own business line — stored as the forwarding target. */
  forwardToPhone: z.string().trim().max(24).optional()
});

businessRoutes.post("/phone-numbers/purchase", async (c) => {
  const authUser = c.get("authUser");
  const parsed = phonePurchaseSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, "Invalid phone purchase payload", 422, "VALIDATION_ERROR");
  }

  const resolved = await resolveOrBootstrapBusiness(authUser.id, parsed.data.listingId);
  if (!resolved) {
    return errorResponse(c, "Purchase an agent before choosing a number.", 404, "BUSINESS_NOT_FOUND");
  }

  const installedAgentId = await resolveOwnedInstalledAgentId(authUser.id, resolved.businessId, parsed.data.installedAgentId);
  if (installedAgentId === null) {
    return errorResponse(c, "Installed agent not found for your business.", 404, "AGENT_NOT_FOUND");
  }

  try {
    const rawOutcome = await purchaseNumberForBusiness({
      businessId: resolved.businessId,
      requestedByUserId: authUser.id,
      installedAgentId: installedAgentId ?? resolved.bootstrappedAgentId,
      clientRequestId: parsed.data.clientRequestId,
      phoneNumber: parsed.data.phoneNumber,
      country: parsed.data.country,
      state: parsed.data.state,
      city: parsed.data.city,
      fallbackType: parsed.data.fallbackType ?? null,
      forwardToPhone: parsed.data.forwardToPhone ? normalizePhoneNumber(parsed.data.forwardToPhone) : null
    });
    const outcome = {
      ...rawOutcome,
      errorMessage: rawOutcome.errorMessage ? neutralizeProviderText(rawOutcome.errorMessage) : rawOutcome.errorMessage
    };
    return successResponse(c, outcome);
  } catch (error) {
    if (error instanceof PhoneNumberServiceError) {
      return errorResponse(c, neutralizeProviderText(error.message), apiErrorStatus(error.status, 500), error.code ?? "PHONE_PURCHASE_FAILED");
    }
    console.error("[phone-purchase] failed", error);
    return errorResponse(c, "Could not complete the number purchase.", 503, "PHONE_PURCHASE_FAILED");
  }
});

businessRoutes.get("/phone-numbers/assignment", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);

  if (!businessId) {
    return successResponse(c, { assigned: false, availableToAssign: [], lockedToOtherAgents: [] });
  }

  const requestedAgentId = c.req.query("installedAgentId")?.trim() || undefined;
  const installedAgentId = await resolveOwnedInstalledAgentId(authUser.id, businessId, requestedAgentId);
  if (installedAgentId === null) {
    return errorResponse(c, "Agent not found for this business.", 404, "AGENT_NOT_FOUND");
  }

  const [assignedToThisAgent, availableToAssign, owned] = await Promise.all([
    installedAgentId ? getAgentPhoneAssignment(businessId, installedAgentId) : Promise.resolve(null),
    listUnassignedBusinessNumbers(businessId),
    listBusinessPhoneAssignments(businessId)
  ]);

  // Numbers held by the buyer's OTHER agents — shown so the buyer understands
  // why they cannot reuse one, never as something they can pick.
  const lockedElsewhere = await prisma.businessPhoneNumber.findMany({
    where: {
      businessId,
      isActive: true,
      installedAgentId: installedAgentId ? { not: installedAgentId } : { not: null }
    },
    select: { phoneNumber: true, installedAgentId: true }
  });

  return successResponse(c, {
    // Kept so existing callers that read the flat shape keep working.
    ...(assignedToThisAgent ?? { assigned: false }),
    assignedToThisAgent,
    availableToAssign,
    lockedToOtherAgents: lockedElsewhere,
    ownedCount: owned.length,
    /** False while a paid-for number is sitting unassigned. */
    canBuyMore: availableToAssign.length === 0 && !assignedToThisAgent
  });
});

const phoneAssignSchema = z.object({
  installedAgentId: z.string().trim().min(1),
  phoneNumber: z.string().trim().min(5),
  forwardToPhone: z.string().trim().optional()
});

/** Lock a number the business already owns to one of its agents. */
businessRoutes.post("/phone-numbers/assign", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) {
    return errorResponse(c, "No business found for this account.", 404, "BUSINESS_NOT_FOUND");
  }

  const parsed = phoneAssignSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, "installedAgentId and phoneNumber are required.", 422, "INVALID_INPUT");
  }

  const installedAgentId = await resolveOwnedInstalledAgentId(
    authUser.id,
    businessId,
    parsed.data.installedAgentId
  );
  if (!installedAgentId) {
    return errorResponse(c, "Agent not found for this business.", 404, "AGENT_NOT_FOUND");
  }

  try {
    const pricingNumber = await prisma.platformPhoneNumber.findFirst({
      where: {
        phoneNumber: parsed.data.phoneNumber,
        businessId,
        status: "ASSIGNED",
        isPlatformSmsSender: false
      },
      select: { id: true }
    });
    if (!pricingNumber) {
      return errorResponse(
        c,
        "That number is not one of your business's numbers.",
        409,
        "PHONE_NUMBER_TAKEN"
      );
    }
    const phoneNumberFee = await getPhoneNumberFeeForPlatformNumber(
      pricingNumber.id,
      { refreshFromTwilio: true }
    );

    const assigned = await prisma.$transaction(async (tx) => {
      // Same lock the purchase flow takes — assignment and provisioning must
      // never interleave for one business.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`business-number-assignment:${businessId}`}))`;

      const platform = await tx.platformPhoneNumber.findFirst({
        where: {
          phoneNumber: parsed.data.phoneNumber,
          businessId,
          status: "ASSIGNED",
          isPlatformSmsSender: false
        }
      });
      if (!platform) {
        throw new PhoneNumberServiceError(
          "That number is not one of your business's numbers.",
          409,
          "PHONE_NUMBER_TAKEN"
        );
      }

      const lockedTo = await tx.businessPhoneNumber.findFirst({
        where: { phoneNumber: parsed.data.phoneNumber, isActive: true, installedAgentId: { not: null } },
        select: { installedAgentId: true }
      });
      if (lockedTo && lockedTo.installedAgentId !== installedAgentId) {
        throw new PhoneNumberServiceError(
          "That number is already assigned to another agent.",
          409,
          "PHONE_NUMBER_LOCKED_TO_AGENT"
        );
      }

      const agentNumber = await tx.businessPhoneNumber.findFirst({
        where: { businessId, installedAgentId, isActive: true },
        select: { phoneNumber: true }
      });
      if (agentNumber && agentNumber.phoneNumber !== parsed.data.phoneNumber) {
        throw new PhoneNumberServiceError(
          "This agent already has a number. Each agent keeps one number.",
          409,
          "AGENT_ALREADY_HAS_NUMBER"
        );
      }

      await assignPlatformNumber(tx, {
        platform,
        businessId,
        installedAgentId,
        buyerUserId: authUser.id,
        forwardToPhone: parsed.data.forwardToPhone ?? null
      });
      await addPhoneNumberFeeToPendingInvoiceTx(
        tx,
        {
          platformPhoneNumberId: platform.id,
          businessId,
          installedAgentId,
          chargedAt: new Date()
        },
        phoneNumberFee
      );

      return platform.phoneNumber;
    });

    return successResponse(c, { assigned: true, phoneNumber: assigned, installedAgentId });
  } catch (error) {
    if (error instanceof PhoneNumberServiceError) {
      return errorResponse(c, error.message, error.status as 409, error.code);
    }
    // The unique index is the real lock — a race lands here.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(
        c,
        "That number was just assigned to another agent.",
        409,
        "PHONE_NUMBER_LOCKED_TO_AGENT"
      );
    }
    throw error;
  }
});

businessRoutes.get("/phone-numbers/provisioning/:clientRequestId", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);

  if (!businessId) {
    return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");
  }

  const outcome = await getProvisioningRequestStatus({
    businessId,
    clientRequestId: c.req.param("clientRequestId")
  });

  if (!outcome) {
    return errorResponse(c, "Provisioning request not found.", 404, "PROVISIONING_NOT_FOUND");
  }

  return successResponse(c, outcome);
});

businessRoutes.post("/agents/:installedAgentId/pause", async (c) => {
  const authUser = c.get("authUser");
  const agent = await loadOwnedInstalledAgent(authUser.id, c.req.param("installedAgentId"));

  if (!agent) return errorResponse(c, "Agent not found.", 404, "AGENT_NOT_FOUND");
  if (agent.status === "PAUSED") {
    return successResponse(c, { installedAgentId: agent.id, status: "PAUSED" }, "Agent is already paused");
  }
  if (agent.status !== "ACTIVE") {
    return errorResponse(c, "Only an active agent can be paused.", 409, "AGENT_NOT_ACTIVE");
  }

 const pausedAt = new Date();
  const transitioned = await prisma.installedAgent.updateMany({
    where: { id: agent.id, status: "ACTIVE" },
    data: { status: "PAUSED", pausedAt }
  });

  if (transitioned.count === 0) {
    const current = await prisma.installedAgent.findUnique({ where: { id: agent.id }, select: { status: true } });
    if (current?.status === "PAUSED") {
      return successResponse(c, { installedAgentId: agent.id, status: "PAUSED" }, "Agent is already paused");
    }
    return errorResponse(c, "Only an active agent can be paused.", 409, "AGENT_NOT_ACTIVE");
  }

  return successResponse(
    c,
    { installedAgentId: agent.id, status: "PAUSED", pausedAt: pausedAt.toISOString() },
    "Agent paused"
  );
});

businessRoutes.post("/agents/:installedAgentId/resume", async (c) => {
  const authUser = c.get("authUser");
  const agent = await loadOwnedInstalledAgent(authUser.id, c.req.param("installedAgentId"));

  if (!agent) return errorResponse(c, "Agent not found.", 404, "AGENT_NOT_FOUND");
  if (agent.status === "ACTIVE") {
    return successResponse(c, { installedAgentId: agent.id, status: "ACTIVE" }, "Agent is already active");
  }
  if (agent.status !== "PAUSED") {
    return errorResponse(c, "Only a paused agent can be resumed.", 409, "AGENT_NOT_PAUSED");
  }

  // CAS resume: PAUSED→ACTIVE atomically; pausedAt clears so period metrics
  // treat later executions normally. Historical execution rows are untouched.
  const transitioned = await prisma.installedAgent.updateMany({
    where: { id: agent.id, status: "PAUSED" },
    data: { status: "ACTIVE", pausedAt: null }
  });

  if (transitioned.count === 0) {
    const current = await prisma.installedAgent.findUnique({ where: { id: agent.id }, select: { status: true } });
    if (current?.status === "ACTIVE") {
      return successResponse(c, { installedAgentId: agent.id, status: "ACTIVE" }, "Agent is already active");
    }
    return errorResponse(c, "Only a paused agent can be resumed.", 409, "AGENT_NOT_PAUSED");
  }

  return successResponse(c, { installedAgentId: agent.id, status: "ACTIVE" }, "Agent resumed");
});

businessRoutes.get("/setup/phone-numbers", async (c) => {
  const authUser = c.get("authUser");

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true }
  });

  const { availablePhoneNumbers } = await loadPhoneOptions(business?.id ?? null);

  return successResponse(c, { numbers: availablePhoneNumbers });
});

/* ----------------------- Buyer knowledge documents ----------------------- */

function knowledgeFileErrorResponse(c: Context, error: unknown) {
  if (error instanceof KnowledgeFileError) {
    return errorResponse(c, error.message, apiErrorStatus(error.status, 422), error.code);
  }
  console.error("[knowledge-files] failed", error);
  return errorResponse(c, "The document could not be processed.", 500, "KNOWLEDGE_FILE_FAILED");
}

businessRoutes.post("/setup/knowledge-files", async (c) => {
  const authUser = c.get("authUser");

  // Early oversize guard before buffering the multipart body.
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES * 5 + 1024 * 1024) {
    return errorResponse(c, "Upload too large. Files can be at most 10 MB each.", 422, "UPLOAD_TOO_LARGE");
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    return errorResponse(c, "Could not read the uploaded files.", 400, "INVALID_MULTIPART_BODY");
  }

  const listingId = typeof body.listingId === "string" ? body.listingId.trim() : undefined;
  const requestedAgentId = typeof body.installedAgentId === "string" ? body.installedAgentId.trim() : undefined;

  const resolved = await resolveOrBootstrapBusiness(authUser.id, listingId);
  if (!resolved) {
    return errorResponse(c, "Purchase an agent before uploading documents.", 404, "BUSINESS_NOT_FOUND");
  }

  const installedAgentId = await resolveOwnedInstalledAgentId(authUser.id, resolved.businessId, requestedAgentId);
  if (installedAgentId === null) {
    return errorResponse(c, "Installed agent not found for your business.", 404, "AGENT_NOT_FOUND");
  }

  const rawFiles = body.files ?? body["files[]"];
  const fileList = (Array.isArray(rawFiles) ? rawFiles : [rawFiles]).filter(
    (item): item is File => typeof File !== "undefined" && item instanceof File
  );

  if (fileList.length === 0) {
    return errorResponse(c, "Attach at least one PDF, DOCX, or TXT document.", 400, "NO_FILES");
  }

  try {
    const uploads = [] as Array<{ filename: string; mimeType: string; bytes: Buffer }>;
    for (const file of fileList) {
      uploads.push({
        filename: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer())
      });
    }

    invalidateDocumentProfileCache(resolved.businessId);
    const results = await ingestKnowledgeFiles({
      businessId: resolved.businessId,
      installedAgentId: installedAgentId ?? resolved.bootstrappedAgentId,
      files: uploads
    });
    // A live assistant's prompt is baked at deploy — synchronize it and
    // REPORT the result: upload success must never hide a stale live agent.
    const liveSync = results.some((file) => file.status === "PROCESSED")
      ? await refreshLiveAssistantKnowledge(resolved.businessId)
      : { attempted: false, ok: true, assistantId: null, error: null };
    return successResponse(c, { files: results, liveSync });
  } catch (error) {
    return knowledgeFileErrorResponse(c, error);
  }
});

businessRoutes.get("/setup/knowledge-files", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return successResponse(c, { files: [] });

  const requestedAgentId = c.req.query("installedAgentId")?.trim() || undefined;
  const installedAgentId =
    requestedAgentId === undefined
      ? undefined
      : await resolveOwnedInstalledAgentId(authUser.id, businessId, requestedAgentId);
  if (installedAgentId === null) {
    return errorResponse(c, "Installed agent not found for your business.", 404, "AGENT_NOT_FOUND");
  }

  return successResponse(c, { files: await listKnowledgeFiles(businessId, installedAgentId) });
});

businessRoutes.delete("/setup/knowledge-files/:id", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  try {
    invalidateDocumentProfileCache(businessId);
    await deleteKnowledgeFile(businessId, c.req.param("id"));
    const liveSync = await refreshLiveAssistantKnowledge(businessId);
    return successResponse(c, { deleted: true, liveSync });
  } catch (error) {
    return knowledgeFileErrorResponse(c, error);
  }
});

businessRoutes.get("/setup/appointment-schedule", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  const { schedule, installedAgentId } = await resolveScheduleForBusiness({ businessId });
  const documentSuggestion =
    schedule.source === "configured"
      ? null
      : await extractHoursFromDocuments({ businessId, installedAgentId }).catch(() => null);

  return successResponse(c, {
    schedule,
    installedAgentId,
    needsConfirmation: !schedule.confirmed,
    documentSuggestion
  });
});

businessRoutes.get("/setup/business-facts", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  const includeDocumentSuggestions = c.req.query("includeDocumentSuggestions") === "1";
  const requestedAgentId = c.req.query("installedAgentId")?.trim() || undefined;
  const installedAgentId =
    requestedAgentId === undefined
      ? undefined
      : await resolveOwnedInstalledAgentId(authUser.id, businessId, requestedAgentId);
  if (installedAgentId === null) {
    return errorResponse(c, "Installed agent not found for your business.", 404, "AGENT_NOT_FOUND");
  }

  const facts = await loadBusinessFacts(businessId);
  const suggestion = includeDocumentSuggestions
    ? await extractAddressFromDocuments({ businessId, installedAgentId }).catch(() => null)
    : null;
  const profileSuggestion = includeDocumentSuggestions
    ? await extractProfileFromDocuments({ businessId, installedAgentId }).catch(() => null)
    : null;

  if (profileSuggestion && suggestion) {
    profileSuggestion.address = suggestion;
  }

  const conflict = Boolean(
    facts?.addressComplete &&
      suggestion &&
      facts.address &&
      addressesMateriallyDiffer(facts.address, suggestion)
  );

  return successResponse(c, {
    businessName: facts?.businessName ?? null,
    address: facts?.address ?? null,
    addressFormatted: facts?.addressFormatted ?? null,
    addressComplete: facts?.addressComplete ?? false,
    addressConfirmed: facts?.addressConfirmed ?? false,
    phone: facts?.phone ?? null,
    documentSuggestion: facts?.addressConfirmed && !conflict ? null : suggestion,
    profileSuggestion,
    conflict
  });
});

// Save the Business Address (also reachable through the setup save) and
// synchronize the live assistant so calls immediately use the new address.
businessRoutes.put("/setup/business-address", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  const parsed = businessAddressSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid address", 422, "VALIDATION_ERROR");
  }

  await saveBusinessAddress(businessId, parsed.data);
  const liveSync = await refreshLiveAssistantKnowledge(businessId);
  const facts = await loadBusinessFacts(businessId);

  return successResponse(c, {
    addressFormatted: facts?.addressFormatted ?? null,
    addressConfirmed: facts?.addressConfirmed ?? false,
    liveSync
  });
});

// Retry synchronizing the live assistant with the current knowledge set.
businessRoutes.post("/setup/knowledge-files/sync", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  const liveSync = await refreshLiveAssistantKnowledge(businessId);
  return successResponse(c, { liveSync });
});

businessRoutes.post("/setup/knowledge-files/:id/reprocess", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  try {
    const file = await reprocessKnowledgeFile(businessId, c.req.param("id"));
    const liveSync =
      file.status === "PROCESSED"
        ? await refreshLiveAssistantKnowledge(businessId)
        : { attempted: false, ok: true, assistantId: null, error: null };
    return successResponse(c, { file, liveSync });
  } catch (error) {
    return knowledgeFileErrorResponse(c, error);
  }
});

function isPublicHttpsUrl(url: string): boolean {
  return url.startsWith("https://") && !/localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d+\./i.test(url);
}

businessRoutes.post("/marketplace/listings/:listingId/demo-call", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.param("listingId");

  if (!listingId) {
    return errorResponse(c, "Listing id is required", 422, "LISTING_ID_REQUIRED");
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    // Body optional
  }

  const customInfo = {
    businessName: typeof body.businessName === "string" ? body.businessName : undefined,
    doctorName: typeof body.doctorName === "string" ? body.doctorName : undefined,
    businessType: typeof body.businessType === "string" ? body.businessType : undefined,
    address: typeof body.address === "string" ? body.address : undefined,
    services: typeof body.services === "string" ? body.services : undefined
  };

  try {
    const session = await startMarketplaceDemoCall(authUser.id, listingId, customInfo);
    return successResponse(c, { session }, "Demo call ready");
  } catch (error) {
    if (error instanceof MarketplaceDemoError) {
      return errorResponse(c, error.message, error.status, error.code);
    }
    console.error("[marketplace-demo] failed", error);
    return errorResponse(c, "Could not start the demo call.", 500, "DEMO_FAILED");
  }
});

const chatTestMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
  createdAt: z.string().optional()
});

const chatTestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(chatTestMessageSchema).max(30).optional(),
  /** Groups this test run's records (calendar events, appointments). */
  testSessionId: z.string().trim().max(64).optional(),
  simulateBusinessHoursState: z.enum(["current", "open", "closed"]).optional()
});

businessRoutes.post("/setup/test-conversation", async (c) => {
  const authUser = c.get("authUser");

  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = chatTestSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, "Invalid test message payload", 422, "VALIDATION_ERROR");
  }

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true }
  });

  if (!business) {
    return errorResponse(c, "Create your business profile first (Configure step of setup).", 404, "BUSINESS_NOT_FOUND");
  }

  const chatSetup = await buildInstalledAgentChatTestSetup(business.id);

  if (!chatSetup) {
    return errorResponse(c, "Save your setup with an installed agent before testing.", 422, "TEST_NOT_AVAILABLE");
  }

  // After-hours simulation for the Test step: evaluate the real configured
  // hours by default, or force open/closed. The override is BUSINESS_TEST-only
  // (resolveSimulatedHoursState refuses LIVE) and never sends anything real.
  const simulateHours = resolveSimulatedHoursState(
    "BUSINESS_TEST",
    parsed.data.simulateBusinessHoursState === "current" ? null : parsed.data.simulateBusinessHoursState
  );
  const afterHoursContext = chatSetup.afterHoursPolicy?.enabled
    ? {
        policy: chatSetup.afterHoursPolicy,
        snapshot: await buildAfterHoursSnapshotForBusiness(business.id, { simulate: simulateHours })
      }
    : undefined;

  /* Question-aware knowledge, exactly like a live call. buildInstalledAgentChatTestSetup
     loads a static slice capped at KNOWLEDGE_PROMPT_BUDGET_CHARS, so anything past
     the first ~12k characters of an uploaded PDF was invisible in testing while the
     live agent answered from it fine. Retrieve for THIS message and prepend. */
  const retrievedKnowledge = await retrieveRelevantKnowledge({
    businessId: business.id,
    installedAgentId: chatSetup.installedAgentId,
    query: parsed.data.message
  }).catch(() => [] as Awaited<ReturnType<typeof retrieveRelevantKnowledge>>);

  const testKnowledge = retrievedKnowledge.length
    ? [...formatKnowledgeEntries(retrievedKnowledge), ...(chatSetup.context.knowledge ?? [])].slice(0, 40)
    : chatSetup.context.knowledge;

  try {
    const result = await runArchitectConversationTest({
      userId: authUser.id,
      workflowId: chatSetup.workflowId,
      workflowJson: chatSetup.workflowJson,
      message: parsed.data.message,
      history: parsed.data.history,
      testContext: {
        ...chatSetup.context,
        knowledge: testKnowledge,
        ...(afterHoursContext ? { afterHours: afterHoursContext } : {})
      },
      executionMode: "BUSINESS_TEST",
      testSessionId: parsed.data.testSessionId,
      businessIdentity: {
        businessId: business.id,
        installedAgentId: chatSetup.installedAgentId
      }
    });

    return successResponse(c, {
      reply: result.reply,
      transcript: result.transcript,
      toolCalls: result.toolCalls,
      // Node execution timeline for the buyer Test step — every node the graph
      // runner executed this turn, in graph order, with per-node status.
      executedNodes: result.executedNodes,
      finalOutput: result.finalOutput,
      simulated: true,
      executionMode: result.executionMode,
      timeZone: result.timeZone,
      testSessionId: result.testSessionId,
      calendarEvent: result.calendarEvent,
      calendarError: result.calendarError,
      configError: result.configError
    });
  } catch (error) {
    console.error("[setup-chat-test] failed", error);
    return errorResponse(c, "Could not run the test conversation.", 500, "TEST_FAILED");
  }
});

// Delete a Business test calendar event — ownership-validated and idempotent.
/** Latest test booking for this buyer — lets the setup wizard link straight to
 *  the created event instead of dumping the buyer on their calendar root. */
businessRoutes.get("/setup/test-events/latest", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return successResponse(c, { event: null });

  const testSessionId = c.req.query("testSessionId")?.trim();

  const row = await prisma.testCalendarEvent.findFirst({
    where: {
      businessId,
      executionMode: "BUSINESS_TEST",
      status: { not: "DELETED" },
      ...(testSessionId ? { testSessionId } : {})
    },
    orderBy: { createdAt: "desc" }
  });

  if (!row) return successResponse(c, { event: null });

  return successResponse(c, {
    event: {
      testEventId: row.id,
      title: calendarEventTitleForMode("BUSINESS_TEST", row.serviceName),
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      timeZone: row.timeZone,
      serviceName: row.serviceName,
      htmlLink: row.htmlLink,
      status: row.status === "CREATED" ? "CREATED" : "SIMULATED"
    }
  });
});

businessRoutes.post("/setup/test-events/:id/delete", async (c) => {
  const authUser = c.get("authUser");
  const testEventId = c.req.param("id");

  const ownedBusinesses = await prisma.business.findMany({
    where: { ownerId: authUser.id },
    select: { id: true }
  });

  const result = await deleteTestCalendarEvent({
    testEventId,
    requesterUserId: authUser.id,
    allowedBusinessIds: ownedBusinesses.map((row) => row.id),
    scope: "BUSINESS"
  });

  if (result.outcome === "not_found") {
    return errorResponse(c, "Test event not found.", 404, "TEST_EVENT_NOT_FOUND");
  }
  if (result.outcome === "ownership_denied") {
    return errorResponse(c, "This test event does not belong to your business.", 403, "TEST_EVENT_OWNERSHIP_DENIED");
  }
  if (result.outcome === "calendar_disconnected" || result.outcome === "provider_failure") {
    const error = result.error;
    return errorResponse(
      c,
      error?.message ?? "The test event could not be deleted.",
      error && result.outcome === "calendar_disconnected" ? 409 : 503,
      error?.code ?? "CALENDAR_EVENT_DELETE_FAILED"
    );
  }

  return successResponse(c, { outcome: result.outcome });
});

businessRoutes.post("/setup/preview-call", async (c) => {
  const authUser = c.get("authUser");

  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true }
  });

  if (!business) {
    return errorResponse(c, "Create your business profile first (Configure step of setup).", 404, "BUSINESS_NOT_FOUND");
  }

  try {
    // Optional after-hours simulation for the browser preview (BUSINESS_TEST
    // only): {"simulateBusinessHoursState": "open" | "closed" | "current"}.
    const previewBody = await c.req.json().catch(() => null);
    const previewOptions = z
      .object({ simulateBusinessHoursState: z.enum(["current", "open", "closed"]).optional() })
      .safeParse(previewBody ?? {});
    const simulateBusinessHoursState =
      previewOptions.success && previewOptions.data.simulateBusinessHoursState !== "current"
        ? previewOptions.data.simulateBusinessHoursState ?? null
        : null;

    const session = await startInstalledAgentPreviewCall(business.id, { simulateBusinessHoursState });
    return successResponse(c, { session }, "Preview call ready");
  } catch (error) {
    if (error instanceof SetupPreviewCallError) {
      return errorResponse(c, error.message, error.status, error.code);
    }
    console.error("[setup-preview] failed", error);
    return errorResponse(c, "Could not start the preview call.", 500, "PREVIEW_FAILED");
  }
});

businessRoutes.post("/setup/workflows/:workflowId/run-test", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  if (!workflowId) {
    return errorResponse(c, "Workflow id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true }
  });

  if (!business) {
    return errorResponse(c, "Create your business profile first (Configure step of setup).", 404, "BUSINESS_NOT_FOUND");
  }

  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: workflowId }
  });

  if (!workflow) {
    return errorResponse(c, "Workflow not found", 404, "WORKFLOW_NOT_FOUND");
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const chatSetup = await buildInstalledAgentChatTestSetup(business.id);
    const sanitizedInput = {
      ...(chatSetup?.context ?? {}),
      ...(body.input ?? {})
    };

    const run = await runWorkflowTest({
      userId: authUser.id,
      workflowId,
      workflowJson: workflow.workflowJson,
      input: sanitizedInput,
      mode: "test",
      executionMode: "BUSINESS_TEST"
    });

    return successResponse(c, { run }, "Workflow test completed");
  } catch (error) {
    console.error("[business-workflow-test] failed", error);
    return errorResponse(c, "Could not run workflow test", 500, "WORKFLOW_TEST_FAILED");
  }
});

businessRoutes.post("/setup/test-call-routing", async (c) => {
  const authUser = c.get("authUser");

  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const backendUrl = env.BACKEND_URL.replace(/\/$/, "");
  const webhookUrl = `${backendUrl}/architect/connectors/twilio/voice`;
  const backendPublic = isPublicHttpsUrl(backendUrl);
  const backendIsTunnel = /\.ngrok(-free)?\./i.test(backendUrl);

  const [business, calendar, calendly] = await Promise.all([
    prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
      include: {
        profile: true,
        phoneNumbers: includeActivePhoneNumbers(),
        installedAgents: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { workflow: { select: { workflowJson: true } } }
        }
      }
    }),
    getGmailConnectionStatus(authUser.id),
    getCalendlyConnectionStatus(authUser.id)
  ]);

  const testWorkflowJson = business?.installedAgents?.[0]?.workflow?.workflowJson ?? null;
  const testConnectorKeys = new Set(
    testWorkflowJson ? requiredConnectorsForWorkflow(testWorkflowJson).map((req) => req.connector) : []
  );
  const calendarRequired =
    testConnectorKeys.size === 0 || testConnectorKeys.has("google_calendar") || testConnectorKeys.has("gmail");
  const calendlyRequired = testConnectorKeys.has("calendly");

  const environmentChecks = [
    {
      key: "business_found",
      label: "Business profile complete",
      ok: Boolean(business && business.name && business.type),
      message: business ? undefined : "Save your business name and type in the Configure step."
    },
    ...(calendarRequired
      ? [
        {
          key: "calendar_connected",
          label: "Google Calendar connected",
          ok: calendar.connected,
          message: calendar.connected
            ? undefined
            : "Connect Google Calendar in the Connect step so the agent can book appointments."
        }
      ]
      : []),
    ...(calendlyRequired
      ? [
        {
          key: "calendly_connected",
          label: "Calendly connected",
          ok: calendly.connected,
          message: calendly.connected
            ? undefined
            : "Connect Calendly in the Connect step so meeting workflows can run."
        }
      ]
      : []),
    {
      key: "timezone_set",
      label: "Calendar timezone selected",
      ok: Boolean(business?.profile?.timeZone),
      message: business?.profile?.timeZone
        ? `Timezone: ${normalizeTimeZone(business.profile.timeZone)}`
        : "Pick a calendar timezone in the Connect step."
    },
    {
      key: "backend_url_public",
      label: "Backend URL is public HTTPS",
      ok: backendPublic,
      message: backendPublic
        ? backendIsTunnel
          ? "Reachable via a tunnel — fine for testing, use the production domain in production."
          : undefined
        : "The platform URL is not publicly reachable yet — inbound calls cannot reach your agent."
    },
    {
      key: "webhook_configured",
      label: "Call routing webhook",
      ok: backendPublic,
      message: "Inbound call routing is configured automatically for your Triven number."
    },
    {
      key: "signature_validation",
      label: "Call security validation",
      ok: !isProduction || env.TWILIO_VALIDATE_SIGNATURE,
      message: env.TWILIO_VALIDATE_SIGNATURE
        ? undefined
        : isProduction
          ? "Platform call security is still being enabled — contact Triven support."
          : "Relaxed in development; enforced automatically in production."
    },
    {
      key: "no_env_phone_dependency",
      label: "Phone numbers managed in database",
      ok: true,
      message: "Your Triven number is managed automatically — nothing to configure."
    }
  ];

  const requestBody: Record<string, unknown> = await c.req
    .json()
    .then((body: unknown) => (isRecord(body) ? body : {}))
    .catch(() => ({}));

  const requested = typeof requestBody.phoneNumber === "string" ? requestBody.phoneNumber : "";
  const requestedId =
    typeof requestBody.selectedPlatformPhoneNumberId === "string"
      ? requestBody.selectedPlatformPhoneNumberId.trim()
      : "";

  const requestedPlatform = requestedId
    ? await prisma.platformPhoneNumber.findUnique({ where: { id: requestedId } })
    : null;

  const activePhone = business?.phoneNumbers?.[0] ?? null;

  const assignedPlatform = business
    ? await prisma.platformPhoneNumber.findFirst({
      where: { businessId: business.id },
      orderBy: { assignedAt: "desc" }
    })
    : null;

  const number =
    normalizePhoneNumber(requested) ||
    requestedPlatform?.phoneNumber ||
    activePhone?.phoneNumber ||
    assignedPlatform?.phoneNumber ||
    "";

  if (!number) {
    return successResponse(c, {
      ok: false,
      number: null,
      webhookUrl,
      readyForCall: false,
      resolveReason: null,
      checks: [
        ...environmentChecks,
        {
          key: "number_selected",
          label: "A Triven number is selected",
          ok: false,
          message: "Select a Triven number in the Connect step."
        }
      ]
    });
  }

  const [platformForNumber, businessPhoneForNumber, diagnostics] = await Promise.all([
    prisma.platformPhoneNumber.findUnique({ where: { phoneNumber: number } }),
    prisma.businessPhoneNumber.findUnique({
      where: { phoneNumber: number },
      select: {
        ...businessPhoneNumberLegacySelect,
        installedAgent: {
          select: { id: true, name: true, status: true, workflowId: true }
        }
      }
    }),
    getCallRoutingDiagnostics(number)
  ]);

  const assignedToThisBusiness = Boolean(
    (business && platformForNumber && platformForNumber.businessId === business.id) ||
    (business && businessPhoneForNumber && businessPhoneForNumber.businessId === business.id)
  );

  const installedAgent = businessPhoneForNumber?.installedAgent ?? business?.installedAgents?.[0] ?? null;

  const checks = [
    ...environmentChecks,
    { key: "number_exists", label: "Selected Triven number exists", ok: Boolean(platformForNumber || businessPhoneForNumber) },
    { key: "assigned_to_business", label: "Number is assigned to this business", ok: assignedToThisBusiness },
    { key: "business_phone_number", label: "BusinessPhoneNumber mapping exists", ok: Boolean(businessPhoneForNumber) },
    { key: "installed_agent_linked", label: "Mapping is linked to an installed agent", ok: Boolean(businessPhoneForNumber?.installedAgentId) },
    {
      key: "installed_agent_active",
      label: "Installed agent exists and is ACTIVE",
      ok: Boolean(installedAgent && installedAgent.status === "ACTIVE")
    },
    {
      key: "vapi_assistant",
      label: "Voice assistant deployed",
      ok: diagnostics.hasVapiAssistantId,
      message: diagnostics.hasVapiAssistantId
        ? undefined
        : "Created when you deploy in the Go live step — deploy, then re-test."
    },
    {
      key: "answering_mode_set",
      label: "Answering mode is set",
      ok: Boolean(diagnostics.routingMode),
      message: diagnostics.routingMode ? `Mode: ${diagnostics.routingMode}` : "Choose an answering mode in the Connect step."
    },
    { key: "answering_mode", label: "Answering mode allows answering", ok: diagnostics.aiWouldAnswer },
    { key: "resolver", label: "Inbound calls reach this agent", ok: diagnostics.resolved }
  ];

  const readyForCall = checks.every((check) => check.ok);

  return successResponse(c, {
    ok: readyForCall,
    number,
    webhookUrl,
    readyForCall,
    resolveReason: diagnostics.resolveReason,
    checks
  });
});

businessRoutes.post("/setup/test-deepgram", async (c) => {
  const authUser = c.get("authUser");

  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const bodySchema = z.object({
    audioBase64: z.string().min(1),
    mimeType: z.string().trim().optional(),
    model: z.string().trim().optional(),
    language: z.string().trim().optional(),
    smartFormat: z.boolean().optional(),
    punctuate: z.boolean().optional(),
    diarize: z.boolean().optional()
  });

  try {
    const input = bodySchema.parse(await c.req.json());
    const result = await transcribeWithDeepgram(input);
    if (result.status !== "success") {
      return errorResponse(
        c,
        result.error ?? "Deepgram transcription failed.",
        500,
        "DEEPGRAM_TRANSCRIBE_FAILED"
      );
    }
    return successResponse(c, result, "Audio transcribed.");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, "Invalid Deepgram transcription request.", 400, "INVALID_REQUEST");
    }
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Deepgram transcription failed.",
      500,
      "DEEPGRAM_TRANSCRIBE_FAILED"
    );
  }
});

businessRoutes.post("/setup/test-deepgram-speak", async (c) => {
  const authUser = c.get("authUser");

  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const bodySchema = z.object({
    text: z.string().min(1).max(2000),
    model: z.string().trim().optional(),
    encoding: z.string().trim().optional()
  });

  try {
    const input = bodySchema.parse(await c.req.json());
    const result = await speakWithDeepgram(input);
    if (result.status !== "success") {
      return errorResponse(
        c,
        result.error ?? "Deepgram speech synthesis failed.",
        500,
        "DEEPGRAM_SPEAK_FAILED"
      );
    }
    return successResponse(c, result, "Speech synthesized.");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, "Invalid Deepgram speak request.", 400, "INVALID_REQUEST");
    }
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Deepgram speech synthesis failed.",
      500,
      "DEEPGRAM_SPEAK_FAILED"
    );
  }
});

businessRoutes.post("/setup/test-sms", async (c) => {
  const authUser = c.get("authUser");

  // Sends a real SMS through the shared platform sender — purchased buyers only.
  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const body: Record<string, unknown> = await c.req
    .json()
    .then((parsed: unknown) => (isRecord(parsed) ? parsed : {}))
    .catch(() => ({}));

  // Explicit E.164 only — a bare 10-digit number is ambiguous and rejected.
  const recipient = validateSmsRecipientE164(typeof body.to === "string" ? body.to : "");
  if (!recipient.ok) {
    return errorResponse(c, recipient.error, 422, "INVALID_PHONE_NUMBER");
  }
  const to = recipient.e164;

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    include: {
      profile: { select: { timeZone: true } },
      phoneNumbers: includeActivePhoneNumbers(),
      installedAgents: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } }
    }
  });

  const businessName = business?.name || "your business";
  const businessPhone = business?.phoneNumbers?.[0]?.phoneNumber ?? "";

  const customMessage = typeof body.message === "string" ? body.message.trim().slice(0, 320) : "";

  const message = customMessage
    ? `${customMessage}\n\nSent by Triven (test). Reply STOP to opt out.`
    : [
      `Hi there,`,
      ``,
      `This is a test of your ${businessName} appointment confirmations from Triven.`,
      ``,
      ...(businessPhone ? [`For assistance call ${businessPhone}.`, ``] : []),
      `Reply STOP to opt out.`
    ].join("\n");

  const outcome = await sendTrackedSms({
    to,
    body: message,
    messageType: "TEST_SMS",
    businessId: business?.id ?? null,
    installedAgentId: business?.installedAgents?.[0]?.id ?? null
  });

  if (!outcome.sent) {
    return errorResponse(c, outcome.error ?? "Could not send the test SMS.", 500, "TEST_SMS_FAILED");
  }

  const mode = resolveTwilioSmsMode();
  const simulated = mode === "SIMULATED";
  return successResponse(
    c,
    {
      // "sent" = Twilio accepted a real API request (test credentials never deliver).
      sent: !simulated,
      simulated,
      testCredentials: mode === "TWILIO_TEST_CREDENTIALS",
      mode,
      messageSid: outcome.messageSid,
      status: outcome.status,
      messagingServiceSid: outcome.messagingServiceSid,
      from: outcome.from ?? (mode === "LIVE" ? env.TWILIO_SHARED_SMS_NUMBER ?? null : null),
      to,
      executionId: outcome.executionId
    },
    simulated
      ? "Test SMS simulated (no Twilio request)"
      : mode === "TWILIO_TEST_CREDENTIALS"
        ? "Test SMS accepted with Twilio test credentials (not delivered)"
        : "Test SMS sent"
  );
});

type SetupChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  blocker?: string;
};

function buildSetupReadiness(
  business: LoadedBusiness | null,
  calendarConnected: boolean,
  listingId?: string | null,
  calendlyConnected = false
) {
  const profile = business?.profile ?? null;
  const installedAgent = listingId
    ? business?.installedAgents?.find((agent) => agent.listingId === listingId) ?? null
    : business?.installedAgents?.[0] ?? null;
  // One number per agent: showing the business's first number here would make
  // a second agent's wizard claim it already has the first agent's number.
  const phone = installedAgent
    ? business?.phoneNumbers?.find((row) => row.installedAgentId === installedAgent.id) ?? null
    : business?.phoneNumbers?.find((row) => !row.installedAgentId) ?? null;
  const workflowJson = installedAgent?.workflow?.workflowJson ?? null;

  const config = (installedAgent?.configJson ?? null) as Record<string, unknown> | null;
  const phoneRoutingConfig =
    config && typeof config.phoneRouting === "object" && config.phoneRouting !== null
      ? (config.phoneRouting as Record<string, unknown>)
      : null;

  const answeringMode =
    phoneRoutingConfig && typeof phoneRoutingConfig.mode === "string"
      ? phoneRoutingConfig.mode
      : "AI_FIRST";

  const requiredConnectors: ConnectorRequirement[] = workflowJson
    ? requiredConnectorsForWorkflow(workflowJson)
    : [];

  const needs = new Set(requiredConnectors.filter((req) => !req.optional).map((req) => req.connector));

  const profileComplete = Boolean(business && profile && business.name && business.type);
  const calendarComplete = calendarConnected;
  const calendlyConfig =
    config && typeof config.calendly === "object" && config.calendly !== null && !Array.isArray(config.calendly)
      ? (config.calendly as Record<string, unknown>)
      : null;
  const calendlyEventTypeUri =
    typeof calendlyConfig?.eventTypeUri === "string" ? calendlyConfig.eventTypeUri.trim() : "";
  const calendlyComplete = calendlyConnected && Boolean(calendlyEventTypeUri);
  const phoneComplete = Boolean(phone) && (answeringMode === "AI_FIRST" || Boolean(phone?.forwardToPhone));
  const smsComplete = Boolean(phone);
  const voiceComplete = Boolean(profile?.vapiAssistantId);
  const telegramComplete =
    installedAgent?.telegramBot?.status === "ACTIVE" &&
    installedAgent.telegramBot.webhookStatus === "HEALTHY";

  const checklist: SetupChecklistItem[] = [
    {
      key: "business_profile",
      label: "Business profile",
      required: true,
      complete: profileComplete,
      blocker: profileComplete ? undefined : "Add your business name, type and services."
    },
    {
      key: "business_address",
      label: "Business address",
      required: false,
      complete: Boolean(profile?.addressLine1 && profile?.addressCity),
      blocker:
        profile?.addressLine1 && profile?.addressCity
          ? undefined
          : "Add your business address so the agent can tell callers where to come."
    },
    {
      key: "business_hours",
      label: "Business Hours",
      required: false,
      complete: Boolean(profile?.hoursConfirmedAt),
      blocker: profile?.hoursConfirmedAt
        ? undefined
        : "Confirm your Business Hours so the agent can answer open/closed questions."
    },
    {
      key: "google_calendar",
      label: "Google Calendar",
      required: needs.has("google_calendar"),
      complete: calendarComplete,
      blocker:
        needs.has("google_calendar") && !calendarComplete
          ? "Google Calendar is required before live booking."
          : undefined
    },
    {
      key: "calendly",
      label: "Calendly",
      required: needs.has("calendly"),
      complete: calendlyComplete,
      blocker:
        needs.has("calendly") && !calendlyComplete
          ? calendlyConnected
            ? "Select your default Calendly event type before going live."
            : "Connect Calendly before going live."
          : undefined
    },
    {
      key: "telegram",
      label: "Telegram bot",
      required: needs.has("telegram"),
      complete: telegramComplete,
      blocker:
        needs.has("telegram") && !telegramComplete
          ? "Connect and verify the dedicated Telegram bot before going live."
          : undefined
    },
    {
      key: "phone_routing",
      label: "Triven phone number & routing",
      required: needs.has("phone_provider") || needs.has("twilio"),
      complete: phoneComplete,
      blocker:
        (needs.has("phone_provider") || needs.has("twilio")) && !phoneComplete
          ? !phone
            ? "Select a Triven phone number."
            : "Add the phone number that should receive forwarded/live calls."
          : undefined
    },
    {
      key: "sms_sender",
      label: "SMS sender",
      required: needs.has("twilio"),
      complete: smsComplete,
      blocker:
        needs.has("twilio") && !smsComplete
          ? "An SMS sender is required before notifications."
          : undefined
    },
    {
      key: "voice",
      label: "Voice setup",
      required: needs.has("vapi"),
      complete: voiceComplete,
      blocker: needs.has("vapi") && !voiceComplete ? "A voice assistant must be deployed before live calls." : undefined
    }
  ];

  const blockers = checklist
    .filter((item) => item.required && !item.complete && item.blocker)
    .map((item) => item.blocker as string);

  const readyToDeploy = checklist.every((item) => !item.required || item.complete);

  return { requiredConnectors, checklist, readyToDeploy, blockers };
}

function serializeSetup(
  business: LoadedBusiness | null,
  calendar: { connected: boolean; email: string | null },
  listingId?: string | null,
  calendly: { connected: boolean; email: string | null } = { connected: false, email: null }
) {
  const profile = business?.profile ?? null;
  const installedAgent = listingId
    ? business?.installedAgents?.find((agent) => agent.listingId === listingId) ?? null
    : business?.installedAgents?.[0] ?? null;
  /* One number per agent. Reading phoneNumbers[0] here handed the SECOND
     agent's wizard whichever number the business happened to own first —
     normally the first agent's — so it looked already provisioned and the buyer
     was never offered a number of its own. Only this agent's own assignment
     counts; an unassigned spare is offered to an agent that has none yet. */
  const phone = installedAgent
    ? business?.phoneNumbers?.find((row) => row.installedAgentId === installedAgent.id) ?? null
    : business?.phoneNumbers?.find((row) => !row.installedAgentId) ?? null;
  const readiness = buildSetupReadiness(business, calendar.connected, listingId, calendly.connected);

  const config = (installedAgent?.configJson ?? null) as Record<string, unknown> | null;

  const voiceConfig =
    config && typeof config.voice === "object" && config.voice !== null
      ? (config.voice as Record<string, unknown>)
      : null;

  const phoneRoutingConfig =
    config && typeof config.phoneRouting === "object" && config.phoneRouting !== null
      ? (config.phoneRouting as Record<string, unknown>)
      : null;

  const silenceConfig =
    config && typeof config.silence === "object" && config.silence !== null
      ? (config.silence as Record<string, unknown>)
      : null;

  const assistantName =
    typeof config?.assistantName === "string" && config.assistantName.trim()
      ? config.assistantName.trim()
      : DEFAULT_ASSISTANT_NAME;

  return {
    business: business
      ? { id: business.id, name: business.name, type: business.type }
      : null,
    profile: profile
      ? {
        bookingUrl: profile.bookingUrl,
        teamPhone: profile.teamPhone,
        calendarId: profile.calendarId,
        timeZone: normalizeTimeZone(profile.timeZone),
        tone: profile.tone,
        escalationRules: profile.escalationRules,
        services: profile.services,
        faqs: profile.faqsJson ?? [],
        hours: profile.hoursJson ?? [],
        vapiAssistantId: profile.vapiAssistantId,
        vapiPhoneNumberId: profile.vapiPhoneNumberId
      }
      : null,
    phoneNumber: phone
      ? {
        phoneNumber: phone.phoneNumber,
        forwardToPhone: phone.forwardToPhone,
        twilioPhoneNumberSid: phone.twilioPhoneNumberSid
      }
      : null,
    installedAgent: installedAgent
      ? { id: installedAgent.id, name: installedAgent.name, status: installedAgent.status }
      : null,
    assistantName,
    knowledge:
      business?.knowledgeBases
        ?.filter((item) => !item.sourceFileId)
        .map((item) => ({
          title: item.title,
          content: item.content
        })) ?? [],
    calendar: { connected: calendar.connected, email: calendar.email },
    calendly: {
      connected: calendly.connected,
      email: calendly.email,
      eventTypeUri:
        typeof (config?.calendly as Record<string, unknown> | undefined)?.eventTypeUri === "string"
          ? String((config?.calendly as Record<string, unknown>).eventTypeUri)
          : null,
      eventTypeName:
        typeof (config?.calendly as Record<string, unknown> | undefined)?.eventTypeName === "string"
          ? String((config?.calendly as Record<string, unknown>).eventTypeName)
          : null,
      schedulingUrl:
        typeof (config?.calendly as Record<string, unknown> | undefined)?.schedulingUrl === "string"
          ? String((config?.calendly as Record<string, unknown>).schedulingUrl)
          : null
    },
    webhooks: phone ? buildWebhookUrls() : null,
    requiredConnectors: readiness.requiredConnectors,
    checklist: readiness.checklist,
    readyToDeploy: readiness.readyToDeploy,
    blockers: readiness.blockers,
    voiceSelection: voiceConfig
      ? {
        name: typeof voiceConfig.name === "string" ? voiceConfig.name : null,
        voiceId: typeof voiceConfig.voiceId === "string" ? voiceConfig.voiceId : null,
        provider: typeof voiceConfig.provider === "string" ? voiceConfig.provider : null
      }
      : null,
    answeringMode:
      phoneRoutingConfig && typeof phoneRoutingConfig.mode === "string"
        ? phoneRoutingConfig.mode
        : null,
    answeringHours: Array.isArray(phoneRoutingConfig?.answeringHours)
      ? phoneRoutingConfig.answeringHours
      : null,
    aiCallCoverage:
      phoneRoutingConfig && typeof phoneRoutingConfig.coverage === "string"
        ? phoneRoutingConfig.coverage
        : phoneRoutingConfig?.mode === "CUSTOM_HOURS"
          ? "custom"
          : "always",
    contactName: typeof config?.contactName === "string" ? config.contactName : null,
    customInstructions: typeof config?.customInstructions === "string" ? config.customInstructions : null,
    customFields: Array.isArray(config?.customFields)
      ? (config.customFields as Array<Record<string, unknown>>)
        .filter((item) => typeof item === "object" && item !== null)
        .map((item) => ({
          key: typeof item.key === "string" ? item.key : "",
          label: typeof item.label === "string" ? item.label : "",
          value:
            typeof item.value === "string" || typeof item.value === "boolean" || typeof item.value === "number"
              ? item.value
              : Array.isArray(item.value)
                ? item.value.filter((entry): entry is string => typeof entry === "string")
                : ""
        }))
        .filter((item) => item.key)
      : [],
    // Buyer setup schema snapshot saved at install time — lets the setup form
    // re-render the agent-specific fields without re-fetching the listing.
    buyerSetupSchema: normalizeBuyerSetupFields(config?.buyerSetupSchema),
    // Buyer-owned Send Email recipients; null until the buyer saves them.
    emailRecipients: extractBuyerEmailRecipients(config),
    // After-hours routing policy; null until the buyer (or template) sets one.
    afterHoursPolicy: normalizeAfterHoursPolicy(config?.afterHoursPolicy),
    triggerKind: (installedAgent as any)?.workflow?.workflowJson
      ? getWorkflowTriggerKind((installedAgent as any).workflow.workflowJson)
      : null,
    setupTimeEstimate: (installedAgent as any)?.listing?.setupTimeEstimate 
      || ((installedAgent as any)?.workflow?.configureJson as any)?.template?.setupTimeEstimate 
      || null,
    silence: silenceConfig
      ? {
        repromptCount: typeof silenceConfig.repromptCount === "number" ? silenceConfig.repromptCount : null,
        reprompt1: typeof silenceConfig.reprompt1 === "string" ? silenceConfig.reprompt1 : null,
        reprompt2: typeof silenceConfig.reprompt2 === "string" ? silenceConfig.reprompt2 : null,
        goodbye: typeof silenceConfig.goodbye === "string" ? silenceConfig.goodbye : null
      }
      : null
  };
}

/* ---- Mail Setup (proxy email alias on reply.triven.ai) ---- */

const mailSetupSchema = z.object({
  localPart: z.string().trim().min(1, "Email alias is required").max(50),
  displayName: z.string().trim().min(1, "Sender name is required").max(120),
  forwardToEmail: z.string().trim().optional().or(z.literal("")),
  replyHandlingMode: z.enum(["TRIVEN_INBOX", "FORWARD_ONLY", "TRIVEN_AND_FORWARD"]).default("TRIVEN_AND_FORWARD"),
  customerConfirmationEnabled: z.boolean().optional(),
  internalSummaryEnabled: z.boolean().optional()
});

function serializeAlias(alias: NonNullable<Awaited<ReturnType<typeof getBusinessEmailAlias>>>) {
  return {
    id: alias.id,
    localPart: alias.localPart,
    domain: alias.domain,
    emailAddress: alias.emailAddress,
    displayName: alias.displayName,
    forwardToEmail: alias.forwardToEmail,
    replyHandlingMode: alias.replyHandlingMode,
    customerConfirmationEnabled: alias.customerConfirmationEnabled,
    internalSummaryEnabled: alias.internalSummaryEnabled,
    status: alias.status
  };
}

businessRoutes.get("/mail-setup", async (c) => {
  const authUser = c.get("authUser");
  const business = await prisma.business.findFirst({ where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" } });

  const alias = business ? await getBusinessEmailAlias(business.id) : null;
  const suggestedLocalPart = alias
    ? alias.localPart
    : await generateSuggestedAlias(business?.name || "business");

  return successResponse(c, {
    alias: alias ? serializeAlias(alias) : null,
    suggestedLocalPart,
    domain: env.SES_FROM_DOMAIN,
    sesConfigured: isSesConfigured()
  });
});

businessRoutes.get("/mail-setup/check", async (c) => {
  const authUser = c.get("authUser");
  const raw = c.req.query("localPart") ?? "";
  const localPart = normalizeEmailAliasLocalPart(raw);
  const issue = validateLocalPart(localPart);

  if (issue) return successResponse(c, { localPart, available: false, reason: issue.message });

  const business = await prisma.business.findFirst({ where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" }, select: { id: true } });
  const available = await isLocalPartAvailable(localPart, business?.id);
  return successResponse(c, { localPart, available, reason: available ? null : "This alias is already taken." });
});

businessRoutes.post("/mail-setup", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = mailSetupSchema.parse(await c.req.json());

    const business = await prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
      include: { installedAgents: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    if (!business) {
      return errorResponse(c, "Create your business profile first (Configure step of setup).", 404, "BUSINESS_NOT_FOUND");
    }

    const result = await createOrUpdateBusinessEmailAlias({
      businessId: business.id,
      buyerUserId: authUser.id,
      installedAgentId: business.installedAgents[0]?.id ?? null,
      localPart: input.localPart,
      displayName: input.displayName,
      forwardToEmail: input.forwardToEmail || null,
      replyHandlingMode: input.replyHandlingMode,
      customerConfirmationEnabled: input.customerConfirmationEnabled,
      internalSummaryEnabled: input.internalSummaryEnabled
    });

    if (!result.ok) return errorResponse(c, result.error, 422, "MAIL_SETUP_INVALID");
    return successResponse(c, { alias: serializeAlias(result.alias) }, "Mail setup saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION_ERROR");
    }
    throw error;
  }
});

businessRoutes.post("/mail-setup/test-email", async (c) => {
  const authUser = c.get("authUser");

  // Sends a real email through the platform proxy — purchased buyers only.
  if (!(await hasAnyAgentAcquisition(authUser.id))) {
    return errorResponse(c, "Purchase an agent before using setup test tools.", 403, "PURCHASE_REQUIRED");
  }

  const body = (await c.req.json().catch(() => ({}))) as { to?: string };

  const business = await prisma.business.findFirst({ where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" } });
  if (!business) return errorResponse(c, "Business not found.", 404, "BUSINESS_NOT_FOUND");

  const alias = await getBusinessEmailAlias(business.id);
  if (!alias) return errorResponse(c, "Save your mail setup first.", 422, "MAIL_SETUP_MISSING");

  const to = body.to?.trim() || alias.forwardToEmail;
  if (!to || !isValidEmailAddress(to)) {
    return errorResponse(c, "Add a valid forward-to email (or pass one) for the test.", 422, "INVALID_TEST_RECIPIENT");
  }

  const result = await sendBusinessEmail({
    businessId: business.id,
    to,
    subject: `Test email from ${alias.displayName} via Triven`,
    textBody: `This is a test email from your Triven proxy address.\n\nFrom: ${alias.displayName} via Triven <${alias.emailAddress}>\nReplies go to: ${alias.emailAddress}\n\nIf you received this, your mail setup works.`,
    purpose: "TEST"
  });

  if (!result.ok) return errorResponse(c, result.error, 422, "TEST_EMAIL_FAILED");
  return successResponse(c, { messageId: result.messageId, dryRun: result.dryRun }, "Test email sent");
});

businessRoutes.get("/setup", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.query("listingId")?.trim() || null;

  const [business, calendar, calendly] = await Promise.all([
    loadBusinessForOwner(authUser.id),
    getGmailConnectionStatus(authUser.id),
    getCalendlyConnectionStatus(authUser.id)
  ]);

  // Scope the number picker to THIS agent, so a second agent is never shown the
  // first agent's number as already selected.
  const setupAgent = listingId
    ? business?.installedAgents?.find((agent) => agent.listingId === listingId) ?? null
    : business?.installedAgents?.[0] ?? null;
  const phoneOptions = await loadPhoneOptions(business?.id ?? null, setupAgent?.id ?? null);
  let setupVisibility = deriveSetupVisibility(null);

  if (listingId) {
    const listing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      include: { workflow: { select: { workflowJson: true } } }
    });
    const wfJson = listing?.workflow?.workflowJson;
    setupVisibility = deriveSetupVisibility(wfJson, listing?.requiredConnectors as string[] | undefined);
  }

  return successResponse(c, {
    ...serializeSetup(business, calendar, listingId, {
      connected: calendly.connected,
      email: calendly.email
    }),
    ...phoneOptions,
    setupVisibility
  });
});

businessRoutes.post("/setup", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = businessSetupSchema.parse(await c.req.json());

    // Only contact methods with a real delivery path may be saved — a stored
    // PHONE/WEBHOOK value would silently do nothing at emergency time.
    if (
      input.afterHoursPolicy?.emergencyContactMethod &&
      !isSupportedAfterHoursContactMethod(input.afterHoursPolicy.emergencyContactMethod)
    ) {
      return errorResponse(
        c,
        `Emergency contact method "${input.afterHoursPolicy.emergencyContactMethod}" is not supported yet. Choose SMS, EMAIL, or NONE.`,
        422,
        AFTER_HOURS_CONTACT_METHOD_UNSUPPORTED
      );
    }

    if (input.deploy) {
      const access = await canBusinessDeployAgent(authUser.id);
      if (!access.allowed) {
        console.warn("[business.setup] deploy blocked by subscription enforcement", {
          ownerId: authUser.id,
          enforcement: access.subscriptionEnforcementEnabled
        });
        return errorResponse(
          c,
          "An active subscription is required before activating your AI agent.",
          402,
          "SUBSCRIPTION_REQUIRED"
        );
      }
    }

    const existing = await prisma.business.findFirst({
      where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
      include: {
        profile: { select: { timeZone: true } },
        phoneNumbers: includeActivePhoneNumbers(),
        installedAgents: { orderBy: { createdAt: "desc" } }
      }
    });

    const phoneAgentForSetup = input.listingId
      ? existing?.installedAgents?.find((agent) => agent.listingId === input.listingId) ?? null
      : existing?.installedAgents?.[0] ?? null;
    const existingPhone = phoneAgentForSetup
      ? existing?.phoneNumbers?.find((row) => row.installedAgentId === phoneAgentForSetup.id) ?? null
      : null;

    let targetPlatform: Awaited<ReturnType<typeof prisma.platformPhoneNumber.findFirst>> = null;
    const selectedId = input.selectedPlatformPhoneNumberId?.trim();
    const selectedNumber = input.selectedPhoneNumber ? normalizePhoneNumber(input.selectedPhoneNumber) : "";

    if (selectedId) {
      targetPlatform = await prisma.platformPhoneNumber.findUnique({ where: { id: selectedId } });

      if (!targetPlatform) {
        return errorResponse(c, "Selected phone number was not found.", 404, "PHONE_NUMBER_NOT_FOUND");
      }
    } else if (selectedNumber) {
      targetPlatform = await prisma.platformPhoneNumber.findFirst({ where: { phoneNumber: selectedNumber } });
    }

    if (targetPlatform?.isPlatformSmsSender) {
      return errorResponse(
        c,
        "That number is the reserved shared Triven SMS sender and cannot be used as a business number.",
        409,
        "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE"
      );
    }

    if (
      targetPlatform &&
      targetPlatform.status === "ASSIGNED" &&
      ((targetPlatform.businessId && targetPlatform.businessId !== (existing?.id ?? null)) ||
        // Reserved at purchase time by another buyer (no business yet) —
        // just as taken as an assigned one.
        (!targetPlatform.businessId &&
          targetPlatform.buyerUserId &&
          targetPlatform.buyerUserId !== authUser.id))
    ) {
      return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
    }

    const resolved = await resolveReceptionistWorkflow({
      ownerId: authUser.id,
      workflowId: input.workflowId || undefined,
      listingId: input.listingId || undefined
    });

    const agentForAccessCheck = input.listingId
      ? existing?.installedAgents?.find((agent) => agent.listingId === input.listingId) ?? null
      : existing?.installedAgents?.[0] ?? null;

    const setupAccess = await canBusinessRunSetup({
      userId: authUser.id,
      requestedListingId: input.listingId || null,
      requestedWorkflowId: input.workflowId || null,
      resolvedListingId: resolved.listingId ?? null,
      existingAgent: agentForAccessCheck
        ? { listingId: agentForAccessCheck.listingId, workflowId: agentForAccessCheck.workflowId }
        : null
    });

    if (!setupAccess.allowed) {
      return errorResponse(
        c,
        "Purchase this agent before configuring, deploying, or testing it.",
        403,
        "PURCHASE_REQUIRED"
      );
    }

    const setupListingId = input.listingId || existing?.installedAgents?.[0]?.listingId || resolved.listingId || null;
    const setupListing = setupListingId
      ? await prisma.agentListing.findUnique({
        where: { id: setupListingId },
        select: { requiredBuyerSetup: true }
      })
      : null;
    const buyerSetupFields = normalizeBuyerSetupFields(setupListing?.requiredBuyerSetup);

    if (buyerSetupFields.length > 0) {
      // Only keys defined in the listing's schema are accepted — anything else
      // is rejected so answers can't be smuggled past validation. Agents
      // without a schema (older installs) keep the previous open behavior.
      const allowedKeys = new Set(buyerSetupFields.map((field) => field.key));
      const unknownField = input.customFields.find((field) => !allowedKeys.has(field.key));

      if (unknownField) {
        return errorResponse(c, `Unknown setup field: ${unknownField.key}`, 422, "BUYER_SETUP_UNKNOWN_FIELD");
      }

      const answerIssues = validateBuyerSetupAnswers(buyerSetupFields, input.customFields, {
        requireMissing: input.deploy
      });

      if (answerIssues.length > 0) {
        return errorResponse(c, answerIssues.map((issue) => issue.message).join(" "), 422, "BUYER_SETUP_INVALID");
      }
    }

    // Normalize + validate buyer email recipients before they reach configJson.
    // Every typed address must be valid — silent drops would surprise buyers.
    const firstInvalidEmail = (raw: string) =>
      raw
        .split(/[,;\s]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .find((entry) => !isValidEmailAddress(entry));

    let emailRecipients: { recipientType: "customer" | "team" | "custom"; customRecipient: string; cc: string[]; bcc: string[] } | null = null;
    if (input.emailRecipients) {
      const customRecipient = (input.emailRecipients.customRecipient ?? "").trim().toLowerCase();
      const ccRaw = input.emailRecipients.cc ?? "";
      const bccRaw = input.emailRecipients.bcc ?? "";

      if (input.emailRecipients.recipientType === "custom" && !isValidEmailAddress(customRecipient)) {
        return errorResponse(c, "Enter a valid recipient email address for agent emails.", 422, "EMAIL_RECIPIENTS_INVALID");
      }

      const invalidCc = firstInvalidEmail(ccRaw);
      if (invalidCc) {
        return errorResponse(c, `Invalid CC email address: ${invalidCc}`, 422, "EMAIL_RECIPIENTS_INVALID");
      }

      const invalidBcc = firstInvalidEmail(bccRaw);
      if (invalidBcc) {
        return errorResponse(c, `Invalid BCC email address: ${invalidBcc}`, 422, "EMAIL_RECIPIENTS_INVALID");
      }

      emailRecipients = {
        recipientType: input.emailRecipients.recipientType,
        customRecipient: input.emailRecipients.recipientType === "custom" ? customRecipient : "",
        cc: parseEmailList(ccRaw),
        bcc: parseEmailList(bccRaw)
      };
    }

    const timeZone = input.timeZone?.trim()
      ? normalizeTimeZone(input.timeZone)
      : normalizeTimeZone(existing?.profile?.timeZone || undefined);
    const assistantName = cleanAssistantName(input.assistantName);

    const profileData = {
      bookingUrl: cleanOptional(input.bookingUrl),
      teamPhone: cleanOptional(input.teamPhone),
      calendarId: input.calendarId || "primary",
      ...(input.timeZone?.trim() ? { timeZone } : {}),
      tone: input.tone,
      escalationRules: cleanOptional(input.escalationRules),
      services: input.services,
      faqsJson: input.faqs as never,
      ...(input.hours.length > 0 ? { hoursJson: input.hours as never } : {}),
      ...(cleanOptional(input.vapiAssistantId) ? { vapiAssistantId: cleanOptional(input.vapiAssistantId) } : {}),
      ...(cleanOptional(input.vapiPhoneNumberId) ? { vapiPhoneNumberId: cleanOptional(input.vapiPhoneNumberId) } : {})
    };

    const business = existing
      ? await prisma.business.update({
        where: { id: existing.id },
        data: { name: input.businessName, type: input.businessType }
      })
      : await prisma.business.create({
        data: { ownerId: authUser.id, name: input.businessName, type: input.businessType }
      });

    await prisma.businessProfile.upsert({
      where: { businessId: business.id },
      update: profileData,
      create: { businessId: business.id, ...profileData }
    });

    // Manual knowledge only — document chunks are owned by the uploaded-file
    // pipeline and survive every setup save.
    await replaceManualKnowledge(
      business.id,
      input.knowledge.map((item) => ({ title: item.title, content: item.content }))
    );

    // One authoritative Business Address: written here AND from Business
    // Settings — both interfaces always show the same saved value. A save
    // without the field never clears an existing address.
    let addressLiveSync: Awaited<ReturnType<typeof refreshLiveAssistantKnowledge>> | null = null;
    if (input.businessAddress) {
      await saveBusinessAddress(business.id, input.businessAddress);
      addressLiveSync = await refreshLiveAssistantKnowledge(business.id);
    }

    // Existing agent config — settings not sent by this save are preserved,
    // never silently overwritten.
    const existingAgentRow = input.listingId
      ? existing?.installedAgents?.find((agent) => agent.listingId === input.listingId) ?? null
      : existing?.installedAgents?.[0] ?? null;
    const existingAgentConfig =
      existingAgentRow?.configJson && typeof existingAgentRow.configJson === "object" && !Array.isArray(existingAgentRow.configJson)
        ? (existingAgentRow.configJson as Record<string, unknown>)
        : {};

    const existingPhoneRouting =
      typeof existingAgentConfig.phoneRouting === "object" &&
      existingAgentConfig.phoneRouting !== null &&
      !Array.isArray(existingAgentConfig.phoneRouting)
        ? (existingAgentConfig.phoneRouting as Record<string, unknown>)
        : {};

    const answeringMode =
      input.answeringMode ||
      (typeof existingPhoneRouting.mode === "string" && existingPhoneRouting.mode.trim()
        ? existingPhoneRouting.mode
        : "AI_FIRST");
    const coverage = input.aiCallCoverage ?? null;
    const coverageAnsweringHours =
      coverage?.kind === "custom" && coverage.answeringHours?.length
        ? coverage.answeringHours
        : input.answeringHours?.length
          ? input.answeringHours
          : null;
    const configJson = {
      ...existingAgentConfig,
      connectors: ["TWILIO", "VAPI", "GOOGLE_CALENDAR"],
      ...(cleanOptional(input.vapiAssistantId) ? { vapiAssistantId: cleanOptional(input.vapiAssistantId) } : {}),
      ...(cleanOptional(input.vapiPhoneNumberId) ? { vapiPhoneNumberId: cleanOptional(input.vapiPhoneNumberId) } : {}),
      calendarId: input.calendarId || "primary",
      assistantName,
      calendar: {
        calendarId: input.calendarId || "primary",
        timezone: timeZone
      },
      voice: {
        name: cleanOptional(input.voice),
        voiceId: cleanOptional(input.voiceId),
        provider: cleanOptional(input.voiceProvider)
      },
      phoneRouting: {
        ...existingPhoneRouting,
        mode: answeringMode,
        ...(coverage ? { coverage: coverage.kind } : {}),
        ...(coverageAnsweringHours ? { answeringHours: coverageAnsweringHours } : {})
      },
      contactName: resolveContactName(input.contactName, input.allContactNames),
      customInstructions: cleanOptional(input.customInstructions),
      ...(emailRecipients ? { emailRecipients } : {}),
      ...(input.scheduling ? { scheduling: input.scheduling } : {}),
      ...(input.appointmentSchedule ? { appointmentSchedule: input.appointmentSchedule } : {}),
      // Conditional spread: omitting afterHoursPolicy on a save preserves the
      // stored policy (same MERGE contract as scheduling/emailRecipients).
      ...(input.afterHoursPolicy
        ? { afterHoursPolicy: normalizeAfterHoursPolicy(input.afterHoursPolicy) }
        : {}),
      ...(input.customFields.length > 0 || buyerSetupFields.length > 0
        ? { customFields: input.customFields.filter((field) => !isBuyerAnswerEmpty(field.value)) }
        : {}),
      ...(buyerSetupFields.length > 0 ? { buyerSetupSchema: buyerSetupFields } : {}),
      ...(input.calendlyEventTypeUri?.trim()
        ? {
            calendly: {
              ...(typeof existingAgentConfig.calendly === "object" &&
              existingAgentConfig.calendly !== null &&
              !Array.isArray(existingAgentConfig.calendly)
                ? (existingAgentConfig.calendly as Record<string, unknown>)
                : {}),
              eventTypeUri: input.calendlyEventTypeUri.trim(),
              ...(input.calendlyEventTypeName?.trim()
                ? { eventTypeName: input.calendlyEventTypeName.trim() }
                : {}),
              ...(input.calendlySchedulingUrl?.trim()
                ? { schedulingUrl: input.calendlySchedulingUrl.trim() }
                : {})
            }
          }
        : {}),
      businessDetails: {
        assistantName,
        businessName: input.businessName,
        businessType: input.businessType,
        contactName: resolveContactName(input.contactName, input.allContactNames),
        services: input.services
      },
      silence: {
        repromptCount: input.silenceRepromptCount ?? 2,
        reprompt1: cleanOptional(input.silenceRepromptMessage1),
        reprompt2: cleanOptional(input.silenceRepromptMessage2),
        goodbye: cleanOptional(input.goodbyeMessage)
      }
    };

    const existingAgent = resolved.listingId
      ? existing?.installedAgents?.find((agent) => agent.listingId === resolved.listingId) ?? null
      : existing?.installedAgents?.[0] ?? null;
    const resolvedListingTerms = resolved.listingId
      ? await prisma.agentListing.findUnique({
          where: { id: resolved.listingId },
          select: { executionFeeCents: true }
        })
      : null;

    let installedAgent: InstalledAgent;
    if (existingAgent) {
      installedAgent = await prisma.installedAgent.update({
        where: { id: existingAgent.id },
        data: {
          workflowId: resolved.workflow.id,
          listingId: resolved.listingId ?? undefined,
          name: resolved.workflow.name,
          configJson: configJson as never
        }
      });
    } else {
      try {
        installedAgent = await prisma.installedAgent.create({
          data: {
            businessId: business.id,
            workflowId: resolved.workflow.id,
            listingId: resolved.listingId ?? undefined,
            name: resolved.workflow.name,
            status: "PROVISIONING",
            executionFeeCents: resolvedListingTerms?.executionFeeCents ?? 0,
            trialExecutionLimit: 50,
            configJson: configJson as never
          }
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          throw error;
        }

        const concurrent = await prisma.installedAgent.findFirst({
          where: { businessId: business.id, listingId: resolved.listingId ?? null },
          orderBy: { createdAt: "desc" }
        });

        if (!concurrent) throw error;

        installedAgent = await prisma.installedAgent.update({
          where: { id: concurrent.id },
          data: {
            workflowId: resolved.workflow.id,
            name: resolved.workflow.name,
            configJson: configJson as never
          }
        });
      }
    }

    if (resolved.listingId) {
      await prisma.payment.updateMany({
        where: {
          userId: authUser.id,
          listingId: resolved.listingId,
          installedAgentId: null,
          OR: [{ businessId: business.id }, { businessId: null }]
        },
        data: {
          businessId: business.id,
          installedAgentId: installedAgent.id
        }
      });
    }

    const billingNow = new Date();
    const [blockingUsageDebt, blockingAgentDebt] = await Promise.all([
      prisma.businessUsageInvoice.count({
        where: {
          businessId: business.id,
          installedAgentId: installedAgent.id,
          status: "OVERDUE",
          OR: [
            { suspendedAt: { not: null } },
            { graceEndsAt: { lte: billingNow } }
          ]
        }
      }),
      resolved.listingId
        ? prisma.payment.count({
            where: {
              userId: authUser.id,
              listingId: resolved.listingId,
              status: "OVERDUE",
              AND: [
                {
                  OR: [
                    { installedAgentId: installedAgent.id },
                    { installedAgentId: null }
                  ]
                },
                {
                  OR: [
                    { suspendedAt: { not: null } },
                    { graceEndsAt: { lte: billingNow } }
                  ]
                }
              ]
            }
          })
        : Promise.resolve(0)
    ]);
    if (
      installedAgent.status === "SUSPENDED_BILLING" ||
      blockingUsageDebt > 0 ||
      blockingAgentDebt > 0
    ) {
      return errorResponse(
        c,
        "Clear overdue billing before reactivating this agent.",
        402,
        "BILLING_PAYMENT_REQUIRED"
      );
    }

    const forward = normalizePhoneNumber(input.forwardToPhone || "");
    let businessPhone: Awaited<ReturnType<typeof prisma.businessPhoneNumber.findFirst>> = null;

    if (!targetPlatform && !existingPhone) {
      const adopted = await findBuyerPlatformNumber({
        buyerUserId: authUser.id,
        businessId: business.id
      });

      if (adopted) {
        targetPlatform = adopted;
      } else if (workflowNeedsPhoneNumber(resolved.workflow.workflowJson)) {
        console.log("[phone-provision] no number yet — buyer must select one via phone-numbers/search+purchase", {
          businessId: business.id
        });
      }
    }

    const selectedPlatformNumberId =
      targetPlatform?.id ??
      (
        existingPhone
          ? await prisma.platformPhoneNumber.findFirst({
              where: {
                phoneNumber: existingPhone.phoneNumber,
                businessId: business.id,
                status: "ASSIGNED",
                isPlatformSmsSender: false
              },
              select: { id: true }
            })
          : null
      )?.id ??
      null;
    const selectedPhoneFee = selectedPlatformNumberId
      ? await getPhoneNumberFeeForPlatformNumber(selectedPlatformNumberId, {
          refreshFromTwilio: true
        })
      : null;

    if (targetPlatform) {
      const targetNumber = normalizePhoneNumber(targetPlatform.phoneNumber);

      const conflicting = await prisma.businessPhoneNumber.findUnique({
        where: { phoneNumber: targetNumber },
        select: { id: true, businessId: true, phoneNumber: true, isActive: true }
      });
      if (conflicting && conflicting.isActive && conflicting.businessId !== business.id) {
        return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
      }

      businessPhone = await prisma
        .$transaction(async (tx) => {
          const fresh = await tx.platformPhoneNumber.findUnique({
            where: { id: targetPlatform.id }
          });

          if (
            !fresh ||
            fresh.isPlatformSmsSender ||
            (fresh.businessId && fresh.businessId !== business.id) ||
            // Reserved for a different buyer at purchase time.
            (!fresh.businessId && fresh.buyerUserId && fresh.buyerUserId !== authUser.id)
          ) {
            throw new Error("PHONE_NUMBER_TAKEN");
          }

          if (
            existingPhone &&
            existingPhone.phoneNumber !== targetNumber &&
            existingPhone.installedAgentId === installedAgent.id
          ) {
            await tx.platformPhoneNumber.updateMany({
              where: { phoneNumber: existingPhone.phoneNumber, businessId: business.id },
              data: {
                status: "AVAILABLE",
                businessId: null,
                buyerUserId: null,
                assignedAt: null,
                feeBilledAt: null
              }
            });

            await tx.businessPhoneNumber.update({
              where: { id: existingPhone.id },
              data: { isActive: false, installedAgentId: null }
            });
          }

          const mapping = await tx.businessPhoneNumber.upsert({
            where: { phoneNumber: targetNumber },
            update: {
              businessId: business.id,
              installedAgentId: installedAgent.id,
              provider: targetPlatform.provider,
              twilioPhoneNumberSid: targetPlatform.twilioSid ?? null,
              forwardToPhone: forward,
              isActive: true
            },
            create: {
              businessId: business.id,
              installedAgentId: installedAgent.id,
              phoneNumber: targetNumber,
              provider: targetPlatform.provider,
              twilioPhoneNumberSid: targetPlatform.twilioSid ?? null,
              forwardToPhone: forward,
              isActive: true
            }
          });

          await tx.platformPhoneNumber.update({
            where: { id: targetPlatform.id },
            data: {
              status: "ASSIGNED",
              businessId: business.id,
              buyerUserId: authUser.id,
              installedAgentId: installedAgent.id,
              assignedAt: fresh.assignedAt ?? new Date()
            }
          });
          if (selectedPhoneFee) {
            await addPhoneNumberFeeToPendingInvoiceTx(
              tx,
              {
                platformPhoneNumberId: targetPlatform.id,
                businessId: business.id,
                installedAgentId: installedAgent.id,
                chargedAt: new Date()
              },
              selectedPhoneFee
            );
          }

          // Release any other number still reserved for this buyer at
          // purchase time (businessId null) — they went with a different one,
          // and unadopted reservations would leak provider rent forever.
          await tx.platformPhoneNumber.updateMany({
            where: {
              buyerUserId: authUser.id,
              businessId: null,
              status: "ASSIGNED",
              NOT: { id: targetPlatform.id }
            },
            data: {
              status: "AVAILABLE",
              buyerUserId: null,
              installedAgentId: null,
              assignedAt: null,
              feeBilledAt: null
            }
          });

          return mapping;
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === "PHONE_NUMBER_TAKEN") return null;
          throw error;
        });

      if (!businessPhone) {
        return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
      }
    } else if (existingPhone) {
      businessPhone = await prisma.$transaction(async (tx) => {
        const mapping = await tx.businessPhoneNumber.update({
          where: { id: existingPhone.id },
          data: {
            forwardToPhone: forward,
            installedAgentId: installedAgent.id,
            isActive: true
          }
        });
        const assigned = await tx.platformPhoneNumber.findFirst({
          where: {
            phoneNumber: existingPhone.phoneNumber,
            businessId: business.id,
            status: "ASSIGNED",
            isPlatformSmsSender: false
          },
          select: { id: true }
        });
        if (assigned) {
          await tx.platformPhoneNumber.update({
            where: { id: assigned.id },
            data: {
              buyerUserId: authUser.id,
              installedAgentId: installedAgent.id
            }
          });
          if (selectedPhoneFee) {
            await addPhoneNumberFeeToPendingInvoiceTx(
              tx,
              {
                platformPhoneNumberId: assigned.id,
                businessId: business.id,
                installedAgentId: installedAgent.id,
                chargedAt: new Date()
              },
              selectedPhoneFee
            );
          }
        }
        return mapping;
      });
    }

    let deployedVapiAssistantId: string | null = null;

    if (input.deploy !== false) {
      const usesVoice = workflowUsesVoice(resolved.workflow.workflowJson);

      if (usesVoice) {
        const voiceDeploy = await deployInstalledAgentVoiceAssistant(
          business.id,
          installedAgent.id
        );
        deployedVapiAssistantId = voiceDeploy?.assistantId ?? null;

        if (!deployedVapiAssistantId) {
          return errorResponse(
            c,
            "Live voice assistant was not created. Make sure the workflow has an AI Voice Conversation node and Vapi is configured.",
            500,
            "VAPI_ASSISTANT_DEPLOY_FAILED"
          );
        }
      }

      const prevConfig = (installedAgent.configJson as Record<string, unknown> | null) ?? {};

      installedAgent = await prisma.installedAgent.update({
        where: { id: installedAgent.id },
        data: {
          status: "ACTIVE",
          configJson: {
            ...prevConfig,
            vapiAssistantId: deployedVapiAssistantId
          } as never
        }
      });
    }

    const setupLiveSync = deployedVapiAssistantId
      ? null
      : await refreshLiveAssistantKnowledge(business.id);

    const [refreshed, calendar, calendly] = await Promise.all([
      loadBusinessForOwner(authUser.id),
      getGmailConnectionStatus(authUser.id),
      getCalendlyConnectionStatus(authUser.id)
    ]);

    const refreshedAgent = input.listingId
      ? refreshed?.installedAgents?.find((agent) => agent.listingId === input.listingId) ?? null
      : refreshed?.installedAgents?.[0] ?? null;
    // Agent-scoped, so the saved response cannot echo a sibling agent's number.
    const phoneOptions = await loadPhoneOptions(refreshed?.id ?? null, refreshedAgent?.id ?? null);
    const refreshedConfig = (refreshedAgent?.configJson ?? null) as Record<string, unknown> | null;

    const responseVapiAssistantId =
      deployedVapiAssistantId ||
      (typeof refreshedConfig?.vapiAssistantId === "string" && refreshedConfig.vapiAssistantId
        ? (refreshedConfig.vapiAssistantId as string)
        : null) ||
      refreshed?.profile?.vapiAssistantId ||
      null;

    return successResponse(
      c,
      {
        ...serializeSetup(refreshed, calendar, input.listingId, {
          connected: calendly.connected,
          email: calendly.email
        }),
        installedAgentId: refreshedAgent?.id ?? installedAgent.id,
        assignedPhoneNumber: businessPhone?.phoneNumber ?? null,
        vapiAssistantId: responseVapiAssistantId,
        ...(addressLiveSync ? { addressLiveSync } : {}),
        ...(setupLiveSync ? { liveSync: setupLiveSync } : {}),
        ...phoneOptions
      },
      "Business setup saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid setup input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(
      c,
      errorMessage(error, "Could not save business setup"),
      500,
      "BUSINESS_SETUP_FAILED"
    );
  }
});

businessRoutes.get("/connectors/google-calendar/status", async (c) => {
  const authUser = c.get("authUser");
  const status = await getGmailConnectionStatus(authUser.id);
  return successResponse(c, status);
});

function sanitizeGoogleReturnPath(raw: string | undefined): string {
  const value = raw?.trim() ?? "";

  if (
    value.startsWith("/business/") &&
    !value.includes("\\") &&
    !value.includes("//") &&
    value.length <= 512
  ) {
    return value;
  }

  return BUSINESS_SETTINGS_INTEGRATIONS_PATH;
}

businessRoutes.post("/connectors/google-calendar/disclosure-consent", async (c) => {
  try {
    const authUser = c.get("authUser");
    const businessId = await resolvePrimaryBusinessId(authUser.id).catch(() => null);
    const body = await c.req.json().catch(() => ({}));
    const record = await recordDisclosureConsent({
      userId: authUser.id,
      businessId,
      integration: GOOGLE_CALENDAR_INTEGRATION,
      disclosureVersion: typeof body?.disclosureVersion === "string" ? body.disclosureVersion : "",
      action: typeof body?.action === "string" ? body.action : ""
    });
    return successResponse(c, { disclosureVersion: record.disclosureVersion });
  } catch (error) {
    if (error instanceof DisclosureConsentError) {
      return errorResponse(c, error.message, error.status, error.code);
    }
    return errorResponse(c, "Could not record the disclosure agreement", 500, "DISCLOSURE_CONSENT_FAILED");
  }
});

businessRoutes.get("/connectors/google-calendar/oauth-url", async (c) => {
  try {
    const authUser = c.get("authUser");

    const consented = await hasFreshDisclosureConsent({
      userId: authUser.id,
      integration: GOOGLE_CALENDAR_INTEGRATION
    });
    if (!consented) {
      return errorResponse(
        c,
        "Review and agree to the Google data disclosure before connecting.",
        428,
        "DISCLOSURE_CONSENT_REQUIRED"
      );
    }

    const url = createGmailOAuthUrl(
      authUser.id,
      sanitizeGoogleReturnPath(c.req.query("redirect"))
    );
    return successResponse(c, { url });
  } catch (error) {
    return errorResponse(
      c,
      errorMessage(error, "Could not create Google OAuth URL"),
      500,
      "GOOGLE_OAUTH_URL_FAILED"
    );
  }
});

businessRoutes.delete("/connectors/google-calendar", async (c) => {
  const authUser = c.get("authUser");
  await disconnectGmail(authUser.id);
  return successResponse(c, null, "Google Calendar disconnected");
});

function sanitizeCalendlyReturnPath(raw: string | undefined): string {
  const value = raw?.trim() ?? "";

  if (
    (value.startsWith("/business/") || value.startsWith("/architect/")) &&
    !value.includes("\\") &&
    !value.includes("//") &&
    value.length <= 512
  ) {
    return value;
  }

  return BUSINESS_SETTINGS_INTEGRATIONS_PATH;
}

businessRoutes.get("/connectors/calendly/status", async (c) => {
  const authUser = c.get("authUser");
  const status = await getCalendlyConnectionStatus(authUser.id);
  return successResponse(c, status);
});

businessRoutes.get("/connectors/calendly/event-types", async (c) => {
  try {
    const authUser = c.get("authUser");
    const options = await listCalendlyEventTypeOptions(authUser.id);
    return successResponse(c, { options });
  } catch (error) {
    return errorResponse(
      c,
      errorMessage(error, "Could not load Calendly event types"),
      500,
      "CALENDLY_EVENT_TYPES_FAILED"
    );
  }
});

const calendlyBuyerConfigSchema = z.object({
  listingId: z.string().trim().optional().or(z.literal("")),
  installedAgentId: z.string().trim().optional().or(z.literal("")),
  eventTypeUri: z.string().trim().min(1),
  eventTypeName: z.string().trim().optional().or(z.literal("")),
  schedulingUrl: z.string().trim().url().optional().or(z.literal(""))
});

businessRoutes.put("/connectors/calendly/config", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = calendlyBuyerConfigSchema.parse(await c.req.json());
    const business = await prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        installedAgents: {
          select: { id: true, listingId: true, configJson: true }
        },
        profile: { select: { bookingUrl: true } }
      }
    });
    if (!business) {
      return errorResponse(c, "Business not found", 404, "BUSINESS_NOT_FOUND");
    }

    const agent =
      (input.installedAgentId
        ? business.installedAgents.find((row) => row.id === input.installedAgentId)
        : null) ??
      (input.listingId
        ? business.installedAgents.find((row) => row.listingId === input.listingId)
        : null) ??
      business.installedAgents[0] ??
      null;

    if (!agent) {
      return errorResponse(c, "Installed agent not found", 404, "INSTALLED_AGENT_NOT_FOUND");
    }

    const prev =
      agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
        ? (agent.configJson as Record<string, unknown>)
        : {};
    const prevCalendly =
      typeof prev.calendly === "object" && prev.calendly !== null && !Array.isArray(prev.calendly)
        ? (prev.calendly as Record<string, unknown>)
        : {};

    const calendlyConfig = {
      ...prevCalendly,
      eventTypeUri: input.eventTypeUri.trim(),
      ...(input.eventTypeName?.trim() ? { eventTypeName: input.eventTypeName.trim() } : {}),
      ...(input.schedulingUrl?.trim() ? { schedulingUrl: input.schedulingUrl.trim() } : {})
    };

    await prisma.installedAgent.update({
      where: { id: agent.id },
      data: {
        configJson: {
          ...prev,
          calendly: calendlyConfig
        } as never
      }
    });

    // Prefer Calendly scheduling URL as booking link when the buyer has none yet.
    if (input.schedulingUrl?.trim() && !business.profile?.bookingUrl) {
      await prisma.businessProfile.updateMany({
        where: { businessId: business.id },
        data: { bookingUrl: input.schedulingUrl.trim() }
      });
    }

    return successResponse(c, {
      installedAgentId: agent.id,
      calendly: calendlyConfig
    }, "Calendly preferences saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid Calendly config", 422, "VALIDATION_ERROR");
    }
    return errorResponse(
      c,
      errorMessage(error, "Could not save Calendly preferences"),
      500,
      "CALENDLY_CONFIG_FAILED"
    );
  }
});

businessRoutes.get("/connectors/calendly/oauth-url", async (c) => {
  try {
    const authUser = c.get("authUser");
    const url = createCalendlyOAuthUrl(authUser.id, sanitizeCalendlyReturnPath(c.req.query("redirect")));
    return successResponse(c, { url });
  } catch (error) {
    return errorResponse(
      c,
      errorMessage(error, "Could not create Calendly OAuth URL"),
      500,
      "CALENDLY_OAUTH_URL_FAILED"
    );
  }
});

businessRoutes.delete("/connectors/calendly", async (c) => {
  const authUser = c.get("authUser");
  await disconnectCalendly(authUser.id);
  return successResponse(c, null, "Calendly disconnected");
});

businessRoutes.get("/connectors/whatsapp/status", async (c) => {
  const authUser = c.get("authUser");
  try {
    const connections = await WhatsAppService.listConnections(authUser.id);
    const connected = connections.find((row) => row.status === "CONNECTED") ?? connections[0] ?? null;
    return successResponse(c, {
      connected: Boolean(connected && connected.status === "CONNECTED"),
      connectionId: connected?.id ?? null,
      displayName: connected?.displayName ?? null,
      phoneNumber: connected?.phoneNumber ?? null,
      status: connected?.status ?? null
    });
  } catch (error) {
    return errorResponse(
      c,
      errorMessage(error, "Could not load WhatsApp status"),
      500,
      "WHATSAPP_STATUS_FAILED"
    );
  }
});

businessRoutes.delete("/connectors/whatsapp", async (c) => {
  const authUser = c.get("authUser");
  try {
    const connections = await WhatsAppService.listConnections(authUser.id);
    const active = connections.filter((row) => row.status === "CONNECTED");
    const targets = active.length > 0 ? active : connections.slice(0, 1);
    for (const connection of targets) {
      await WhatsAppService.disconnect(authUser.id, connection.id);
    }
    return successResponse(c, { disconnected: targets.length }, "WhatsApp disconnected");
  } catch (error) {
    if (error instanceof WhatsAppServiceError) {
      return errorResponse(c, error.message, apiErrorStatus(error.status, 500), error.errorCode);
    }
    return errorResponse(
      c,
      errorMessage(error, "Could not disconnect WhatsApp"),
      500,
      "WHATSAPP_DISCONNECT_FAILED"
    );
  }
});
