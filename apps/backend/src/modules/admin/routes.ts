import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth, requireRole } from "../../middleware/auth";
import { adminPhoneNumberRoutes } from "./phone-numbers";
import { adminPayoutRoutes } from "./payout-routes";
import { adminPricingRoutes } from "./pricing-routes";
import { sendBusinessEmail } from "../email/ses-mail-service";

export const adminRoutes = new Hono();

adminRoutes.use("*", requireAuth);
adminRoutes.use("*", requireRole(["ADMIN"]));

// Platform Twilio phone-number management (inherits the guards above).
adminRoutes.route("/phone-numbers", adminPhoneNumberRoutes);
adminRoutes.route("/payouts", adminPayoutRoutes);
adminRoutes.route("/pricing", adminPricingRoutes);

function parsePagination(c: { req: { query: (k: string) => string | undefined } }) {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limitRaw = Number(c.req.query("limit")) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  return { page, limit, skip: (page - 1) * limit };
}

const listingStatusSchema = z.object({
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().max(2000).optional()
});

const architectStatusSchema = z.object({
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"])
});

const suspensionSchema = z.object({
  isSuspended: z.boolean()
});

// 1. GET /admin/summary
adminRoutes.get("/summary", async (c) => {
  const [
    totalBusinesses,
    totalArchitects,
    totalAgentListings,
    pendingAgentListings,
    approvedAgentListings,
    rejectedAgentListings,
    suspendedAgentListings,
    activeInstalledAgents,
    totalAppointments,
    totalLeads
  ] = await Promise.all([
    prisma.business.count(),
    prisma.user.count({ where: { role: "ARCHITECT" } }),
    prisma.agentListing.count(),
    prisma.agentListing.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.agentListing.count({ where: { status: "APPROVED" } }),
    prisma.agentListing.count({ where: { status: "REJECTED" } }),
    prisma.agentListing.count({ where: { status: "SUSPENDED" } }),
    prisma.installedAgent.count({ where: { status: "ACTIVE" } }),
    prisma.appointment.count(),
    prisma.lead.count()
  ]);

  return successResponse(c, {
    totalBusinesses,
    totalArchitects,
    totalAgentListings,
    pendingAgentListings,
    approvedAgentListings,
    rejectedAgentListings,
    suspendedAgentListings,
    activeInstalledAgents,
    totalAppointments,
    totalLeads
  });
});

// 2. GET /admin/businesses
adminRoutes.get("/businesses", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { type: { contains: search, mode: "insensitive" as const } },
          { owner: { email: { contains: search, mode: "insensitive" as const } } }
        ]
      }
    : {};

  const [total, businesses] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        type: true,
        createdAt: true,
        subscriptionStatus: true,
        owner: { select: { id: true, email: true, fullName: true, role: true } },
        phoneNumbers: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { phoneNumber: true }
        },
        _count: { select: { installedAgents: true, phoneNumbers: true, appointments: true, leads: true } }
      }
    })
  ]);

  const items = businesses.map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    createdAt: b.createdAt,
    subscriptionStatus: b.subscriptionStatus ?? "inactive",
    owner: b.owner,
    activePhoneNumber: b.phoneNumbers[0]?.phoneNumber ?? null,
    installedAgentsCount: b._count.installedAgents,
    phoneNumbersCount: b._count.phoneNumbers,
    appointmentsCount: b._count.appointments,
    leadsCount: b._count.leads
  }));

  return successResponse(c, { items, total, page, limit });
});

// 3. GET /admin/architects
adminRoutes.get("/architects", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();
  const status = (c.req.query("status") ?? "").trim();

  const where: Record<string, unknown> = { role: "ARCHITECT" };
  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" as const } },
      { fullName: { contains: search, mode: "insensitive" as const } }
    ];
  }
  if (["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
    where.architectProfile = { approvalStatus: status };
  }

  const [total, architects] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        isSuspended: true,
        architectProfile: {
          select: { title: true, approvalStatus: true, rating: true, completedJobs: true }
        },
        _count: { select: { listings: true, workflows: true } }
      }
    })
  ]);

  const items = architects.map((a) => ({
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    createdAt: a.createdAt,
    isSuspended: a.isSuspended,
    architectProfile: a.architectProfile,
    listingCount: a._count.listings,
    workflowCount: a._count.workflows
  }));

  return successResponse(c, { items, total, page, limit });
});

// 4. GET /admin/agents
adminRoutes.get("/agents", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();
  const status = (c.req.query("status") ?? "").trim();

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" as const } },
      { shortDescription: { contains: search, mode: "insensitive" as const } }
    ];
  }
  if (["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
    where.status = status;
  }

  const [total, listings] = await Promise.all([
    prisma.agentListing.count({ where }),
    prisma.agentListing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        shortDescription: true,
        description: true,
        priceCents: true,
        status: true,
        tags: true,
        requiredConnectors: true,
        supportedLlms: true,
        createdAt: true,
        updatedAt: true,
        workflowId: true,
        workflow: { select: { name: true } },
        architect: { select: { id: true, email: true, fullName: true } },
        _count: { select: { installedAgents: true } }
      }
    })
  ]);

  const items = listings.map((l) => ({
    id: l.id,
    name: l.name,
    shortDescription: l.shortDescription,
    description: l.description,
    priceCents: l.priceCents,
    status: l.status,
    tags: l.tags,
    requiredConnectors: l.requiredConnectors,
    supportedLlms: l.supportedLlms,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    workflowId: l.workflowId,
    workflowName: l.workflow?.name ?? null,
    architect: l.architect,
    installedAgentsCount: l._count.installedAgents
  }));

  return successResponse(c, { items, total, page, limit });
});

// 5. PATCH /admin/agents/:listingId/status
adminRoutes.patch("/agents/:listingId/status", async (c) => {
  try {
    const listingId = c.req.param("listingId");
    const input = listingStatusSchema.parse(await c.req.json());

    const existing = await prisma.agentListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!existing) {
      return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
    }

    const listing = await prisma.agentListing.update({
      where: { id: listingId },
      data: { status: input.status },
      select: {
        id: true,
        name: true,
        status: true,
        priceCents: true,
        workflowId: true,
        updatedAt: true,
        architect: { select: { id: true, email: true, fullName: true } }
      }
    });

    return successResponse(c, { listing }, "Listing status updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update listing status", 500, "LISTING_STATUS_FAILED");
  }
});

// 6. PATCH /admin/architects/:userId/status
adminRoutes.patch("/architects/:userId/status", async (c) => {
  try {
    const userId = c.req.param("userId");
    const input = architectStatusSchema.parse(await c.req.json());

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        architectProfile: { select: { id: true } },
        roleMemberships: { select: { role: true } }
      }
    });

    const isArchitect =
      user?.role === "ARCHITECT" ||
      user?.roleMemberships.some((membership) => membership.role === "ARCHITECT");

    if (!user || !isArchitect) {
      return errorResponse(c, "Architect not found", 404, "ARCHITECT_NOT_FOUND");
    }
    if (!user.architectProfile) {
      return errorResponse(
        c,
        "This architect has no profile yet and cannot be approved.",
        409,
        "ARCHITECT_PROFILE_MISSING"
      );
    }

    const profile = await prisma.architectProfile.update({
      where: { userId },
      data: { approvalStatus: input.approvalStatus },
      select: { id: true, userId: true, title: true, approvalStatus: true, rating: true, completedJobs: true }
    });

    return successResponse(c, { architectProfile: profile }, "Architect status updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update architect status", 500, "ARCHITECT_STATUS_FAILED");
  }
});

// 7. PATCH /admin/users/:userId/suspension
adminRoutes.patch("/users/:userId/suspension", async (c) => {
  try {
    const authUser = c.get("authUser");
    const userId = c.req.param("userId");
    const input = suspensionSchema.parse(await c.req.json());

    if (userId === authUser.id) {
      return errorResponse(c, "You cannot change your own suspension state.", 409, "CANNOT_SUSPEND_SELF");
    }

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) {
      return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isSuspended: input.isSuspended },
      select: { id: true, email: true, fullName: true, role: true, isSuspended: true }
    });

    return successResponse(c, { user }, "User suspension updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update suspension", 500, "SUSPENSION_FAILED");
  }
});

const templateRequestListQuerySchema = z.object({
  search: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

// 8. GET /admin/template-requests — list architect template requests
adminRoutes.get("/template-requests", async (c) => {
  const parsed = templateRequestListQuerySchema.safeParse({
    search: c.req.query("search"),
    industry: c.req.query("industry"),
    page: c.req.query("page"),
    limit: c.req.query("limit")
  });

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION_ERROR");
  }

  const { page, limit, skip } = parsePagination(c);
  const search = (parsed.data.search ?? "").trim();
  const industry = (parsed.data.industry ?? "").trim();

  const where: Record<string, unknown> = {};
  if (industry) {
    where.industry = { equals: industry, mode: "insensitive" };
  }
  if (search) {
    where.OR = [
      { industry: { contains: search, mode: "insensitive" as const } },
      { description: { contains: search, mode: "insensitive" as const } },
      { architect: { email: { contains: search, mode: "insensitive" as const } } },
      { architect: { fullName: { contains: search, mode: "insensitive" as const } } }
    ];
  }

  const [total, requests] = await Promise.all([
    prisma.templateRequest.count({ where }),
    prisma.templateRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        industry: true,
        description: true,
        createdAt: true,
        architect: {
          select: {
            id: true,
            email: true,
            fullName: true
          }
        }
      }
    })
  ]);

  return successResponse(c, { items: requests, total, page, limit });
});

const contactSubmissionListQuerySchema = z.object({
  search: z.string().trim().optional(),
  subject: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

// 9. GET /admin/contact-submissions — list public contact form submissions
adminRoutes.get("/contact-submissions", async (c) => {
  const parsed = contactSubmissionListQuerySchema.safeParse({
    search: c.req.query("search"),
    subject: c.req.query("subject"),
    page: c.req.query("page"),
    limit: c.req.query("limit")
  });

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION_ERROR");
  }

  const { page, limit, skip } = parsePagination(c);
  const search = (parsed.data.search ?? "").trim();
  const subject = (parsed.data.subject ?? "").trim();

  const where: Record<string, unknown> = {};
  if (subject) {
    where.subject = { equals: subject, mode: "insensitive" };
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" as const } },
      { email: { contains: search, mode: "insensitive" as const } },
      { subject: { contains: search, mode: "insensitive" as const } },
      { message: { contains: search, mode: "insensitive" as const } }
    ];
  }

  const [total, submissions] = await Promise.all([
    prisma.contactSubmission.count({ where }),
    prisma.contactSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        createdAt: true
      }
    })
  ]);

  return successResponse(c, { items: submissions, total, page, limit });
});

/* ---- Proxy email alias administration (reply.triven.ai) ---- */

adminRoutes.get("/email-aliases", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();

  const where = search
    ? {
        OR: [
          { emailAddress: { contains: search, mode: "insensitive" as const } },
          { displayName: { contains: search, mode: "insensitive" as const } },
          { business: { name: { contains: search, mode: "insensitive" as const } } }
        ]
      }
    : {};

  const [aliases, total] = await Promise.all([
    prisma.businessEmailAlias.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { business: { select: { id: true, name: true } } }
    }),
    prisma.businessEmailAlias.count({ where })
  ]);

  const aliasIds = aliases.map((alias) => alias.id);
  const [statusRows, lastMessages] = await Promise.all([
    aliasIds.length
      ? prisma.emailMessage.groupBy({
          by: ["aliasId", "status"],
          where: { aliasId: { in: aliasIds } },
          _count: { _all: true }
        })
      : Promise.resolve([]),
    aliasIds.length
      ? prisma.emailMessage.findMany({
          where: { aliasId: { in: aliasIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["aliasId"],
          select: {
            id: true,
            aliasId: true,
            subject: true,
            status: true,
            purpose: true,
            toEmail: true,
            createdAt: true
          }
        })
      : Promise.resolve([])
  ]);

  const countsByAlias = new Map<string, Record<string, number>>();
  for (const row of statusRows) {
    if (!row.aliasId) continue;
    const bucket = countsByAlias.get(row.aliasId) ?? {};
    bucket[row.status] = row._count._all;
    countsByAlias.set(row.aliasId, bucket);
  }
  const lastByAlias = new Map(lastMessages.map((message) => [message.aliasId, message]));

  const items = aliases.map((alias) => ({
    ...alias,
    counts: countsByAlias.get(alias.id) ?? {},
    lastMessage: lastByAlias.get(alias.id) ?? null
  }));

  return successResponse(c, { items, total, page, limit });
});

function registerAliasStatusRoute(path: string, status: "DISABLED" | "ARCHIVED") {
  adminRoutes.post(path, async (c) => {
    const id = c.req.param("id");
    const alias = await prisma.businessEmailAlias.findUnique({ where: { id } });
    if (!alias) return errorResponse(c, "Alias not found", 404, "ALIAS_NOT_FOUND");

    const updated = await prisma.businessEmailAlias.update({ where: { id }, data: { status } });
    console.log(`[email] admin set alias ${updated.emailAddress} -> ${status}`);
    return successResponse(c, { alias: updated }, `Alias ${status.toLowerCase()}`);
  });
}

registerAliasStatusRoute("/email-aliases/:id/disable", "DISABLED");
registerAliasStatusRoute("/email-aliases/:id/archive", "ARCHIVED");

adminRoutes.post("/email-aliases/:id/resend-test", async (c) => {
  const id = c.req.param("id");
  const alias = await prisma.businessEmailAlias.findUnique({ where: { id } });
  if (!alias) return errorResponse(c, "Alias not found", 404, "ALIAS_NOT_FOUND");
  if (!alias.forwardToEmail) return errorResponse(c, "Alias has no forward-to email", 422, "NO_FORWARD_EMAIL");

  const result = await sendBusinessEmail({
    businessId: alias.businessId,
    to: alias.forwardToEmail,
    subject: `Test email from ${alias.displayName} via Triven`,
    textBody: `Admin-triggered test for ${alias.emailAddress}.`,
    purpose: "TEST"
  });

  if (!result.ok) return errorResponse(c, result.error, 422, "TEST_EMAIL_FAILED");
  return successResponse(c, { messageId: result.messageId, dryRun: result.dryRun }, "Test email sent");
});

/** Delivery/bounce/complaint counts for one alias — admin diagnostics. */
adminRoutes.get("/email-aliases/:id/activity", async (c) => {
  const id = c.req.param("id");
  const alias = await prisma.businessEmailAlias.findUnique({ where: { id } });
  if (!alias) return errorResponse(c, "Alias not found", 404, "ALIAS_NOT_FOUND");

  const [byStatus, lastMessage] = await Promise.all([
    prisma.emailMessage.groupBy({
      by: ["status"],
      where: { aliasId: id },
      _count: { _all: true }
    }),
    prisma.emailMessage.findFirst({
      where: { aliasId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, status: true, purpose: true, toEmail: true, createdAt: true }
    })
  ]);

  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  return successResponse(c, { alias: { id: alias.id, emailAddress: alias.emailAddress }, counts, lastMessage });
});

/* ---- Suppression list (permanent bounces / complaints) ---- */

adminRoutes.get("/email-suppressions", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const [items, total] = await Promise.all([
    prisma.emailSuppression.findMany({ orderBy: { updatedAt: "desc" }, skip, take: limit }),
    prisma.emailSuppression.count()
  ]);
  return successResponse(c, { items, total, page, limit });
});

/**
 * Reactivation only deactivates the local block. Complaints stay suppressed —
 * emailing someone who marked mail as spam again risks the whole domain.
 */
adminRoutes.post("/email-suppressions/:id/reactivate", async (c) => {
  const id = c.req.param("id");
  const entry = await prisma.emailSuppression.findUnique({ where: { id } });
  if (!entry) return errorResponse(c, "Suppression not found", 404, "SUPPRESSION_NOT_FOUND");
  if (/complain/i.test(entry.reason)) {
    return errorResponse(c, "Complaint suppressions cannot be reactivated.", 422, "COMPLAINT_LOCKED");
  }

  const updated = await prisma.emailSuppression.update({ where: { id }, data: { active: false } });
  console.log(`[email] admin reactivated recipient ${updated.emailAddress}`);
  return successResponse(c, { suppression: updated }, "Recipient reactivated");
});
