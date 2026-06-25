import { Hono } from "hono";
import { z } from "zod";
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

export const businessRoutes = new Hono();

/**
 * Every business route requires an authenticated BUSINESS user. The buyer is
 * always the owner of the records they create here.
 */
businessRoutes.use("*", requireAuth);
businessRoutes.use("*", requireRole(["BUSINESS"]));

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
      installedAgents: { orderBy: { createdAt: "desc" } }
    }
  });
}

type LoadedBusiness = NonNullable<Awaited<ReturnType<typeof loadBusinessForOwner>>>;

function serializeSetup(business: LoadedBusiness | null, calendar: { connected: boolean; email: string | null }) {
  const profile = business?.profile ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const installedAgent = business?.installedAgents?.[0] ?? null;

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
    webhooks: phone ? buildWebhookUrls() : null
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
      calendarId: input.calendarId || "primary"
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
