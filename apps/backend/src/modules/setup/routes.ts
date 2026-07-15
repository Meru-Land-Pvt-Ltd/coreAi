import { createHash, randomInt } from "node:crypto";
import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isProduction } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { resolveTwilioSmsMode, sendTwilioSms, validateSmsRecipientE164 } from "../architect/twilio-connector";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import { claimAvailableInventoryNumber } from "../business/phone-provisioning";
import {
  RECEPTIONIST_WORKFLOW_DESCRIPTION,
  RECEPTIONIST_WORKFLOW_NAME,
  buildReceptionistWorkflowJson
} from "../business/receptionist-template";
import { canBusinessAccessListing } from "../business/purchase-access";

export const setupRoutes = new Hono();

setupRoutes.use("*", requireAuth);
setupRoutes.use("*", requireRole(["BUSINESS"]));

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
  // Centralized ownership: SUCCEEDED or in-window TRIALING payment, or an
  // already-installed agent (legacy). PENDING/FAILED payments grant nothing.
  const access = await canBusinessAccessListing({ userId, listingId });

  if (!access.allowed) return null;

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

    try {
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
    } catch (error) {
      // Unique (businessId, listingId) — a concurrent request (double click,
      // webhook retry) already installed this listing; reuse that row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        agent = await prisma.installedAgent.findFirst({
          where: { businessId: business.id, listingId: opts.listing.id },
          orderBy: { createdAt: "desc" }
        });
      }
      if (!agent) throw error;
    }
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

  // Prefer the number already allotted to this buyer at purchase time
  // (assigned to the business, or reserved by owner before it existed) so a
  // second pool number is never claimed for the same buyer.
  const business = await prisma.business.findUnique({
    where: { id: opts.businessId },
    select: { ownerId: true }
  });
  const alreadyAllotted = await prisma.platformPhoneNumber.findFirst({
    where: {
      status: "ASSIGNED",
      // Never adopt the reserved shared Triven SMS sender as a buyer number.
      isPlatformSmsSender: false,
      OR: [
        { businessId: opts.businessId },
        ...(business ? [{ businessId: null, buyerUserId: business.ownerId }] : [])
      ]
    },
    orderBy: { assignedAt: "desc" }
  });

  // Pool fallback claims atomically (status guard inside) — a concurrent
  // purchase or another business's setup can never end up on the same number.
  const claimed =
    alreadyAllotted ??
    (business
      ? await claimAvailableInventoryNumber({
          buyerUserId: business.ownerId,
          businessId: opts.businessId,
          installedAgentId: opts.installedAgentId
        })
      : null);

  const targetNumber = claimed?.phoneNumber ?? normalized;

  // A reclaimed pool number may carry a historical (inactive) routing row —
  // take it over. An ACTIVE row owned by another business means the number
  // (or the buyer's own line) is in use elsewhere: fail loudly, never steal.
  const existingRow = await prisma.businessPhoneNumber.findUnique({
    where: { phoneNumber: targetNumber },
    select: { businessId: true, isActive: true }
  });
  if (existingRow && existingRow.isActive && existingRow.businessId !== opts.businessId) {
    throw new Error("That phone number is already in use by another business.");
  }

  const created = await prisma.businessPhoneNumber.upsert({
    where: { phoneNumber: targetNumber },
    update: {
      businessId: opts.businessId,
      installedAgentId: opts.installedAgentId,
      twilioPhoneNumberSid: claimed?.twilioSid ?? null,
      forwardToPhone: normalized,
      isActive: true
    },
    create: {
      businessId: opts.businessId,
      installedAgentId: opts.installedAgentId,
      phoneNumber: targetNumber,
      twilioPhoneNumberSid: claimed?.twilioSid ?? null,
      forwardToPhone: normalized,
      isActive: true
    }
  });

  if (claimed) {
    await prisma.platformPhoneNumber.update({
      where: { id: claimed.id },
      data: {
        status: "ASSIGNED",
        businessId: opts.businessId,
        installedAgentId: opts.installedAgentId,
        assignedAt: claimed.assignedAt ?? new Date()
      }
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
  const storedTo = (setup.verifiedPhone as string | undefined) || phone?.forwardToPhone;

  if (!storedTo) {
    return errorResponse(c, "Verify your phone number first.", 400, "PHONE_NOT_VERIFIED");
  }

  // Explicit E.164 only — an ambiguous stored number (no country code) is
  // rejected with a clear message rather than guessed.
  const recipient = validateSmsRecipientE164(storedTo);
  if (!recipient.ok) {
    return errorResponse(c, recipient.error, 422, "INVALID_PHONE_NUMBER");
  }
  const to = recipient.e164;

  const message =
    (setup.message as string | undefined) ||
    `Hi! Sorry we missed your call at ${business?.name || "our office"}. ${
      phone?.phoneNumber ? `Call us back at ${phone.phoneNumber}. ` : ""
    }Reply STOP to opt out.`;

  // Sent through the shared Triven Messaging Service and tracked as an
  // SmsExecution. A Twilio failure is a failure — the SIMULATED /
  // TWILIO_TEST_CREDENTIALS / LIVE mode is explicit (TWILIO_SMS_MODE), and the
  // agent is marked tested only when the request was accepted or explicitly
  // simulated.
  const outcome = await sendTrackedSms({
    to,
    body: message,
    messageType: "TEST_SMS",
    businessId: business?.id ?? null,
    installedAgentId: agent?.id ?? null
  });

  if (!outcome.sent) {
    return errorResponse(c, outcome.error ?? "Could not send test message", 500, "TEST_SMS_FAILED");
  }

  if (agent) {
    await mergeAgentSetup(agent.id, { tested: true });
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
      messageSid: outcome.messageSid ?? undefined,
      status: outcome.status ?? undefined,
      messagingServiceSid: outcome.messagingServiceSid ?? undefined,
      from: outcome.from ?? undefined,
      to,
      executionId: outcome.executionId ?? undefined
    },
    simulated
      ? "Test SMS simulated (no Twilio request)"
      : mode === "TWILIO_TEST_CREDENTIALS"
        ? "Test SMS accepted with Twilio test credentials (not delivered)"
        : "Test message sent"
  );
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
