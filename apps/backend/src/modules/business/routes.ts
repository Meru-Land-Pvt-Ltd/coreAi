import { Hono } from "hono";
import { z } from "zod";
import { normalizeTimeZone, requiredConnectorsForWorkflow, type ConnectorRequirement } from "@coreai/shared";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
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
import { ensureBusinessVapiAssistant } from "../architect/vapi-connector";
import { getCallRoutingDiagnostics } from "../architect/twilio-business-routing";
import { deployInstalledAgentVoiceAssistant } from "./deploy";
import { isBillingEnabled } from "../../lib/stripe";

export const businessRoutes = new Hono();

businessRoutes.post("/billing/webhook", handleStripeWebhook);

businessRoutes.use("*", requireAuth);
businessRoutes.use("*", requireRole(["BUSINESS"]));

businessRoutes.post("/billing/checkout", createCheckoutSession);
businessRoutes.get("/billing/status", getBillingStatus);

/**
 * Aggregated data for the business dashboard: installed agent, assigned number,
 * subscription status, counts, recent leads/appointments/missed calls, and the
 * Google Calendar connection state. Read-only.
 */
businessRoutes.get("/dashboard", async (c) => {
  const authUser = c.get("authUser");

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      installedAgents: { orderBy: { createdAt: "desc" }, take: 1 },
      phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  const calendar = await getGmailConnectionStatus(authUser.id);

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
      calendarConnected: calendar.connected
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
    calendarConnected: calendar.connected
  });
});

const BUSINESS_SETUP_REDIRECT_PATH = "/business/agents/setup";

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
  businessName: z.string().trim().min(2, "Business name is required"),
  businessType: z.string().trim().min(2, "Business type is required"),
  // Optional so progress can be saved incrementally; required (as a blocker) only to deploy.
  forwardToPhone: z.string().trim().optional().or(z.literal("")),
  // true only on the final "Deploy live agent" — incremental saves skip the Vapi build.
  deploy: z.boolean().optional(),
  bookingUrl: z.string().trim().url().optional().or(z.literal("")),
  teamPhone: z.string().trim().optional().or(z.literal("")),
  timeZone: z.string().trim().default("America/New_York"),
  tone: z.string().trim().default("friendly"),
  escalationRules: z.string().trim().optional().or(z.literal("")),
  services: z.array(z.string().trim().min(1)).default([]),
  faqs: z.array(faqItemSchema).default([]),
  hours: z.array(hoursItemSchema).default([]),
  knowledge: z.array(knowledgeItemSchema).default([]),
  vapiAssistantId: z.string().trim().optional().or(z.literal("")),
  vapiPhoneNumberId: z.string().trim().optional().or(z.literal("")),
  // Buyer voice selection: accept the agent default or override it at install.
  voice: z.string().trim().optional().or(z.literal("")),
  voiceId: z.string().trim().optional().or(z.literal("")),
  voiceProvider: z.string().trim().optional().or(z.literal("")),
  // Buyer-chosen answering mode (AI_FIRST | NO_ANSWER | BUSY | AFTER_HOURS | UNREACHABLE).
  answeringMode: z.string().trim().optional().or(z.literal("")),
  // Buyer-owned contact name + custom instructions + silence/no-answer policy.
  contactName: z.string().trim().optional().or(z.literal("")),
  customInstructions: z.string().trim().optional().or(z.literal("")),
  silenceRepromptCount: z.coerce.number().int().min(0).max(3).optional(),
  silenceRepromptMessage1: z.string().trim().optional().or(z.literal("")),
  silenceRepromptMessage2: z.string().trim().optional().or(z.literal("")),
  goodbyeMessage: z.string().trim().optional().or(z.literal("")),
  // Buyer-selected CoreAI/platform phone number (by id, or by number as fallback).
  selectedPlatformPhoneNumberId: z.string().trim().optional().or(z.literal("")),
  selectedPhoneNumber: z.string().trim().optional().or(z.literal("")),
  calendarId: z.string().trim().optional().or(z.literal("")),
  workflowId: z.string().trim().optional().or(z.literal("")),
  listingId: z.string().trim().optional().or(z.literal(""))
});

function normalizePhoneNumber(value: string) {
  return value.replace(/[^+\d]/g, "").trim();
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

/**
 * Resolves which workflow the installed AI Receptionist should run. Prefers an
 * explicit id, then a published receptionist listing, then any template, and
 * finally falls back to creating a runnable default workflow so a brand-new
 * platform (no seeded listings) still produces a working agent.
 */
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
      phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      installedAgents: { orderBy: { createdAt: "desc" }, include: { workflow: true } }
    }
  });
}

type LoadedBusiness = NonNullable<Awaited<ReturnType<typeof loadBusinessForOwner>>>;

/**
 * Platform (CoreAI/Twilio) numbers the buyer may pick: all AVAILABLE numbers plus
 * any already assigned to THIS business. Numbers assigned to other businesses are
 * never returned. Also resolves the currently-selected number for this business.
 */
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
    assignedToThisBusiness: Boolean(businessId && number.businessId === businessId)
  }));

  const selectedPlatformPhoneNumberId = mapped.find((number) => number.assignedToThisBusiness)?.id ?? null;

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

/**
 * Buyer "Test call routing": runs the same resolver the live Twilio webhook uses
 * against the buyer's selected CoreAI number and returns a pass/fail checklist so
 * the buyer can confirm an inbound call will reach their deployed agent.
 */
businessRoutes.post("/setup/test-call-routing", async (c) => {
  const authUser = c.get("authUser");
  const webhookUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/twilio/voice`;

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      installedAgents: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  const requested = await c.req
    .json()
    .then((body) => (body && typeof body.phoneNumber === "string" ? body.phoneNumber : ""))
    .catch(() => "");

  const activePhone = business?.phoneNumbers?.[0] ?? null;
  const assignedPlatform = business
    ? await prisma.platformPhoneNumber.findFirst({
        where: { businessId: business.id },
        orderBy: { assignedAt: "desc" }
      })
    : null;

  const number = normalizePhoneNumber(requested) || activePhone?.phoneNumber || assignedPlatform?.phoneNumber || "";

  if (!number) {
    return successResponse(c, {
      number: null,
      webhookUrl,
      readyForCall: false,
      resolveReason: null,
      checks: [{ key: "number_selected", label: "A CoreAI number is selected", ok: false }]
    });
  }

  const [platformForNumber, businessPhoneForNumber, diagnostics] = await Promise.all([
    prisma.platformPhoneNumber.findUnique({ where: { phoneNumber: number } }),
    prisma.businessPhoneNumber.findUnique({ where: { phoneNumber: number }, include: { installedAgent: true } }),
    getCallRoutingDiagnostics(number)
  ]);

  const assignedToThisBusiness = Boolean(
    (business && platformForNumber && platformForNumber.businessId === business.id) ||
      (business && businessPhoneForNumber && businessPhoneForNumber.businessId === business.id)
  );
  const installedAgent = businessPhoneForNumber?.installedAgent ?? business?.installedAgents?.[0] ?? null;

  const checks = [
    { key: "number_exists", label: "Selected CoreAI number exists", ok: Boolean(platformForNumber || businessPhoneForNumber) },
    { key: "assigned_to_business", label: "Number is assigned to this business", ok: assignedToThisBusiness },
    { key: "business_phone_number", label: "BusinessPhoneNumber mapping exists", ok: Boolean(businessPhoneForNumber) },
    { key: "installed_agent_linked", label: "Mapping is linked to an installed agent", ok: Boolean(businessPhoneForNumber?.installedAgentId) },
    {
      key: "installed_agent_active",
      label: "Installed agent exists and is ACTIVE",
      ok: Boolean(installedAgent && installedAgent.status === "ACTIVE")
    },
    { key: "vapi_assistant", label: "Vapi assistant id exists", ok: diagnostics.hasVapiAssistantId },
    { key: "answering_mode", label: "Answering mode allows answering", ok: diagnostics.aiWouldAnswer },
    { key: "resolver", label: "Twilio resolver can resolve this number", ok: diagnostics.resolved }
  ];
  const readyForCall = checks.every((check) => check.ok);

  return successResponse(c, { number, webhookUrl, readyForCall, resolveReason: diagnostics.resolveReason, checks });
});

type SetupChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  blocker?: string;
};

/**
 * Buyer install readiness: derives the connectors the installed workflow needs,
 * checks each against the business's connection/setup state, and gates live
 * deployment. Live deploy is enabled only when every REQUIRED item is complete.
 */
function buildSetupReadiness(business: LoadedBusiness | null, calendarConnected: boolean) {
  const profile = business?.profile ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const installedAgent = business?.installedAgents?.[0] ?? null;
  const workflowJson = installedAgent?.workflow?.workflowJson ?? null;

  const requiredConnectors: ConnectorRequirement[] = workflowJson
    ? requiredConnectorsForWorkflow(workflowJson)
    : [];
  const needs = new Set(requiredConnectors.filter((req) => !req.optional).map((req) => req.connector));

  const profileComplete = Boolean(business && profile && business.name && business.type);
  const calendarComplete = calendarConnected;
  const phoneComplete = Boolean(phone && phone.forwardToPhone);
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
      label: "CoreAI phone number & routing",
      required: needs.has("phone_provider") || needs.has("twilio"),
      complete: phoneComplete,
      blocker:
        (needs.has("phone_provider") || needs.has("twilio")) && !phoneComplete
          ? !phone
            ? "Select a CoreAI phone number."
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
          ? "An SMS sender (assigned number) is required before notifications."
          : undefined
    },
    {
      key: "voice",
      label: "Voice setup",
      required: needs.has("vapi"),
      complete: voiceComplete,
      blocker: needs.has("vapi") && !voiceComplete ? "A voice must be set up before live calls." : undefined
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

  // Buyer's persisted voice + answering-mode choices live on InstalledAgent.configJson.
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
    knowledge:
      business?.knowledgeBases?.map((item) => ({
        title: item.title,
        content: item.content
      })) ?? [],
    calendar: { connected: calendar.connected, email: calendar.email },
    webhooks: phone ? buildWebhookUrls() : null,
    // Buyer install checklist: required connectors, per-item status, blockers,
    // and the live-deploy gate.
    requiredConnectors: readiness.requiredConnectors,
    checklist: readiness.checklist,
    readyToDeploy: readiness.readyToDeploy,
    blockers: readiness.blockers,
    // Buyer's persisted voice + answering-mode choices (prefill the setup UI).
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
    // Buyer-owned contact + custom instructions + silence policy (prefill the UI).
    contactName: typeof config?.contactName === "string" ? config.contactName : null,
    customInstructions: typeof config?.customInstructions === "string" ? config.customInstructions : null,
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

  return successResponse(c, { ...serializeSetup(business, calendar), ...phoneOptions });
});

businessRoutes.post("/setup", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = businessSetupSchema.parse(await c.req.json());

    // Activation requires an active subscription — but only when real Stripe keys
    // are configured, so local/dev with placeholder keys is not blocked.
    if (isBillingEnabled()) {
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
          "An active subscription is required before activating your AI Receptionist.",
          402,
          "SUBSCRIPTION_REQUIRED"
        );
      }
    }

    const existing = await prisma.business.findFirst({
      where: { ownerId: authUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
        installedAgents: { orderBy: { createdAt: "desc" } }
      }
    });

    const existingPhone = existing?.phoneNumbers?.[0] ?? null;

    // Resolve the CoreAI/platform number to assign (before any writes → fail fast).
    // The buyer's explicit selection wins; otherwise reuse the current number, else
    // auto-assign the first available (legacy fallback only when nothing selected).
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

    // A selected number must not belong to another business.
    if (
      targetPlatform &&
      targetPlatform.status === "ASSIGNED" &&
      targetPlatform.businessId &&
      targetPlatform.businessId !== (existing?.id ?? null)
    ) {
      return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
    }

    // No auto-assign: the buyer must pick a CoreAI number (primary UX). When no
    // number is selected and none exists yet, the business simply stays without a
    // phone until one is chosen (the deploy checklist blocks going live).

    const resolved = await resolveReceptionistWorkflow({
      ownerId: authUser.id,
      workflowId: input.workflowId || undefined,
      listingId: input.listingId || undefined
    });

    // Canonicalize the timezone before persisting (e.g. Asia/Calcutta → Asia/Kolkata).
    const timeZone = normalizeTimeZone(input.timeZone);

    const profileData = {
      bookingUrl: input.bookingUrl || null,
      teamPhone: input.teamPhone || null,
      calendarId: input.calendarId || "primary",
      timeZone,
      tone: input.tone,
      escalationRules: input.escalationRules || null,
      services: input.services,
      faqsJson: input.faqs as never,
      hoursJson: input.hours as never,
      // Stored only when explicitly provided; runtime falls back to env defaults.
      vapiAssistantId: input.vapiAssistantId || null,
      vapiPhoneNumberId: input.vapiPhoneNumberId || null
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
      vapiAssistantId: input.vapiAssistantId || null,
      vapiPhoneNumberId: input.vapiPhoneNumberId || null,
      calendarId: input.calendarId || "primary",
      // Buyer's calendar config (timezone mirrored on BusinessProfile.timeZone too).
      calendar: {
        calendarId: input.calendarId || "primary",
        timezone: timeZone
      },
      // Buyer's voice selection (overrides the agent default at deploy).
      voice: {
        name: input.voice || null,
        voiceId: input.voiceId || null,
        provider: input.voiceProvider || null
      },
      // Buyer's phone answering mode (routing). Stored for the live voice path.
      phoneRouting: {
        mode: input.answeringMode || "NO_ANSWER"
      },
      // Buyer-owned contact + custom instructions + silence/no-answer policy.
      contactName: input.contactName || null,
      customInstructions: input.customInstructions || null,
      silence: {
        repromptCount: input.silenceRepromptCount ?? 2,
        reprompt1: input.silenceRepromptMessage1 || null,
        reprompt2: input.silenceRepromptMessage2 || null,
        goodbye: input.goodbyeMessage || null
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
      const conflicting = await prisma.businessPhoneNumber.findUnique({ where: { phoneNumber: targetNumber } });
      if (conflicting && conflicting.businessId !== business.id) {
        return errorResponse(c, "That phone number is already assigned to another business.", 409, "PHONE_NUMBER_TAKEN");
      }

      // Switching numbers: release the old platform number + deactivate the old mapping.
      if (existingPhone && existingPhone.phoneNumber !== targetNumber) {
        await prisma.platformPhoneNumber.updateMany({
          where: { phoneNumber: existingPhone.phoneNumber, businessId: business.id },
          data: { status: "AVAILABLE", businessId: null, assignedAt: null }
        });
        await prisma.businessPhoneNumber.update({
          where: { id: existingPhone.id },
          data: { isActive: false, installedAgentId: null }
        });
      }

      businessPhone = await prisma.businessPhoneNumber.upsert({
        where: { phoneNumber: targetNumber },
        update: {
          businessId: business.id,
          installedAgentId: installedAgent.id,
          twilioPhoneNumberSid: targetPlatform.twilioSid ?? null,
          forwardToPhone: forward,
          isActive: true
        },
        create: {
          businessId: business.id,
          installedAgentId: installedAgent.id,
          phoneNumber: targetNumber,
          twilioPhoneNumberSid: targetPlatform.twilioSid ?? null,
          forwardToPhone: forward,
          isActive: true
        }
      });

      await prisma.platformPhoneNumber.update({
        where: { id: targetPlatform.id },
        data: { status: "ASSIGNED", businessId: business.id, assignedAt: new Date() }
      });
    } else if (existingPhone) {
      // Kept the existing number (no new selection) — update forwarding + agent link.
      businessPhone = await prisma.businessPhoneNumber.update({
        where: { id: existingPhone.id },
        data: { forwardToPhone: forward, installedAgentId: installedAgent.id, isActive: true }
      });
    }
    // else: no number selected yet — the business stays without a phone (blocked at deploy).

    // Build/refresh the per-business Vapi assistant ONLY on the final deploy (or for
    // legacy callers that don't send `deploy`). Incremental "Save progress" skips it
    // to keep saves fast. Non-fatal — setup still succeeds on failure.
    if (input.deploy !== false) {
      try {
        const voiceDeploy = await deployInstalledAgentVoiceAssistant(business.id);
        if (!voiceDeploy) {
          await ensureBusinessVapiAssistant(business.id);
        }
      } catch (error) {
        console.error("voice assistant deploy failed (non-fatal); falling back", error);
        try {
          await ensureBusinessVapiAssistant(business.id);
        } catch (fallbackError) {
          console.error("ensureBusinessVapiAssistant fallback failed (non-fatal)", fallbackError);
        }
      }
    }

    const [refreshed, calendar] = await Promise.all([
      loadBusinessForOwner(authUser.id),
      getGmailConnectionStatus(authUser.id)
    ]);
    const phoneOptions = await loadPhoneOptions(refreshed?.id ?? null);

    return successResponse(
      c,
      {
        ...serializeSetup(refreshed, calendar),
        assignedPhoneNumber: businessPhone?.phoneNumber ?? null,
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
      error instanceof Error ? error.message : "Could not save business setup",
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
      error instanceof Error ? error.message : "Could not create Google OAuth URL",
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
