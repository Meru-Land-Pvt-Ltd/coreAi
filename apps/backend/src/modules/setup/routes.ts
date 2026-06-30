import { createHash, randomInt } from "node:crypto";
import { Hono } from "hono";
import { PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { env, isProduction } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { sendTwilioSms } from "../architect/twilio-connector";
import {
  RECEPTIONIST_WORKFLOW_DESCRIPTION,
  RECEPTIONIST_WORKFLOW_NAME,
  buildReceptionistWorkflowJson
} from "../business/receptionist-template";

export const setupRoutes = new Hono();

/**
 * Per-agent setup wizard for a business. A business reaches this flow after
 * purchasing an agent from the marketplace, so every endpoint is scoped to an
 * authenticated BUSINESS user that owns the listing being set up.
 */
setupRoutes.use("*", requireAuth);
setupRoutes.use("*", requireRole(["BUSINESS"]));

// A payment in one of these states means the business owns the agent.
const OWNED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.TRIALING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PENDING
];

// ---------------------------------------------------------------------------
// OTP store (in-memory) — transient phone verification codes keyed by the
// owner + listing being configured. Codes are short-lived so memory is fine
// and we avoid a schema migration just for verification.
// ---------------------------------------------------------------------------
type OtpEntry = {
  codeHash: string;
  phone: string;
  expiresAt: number;
  attempts: number;
};

const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function otpKey(userId: string, listingId: string) {
  return `${userId}::${listingId}`;
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function normalizePhone(value: string) {
  return value.replace(/[^+\d]/g, "").trim();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const sendOtpSchema = z.object({
  listingId: z.string().trim().min(1),
  phone: z.string().trim().min(5, "A valid phone number is required")
});

const verifyOtpSchema = z.object({
  listingId: z.string().trim().min(1),
  phone: z.string().trim().min(5),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code")
});

const configureSchema = z.object({
  listingId: z.string().trim().min(1),
  businessName: z.string().trim().min(1, "Business name is required"),
  tone: z.enum(["friendly", "professional", "casual"]).default("friendly"),
  message: z.string().trim().min(1, "Message is required").max(480),
  messageEdited: z.boolean().default(false),
  hoursMode: z.enum(["247", "custom"]).default("247"),
  startTime: z.string().trim().optional().or(z.literal("")),
  endTime: z.string().trim().optional().or(z.literal("")),
  days: z
    .object({
      mon: z.boolean(),
      tue: z.boolean(),
      wed: z.boolean(),
      thu: z.boolean(),
      fri: z.boolean(),
      sat: z.boolean(),
      sun: z.boolean()
    })
    .partial()
    .optional()
});

const listingIdBodySchema = z.object({
  listingId: z.string().trim().min(1)
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type OwnedListing = NonNullable<Awaited<ReturnType<typeof loadOwnedListing>>>;

async function loadOwnedListing(userId: string, listingId: string) {
  const payment = await prisma.payment.findFirst({
    where: { userId, listingId, status: { in: OWNED_PAYMENT_STATUSES } }
  });

  if (!payment) return null;

  return prisma.agentListing.findUnique({
    where: { id: listingId },
    include: {
      workflow: { select: { id: true, name: true, description: true } },
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: { select: { title: true } }
        }
      }
    }
  });
}

async function resolveWorkflowId(ownerId: string, listingWorkflowId: string | null) {
  if (listingWorkflowId) {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: listingWorkflowId },
      select: { id: true }
    });
    if (workflow) return workflow.id;
  }

  const template = await prisma.workflowDefinition.findFirst({
    where: { isTemplate: true },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (template) return template.id;

  const created = await prisma.workflowDefinition.create({
    data: {
      architectUserId: ownerId,
      name: RECEPTIONIST_WORKFLOW_NAME,
      description: RECEPTIONIST_WORKFLOW_DESCRIPTION,
      isTemplate: false,
      workflowJson: buildReceptionistWorkflowJson() as never
    },
    select: { id: true }
  });
  return created.id;
}

/**
 * Ensure a Business + InstalledAgent row exists for this owner/listing so the
 * agent's setup is stored against the business id and agent id. Reuses the
 * existing business for the owner; creates the per-listing installed agent.
 */
async function ensureBusinessAndAgent(opts: {
  ownerId: string;
  listing: OwnedListing;
  businessName?: string;
}) {
  let business = await prisma.business.findFirst({
    where: { ownerId: opts.ownerId },
    orderBy: { createdAt: "desc" }
  });

  if (!business) {
    business = await prisma.business.create({
      data: {
        ownerId: opts.ownerId,
        name: opts.businessName?.trim() || opts.listing.name || "My Business",
        type: "general"
      }
    });
  } else if (opts.businessName?.trim() && opts.businessName.trim() !== business.name) {
    business = await prisma.business.update({
      where: { id: business.id },
      data: { name: opts.businessName.trim() }
    });
  }

  let agent = await prisma.installedAgent.findFirst({
    where: { businessId: business.id, listingId: opts.listing.id },
    orderBy: { createdAt: "desc" }
  });

  if (!agent) {
    const workflowId = await resolveWorkflowId(opts.ownerId, opts.listing.workflowId);
    agent = await prisma.installedAgent.create({
      data: {
        businessId: business.id,
        workflowId,
        listingId: opts.listing.id,
        name: opts.listing.name,
        status: "PROVISIONING",
        configJson: {} as never
      }
    });
  }

  return { business, agent };
}

function readSetupConfig(configJson: unknown) {
  const config = (configJson as Record<string, unknown> | null) ?? {};
  const setup = (config.setup as Record<string, unknown> | undefined) ?? {};
  return { config, setup };
}

async function mergeAgentSetup(agentId: string, patch: Record<string, unknown>) {
  const agent = await prisma.installedAgent.findUnique({ where: { id: agentId } });
  const { config, setup } = readSetupConfig(agent?.configJson);

  const nextConfig = {
    ...config,
    connectors: (config.connectors as string[] | undefined) ?? ["TWILIO"],
    setup: { ...setup, ...patch }
  };

  return prisma.installedAgent.update({
    where: { id: agentId },
    data: { configJson: nextConfig as never }
  });
}

async function getActivePhone(businessId: string) {
  return prisma.businessPhoneNumber.findFirst({
    where: { businessId },
    orderBy: { createdAt: "desc" }
  });
}

/**
 * Store the verified business phone. The verified number is the line the
 * business owner controls (forwardToPhone). A platform Twilio number is claimed
 * when one is available so missed-call routing has a number to publish.
 */
async function persistVerifiedPhone(opts: {
  businessId: string;
  installedAgentId: string;
  phone: string;
}) {
  const normalized = normalizePhone(opts.phone);
  const existing = await getActivePhone(opts.businessId);

  if (existing) {
    return prisma.businessPhoneNumber.update({
      where: { id: existing.id },
      data: {
        forwardToPhone: normalized,
        installedAgentId: opts.installedAgentId,
        isActive: true
      }
    });
  }

  const claimed = await prisma.platformPhoneNumber.findFirst({
    where: { status: "AVAILABLE", provider: "TWILIO" },
    orderBy: { createdAt: "asc" }
  });

  const created = await prisma.businessPhoneNumber.create({
    data: {
      businessId: opts.businessId,
      installedAgentId: opts.installedAgentId,
      phoneNumber: claimed?.phoneNumber ?? normalized,
      twilioPhoneNumberSid: claimed?.twilioSid ?? null,
      forwardToPhone: normalized,
      isActive: true
    }
  });

  if (claimed) {
    await prisma.platformPhoneNumber.update({
      where: { id: claimed.id },
      data: { status: "ASSIGNED", businessId: opts.businessId, assignedAt: new Date() }
    });
  }

  return created;
}

function serializeListing(listing: OwnedListing) {
  return {
    id: listing.id,
    name: listing.name,
    shortDescription: listing.shortDescription,
    description: listing.description,
    priceCents: listing.priceCents,
    tags: listing.tags,
    requiredConnectors: listing.requiredConnectors,
    workflowId: listing.workflowId,
    architectName:
      listing.architect?.fullName ||
      listing.architect?.architectProfile?.title ||
      listing.architect?.email ||
      "Triven Architect"
  };
}

// ---------------------------------------------------------------------------
// GET /setup/agent/:listingId — agent details + any saved setup state
// ---------------------------------------------------------------------------
setupRoutes.get("/agent/:listingId", async (c) => {
  const authUser = c.get("authUser");
  const listingId = c.req.param("listingId");

  const listing = await loadOwnedListing(authUser.id, listingId);
  if (!listing) {
    return errorResponse(c, "You don't own this agent yet.", 403, "AGENT_NOT_OWNED");
  }

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      profile: true,
      phoneNumbers: { orderBy: { createdAt: "desc" }, take: 1 },
      installedAgents: {
        where: { listingId },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  const agent = business?.installedAgents?.[0] ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const { setup } = readSetupConfig(agent?.configJson);

  return successResponse(c, {
    listing: serializeListing(listing),
    business: business ? { id: business.id, name: business.name, type: business.type } : null,
    phone: phone
      ? {
          forwardToPhone: phone.forwardToPhone,
          platformNumber: phone.phoneNumber,
          verified: Boolean(setup.phoneVerified)
        }
      : null,
    setup: {
      phoneVerified: Boolean(setup.phoneVerified),
      verifiedPhone: (setup.verifiedPhone as string | undefined) ?? phone?.forwardToPhone ?? null,
      tone: (setup.tone as string | undefined) ?? "friendly",
      message: (setup.message as string | undefined) ?? null,
      messageEdited: Boolean(setup.messageEdited),
      hoursMode: (setup.hoursMode as string | undefined) ?? "247",
      startTime: (setup.startTime as string | undefined) ?? "08:00",
      endTime: (setup.endTime as string | undefined) ?? "18:00",
      days: (setup.days as Record<string, boolean> | undefined) ?? null,
      tested: Boolean(setup.tested),
      live: Boolean(setup.live)
    },
    status: agent?.status ?? null
  });
});

// ---------------------------------------------------------------------------
// POST /setup/send-otp — send a verification code via Twilio SMS
// ---------------------------------------------------------------------------
setupRoutes.post("/send-otp", async (c) => {
  const authUser = c.get("authUser");
  const parsed = sendOtpSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
  }

  const listing = await loadOwnedListing(authUser.id, parsed.data.listingId);
  if (!listing) {
    return errorResponse(c, "You don't own this agent yet.", 403, "AGENT_NOT_OWNED");
  }

  const phone = normalizePhone(parsed.data.phone);
  const code = generateOtp();

  otpStore.set(otpKey(authUser.id, parsed.data.listingId), {
    codeHash: hashCode(code),
    phone,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0
  });

  try {
    await sendTwilioSms({
      to: phone,
      body: `Your Triven.ai verification code is ${code}. It expires in 10 minutes.`
    });
    return successResponse(c, { sent: true }, "Verification code sent");
  } catch (error) {
    // In non-production, allow the flow to continue (Twilio may be unconfigured)
    // by surfacing the code so testing isn't blocked.
    if (!isProduction) {
      console.warn("Twilio send failed (dev) — returning devCode", error);
      return successResponse(c, { sent: false, devCode: code }, "Verification code generated (dev)");
    }
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not send verification code",
      500,
      "OTP_SEND_FAILED"
    );
  }
});

// ---------------------------------------------------------------------------
// POST /setup/verify-otp — verify the code, persist the phone
// ---------------------------------------------------------------------------
setupRoutes.post("/verify-otp", async (c) => {
  const authUser = c.get("authUser");
  const parsed = verifyOtpSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
  }

  const listing = await loadOwnedListing(authUser.id, parsed.data.listingId);
  if (!listing) {
    return errorResponse(c, "You don't own this agent yet.", 403, "AGENT_NOT_OWNED");
  }

  const key = otpKey(authUser.id, parsed.data.listingId);
  const entry = otpStore.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    otpStore.delete(key);
    return errorResponse(c, "Your code expired. Please request a new one.", 400, "OTP_EXPIRED");
  }

  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(key);
    return errorResponse(c, "Too many attempts. Please request a new code.", 400, "OTP_TOO_MANY_ATTEMPTS");
  }

  entry.attempts += 1;

  if (entry.codeHash !== hashCode(parsed.data.code)) {
    return errorResponse(c, "That code doesn't match. Please try again.", 400, "OTP_INVALID");
  }

  otpStore.delete(key);

  try {
    const { business, agent } = await ensureBusinessAndAgent({
      ownerId: authUser.id,
      listing
    });

    const phoneNumber = await persistVerifiedPhone({
      businessId: business.id,
      installedAgentId: agent.id,
      phone: entry.phone
    });

    await mergeAgentSetup(agent.id, {
      phoneVerified: true,
      verifiedPhone: entry.phone
    });

    return successResponse(
      c,
      {
        verified: true,
        verifiedPhone: entry.phone,
        platformNumber: phoneNumber.phoneNumber,
        businessId: business.id,
        installedAgentId: agent.id
      },
      "Phone verified"
    );
  } catch (error) {
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not save your phone number",
      500,
      "PHONE_SAVE_FAILED"
    );
  }
});

// ---------------------------------------------------------------------------
// POST /setup/configure — save the message, tone and hours (Configure tab)
// ---------------------------------------------------------------------------
setupRoutes.post("/configure", async (c) => {
  const authUser = c.get("authUser");
  const parsed = configureSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
  }

  const listing = await loadOwnedListing(authUser.id, parsed.data.listingId);
  if (!listing) {
    return errorResponse(c, "You don't own this agent yet.", 403, "AGENT_NOT_OWNED");
  }

  try {
    const { business, agent } = await ensureBusinessAndAgent({
      ownerId: authUser.id,
      listing,
      businessName: parsed.data.businessName
    });

    const days =
      parsed.data.hoursMode === "custom"
        ? {
            mon: parsed.data.days?.mon ?? true,
            tue: parsed.data.days?.tue ?? true,
            wed: parsed.data.days?.wed ?? true,
            thu: parsed.data.days?.thu ?? true,
            fri: parsed.data.days?.fri ?? true,
            sat: parsed.data.days?.sat ?? false,
            sun: parsed.data.days?.sun ?? false
          }
        : null;

    const hoursJson =
      parsed.data.hoursMode === "custom" && days
        ? Object.entries(days)
            .filter(([, open]) => open)
            .map(([day]) => ({
              day,
              open: parsed.data.startTime || "08:00",
              close: parsed.data.endTime || "18:00",
              closed: false
            }))
        : [];

    await prisma.businessProfile.upsert({
      where: { businessId: business.id },
      update: { tone: parsed.data.tone, hoursJson: hoursJson as never },
      create: {
        businessId: business.id,
        tone: parsed.data.tone,
        services: [],
        hoursJson: hoursJson as never
      }
    });

    await mergeAgentSetup(agent.id, {
      businessName: parsed.data.businessName,
      tone: parsed.data.tone,
      message: parsed.data.message,
      messageEdited: parsed.data.messageEdited,
      hoursMode: parsed.data.hoursMode,
      startTime: parsed.data.startTime || "08:00",
      endTime: parsed.data.endTime || "18:00",
      days
    });

    return successResponse(c, { configured: true }, "Configuration saved");
  } catch (error) {
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not save configuration",
      500,
      "CONFIGURE_FAILED"
    );
  }
});

// ---------------------------------------------------------------------------
// POST /setup/test-sms — send a sample text-back to the verified phone
// ---------------------------------------------------------------------------
setupRoutes.post("/test-sms", async (c) => {
  const authUser = c.get("authUser");
  const parsed = listingIdBodySchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, "Invalid request", 422, "VALIDATION_ERROR");
  }

  const listing = await loadOwnedListing(authUser.id, parsed.data.listingId);
  if (!listing) {
    return errorResponse(c, "You don't own this agent yet.", 403, "AGENT_NOT_OWNED");
  }

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      phoneNumbers: { orderBy: { createdAt: "desc" }, take: 1 },
      installedAgents: { where: { listingId: parsed.data.listingId }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  const agent = business?.installedAgents?.[0] ?? null;
  const phone = business?.phoneNumbers?.[0] ?? null;
  const { setup } = readSetupConfig(agent?.configJson);
  const to = (setup.verifiedPhone as string | undefined) || phone?.forwardToPhone;

  if (!to) {
    return errorResponse(c, "Verify your phone number first.", 400, "PHONE_NOT_VERIFIED");
  }

  const message =
    (setup.message as string | undefined) ||
    `Hi! Sorry we missed your call at ${business?.name || "our office"}. Reply YES and we'll get you scheduled right away.`;

  try {
    await sendTwilioSms({
      to,
      body: message,
      fromPhoneNumber: phone?.phoneNumber ?? null
    });

    if (agent) {
      await mergeAgentSetup(agent.id, { tested: true });
    }

    return successResponse(c, { sent: true }, "Test message sent");
  } catch (error) {
    if (!isProduction) {
      if (agent) await mergeAgentSetup(agent.id, { tested: true });
      return successResponse(c, { sent: false }, "Test simulated (dev)");
    }
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not send test message",
      500,
      "TEST_SMS_FAILED"
    );
  }
});

// ---------------------------------------------------------------------------
// POST /setup/go-live — activate the installed agent
// ---------------------------------------------------------------------------
setupRoutes.post("/go-live", async (c) => {
  const authUser = c.get("authUser");
  const parsed = listingIdBodySchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(c, "Invalid request", 422, "VALIDATION_ERROR");
  }

  const listing = await loadOwnedListing(authUser.id, parsed.data.listingId);
  if (!listing) {
    return errorResponse(c, "You don't own this agent yet.", 403, "AGENT_NOT_OWNED");
  }

  try {
    const { agent } = await ensureBusinessAndAgent({ ownerId: authUser.id, listing });

    await prisma.installedAgent.update({
      where: { id: agent.id },
      data: { status: "ACTIVE" }
    });

    await mergeAgentSetup(agent.id, { live: true });

    return successResponse(c, { live: true, installedAgentId: agent.id }, "Agent is live");
  } catch (error) {
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not activate the agent",
      500,
      "GO_LIVE_FAILED"
    );
  }
});
