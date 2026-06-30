import { Hono } from "hono";
import { z } from "zod";
import { requiredConnectorsForWorkflow, type ConnectorRequirement } from "@coreai/shared";
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
import { deployInstalledAgentVoiceAssistant } from "./deploy";
import { isBillingEnabled } from "../../lib/stripe";

export const businessRoutes = new Hono();

/**
 * Stripe billing webhook must stay PUBLIC and read the RAW body for signature
 * verification, so it is registered BEFORE the auth guards below.
 */
businessRoutes.post("/billing/webhook", handleStripeWebhook);

/**
 * Every business route requires an authenticated BUSINESS user. The buyer is
 * always the owner of the records they create here.
 */
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
  forwardToPhone: z.string().trim().min(5, "Forwarding phone number is required"),
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
      label: "Phone routing / number",
      required: needs.has("phone_provider") || needs.has("twilio"),
      complete: phoneComplete,
      blocker:
        (needs.has("phone_provider") || needs.has("twilio")) && !phoneComplete
          ? "Phone routing is required before live calls."
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

  return {
    business: business
      ? { id: business.id, name: business.name, type: business.type }
      : null,
    profile: profile
      ? {
          bookingUrl: profile.bookingUrl,
          teamPhone: profile.teamPhone,
          calendarId: profile.calendarId,
          timeZone: profile.timeZone,
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
        : null
  };
}

businessRoutes.get("/setup", async (c) => {
  const authUser = c.get("authUser");
  const [business, calendar] = await Promise.all([
    loadBusinessForOwner(authUser.id),
    getGmailConnectionStatus(authUser.id)
  ]);

  return successResponse(c, serializeSetup(business, calendar));
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

    // Platform-assigned number: only claim one if this business does not already
    // have an active mapping. Fail fast (before writes) if none is available.
    let claimedNumber = null as
      | Awaited<ReturnType<typeof prisma.platformPhoneNumber.findFirst>>
      | null;
    if (!existingPhone) {
      claimedNumber = await prisma.platformPhoneNumber.findFirst({
        where: { status: "AVAILABLE", provider: "TWILIO" },
        orderBy: { createdAt: "asc" }
      });
      if (!claimedNumber) {
        return errorResponse(
          c,
          "No CoreAI phone numbers are available. Please contact support.",
          409,
          "NO_PHONE_NUMBER_AVAILABLE"
        );
      }
    }

    const resolved = await resolveReceptionistWorkflow({
      ownerId: authUser.id,
      workflowId: input.workflowId || undefined,
      listingId: input.listingId || undefined
    });

    const profileData = {
      bookingUrl: input.bookingUrl || null,
      teamPhone: input.teamPhone || null,
      calendarId: input.calendarId || "primary",
      timeZone: input.timeZone,
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
      // Buyer's voice selection (overrides the agent default at deploy).
      voice: {
        name: input.voice || null,
        voiceId: input.voiceId || null,
        provider: input.voiceProvider || null
      },
      // Buyer's phone answering mode (routing). Stored for the live voice path.
      phoneRouting: {
        mode: input.answeringMode || "NO_ANSWER"
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

    let businessPhone;
    if (existingPhone) {
      businessPhone = await prisma.businessPhoneNumber.update({
        where: { id: existingPhone.id },
        data: {
          forwardToPhone: normalizePhoneNumber(input.forwardToPhone),
          installedAgentId: installedAgent.id,
          isActive: true
        }
      });
    } else {
      const assigned = claimedNumber!;
      businessPhone = await prisma.businessPhoneNumber.create({
        data: {
          businessId: business.id,
          installedAgentId: installedAgent.id,
          phoneNumber: normalizePhoneNumber(assigned.phoneNumber),
          twilioPhoneNumberSid: assigned.twilioSid ?? null,
          forwardToPhone: normalizePhoneNumber(input.forwardToPhone),
          isActive: true
        }
      });

      await prisma.platformPhoneNumber.update({
        where: { id: assigned.id },
        data: { status: "ASSIGNED", businessId: business.id, assignedAt: new Date() }
      });
    }

    // Build/refresh the per-business Vapi assistant from the installed workflow's
    // voice node (honoring the buyer's voice selection). Falls back to assigning
    // the shared default assistant for SMS-only agents or if the build fails.
    // Non-fatal — setup still succeeds so the buyer can retry/connect later.
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

    const [refreshed, calendar] = await Promise.all([
      loadBusinessForOwner(authUser.id),
      getGmailConnectionStatus(authUser.id)
    ]);

    return successResponse(
      c,
      {
        ...serializeSetup(refreshed, calendar),
        assignedPhoneNumber: businessPhone.phoneNumber
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
