import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { logAdminAction } from "./audit";
import { assignPlatformNumber, unassignPlatformNumber } from "../business/phone-assignment";
import { addPhoneNumberFeeToPendingInvoiceTx } from "../business/phone-number-invoice";
import { getPhoneNumberFeeForPlatformNumber } from "../business/phone-provisioning";
import {
  PhoneNumberServiceError,
  configureWebhooks,
  normalizeA2pStatus,
  normalizeE164,
  purchaseNumber,
  releaseNumber,
  safeTwilioError,
  searchAvailableNumbers,
  syncTwilioNumbers
} from "./twilio-number-service";


export const adminPhoneNumberRoutes = new Hono();

const TARGET_TYPE = "PHONE_NUMBER";

/** Map service errors to safe API responses; never leak raw Twilio payloads. */
function handleServiceError(c: Parameters<typeof errorResponse>[0], error: unknown, fallback: string) {
  if (error instanceof PhoneNumberServiceError) {
    const status = (error.status >= 400 && error.status <= 599 ? error.status : 500) as 400;
    return errorResponse(c, error.message, status, error.code);
  }
  console.error("[admin-phone-numbers] unexpected error", error);
  return errorResponse(c, safeTwilioError(error, fallback), 500, "PHONE_ADMIN_ERROR");
}

function adminId(c: { get: (key: "authUser") => { id: string } }): string {
  return c.get("authUser").id;
}

/* --------------------------------- schemas -------------------------------- */

const availableQuerySchema = z.object({
  country: z.string().trim().length(2).optional(),
  areaCode: z.string().trim().max(8).optional(),
  contains: z.string().trim().max(16).optional(),
  voiceEnabled: z.coerce.boolean().optional(),
  smsEnabled: z.coerce.boolean().optional(),
  mmsEnabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(30).optional()
});

const purchaseSchema = z.object({
  phoneNumber: z.string().trim().min(7).max(20),
  country: z.string().trim().length(2).optional(),
  friendlyName: z.string().trim().max(64).optional(),
  metadata: z.record(z.string(), z.string().max(500)).optional()
});

const assignSchema = z.object({
  businessId: z.string().trim().min(1),
  installedAgentId: z.string().trim().min(1).optional(),
  buyerUserId: z.string().trim().min(1).optional()
});

/* ---------------------------------- list ---------------------------------- */

// GET /admin/phone-numbers — full inventory with assignment context.
adminPhoneNumberRoutes.get("/", async (c) => {
  const numbers = await prisma.platformPhoneNumber.findMany({ orderBy: { createdAt: "desc" } });

  const businessIds = [...new Set(numbers.map((n) => n.businessId).filter((v): v is string => Boolean(v)))];
  const agentIds = [...new Set(numbers.map((n) => n.installedAgentId).filter((v): v is string => Boolean(v)))];
  const buyerIds = [...new Set(numbers.map((n) => n.buyerUserId).filter((v): v is string => Boolean(v)))];

  const [businesses, agents, buyers] = await Promise.all([
    businessIds.length
      ? prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, type: true } })
      : Promise.resolve([]),
    agentIds.length
      ? prisma.installedAgent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, status: true } })
      : Promise.resolve([]),
    buyerIds.length
      ? prisma.user.findMany({ where: { id: { in: buyerIds } }, select: { id: true, email: true, fullName: true } })
      : Promise.resolve([])
  ]);

  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const buyerById = new Map(buyers.map((u) => [u.id, u]));

  return successResponse(c, {
    numbers: numbers.map((n) => ({
      id: n.id,
      phoneNumber: n.phoneNumber,
      e164: n.e164,
      provider: n.provider,
      status: n.status,
      twilioSid: n.twilioSid,
      country: n.country,
      region: n.region,
      locality: n.locality,
      capabilities: n.capabilities,
      voiceEnabled: n.voiceEnabled,
      smsEnabled: n.smsEnabled,
      mmsEnabled: n.mmsEnabled,
      business: n.businessId ? (businessById.get(n.businessId) ?? { id: n.businessId, name: null, type: null }) : null,
      installedAgent: n.installedAgentId
        ? (agentById.get(n.installedAgentId) ?? { id: n.installedAgentId, name: null, status: null })
        : null,
      buyerUser: n.buyerUserId ? (buyerById.get(n.buyerUserId) ?? { id: n.buyerUserId, email: null, fullName: null }) : null,
      assignedAt: n.assignedAt,
      purchasedAt: n.purchasedAt,
      releasedAt: n.releasedAt,
      voiceWebhookUrl: n.voiceWebhookUrl,
      smsWebhookUrl: n.smsWebhookUrl,
      webhookStatus: n.webhookStatus,
      complianceStatus: n.complianceStatus ?? "UNKNOWN",
      a2pStatus: normalizeA2pStatus(n.a2pStatus),
      isPlatformSmsSender: n.isPlatformSmsSender,
      lastSyncedAt: n.lastSyncedAt,
      lastError: n.lastError,
      createdAt: n.createdAt
    }))
  });
});

/* --------------------------------- search --------------------------------- */

// GET /admin/phone-numbers/available — search purchasable numbers on Twilio.
adminPhoneNumberRoutes.get("/available", async (c) => {
  const parsed = availableQuerySchema.safeParse({
    country: c.req.query("country"),
    areaCode: c.req.query("areaCode"),
    contains: c.req.query("contains"),
    voiceEnabled: c.req.query("voiceEnabled"),
    smsEnabled: c.req.query("smsEnabled"),
    mmsEnabled: c.req.query("mmsEnabled"),
    limit: c.req.query("limit")
  });
  if (!parsed.success) {
    return errorResponse(c, "Invalid search filters.", 422, "VALIDATION_ERROR");
  }

  try {
    const results = await searchAvailableNumbers(parsed.data);
    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_SEARCH",
      targetType: TARGET_TYPE,
      meta: { country: parsed.data.country ?? "US", areaCode: parsed.data.areaCode, results: results.length }
    });
    return successResponse(c, { numbers: results });
  } catch (error) {
    return handleServiceError(c, error, "Could not search available numbers.");
  }
});

/* ------------------------------ assign options ---------------------------- */

// GET /admin/phone-numbers/assign-options?businessId=… — installed agents for the assign modal.
adminPhoneNumberRoutes.get("/assign-options", async (c) => {
  const businessId = (c.req.query("businessId") ?? "").trim();
  if (!businessId) return errorResponse(c, "businessId is required.", 422, "VALIDATION_ERROR");

  const agents = await prisma.installedAgent.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true }
  });

  return successResponse(c, { agents });
});

/* -------------------------------- purchase -------------------------------- */

// POST /admin/phone-numbers/purchase — buy on Twilio + auto-configure webhooks + save.
adminPhoneNumberRoutes.post("/purchase", async (c) => {
  let input: z.infer<typeof purchaseSchema>;
  try {
    input = purchaseSchema.parse(await c.req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid purchase request.", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Invalid purchase request.", 422, "VALIDATION_ERROR");
  }

  try {
    const record = await purchaseNumber({
      phoneNumber: input.phoneNumber,
      country: input.country,
      friendlyName: input.friendlyName,
      adminUserId: adminId(c)
    });
    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_PURCHASE",
      targetType: TARGET_TYPE,
      targetId: record.id,
      meta: {
        phoneNumber: record.phoneNumber,
        country: record.country,
        webhookStatus: record.webhookStatus,
        ...(input.metadata ? { metadata: input.metadata } : {})
      }
    });
    return successResponse(c, { number: record }, "Number purchased and configured.", 201);
  } catch (error) {
    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_PURCHASE_FAILED",
      targetType: TARGET_TYPE,
      meta: {
        phoneNumber: normalizeE164(input.phoneNumber),
        error: error instanceof PhoneNumberServiceError ? error.message.slice(0, 300) : "unexpected error"
      }
    });
    return handleServiceError(c, error, "Twilio could not complete the purchase.");
  }
});

/* ---------------------------------- sync ---------------------------------- */

// POST /admin/phone-numbers/sync-twilio(?dryRun=true) — reconcile inventory with Twilio.
adminPhoneNumberRoutes.post("/sync-twilio", async (c) => {
  const dryRun = ["true", "1"].includes((c.req.query("dryRun") ?? "").toLowerCase());

  try {
    const result = await syncTwilioNumbers({ dryRun });
    await logAdminAction({
      adminUserId: adminId(c),
      action: dryRun ? "PHONE_NUMBER_SYNC_DRY_RUN" : "PHONE_NUMBER_SYNC",
      targetType: TARGET_TYPE,
      meta: {
        totalOnTwilio: result.totalOnTwilio,
        created: result.created.length,
        updated: result.updated.length,
        missingInTwilio: result.missingInTwilio.length
      }
    });
    return successResponse(c, result, dryRun ? "Dry run complete — nothing written." : "Sync complete.");
  } catch (error) {
    return handleServiceError(c, error, "Could not sync numbers from Twilio.");
  }
});

/* --------------------------------- assign --------------------------------- */

// POST /admin/phone-numbers/:id/assign — attach a number to a business (+agent/buyer).
adminPhoneNumberRoutes.post("/:id/assign", async (c) => {
  const id = c.req.param("id");

  let input: z.infer<typeof assignSchema>;
  try {
    input = assignSchema.parse(await c.req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid assignment request.", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Invalid assignment request.", 422, "VALIDATION_ERROR");
  }

  const record = await prisma.platformPhoneNumber.findUnique({ where: { id } });
  if (!record) return errorResponse(c, "Phone number not found.", 404, "NUMBER_NOT_FOUND");

  if (record.isPlatformSmsSender) {
    return errorResponse(
      c,
      "This number is the reserved shared Triven SMS sender. It can never be assigned to a business, installed agent, or buyer.",
      409,
      "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE"
    );
  }

  if (record.status !== "AVAILABLE") {
    const reason =
      record.status === "ASSIGNED"
        ? "This number is already assigned. Unassign it first."
        : `This number cannot be assigned while its status is ${record.status}.`;
    return errorResponse(c, reason, 409, "NUMBER_NOT_ASSIGNABLE");
  }

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, name: true, ownerId: true }
  });
  if (!business) return errorResponse(c, "Business not found.", 404, "BUSINESS_NOT_FOUND");

  let installedAgentId: string | null = null;
  if (input.installedAgentId) {
    const agent = await prisma.installedAgent.findUnique({
      where: { id: input.installedAgentId },
      select: { id: true, businessId: true }
    });
    if (!agent) return errorResponse(c, "Installed agent not found.", 404, "INSTALLED_AGENT_NOT_FOUND");
    if (agent.businessId !== business.id) {
      return errorResponse(c, "That installed agent belongs to a different business.", 422, "AGENT_BUSINESS_MISMATCH");
    }
    installedAgentId = agent.id;

    // Product convention: one active number per installed agent.
    const existingAgentNumber = await prisma.businessPhoneNumber.findFirst({
      where: { installedAgentId: agent.id, isActive: true, NOT: { phoneNumber: record.phoneNumber } },
      select: { phoneNumber: true }
    });
    if (existingAgentNumber) {
      return errorResponse(
        c,
        `That installed agent already has an active number (${existingAgentNumber.phoneNumber}). Unassign it first.`,
        409,
        "AGENT_ALREADY_HAS_NUMBER"
      );
    }
  }

  if (input.buyerUserId) {
    const buyer = await prisma.user.findUnique({ where: { id: input.buyerUserId }, select: { id: true } });
    if (!buyer) return errorResponse(c, "Buyer user not found.", 404, "BUYER_NOT_FOUND");
  }

  // A number routes to exactly one business: block stale mappings owned elsewhere.
  const conflicting = await prisma.businessPhoneNumber.findUnique({
    where: { phoneNumber: record.phoneNumber },
    select: { businessId: true, isActive: true }
  });
  if (conflicting && conflicting.isActive && conflicting.businessId !== business.id) {
    return errorResponse(c, "That phone number is already routing to another business.", 409, "PHONE_NUMBER_TAKEN");
  }

  try {
    const phoneNumberFee = installedAgentId
      ? await getPhoneNumberFeeForPlatformNumber(record.id, {
          refreshFromTwilio: true
        })
      : null;
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.platformPhoneNumber.findUnique({ where: { id: record.id } });
      if (!fresh || fresh.status !== "AVAILABLE") throw new PhoneNumberServiceError("This number was just assigned by someone else.", 409, "NUMBER_NOT_ASSIGNABLE");
      const assignment = await assignPlatformNumber(tx, {
        platform: fresh,
        businessId: business.id,
        installedAgentId,
        buyerUserId: input.buyerUserId ?? null
      });
      if (installedAgentId && phoneNumberFee) {
        await addPhoneNumberFeeToPendingInvoiceTx(
          tx,
          {
            platformPhoneNumberId: record.id,
            businessId: business.id,
            installedAgentId,
            chargedAt: new Date()
          },
          phoneNumberFee
        );
      }
      return assignment;
    });

    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_ASSIGN",
      targetType: TARGET_TYPE,
      targetId: record.id,
      meta: {
        phoneNumber: record.phoneNumber,
        businessId: business.id,
        installedAgentId,
        buyerUserId: input.buyerUserId ?? null
      }
    });

    return successResponse(c, { number: result.platform }, "Number assigned.");
  } catch (error) {
    return handleServiceError(c, error, "Could not assign this number.");
  }
});

/* -------------------------------- unassign -------------------------------- */

// POST /admin/phone-numbers/:id/unassign — detach safely, keep history.
adminPhoneNumberRoutes.post("/:id/unassign", async (c) => {
  const id = c.req.param("id");

  const record = await prisma.platformPhoneNumber.findUnique({ where: { id } });
  if (!record) return errorResponse(c, "Phone number not found.", 404, "NUMBER_NOT_FOUND");

  if (record.status !== "ASSIGNED" && !record.businessId && !record.installedAgentId) {
    return errorResponse(c, "This number is not assigned.", 409, "NUMBER_NOT_ASSIGNED");
  }

  try {
    const previous = {
      businessId: record.businessId,
      installedAgentId: record.installedAgentId,
      buyerUserId: record.buyerUserId
    };

    const result = await prisma.$transaction(async (tx) => unassignPlatformNumber(tx, { platform: record }));

    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_UNASSIGN",
      targetType: TARGET_TYPE,
      targetId: record.id,
      meta: { phoneNumber: record.phoneNumber, ...previous }
    });

    return successResponse(c, { number: result.platform }, "Number unassigned.");
  } catch (error) {
    return handleServiceError(c, error, "Could not unassign this number.");
  }
});

/* --------------------------- configure webhooks ---------------------------- */

// POST /admin/phone-numbers/:id/configure-webhooks — repoint Twilio at our shared URLs.
adminPhoneNumberRoutes.post("/:id/configure-webhooks", async (c) => {
  const id = c.req.param("id");

  try {
    const record = await configureWebhooks(id);
    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_CONFIGURE_WEBHOOKS",
      targetType: TARGET_TYPE,
      targetId: record.id,
      meta: { phoneNumber: record.phoneNumber, webhookStatus: record.webhookStatus }
    });
    return successResponse(c, { number: record }, "Webhooks configured.");
  } catch (error) {
    return handleServiceError(c, error, "Could not configure webhooks.");
  }
});

/* --------------------------------- release -------------------------------- */

// DELETE /admin/phone-numbers/:id/release — release from Twilio (unassigned only).
adminPhoneNumberRoutes.delete("/:id/release", async (c) => {
  const id = c.req.param("id");

  try {
    const record = await releaseNumber({ id });
    await logAdminAction({
      adminUserId: adminId(c),
      action: "PHONE_NUMBER_RELEASE",
      targetType: TARGET_TYPE,
      targetId: record.id,
      meta: { phoneNumber: record.phoneNumber, releasedAt: record.releasedAt?.toISOString() ?? null }
    });
    return successResponse(c, { number: record }, "Number released.");
  } catch (error) {
    return handleServiceError(c, error, "Could not release this number.");
  }
});
