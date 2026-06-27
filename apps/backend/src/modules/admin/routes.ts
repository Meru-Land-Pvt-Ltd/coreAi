import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth, requireRole } from "../../middleware/auth";

export const adminRoutes = new Hono();

// Admin is fully privileged — enforce auth + ADMIN role on every route.
// Never rely on the frontend guard alone.
adminRoutes.use("*", requireAuth);
adminRoutes.use("*", requireRole(["ADMIN"]));

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
      select: { id: true, role: true, architectProfile: { select: { id: true } } }
    });

    if (!user || user.role !== "ARCHITECT") {
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
