import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  isBuyerAnswerEmpty,
  normalizeBuyerSetupFields,
  normalizeTimeZone,
  requiredConnectorsForWorkflow,
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
import {
  getBusinessPhoneAssignment,
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
  RECEPTIONIST_WORKFLOW_DESCRIPTION,
  RECEPTIONIST_WORKFLOW_NAME,
  buildReceptionistWorkflowJson
} from "./receptionist-template";
import {
  createCheckoutSession,
  getBillingStatus,
  handleStripeWebhook
} from "./billing";
import { getBusinessUsageBill, getBusinessUsageInvoices, payBusinessUsageInvoice } from "./usage-billing";
import { getCallRoutingDiagnostics } from "../architect/twilio-business-routing";
import { resolveTwilioSmsMode, validateSmsRecipientE164 } from "../architect/twilio-connector";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import { Prisma, InstalledAgent } from "@prisma/client";
import { canBusinessDeployAgent } from "./deployment-access";
import { canBusinessRunSetup, hasAnyAgentAcquisition } from "./purchase-access";
import {
  KnowledgeFileError,
  MAX_FILE_BYTES,
  deleteKnowledgeFile,
  ingestKnowledgeFiles,
  listKnowledgeFiles,
  reprocessKnowledgeFile
} from "./knowledge-files";
import { MarketplaceDemoError, startMarketplaceDemoCall } from "./marketplace-demo";
import {
  buildInstalledAgentChatTestSetup,
  deployInstalledAgentVoiceAssistant,
  refreshLiveAssistantKnowledge,
  SetupPreviewCallError,
  startInstalledAgentPreviewCall
} from "./deploy";
import { runArchitectConversationTest } from "../architect/workflow-conversation-test";
import { deleteTestCalendarEvent } from "../architect/test-calendar-events";
import { ensureBusinessAndAgent, loadOwnedListing } from "../setup/routes";
import {
  findBuyerPlatformNumber,
  workflowNeedsPhoneNumber
} from "./phone-provisioning";
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

const BUSINESS_SETTINGS_INTEGRATIONS_PATH = "/business/setting?tab=integrations";
const DEFAULT_ASSISTANT_NAME = "AI Assistant";

businessRoutes.post("/billing/webhook", handleStripeWebhook);

businessRoutes.use("*", requireAuth);
businessRoutes.use("*", requireRole(["BUSINESS"]));

businessRoutes.post("/billing/checkout", createCheckoutSession);
businessRoutes.get("/billing/status", getBillingStatus);
businessRoutes.get("/billing/usage", getBusinessUsageBill);
businessRoutes.get("/billing/usage-invoices", getBusinessUsageInvoices);
businessRoutes.post("/billing/usage-invoices/:id/pay", payBusinessUsageInvoice);
businessRoutes.route("/settings", businessSettingsRoutes);
businessRoutes.route("/onboarding", businessOnboardingRoutes);

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
      bucket.executions += 1;
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
      createdAt: call.createdAt.toISOString(),
      ...(call.recordingUrl ? { recordingUrl: call.recordingUrl } : {})
    });
  }

  return activities;
}

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
      bookings: { month: new Date().toISOString().slice(0, 7), total: 0, upcoming: 0, items: [] },
      monthlyMetrics: {
        callsHandled: 0,
        callsHandledPrevMonth: 0,
        bookings: 0,
        bookingsPrevMonth: 0
      },
      activityChart: { days: buildActivityChartDays({ days: 30, appointments: [], missedCallLeads: [], vapiCalls: [] }) },
      agentActivity: [],
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
    // Last 30 days of raw agent events for the activity chart + agent activity feed.
    // Test-mode rows never appear as live customer activity.
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
      items: monthBookings.map((booking) => ({
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
        createdAt: booking.createdAt.toISOString()
      }))
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
    calendarConnected: calendar.connected,
    totalSpendCents,
    activities: mergedActivities
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

  // Buyer-owned Send Email recipients (To/CC/BCC). The architect's Email node
  // only defines template/content; who receives it is configured here.
  emailRecipients: z
    .object({
      recipientType: z.enum(["customer", "team", "custom"]).default("customer"),
      customRecipient: z.string().trim().max(320).optional().or(z.literal("")),
      cc: z.string().trim().max(2000).optional().or(z.literal("")),
      bcc: z.string().trim().max(2000).optional().or(z.literal(""))
    })
    .optional(),

  // Architect-defined buyer setup answers (the listing's requiredBuyerSetup
  // fields) — business-specific facts injected into the live system prompt.
  // Values may be text, a multiselect list, a yes/no toggle, or a number.
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
      // The reserved shared Triven SMS sender is never shown to buyers.
      isPlatformSmsSender: false,
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
async function loadOwnedInstalledAgent(ownerId: string, installedAgentId: string) {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: { id: true, status: true, business: { select: { ownerId: true } } }
  });
  // One business can never see or modify another business's agent.
  if (!agent || agent.business.ownerId !== ownerId) return null;
  return agent;
}

/* --------------- Phone number location, search & purchase --------------- */

// The businessId is ALWAYS derived from the authenticated owner — a
// browser-supplied businessId is never accepted for phone provisioning.
async function requireOwnedBusinessId(ownerId: string): Promise<string | null> {
  // Prefer the newest business that actually carries a buyer installed agent
  // (excluding architect test sandboxes) — uploads, demo tests, and setup then
  // always target the SAME business the live phone number was purchased for,
  // even when stray/placeholder Business rows exist for the owner.
  const withAgent = await prisma.business.findFirst({
    where: {
      ownerId,
      installedAgents: {
        some: { NOT: { configJson: { path: ["purpose"], equals: "ARCHITECT_TEST" } } }
      }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (withAgent) return withAgent.id;

  const business = await prisma.business.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  return business?.id ?? null;
}

/**
 * Resolve the caller's business, bootstrapping the Business + InstalledAgent
 * from a PURCHASED listing when none exists yet (first-time setup reaches the
 * number step before the Configure step names the business). Ownership of the
 * listing is verified through the central purchase-access check.
 */
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

// Hierarchical location catalogue: no params → all countries; ?country= →
// that country's states; ?country=&state= → that state's cities. Backed by
// the full ISO dataset so every country/state/city is selectable; selections
// are still re-validated server-side at search/purchase time.
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

// The business's current active Triven number in the buyer-safe shape — never
// includes provider/wholesale cost. `assigned: false` when no number is held.
businessRoutes.get("/phone-numbers/assignment", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);

  if (!businessId) {
    return successResponse(c, { assigned: false });
  }

  const assignment = await getBusinessPhoneAssignment(businessId);
  return successResponse(c, assignment ?? { assigned: false });
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

  const updated = await prisma.installedAgent.update({
    where: { id: agent.id },
    data: { status: "PAUSED" }
  });

  return successResponse(c, { installedAgentId: updated.id, status: updated.status }, "Agent paused");
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

  const updated = await prisma.installedAgent.update({
    where: { id: agent.id },
    data: { status: "ACTIVE" }
  });

  return successResponse(c, { installedAgentId: updated.id, status: updated.status }, "Agent resumed");
});

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

/* ----------------------- Buyer knowledge documents ----------------------- */

function knowledgeFileErrorResponse(c: Context, error: unknown) {
  if (error instanceof KnowledgeFileError) {
    return errorResponse(c, error.message, apiErrorStatus(error.status, 422), error.code);
  }
  console.error("[knowledge-files] failed", error);
  return errorResponse(c, "The document could not be processed.", 500, "KNOWLEDGE_FILE_FAILED");
}

// Multipart upload: PDF/DOCX/TXT documents become agent knowledge. Business
// ownership always comes from the authenticated user — any client-supplied
// businessId is ignored.
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

    const results = await ingestKnowledgeFiles({
      businessId: resolved.businessId,
      installedAgentId: installedAgentId ?? resolved.bootstrappedAgentId,
      files: uploads
    });
    // A live assistant's prompt is baked at deploy — refresh it so future
    // live calls answer from the new documents. Best-effort, never blocking.
    if (results.some((file) => file.status === "PROCESSED")) {
      void refreshLiveAssistantKnowledge(resolved.businessId);
    }
    return successResponse(c, { files: results });
  } catch (error) {
    return knowledgeFileErrorResponse(c, error);
  }
});

businessRoutes.get("/setup/knowledge-files", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return successResponse(c, { files: [] });

  return successResponse(c, { files: await listKnowledgeFiles(businessId) });
});

businessRoutes.delete("/setup/knowledge-files/:id", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  try {
    await deleteKnowledgeFile(businessId, c.req.param("id"));
    void refreshLiveAssistantKnowledge(businessId);
    return successResponse(c, { deleted: true });
  } catch (error) {
    return knowledgeFileErrorResponse(c, error);
  }
});

businessRoutes.post("/setup/knowledge-files/:id/reprocess", async (c) => {
  const authUser = c.get("authUser");
  const businessId = await requireOwnedBusinessId(authUser.id);
  if (!businessId) return errorResponse(c, "Create your business profile first.", 404, "BUSINESS_NOT_FOUND");

  try {
    const file = await reprocessKnowledgeFile(businessId, c.req.param("id"));
    if (file.status === "PROCESSED") void refreshLiveAssistantKnowledge(businessId);
    return successResponse(c, { file });
  } catch (error) {
    return knowledgeFileErrorResponse(c, error);
  }
});

function isPublicHttpsUrl(url: string): boolean {
  return url.startsWith("https://") && !/localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d+\./i.test(url);
}

// Pre-purchase try-before-buy: a sandboxed, time-capped browser demo call for
// a marketplace listing. No purchase required — the demo has no tools, no
// recording, fictional business data, and a per-buyer daily limit.
businessRoutes.post("/marketplace/listings/:listingId/demo-call", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.param("listingId");

  if (!listingId) {
    return errorResponse(c, "Listing id is required", 422, "LISTING_ID_REQUIRED");
  }

  try {
    const session = await startMarketplaceDemoCall(authUser.id, listingId);
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
  testSessionId: z.string().trim().max(64).optional()
});

// Chat simulation for the setup wizard's Test step — runs the buyer's real
// workflow + business config through the shared agent runtime with dry-run
// providers (booking/SMS simulated, nothing real is sent).
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
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  if (!business) {
    return errorResponse(c, "Create your business profile first (Configure step of setup).", 404, "BUSINESS_NOT_FOUND");
  }

  const chatSetup = await buildInstalledAgentChatTestSetup(business.id);

  if (!chatSetup) {
    return errorResponse(c, "Save your setup with an installed agent before testing.", 422, "TEST_NOT_AVAILABLE");
  }

  try {
    const result = await runArchitectConversationTest({
      userId: authUser.id,
      workflowId: chatSetup.workflowId,
      workflowJson: chatSetup.workflowJson,
      message: parsed.data.message,
      history: parsed.data.history,
      testContext: chatSetup.context,
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
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  if (!business) {
    return errorResponse(c, "Create your business profile first (Configure step of setup).", 404, "BUSINESS_NOT_FOUND");
  }

  try {
    const session = await startInstalledAgentPreviewCall(business.id);
    return successResponse(c, { session }, "Preview call ready");
  } catch (error) {
    if (error instanceof SetupPreviewCallError) {
      return errorResponse(c, error.message, error.status, error.code);
    }
    console.error("[setup-preview] failed", error);
    return errorResponse(c, "Could not start the preview call.", 500, "PREVIEW_FAILED");
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

  const [business, calendar] = await Promise.all([
    prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
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
    getGmailConnectionStatus(authUser.id)
  ]);

  // Calendar checks apply only when the agent's workflow actually uses a
  // calendar node — mirrors the dynamic gating in the setup wizard. Unknown
  // workflow keeps the checks (safe fallback).
  const testWorkflowJson = business?.installedAgents?.[0]?.workflow?.workflowJson ?? null;
  const testConnectorKeys = new Set(
    testWorkflowJson ? requiredConnectorsForWorkflow(testWorkflowJson).map((req) => req.connector) : []
  );
  const calendarRequired =
    testConnectorKeys.size === 0 || testConnectorKeys.has("google_calendar") || testConnectorKeys.has("gmail");

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

// ---------------------------------------------------------------------------
// POST /business/setup/test-sms — send one appointment-style test SMS to a
// consented number through the shared Triven Messaging Service. Honest by
// design: a Twilio failure is an error; the SIMULATED / TWILIO_TEST_CREDENTIALS
// / LIVE mode is explicit (TWILIO_SMS_MODE) and reported in the response.
// ---------------------------------------------------------------------------
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
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      profile: { select: { timeZone: true } },
      phoneNumbers: includeActivePhoneNumbers(),
      installedAgents: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } }
    }
  });

  const businessName = business?.name || "your business";
  const businessPhone = business?.phoneNumbers?.[0]?.phoneNumber ?? "";

  // Optional custom text — the wizard's missed-call simulation sends the
  // buyer's configured text-back message. Capped, and always suffixed with
  // the opt-out line for compliance.
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
  listingId?: string | null
) {
  const profile = business?.profile ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const installedAgent = listingId
    ? business?.installedAgents?.find((agent) => agent.listingId === listingId) ?? null
    : business?.installedAgents?.[0] ?? null;
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

function serializeSetup(
  business: LoadedBusiness | null,
  calendar: { connected: boolean; email: string | null },
  listingId?: string | null
) {
  const profile = business?.profile ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const installedAgent = listingId
    ? business?.installedAgents?.find((agent) => agent.listingId === listingId) ?? null
    : business?.installedAgents?.[0] ?? null;
  const readiness = buildSetupReadiness(business, calendar.connected, listingId);

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
    triggerKind: (installedAgent as any)?.workflow?.workflowJson
      ? getWorkflowTriggerKind((installedAgent as any).workflow.workflowJson)
      : null,
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
  const business = await prisma.business.findFirst({ where: { ownerId: authUser.id }, orderBy: { createdAt: "desc" } });

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

  const business = await prisma.business.findFirst({ where: { ownerId: authUser.id }, select: { id: true } });
  const available = await isLocalPartAvailable(localPart, business?.id);
  return successResponse(c, { localPart, available, reason: available ? null : "This alias is already taken." });
});

businessRoutes.post("/mail-setup", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = mailSetupSchema.parse(await c.req.json());

    const business = await prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
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

  const business = await prisma.business.findFirst({ where: { ownerId: authUser.id }, orderBy: { createdAt: "desc" } });
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

  const [business, calendar] = await Promise.all([
    loadBusinessForOwner(authUser.id),
    getGmailConnectionStatus(authUser.id)
  ]);

  const phoneOptions = await loadPhoneOptions(business?.id ?? null);

  return successResponse(c, {
    ...serializeSetup(business, calendar, listingId),
    ...phoneOptions
  });
});

businessRoutes.post("/setup", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = businessSetupSchema.parse(await c.req.json());

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
      ...(emailRecipients ? { emailRecipients } : {}),
      ...(input.scheduling ? { scheduling: input.scheduling } : {}),
      ...(input.customFields.length > 0
        ? { customFields: input.customFields.filter((field) => !isBuyerAnswerEmpty(field.value)) }
        : {}),
      // Snapshot of the listing's buyer setup schema at save time, so the
      // installed agent stays renderable/validatable even if the listing changes.
      ...(buyerSetupFields.length > 0 ? { buyerSetupSchema: buyerSetupFields } : {}),
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

    const existingAgent = resolved.listingId
      ? existing?.installedAgents?.find((agent) => agent.listingId === resolved.listingId) ?? null
      : existing?.installedAgents?.[0] ?? null;

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

    const forward = normalizePhoneNumber(input.forwardToPhone || "");
    let businessPhone: Awaited<ReturnType<typeof prisma.businessPhoneNumber.findFirst>> = null;

    // Number adoption only: a number already reserved/assigned to this buyer
    // is attached, but numbers are never silently purchased here anymore — the
    // buyer selects a location and confirms a specific number through
    // /business/phone-numbers/search + /purchase. The deploy checklist reports
    // a missing number with that remediation.
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

    if (targetPlatform) {
      const targetNumber = normalizePhoneNumber(targetPlatform.phoneNumber);

      // Guard against a mapping actively owned by another business. Inactive
      // rows are history kept by unassignment (recycled pool numbers) and are
      // safely taken over by the upsert below.
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

          if (existingPhone && existingPhone.phoneNumber !== targetNumber) {
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
              assignedAt: fresh.assignedAt ?? new Date()
            }
          });

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
      const usesVoice = workflowUsesVoice(resolved.workflow.workflowJson);

      if (usesVoice) {
        // The target row is still PROVISIONING until Vapi succeeds. Pass its
        // id so deployment cannot skip it or select another ACTIVE agent owned
        // by the same business.
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

    const [refreshed, calendar] = await Promise.all([
      loadBusinessForOwner(authUser.id),
      getGmailConnectionStatus(authUser.id)
    ]);

    const phoneOptions = await loadPhoneOptions(refreshed?.id ?? null);

    const refreshedAgent = input.listingId
      ? refreshed?.installedAgents?.find((agent) => agent.listingId === input.listingId) ?? null
      : refreshed?.installedAgents?.[0] ?? null;
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
        ...serializeSetup(refreshed, calendar, input.listingId),
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

businessRoutes.get("/connectors/google-calendar/oauth-url", async (c) => {
  try {
    const authUser = c.get("authUser");
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
