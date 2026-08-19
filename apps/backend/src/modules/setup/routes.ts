import { createHash, randomInt } from "node:crypto";
import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isProduction } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { resolvePrimaryBusinessId } from "../business/primary-business";
import { requireAuth, requireRole } from "../../middleware/auth";
import { resolveTwilioSmsMode, sendTwilioSms, validateSmsRecipientE164 } from "../architect/twilio-connector";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import {
  RECEPTIONIST_WORKFLOW_DESCRIPTION,
  RECEPTIONIST_WORKFLOW_NAME,
  buildReceptionistWorkflowJson
} from "../business/receptionist-template";
import { canBusinessAccessListing, findActiveListingPurchase } from "../business/purchase-access";
import { grantRole } from "../../lib/roles";
import { deriveSetupVisibility } from "@coreai/shared";
import type { InstallSource } from "@prisma/client";
import { syncSchedulesForInstalledAgent } from "../architect/schedule-trigger";
import { syncCallListsForInstalledAgent } from "../architect/call-list";
import { syncWebhookEndpointsForInstalledAgent } from "../webhooks/inbound-webhook";

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
export type OwnedListing = NonNullable<Awaited<ReturnType<typeof loadOwnedListing>>>;

export async function loadOwnedListing(userId: string, listingId: string) {
  // Centralized ownership: SUCCEEDED or in-window TRIALING payment, or an
  // already-installed agent (legacy). PENDING/FAILED payments grant nothing.
  const access = await canBusinessAccessListing({ userId, listingId });

  if (!access.allowed) return null;

  return prisma.agentListing.findUnique({
    where: { id: listingId },
    include: {
      workflow: { select: { id: true, name: true, description: true, workflowJson: true } },
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
 * How this install was acquired. The architect installing their own listing
 * is a self-test — it must never create a Payment, earning, commission or
 * payout obligation.
 */
async function resolveInstallSource(
  ownerId: string,
  listing: OwnedListing
): Promise<InstallSource> {
  if (listing.architectUserId === ownerId) return "ARCHITECT_SELF_TEST";
  if (listing.pricingModel === "FREE" || listing.priceCents === 0) return "FREE_INSTALL";

  const payment = await findActiveListingPurchase(ownerId, listing.id);
  if (payment?.status === "TRIALING") return "TRIAL";

  return "MARKETPLACE_PURCHASE";
}

export async function ensureBusinessAndAgent(opts: {
  ownerId: string;
  listing: OwnedListing;
  businessName?: string;
}) {
  // Installing an agent is an intentional buyer action — make sure the owner
  // holds the BUSINESS capability (idempotent; an ARCHITECT self-installing
  // keeps architect access and additionally becomes a buyer).
  await grantRole(opts.ownerId, "BUSINESS");

  const primaryId = await resolvePrimaryBusinessId(opts.ownerId);
  let business = await prisma.business.findFirst({
    where: { id: primaryId ?? "" }
  });

  if (!business) {
    // Advisory-locked create: concurrent first-time installs (double-click,
    // purchase response + webhook) would otherwise both see "no business"
    // and create two rows for the owner.
    business = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ensure-business:${opts.ownerId}`}))`;

      const existing = await tx.business.findFirst({
        where: { ownerId: opts.ownerId },
        orderBy: { createdAt: "desc" }
      });
      if (existing) return existing;

      return tx.business.create({
        data: {
          ownerId: opts.ownerId,
          name: opts.businessName?.trim() || opts.listing.name || "My Business",
          type: "general"
        }
      });
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
    const installSource = await resolveInstallSource(opts.ownerId, opts.listing);

    try {
      agent = await prisma.installedAgent.create({
        data: {
          businessId: business.id,
          workflowId,
          listingId: opts.listing.id,
          name: opts.listing.name,
          status: "PROVISIONING",
          installSource,
          executionFeeCents: opts.listing.executionFeeCents,
          trialExecutionLimit: 50,
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


async function getActivePhone(businessId: string, installedAgentId?: string) {
  if (installedAgentId) {
    const own = await prisma.businessPhoneNumber.findFirst({
      where: { businessId, installedAgentId, isActive: true },
      orderBy: { createdAt: "desc" }
    });
    if (own) return own;
  }

  return prisma.businessPhoneNumber.findFirst({
    where: { businessId, isActive: true, installedAgentId: null },
    orderBy: { createdAt: "desc" }
  });
}

async function persistVerifiedPhone(opts: {
  businessId: string;
  installedAgentId: string;
  phone: string;
}) {
  const normalized = normalizePhone(opts.phone);
  const existing = await getActivePhone(opts.businessId, opts.installedAgentId);

  if (existing) {
    const updatedMapping = await prisma.businessPhoneNumber.update({
      where: { id: existing.id },
      data: {
        forwardToPhone: normalized,
        installedAgentId: opts.installedAgentId,
        isActive: true
      }
    });
    const platform = await prisma.platformPhoneNumber.findFirst({
      where: { phoneNumber: existing.phoneNumber }
    });
    return {
      phoneNumber: updatedMapping.phoneNumber,
      platformPhoneNumberId: platform?.id ?? null,
      numberSelectionRequired: false
    };
  }

  // No inbound number yet: remember the forwarding phone on the installed
  // agent config so purchase can pick it up, and tell the wizard to run the
  // location → search → select → confirm flow.
  await prisma.installedAgent.update({
    where: { id: opts.installedAgentId },
    data: {
      configJson: {
        ...(await prisma.installedAgent
          .findUnique({ where: { id: opts.installedAgentId }, select: { configJson: true } })
          .then((row) =>
            row?.configJson && typeof row.configJson === "object" && !Array.isArray(row.configJson)
              ? (row.configJson as Record<string, unknown>)
              : {}
          )),
        verifiedForwardToPhone: normalized
      } as never
    }
  });

  return {
    phoneNumber: null,
    platformPhoneNumberId: null,
    numberSelectionRequired: true
  };
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
    setupTimeEstimate: listing.setupTimeEstimate,
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
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
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
    status: agent?.status ?? null,
    setupVisibility: deriveSetupVisibility(
      (listing as any).workflowJson || listing.workflow?.workflowJson,
      listing.requiredConnectors as string[] | undefined
    )
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
    if (isProduction) {
      await sendTwilioSms({
        to: phone,
        body: `Your Triven.ai verification code is ${code}. It expires in 10 minutes.`
      });
      return successResponse(c, { sent: true }, "Verification code sent");
    } else {
      console.log(`\n======================================\n[VERIFICATION CODE] Sent to ${phone}: ${code}\n======================================\n`);
      try {
        await sendTwilioSms({
          to: phone,
          body: `Your Triven.ai verification code is ${code}. It expires in 10 minutes.`
        });
        return successResponse(c, { sent: true, devCode: code }, "Verification code sent");
      } catch (smsError) {
        console.warn("Twilio send failed (dev) — returning devCode", smsError);
        return successResponse(c, { sent: false, devCode: code }, "Verification code generated (dev)");
      }
    }
  } catch (error) {
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
    if (isProduction) {
      return errorResponse(c, "That code doesn't match. Please try again.", 400, "OTP_INVALID");
    }
  }

  otpStore.delete(key);

  try {
    const { business, agent } = await ensureBusinessAndAgent({
      ownerId: authUser.id,
      listing
    });

    const result = await persistVerifiedPhone({
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
        platformNumber: result.phoneNumber,
        platformPhoneNumberId: result.platformPhoneNumberId,
        // true → the wizard must run location → search → select → confirm
        // (numbers are no longer auto-assigned here).
        numberSelectionRequired: result.numberSelectionRequired,
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
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
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

    if (agent.status === "SUSPENDED_BILLING") {
      return errorResponse(
        c,
        "Clear overdue billing before reactivating this agent.",
        402,
        "BILLING_PAYMENT_REQUIRED"
      );
    }

    await prisma.installedAgent.update({
      where: { id: agent.id },
      data: { status: "ACTIVE" }
    });

    await mergeAgentSetup(agent.id, { live: true });

    // Going live is what starts the ways IN: the agent's clocks begin ticking
    // and its private links begin accepting deliveries. Both are derived from
    // the saved graph, so an agent with neither node simply gets nothing.
    const [, webhookLinks] = await Promise.all([
      syncSchedulesForInstalledAgent(agent.id).catch((error) => {
        console.error("[setup] schedule sync failed", { installedAgentId: agent.id, error: String(error) });
      }),
      syncWebhookEndpointsForInstalledAgent(agent.id).catch((error) => {
        console.error("[setup] webhook sync failed", { installedAgentId: agent.id, error: String(error) });
        return [] as Array<{ nodeId: string; url: string }>;
      }),
      // Call lists are created empty and DRAFT. Going live must never start
      // dialling anyone — a person presses Start, or nothing happens.
      syncCallListsForInstalledAgent(agent.id).catch((error) => {
        console.error("[setup] call list sync failed", { installedAgentId: agent.id, error: String(error) });
      })
    ]);

    return successResponse(
      c,
      { live: true, installedAgentId: agent.id, webhookLinks: webhookLinks ?? [] },
      "Agent is live"
    );
  } catch (error) {
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not activate the agent",
      500,
      "GO_LIVE_FAILED"
    );
  }
});
