import { Hono } from "hono";
import { z } from "zod";
import { normalizeTimeZone, requiredConnectorsForWorkflow, type ConnectorRequirement } from "@coreai/shared";
import { env, isProduction } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { errorMessage, isRecord } from "../../lib/error-utils";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createGmailOAuthUrl,
  disconnectGmail,
  getGmailConnectionStatus
} from "../architect/gmail-connector";
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
import { getCallRoutingDiagnostics } from "../architect/twilio-business-routing";
import { deployInstalledAgentVoiceAssistant } from "./deploy";
import { isBillingEnabled } from "../../lib/stripe";
import {
  buildDashboardActivities,
  sumInvoiceTotalCents
} from "../../lib/billing-invoices";
import { businessSettingsRoutes } from "./settings-routes";

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

function includeActivePhoneNumbers(options?: { take?: number }) {
  return {
    where: { isActive: true as const },
    orderBy: { createdAt: "desc" as const },
    select: businessPhoneNumberLegacySelect,
    ...(options?.take ? { take: options.take } : {})
  };
}

const BUSINESS_SETUP_REDIRECT_PATH = "/business/agents/setup";
const DEFAULT_ASSISTANT_NAME = "AI Assistant";

businessRoutes.post("/billing/webhook", handleStripeWebhook);

businessRoutes.use("*", requireAuth);
businessRoutes.use("*", requireRole(["BUSINESS"]));

businessRoutes.post("/billing/checkout", createCheckoutSession);
businessRoutes.get("/billing/status", getBillingStatus);
businessRoutes.route("/settings", businessSettingsRoutes);

businessRoutes.get("/dashboard", async (c) => {
  const authUser = c.get("authUser");

  const [business, payments] = await Promise.all([
    prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
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
      calendarConnected: calendar.connected,
      totalSpendCents,
      activities
    });
  }

  const [leadCount, conversationCount, appointmentCount, recentLeads, recentAppointments, recentMissedCalls] =
    await Promise.all([
      prisma.lead.count({ where: { businessId: business.id } }),
      prisma.conversation.count({ where: { businessId: business.id } }),
      prisma.appointment.count({ where: { businessId: business.id } }),
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
      })
    ]);

  const installedAgent = business.installedAgents[0] ?? null;
  const phoneNumber = business.phoneNumbers[0] ?? null;
  const subscriptionStatus = business.subscriptionStatus ?? "inactive";

  return successResponse(c, {
    business: { id: business.id, name: business.name, type: business.type },
    installedAgent: installedAgent
      ? { id: installedAgent.id, name: installedAgent.name, status: installedAgent.status }
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
    recentLeads,
    recentAppointments,
    recentMissedCalls,
    calendarConnected: calendar.connected,
    totalSpendCents,
    activities
  });
});

const faqItemSchema = z.object({
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1)
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

  businessName: z.string().trim().min(2, "Business name is required"),
  businessType: z.string().trim().min(2, "Business type is required"),
  assistantName: z.string().trim().optional().or(z.literal("")),

  forwardToPhone: z.string().trim().optional().or(z.literal("")),
  bookingUrl: z.string().trim().url().optional().or(z.literal("")),
  teamPhone: z.string().trim().optional().or(z.literal("")),
  timeZone: z.string().trim().default("Asia/Kolkata"),
  tone: z.string().trim().default("friendly"),
  escalationRules: z.string().trim().optional().or(z.literal("")),

  services: z.array(z.string().trim().min(1)).default([]),
  faqs: z.array(faqItemSchema).default([]),
  hours: z.array(hoursItemSchema).default([]),
  knowledge: z.array(knowledgeItemSchema).default([]),

  vapiAssistantId: z.string().trim().optional().or(z.literal("")),
  vapiPhoneNumberId: z.string().trim().optional().or(z.literal("")),

  voice: z.string().trim().optional().or(z.literal("")),
  voiceId: z.string().trim().optional().or(z.literal("")),
  voiceProvider: z.string().trim().optional().or(z.literal("")),

  answeringMode: z.string().trim().optional().or(z.literal("")),
  contactName: z.string().trim().optional().or(z.literal("")),
  customInstructions: z.string().trim().optional().or(z.literal("")),

  silenceRepromptCount: z.coerce.number().int().min(0).max(3).optional(),
  silenceRepromptMessage1: z.string().trim().optional().or(z.literal("")),
  silenceRepromptMessage2: z.string().trim().optional().or(z.literal("")),
  goodbyeMessage: z.string().trim().optional().or(z.literal("")),

  // Buyer appointment timing: drives live/test availability (slot count, hours,
  // duration, buffer). Optional — sensible defaults apply when omitted.
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

  // Architect-defined buyer setup answers (the listing's requiredBuyerSetup
  // fields) — industry-specific facts injected into the live system prompt.
  customFields: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(120),
        value: z.string().trim().max(2000)
      })
    )
    .max(40)
    .default([]),

  selectedPlatformPhoneNumberId: z.string().trim().optional().or(z.literal("")),
  selectedPhoneNumber: z.string().trim().optional().or(z.literal("")),
  calendarId: z.string().trim().optional().or(z.literal("")),
  workflowId: z.string().trim().optional().or(z.literal("")),
  listingId: z.string().trim().optional().or(z.literal(""))
});

function normalizePhoneNumber(value: string) {
  return value.replace(/[^+\d]/g, "").trim();
}

function cleanOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  return prisma.business.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    include: {
      profile: true,
      knowledgeBases: { orderBy: { createdAt: "asc" } },
      phoneNumbers: includeActivePhoneNumbers(),
      installedAgents: { orderBy: { createdAt: "desc" }, include: { workflow: true } }
    }
  });
}

type LoadedBusiness = NonNullable<Awaited<ReturnType<typeof loadBusinessForOwner>>>;

async function loadPhoneOptions(businessId: string | null) {
  const numbers = await prisma.platformPhoneNumber.findMany({
    where: {
      provider: "TWILIO",
      OR: [{ status: "AVAILABLE" }, ...(businessId ? [{ businessId }] : [])]
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }]
  });

  const mapped = numbers.map((number) => ({
    id: number.id,
    phoneNumber: number.phoneNumber,
    provider: number.provider,
    status: number.status,
    assignedToThisBusiness: Boolean(businessId && number.businessId === businessId),
    capabilities: number.capabilities ?? null,
    country: number.country ?? null,
    region: number.region ?? null,
    locality: number.locality ?? null
  }));

  const selectedPlatformPhoneNumberId =
    mapped.find((number) => number.assignedToThisBusiness)?.id ?? null;

  const availablePhoneNumbers = mapped.map((number) => ({
    ...number,
    selected: number.id === selectedPlatformPhoneNumberId
  }));

  return { availablePhoneNumbers, selectedPlatformPhoneNumberId };
}

businessRoutes.get("/setup/phone-numbers", async (c) => {
  const authUser = c.get("authUser");

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  const { availablePhoneNumbers } = await loadPhoneOptions(business?.id ?? null);

  return successResponse(c, { numbers: availablePhoneNumbers });
});

function isPublicHttpsUrl(url: string): boolean {
  return url.startsWith("https://") && !/localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d+\./i.test(url);
}

businessRoutes.post("/setup/test-call-routing", async (c) => {
  const authUser = c.get("authUser");
  const backendUrl = env.BACKEND_URL.replace(/\/$/, "");
  const webhookUrl = `${backendUrl}/architect/connectors/twilio/voice`;
  const backendPublic = isPublicHttpsUrl(backendUrl);
  const backendIsTunnel = /\.ngrok(-free)?\./i.test(backendUrl);

  const [business, calendar] = await Promise.all([
    prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        profile: true,
        phoneNumbers: includeActivePhoneNumbers(),
        installedAgents: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    }),
    getGmailConnectionStatus(authUser.id)
  ]);

  const environmentChecks = [
    {
      key: "business_found",
      label: "Business profile complete",
      ok: Boolean(business && business.name && business.type),
      message: business ? undefined : "Save your business name and type in Step 1."
    },
    {
      key: "calendar_connected",
      label: "Google Calendar connected",
      ok: calendar.connected,
      message: calendar.connected ? undefined : "Connect Google Calendar in Step 2 so the agent can book appointments."
    },
    {
      key: "timezone_set",
      label: "Calendar timezone selected",
      ok: Boolean(business?.profile?.timeZone),
      message: business?.profile?.timeZone
        ? `Timezone: ${normalizeTimeZone(business.profile.timeZone)}`
        : "Pick a calendar timezone in Step 2."
    },
    {
      key: "backend_url_public",
      label: "Backend URL is public HTTPS",
      ok: backendPublic,
      message: backendPublic
        ? backendIsTunnel
          ? "Reachable via a tunnel — fine for testing, use the production domain in production."
          : undefined
        : "BACKEND_URL is not a public HTTPS URL — Twilio cannot reach the webhook."
    },
    {
      key: "webhook_configured",
      label: "Twilio voice webhook URL",
      ok: backendPublic,
      message: `Set the Twilio number's voice webhook to POST ${webhookUrl}`
    },
    {
      key: "signature_validation",
      label: "Twilio signature validation",
      ok: !isProduction || env.TWILIO_VALIDATE_SIGNATURE,
      message: env.TWILIO_VALIDATE_SIGNATURE
        ? undefined
        : isProduction
          ? "Set TWILIO_VALIDATE_SIGNATURE=true in production."
          : "Off in dev; set TWILIO_VALIDATE_SIGNATURE=true in production."
    },
    {
      key: "no_env_phone_dependency",
      label: "Phone numbers managed in database",
      ok: true,
      message: "Numbers are resolved from PlatformPhoneNumber/BusinessPhoneNumber."
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
          message: "Select a Triven number in Step 2."
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
    { key: "vapi_assistant", label: "Vapi assistant id exists", ok: diagnostics.hasVapiAssistantId },
    {
      key: "answering_mode_set",
      label: "Answering mode is set",
      ok: Boolean(diagnostics.routingMode),
      message: diagnostics.routingMode ? `Mode: ${diagnostics.routingMode}` : "Choose an answering mode in Step 2."
    },
    { key: "answering_mode", label: "Answering mode allows answering", ok: diagnostics.aiWouldAnswer },
    { key: "resolver", label: "Twilio resolver can resolve this number", ok: diagnostics.resolved }
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

type SetupChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  blocker?: string;
};

function buildSetupReadiness(business: LoadedBusiness | null, calendarConnected: boolean) {
  const profile = business?.profile ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const installedAgent = business?.installedAgents?.[0] ?? null;
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
  const phoneComplete = Boolean(phone) && (answeringMode === "AI_FIRST" || Boolean(phone?.forwardToPhone));
  const smsComplete = Boolean(phone);
  const voiceComplete = Boolean(profile?.vapiAssistantId);

  const checklist: SetupChecklistItem[] = [
    {
      key: "business_profile",
      label: "Business profile",
      required: true,
      complete: profileComplete,
      blocker: profileComplete ? undefined : "Add your business name, type and services."
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

function serializeSetup(business: LoadedBusiness | null, calendar: { connected: boolean; email: string | null }) {
  const profile = business?.profile ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const installedAgent = business?.installedAgents?.[0] ?? null;
  const readiness = buildSetupReadiness(business, calendar.connected);

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
      business?.knowledgeBases?.map((item) => ({
        title: item.title,
        content: item.content
      })) ?? [],
    calendar: { connected: calendar.connected, email: calendar.email },
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
    contactName: typeof config?.contactName === "string" ? config.contactName : null,
    customInstructions: typeof config?.customInstructions === "string" ? config.customInstructions : null,
    customFields: Array.isArray(config?.customFields)
      ? (config.customFields as Array<Record<string, unknown>>)
          .filter((item) => typeof item === "object" && item !== null)
          .map((item) => ({
            key: typeof item.key === "string" ? item.key : "",
            label: typeof item.label === "string" ? item.label : "",
            value: typeof item.value === "string" ? item.value : ""
          }))
          .filter((item) => item.key)
      : [],
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

businessRoutes.get("/setup", async (c) => {
  const authUser = c.get("authUser");

  const [business, calendar] = await Promise.all([
    loadBusinessForOwner(authUser.id),
    getGmailConnectionStatus(authUser.id)
  ]);

  const phoneOptions = await loadPhoneOptions(business?.id ?? null);

  return successResponse(c, {
    ...serializeSetup(business, calendar),
    ...phoneOptions
  });
});

businessRoutes.post("/setup", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = businessSetupSchema.parse(await c.req.json());

    if (input.deploy && isBillingEnabled()) {
      const billed = await prisma.business.findFirst({
        where: { ownerId: authUser.id },
        orderBy: { createdAt: "desc" },
        select: { subscriptionStatus: true }
      });

      const active =
        billed?.subscriptionStatus === "active" || billed?.subscriptionStatus === "trialing";

      if (!active) {
        return errorResponse(
          c,
          "An active subscription is required before activating your AI agent.",
          402,
          "SUBSCRIPTION_REQUIRED"
        );
      }
    }

    const existing = await prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        phoneNumbers: includeActivePhoneNumbers(),
        installedAgents: { orderBy: { createdAt: "desc" } }
      }
    });

    const existingPhone = existing?.phoneNumbers?.[0] ?? null;

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

    if (
      targetPlatform &&
      targetPlatform.status === "ASSIGNED" &&
      targetPlatform.businessId &&
      targetPlatform.businessId !== (existing?.id ?? null)
    ) {
      return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
    }

    const resolved = await resolveReceptionistWorkflow({
      ownerId: authUser.id,
      workflowId: input.workflowId || undefined,
      listingId: input.listingId || undefined
    });

    const timeZone = normalizeTimeZone(input.timeZone);
    const assistantName = cleanAssistantName(input.assistantName);
    const answeringMode = input.answeringMode || "AI_FIRST";

    const profileData = {
      bookingUrl: cleanOptional(input.bookingUrl),
      teamPhone: cleanOptional(input.teamPhone),
      calendarId: input.calendarId || "primary",
      timeZone,
      tone: input.tone,
      escalationRules: cleanOptional(input.escalationRules),
      services: input.services,
      faqsJson: input.faqs as never,
      hoursJson: input.hours as never,
      vapiAssistantId: cleanOptional(input.vapiAssistantId),
      vapiPhoneNumberId: cleanOptional(input.vapiPhoneNumberId)
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

    await prisma.businessKnowledgeBase.deleteMany({ where: { businessId: business.id } });

    if (input.knowledge.length > 0) {
      await prisma.businessKnowledgeBase.createMany({
        data: input.knowledge.map((item) => ({
          businessId: business.id,
          title: item.title,
          content: item.content
        }))
      });
    }

    const configJson = {
      connectors: ["TWILIO", "VAPI", "GOOGLE_CALENDAR"],
      vapiAssistantId: cleanOptional(input.vapiAssistantId),
      vapiPhoneNumberId: cleanOptional(input.vapiPhoneNumberId),
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
        mode: answeringMode
      },
      contactName: cleanOptional(input.contactName),
      customInstructions: cleanOptional(input.customInstructions),
      ...(input.scheduling ? { scheduling: input.scheduling } : {}),
      ...(input.customFields.length > 0
        ? { customFields: input.customFields.filter((field) => field.value.trim()) }
        : {}),
      businessDetails: {
        assistantName,
        businessName: input.businessName,
        businessType: input.businessType,
        contactName: cleanOptional(input.contactName),
        services: input.services
      },
      silence: {
        repromptCount: input.silenceRepromptCount ?? 2,
        reprompt1: cleanOptional(input.silenceRepromptMessage1),
        reprompt2: cleanOptional(input.silenceRepromptMessage2),
        goodbye: cleanOptional(input.goodbyeMessage)
      }
    };

    const existingAgent = existing?.installedAgents?.[0] ?? null;

    const installedAgent = existingAgent
      ? await prisma.installedAgent.update({
          where: { id: existingAgent.id },
          data: {
            workflowId: resolved.workflow.id,
            listingId: resolved.listingId ?? undefined,
            name: resolved.workflow.name,
            status: "ACTIVE",
            configJson: configJson as never
          }
        })
      : await prisma.installedAgent.create({
          data: {
            businessId: business.id,
            workflowId: resolved.workflow.id,
            listingId: resolved.listingId ?? undefined,
            name: resolved.workflow.name,
            status: "ACTIVE",
            configJson: configJson as never
          }
        });

    const forward = normalizePhoneNumber(input.forwardToPhone || "");
    let businessPhone: Awaited<ReturnType<typeof prisma.businessPhoneNumber.findFirst>> = null;

    if (targetPlatform) {
      const targetNumber = normalizePhoneNumber(targetPlatform.phoneNumber);

      // Guard against a stale mapping owned by another business.
      const conflicting = await prisma.businessPhoneNumber.findUnique({
        where: { phoneNumber: targetNumber },
        select: { id: true, businessId: true, phoneNumber: true }
      });
      if (conflicting && conflicting.businessId !== business.id) {
        return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
      }

      businessPhone = await prisma
        .$transaction(async (tx) => {
          const fresh = await tx.platformPhoneNumber.findUnique({
            where: { id: targetPlatform.id }
          });

          if (!fresh || (fresh.businessId && fresh.businessId !== business.id)) {
            throw new Error("PHONE_NUMBER_TAKEN");
          }

          if (existingPhone && existingPhone.phoneNumber !== targetNumber) {
            await tx.platformPhoneNumber.updateMany({
              where: { phoneNumber: existingPhone.phoneNumber, businessId: business.id },
              data: { status: "AVAILABLE", businessId: null, assignedAt: null }
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
              assignedAt: fresh.assignedAt ?? new Date()
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
      businessPhone = await prisma.businessPhoneNumber.update({
        where: { id: existingPhone.id },
        data: {
          forwardToPhone: forward,
          installedAgentId: installedAgent.id,
          isActive: true
        }
      });
    }

    let deployedVapiAssistantId: string | null = null;

    if (input.deploy !== false) {
      const voiceDeploy = await deployInstalledAgentVoiceAssistant(business.id);
      deployedVapiAssistantId = voiceDeploy?.assistantId ?? null;

      if (!deployedVapiAssistantId) {
        return errorResponse(
          c,
          "Live voice assistant was not created. Make sure the workflow has an AI Voice Conversation node and Vapi is configured.",
          500,
          "VAPI_ASSISTANT_DEPLOY_FAILED"
        );
      }

      const prevConfig = (installedAgent.configJson as Record<string, unknown> | null) ?? {};

      await prisma.installedAgent.update({
        where: { id: installedAgent.id },
        data: {
          configJson: {
            ...prevConfig,
            vapiAssistantId: deployedVapiAssistantId
          } as never
        }
      });
    }

    const [refreshed, calendar] = await Promise.all([
      loadBusinessForOwner(authUser.id),
      getGmailConnectionStatus(authUser.id)
    ]);

    const phoneOptions = await loadPhoneOptions(refreshed?.id ?? null);

    const refreshedAgent = refreshed?.installedAgents?.[0] ?? null;
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
        ...serializeSetup(refreshed, calendar),
        installedAgentId: refreshedAgent?.id ?? installedAgent.id,
        assignedPhoneNumber: businessPhone?.phoneNumber ?? null,
        vapiAssistantId: responseVapiAssistantId,
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

businessRoutes.get("/connectors/google-calendar/oauth-url", async (c) => {
  try {
    const authUser = c.get("authUser");
    const url = createGmailOAuthUrl(authUser.id, BUSINESS_SETUP_REDIRECT_PATH);
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