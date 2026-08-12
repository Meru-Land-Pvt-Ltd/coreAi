import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth, requireRole } from "../../middleware/auth";
import { adminPhoneNumberRoutes } from "./phone-numbers";
import { adminPayoutRoutes } from "./payout-routes";
import { adminPricingRoutes } from "./pricing-routes";
import { sendBusinessEmail } from "../email/ses-mail-service";
import { listRegisteredBusinessAccounts } from "./registered-business-accounts";
import { getAdminLiveSummaryData } from "./admin-summary";
import { pseudonymizeDisclosureConsentsForUser } from "../compliance/disclosure-consent";
import { deleteUserWorkspace } from "../auth/workspace-deletion";
import { logAdminAction } from "./audit";
import {
  isManagedPlatformApiKey,
  listPlatformApiSettings,
  savePlatformApiSettings
} from "./platform-api-settings";

export const adminRoutes = new Hono();

adminRoutes.use("*", requireAuth);
adminRoutes.use("*", requireRole(["ADMIN"]));

// Platform Twilio phone-number management (inherits the guards above).
adminRoutes.route("/phone-numbers", adminPhoneNumberRoutes);
adminRoutes.route("/payouts", adminPayoutRoutes);
adminRoutes.route("/pricing", adminPricingRoutes);

/* -------------------- Manage API (platform credentials) ------------------- */

adminRoutes.get("/api-settings", async (c) => {
  // Secrets come back masked — the plaintext never leaves the server.
  return successResponse(c, { groups: await listPlatformApiSettings() });
});

const apiSettingsUpdateSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(120),
        // Empty clears the override and restores the .env fallback.
        value: z.string().max(4000)
      })
    )
    .min(1)
    .max(60)
});

adminRoutes.put("/api-settings", async (c) => {
  const authUser = c.get("authUser");
  const parsed = apiSettingsUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid settings payload", 422, "VALIDATION_ERROR");
  }

  const unknown = parsed.data.settings.filter((setting) => !isManagedPlatformApiKey(setting.key));
  if (unknown.length > 0) {
    return errorResponse(
      c,
      `Not managed from this page: ${unknown.map((setting) => setting.key).join(", ")}`,
      422,
      "UNSUPPORTED_SETTING_KEY"
    );
  }

  const result = await savePlatformApiSettings(parsed.data.settings, authUser.id);

  // Values are never logged — only which keys changed.
  await logAdminAction({
    adminUserId: authUser.id,
    action: "PLATFORM_API_SETTINGS_UPDATED",
    targetType: "PlatformApiSetting",
    meta: { keys: parsed.data.settings.map((setting) => setting.key), ...result }
  }).catch(() => undefined);

  return successResponse(c, { groups: await listPlatformApiSettings(), ...result }, "API settings saved");
});

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

const deleteArchitectSchema = z.object({
  confirmation: z.literal("DELETE")
});

// 1. GET /admin/summary
adminRoutes.get("/summary", async (c) => {
  const [
    totalBusinesses,
    totalAgentListings,
    pendingAgentListings,
    approvedAgentListings,
    rejectedAgentListings,
    suspendedAgentListings,
    activeInstalledAgents,
    totalAppointments,
    totalLeads,
    liveSummary
  ] = await Promise.all([
    listRegisteredBusinessAccounts().then((accounts) => accounts.length),
    prisma.agentListing.count(),
    prisma.agentListing.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.agentListing.count({ where: { status: "APPROVED" } }),
    prisma.agentListing.count({ where: { status: "REJECTED" } }),
    prisma.agentListing.count({ where: { status: "SUSPENDED" } }),
    prisma.installedAgent.count({ where: { status: "ACTIVE" } }),
    prisma.appointment.count(),
    prisma.lead.count(),
    getAdminLiveSummaryData()
  ]);

  return successResponse(c, {
    totalBusinesses,
    totalAgentListings,
    pendingAgentListings,
    approvedAgentListings,
    rejectedAgentListings,
    suspendedAgentListings,
    activeInstalledAgents,
    totalAppointments,
    totalLeads,
    ...liveSummary
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

// Registered buyer identities — unlike /businesses, this endpoint is based on
// signup accounts, not setup-created Business rows. One normalized email is
// returned once even when legacy role rows share that email.
adminRoutes.get("/business-accounts", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();
  const includeAll = c.req.query("all") === "true";
  const accounts = await listRegisteredBusinessAccounts(search, { includePurchasedAgents: true });

  return successResponse(c, {
    items: includeAll ? accounts : accounts.slice(skip, skip + limit),
    total: accounts.length,
    page,
    limit: includeAll ? accounts.length : limit
  });
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
        category: true,
        priceCents: true,
        status: true,
        featuredAt: true,
        tags: true,
        requiredConnectors: true,
        supportedLlms: true,
        createdAt: true,
        submittedAt: true,
        updatedAt: true,
        workflowId: true,
        workflow: { select: { name: true } },
        architect: { select: { id: true, email: true, fullName: true } },
        _count: { select: { installedAgents: true } }
      }
    })
  ]);

  const architectIds = [...new Set(listings.map((listing) => listing.architect.id))];
  const architectListings = architectIds.length
    ? await prisma.agentListing.findMany({
        where: { architectUserId: { in: architectIds } },
        select: {
          architectUserId: true,
          _count: { select: { installedAgents: true } }
        }
      })
    : [];
  const architectTotalInstalls = new Map<string, number>();
  for (const listing of architectListings) {
    architectTotalInstalls.set(
      listing.architectUserId,
      (architectTotalInstalls.get(listing.architectUserId) ?? 0) + listing._count.installedAgents
    );
  }

  const items = listings.map((l) => ({
    id: l.id,
    name: l.name,
    shortDescription: l.shortDescription,
    description: l.description,
    category: l.category,
    priceCents: l.priceCents,
    status: l.status,
    featuredAt: l.featuredAt,
    tags: l.tags,
    requiredConnectors: l.requiredConnectors,
    supportedLlms: l.supportedLlms,
    createdAt: l.createdAt,
    submittedAt: l.submittedAt,
    updatedAt: l.updatedAt,
    workflowId: l.workflowId,
    workflowName: l.workflow?.name ?? null,
    architect: l.architect,
    installedAgentsCount: l._count.installedAgents,
    architectTotalInstalls: architectTotalInstalls.get(l.architect.id) ?? 0,
    architectTier: null,
    priority: null
  }));

  return successResponse(c, { items, total, page, limit });
});

// 5. PATCH /admin/agents/:listingId/status
adminRoutes.patch("/agents/:listingId/status", async (c) => {
  try {
    const listingId = c.req.param("listingId");
    const input = listingStatusSchema.parse(await c.req.json());

    const existing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        workflowId: true,
        submittedAt: true,
        approvedAt: true,
        publishedAt: true,
        reviewStatus: true,
        rejectionReason: true
      }
    });
    if (!existing) {
      return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
    }

    const now = new Date();
    let listingData: Prisma.AgentListingUpdateInput;
    let workflowData: Prisma.WorkflowDefinitionUpdateInput;

    if (input.status === "APPROVED") {
      listingData = {
        status: "APPROVED",
        reviewStatus: "APPROVED",
        publishStatus: "PUBLISHED",
        rejectionReason: null,
        approvedAt: existing.approvedAt ?? now,
        publishedAt: existing.publishedAt ?? now
      };
      workflowData = { reviewStatus: "APPROVED", publishStatus: "PUBLISHED" };
    } else if (input.status === "REJECTED") {
      listingData = {
        status: "REJECTED",
        reviewStatus: "REJECTED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: input.reason?.trim() || null
      };
      workflowData = { reviewStatus: "REJECTED", publishStatus: "UNPUBLISHED" };
    } else if (input.status === "PENDING_REVIEW") {
      // The admin moderation UI uses PENDING_REVIEW for its "Request Changes"
      // decision. Legacy PENDING_REVIEW locks architect editing, so move the
      // legacy status to REJECTED while the canonical review status records
      // the distinct changes-requested decision and its notes.
      listingData = {
        status: "REJECTED",
        reviewStatus: "CHANGES_REQUESTED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: input.reason?.trim() || null,
        submittedAt: existing.submittedAt ?? now
      };
      workflowData = { reviewStatus: "CHANGES_REQUESTED", publishStatus: "UNPUBLISHED" };
    } else {
      listingData = {
        status: "SUSPENDED",
        reviewStatus: existing.reviewStatus,
        publishStatus: "UNPUBLISHED",
        rejectionReason: input.reason?.trim() || existing.rejectionReason
      };
      workflowData = { reviewStatus: existing.reviewStatus, publishStatus: "UNPUBLISHED" };
    }

    const listing = await prisma.$transaction(async (tx) => {
      const updated = await tx.agentListing.update({
        where: { id: listingId },
        data: listingData,
        select: {
          id: true,
          name: true,
          status: true,
          reviewStatus: true,
          publishStatus: true,
          priceCents: true,
          workflowId: true,
          rejectionReason: true,
          submittedAt: true,
          approvedAt: true,
          publishedAt: true,
          updatedAt: true,
          architect: { select: { id: true, email: true, fullName: true } }
        }
      });

      if (existing.workflowId) {
        await tx.workflowDefinition.update({
          where: { id: existing.workflowId },
          data: workflowData
        });
      }

      return updated;
    });

    return successResponse(c, { listing }, "Listing status updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update listing status", 500, "LISTING_STATUS_FAILED");
  }
});

adminRoutes.patch("/agents/:listingId/featured", async (c) => {
  try {
    const listingId = c.req.param("listingId");
    const { featured } = z.object({ featured: z.boolean() }).parse(await c.req.json());

    const existing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, name: true }
    });
    if (!existing) {
      return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
    }

    if (featured && existing.status !== "APPROVED") {
      return errorResponse(
        c,
        `Only an APPROVED listing can be featured. "${existing.name}" is ${existing.status}.`,
        409,
        "LISTING_NOT_APPROVED"
      );
    }

    const { listing, replaced } = await prisma.$transaction(async (tx) => {
      const previouslyFeatured = featured
        ? await tx.agentListing.findMany({
            where: { featuredAt: { not: null }, NOT: { id: listingId } },
            select: { id: true, name: true }
          })
        : [];

      if (previouslyFeatured.length > 0) {
        await tx.agentListing.updateMany({
          where: { id: { in: previouslyFeatured.map((row) => row.id) } },
          data: { featuredAt: null }
        });
      }

      const updated = await tx.agentListing.update({
        where: { id: listingId },
        data: { featuredAt: featured ? new Date() : null },
        select: { id: true, name: true, status: true, featuredAt: true }
      });

      return { listing: updated, replaced: previouslyFeatured };
    });

    await logAdminAction({
      adminUserId: c.get("authUser").id,
      action: featured ? "LISTING_FEATURED" : "LISTING_UNFEATURED",
      targetType: "AGENT_LISTING",
      targetId: listing.id,
      meta: { name: listing.name, replaced: replaced.map((row) => row.name) }
    });

    return successResponse(
      c,
      // The caller needs to know which listing lost the slot so the admin table
      // can clear its star without a refetch.
      { listing, replacedListingIds: replaced.map((row) => row.id) },
      featured
        ? replaced.length > 0
          ? `Listing featured — replaced "${replaced[0]!.name}"`
          : "Listing featured"
        : "Listing no longer featured"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, "featured must be true or false", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update the featured flag", 500, "LISTING_FEATURED_FAILED");
  }
});

adminRoutes.delete("/agents/:listingId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const listingId = c.req.param("listingId");

    const listing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        name: true,
        workflowId: true,
        architectUserId: true
      }
    });

    if (!listing) {
      return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const otherListing = listing.workflowId
        ? await tx.agentListing.findFirst({
            where: { workflowId: listing.workflowId, id: { not: listing.id } },
            select: { id: true }
          })
        : null;
      const deleteWorkflow = Boolean(listing.workflowId && !otherListing);

      const installations = await tx.installedAgent.findMany({
        where: deleteWorkflow && listing.workflowId
          ? { OR: [{ listingId: listing.id }, { workflowId: listing.workflowId }] }
          : { listingId: listing.id },
        select: { id: true, businessId: true, configJson: true }
      });
      const installedAgentIds = installations.map((agent) => agent.id);
      const businessIds = [...new Set(installations.map((agent) => agent.businessId))];
      const assistantIds = [...new Set(installations.flatMap((agent) => {
        const config = agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
          ? agent.configJson as Record<string, unknown>
          : {};
        return [config.vapiAssistantId, config.previewAssistantId]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim());
      }))];

      let phoneNumbersReleased = 0;
      if (installedAgentIds.length > 0) {
        const platformPhones = await tx.platformPhoneNumber.updateMany({
          where: {
            installedAgentId: { in: installedAgentIds },
            isPlatformSmsSender: false
          },
          data: {
            status: "AVAILABLE",
            businessId: null,
            buyerUserId: null,
            installedAgentId: null,
            assignedAt: null,
            feeBilledAt: null
          }
        });
        phoneNumbersReleased = platformPhones.count;

        await tx.businessPhoneNumber.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null, isActive: false }
        });
        await tx.payment.updateMany({
          where: { OR: [{ listingId: listing.id }, { installedAgentId: { in: installedAgentIds } }] },
          data: { listingId: null, installedAgentId: null }
        });
        await tx.businessUsageInvoice.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.appointment.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.businessKnowledgeFile.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.businessKnowledgeBase.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.vapiCall.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.testCalendarEvent.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.emailMessage.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.businessEmailAlias.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null, status: "ARCHIVED" }
        });
        await tx.smsExecution.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.smsConsent.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.phoneProvisioningRequest.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });

        // Older deployed databases retain a restrictive FK for execution
        // usage even though newer schemas cascade it. Remove those children
        // explicitly so an admin deletion works consistently everywhere.
        await tx.agentUsageExecution.deleteMany({
          where: { installedAgentId: { in: installedAgentIds } }
        });

        if (assistantIds.length > 0) {
          await tx.businessProfile.updateMany({
            where: {
              businessId: { in: businessIds },
              vapiAssistantId: { in: assistantIds }
            },
            data: { vapiAssistantId: null }
          });
        }

        await tx.installedAgent.deleteMany({ where: { id: { in: installedAgentIds } } });

        if (businessIds.length > 0) {
          const businessesWithAgents = await tx.installedAgent.findMany({
            where: { businessId: { in: businessIds } },
            select: { businessId: true },
            distinct: ["businessId"]
          });
          const remainingBusinessIds = new Set(businessesWithAgents.map((agent) => agent.businessId));
          const businessesWithoutAgents = businessIds.filter((businessId) => !remainingBusinessIds.has(businessId));
          if (businessesWithoutAgents.length > 0) {
            await tx.businessProfile.updateMany({
              where: { businessId: { in: businessesWithoutAgents } },
              data: { vapiAssistantId: null }
            });
          }
        }
      } else {
        await tx.payment.updateMany({
          where: { listingId: listing.id },
          data: { listingId: null }
        });
      }

      // Architect earnings are immutable history but listingId is a denormalized
      // lookup key, so detach it before the listing disappears.
      await tx.architectEarning.updateMany({
        where: { listingId: listing.id },
        data: { listingId: null }
      });
      await tx.agentListing.delete({ where: { id: listing.id } });

      if (deleteWorkflow && listing.workflowId) {
        await tx.testCalendarEvent.updateMany({
          where: { workflowId: listing.workflowId },
          data: { workflowId: null }
        });
        await tx.workflowDefinition.deleteMany({ where: { id: listing.workflowId } });
      }

      return {
        workflowDeleted: deleteWorkflow,
        installedAgentsDeleted: installedAgentIds.length,
        phoneNumbersReleased
      };
    });

    await logAdminAction({
      adminUserId: authUser.id,
      action: "AGENT_DELETED",
      targetType: "AgentListing",
      targetId: listing.id,
      meta: {
        name: listing.name,
        architectUserId: listing.architectUserId,
        workflowId: listing.workflowId,
        ...deleted
      }
    }).catch(() => undefined);

    return successResponse(
      c,
      {
        deleted: true,
        listingId: listing.id,
        workflowId: listing.workflowId,
        ...deleted
      },
      "Agent deleted permanently"
    );
  } catch (error) {
    console.error("[admin] agent deletion failed", error);
    return errorResponse(c, "Could not delete agent", 500, "AGENT_DELETE_FAILED");
  }
});

// 7. DELETE /admin/architects/:userId
adminRoutes.delete("/architects/:userId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const userId = c.req.param("userId");
    deleteArchitectSchema.parse(await c.req.json().catch(() => ({})));

    if (userId === authUser.id) {
      return errorResponse(c, "You cannot delete your own admin account", 409, "SELF_DELETE_FORBIDDEN");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        roleMemberships: { select: { role: true } },
        _count: { select: { businesses: true } }
      }
    });

    const roles = new Set(user ? [user.role, ...user.roleMemberships.map((membership) => membership.role)] : []);
    if (user?._count.businesses) roles.add("BUSINESS");
    if (!user || !roles.has("ARCHITECT")) {
      return errorResponse(c, "Architect not found", 404, "ARCHITECT_NOT_FOUND");
    }
    if (roles.has("ADMIN")) {
      return errorResponse(c, "Admin accounts cannot be deleted here", 409, "ADMIN_DELETE_FORBIDDEN");
    }

    // Consent evidence is pseudonymized only when the shared User row will be
    // removed. A surviving business workspace still owns that consent.
    if ([...roles].every((role) => role === "ARCHITECT")) {
      await pseudonymizeDisclosureConsentsForUser(userId);
    }

    const deletion = await deleteUserWorkspace(userId, "ARCHITECT");

    await logAdminAction({
      adminUserId: authUser.id,
      action: deletion.accountRemoved ? "ARCHITECT_ACCOUNT_DELETED" : "ARCHITECT_WORKSPACE_DELETED",
      targetType: "USER",
      targetId: userId,
      meta: { roles: [...roles] }
    });

    return successResponse(
      c,
      {
        deleted: true,
        userId,
        accountRemoved: deletion.accountRemoved,
        remainingRoles: deletion.remainingRoles
      },
      deletion.accountRemoved ? "Architect account and associated data deleted" : "Architect workspace and associated data deleted"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, "Type DELETE to confirm account deletion", 422, "CONFIRMATION_REQUIRED");
    }
    return errorResponse(c, "Could not delete architect account", 500, "ARCHITECT_DELETE_FAILED");
  }
});

// 7. PATCH /admin/architects/:userId/status
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

// 8. PATCH /admin/users/:userId/suspension
adminRoutes.patch("/users/:userId/suspension", async (c) => {
  try {
    const authUser = c.get("authUser");
    const userId = c.req.param("userId");
    const input = suspensionSchema.parse(await c.req.json());

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });
    if (!existing) {
      return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
    }

    if (
      userId === authUser.id ||
      existing.email.trim().toLowerCase() === authUser.email.trim().toLowerCase()
    ) {
      return errorResponse(c, "You cannot change your own suspension state.", 409, "CANNOT_SUSPEND_SELF");
    }

    // The admin business table is identity-based and deduplicates legacy role
    // rows by email. Keep every row for that registered identity in sync.
    await prisma.user.updateMany({
      where: { email: { equals: existing.email, mode: "insensitive" } },
      data: { isSuspended: input.isSuspended },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
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

/* ---- "Need Help" support issues (public landing-page submissions) ---- */

const supportIssueListQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

// GET /admin/support-issues — list "Need Help" submissions (metadata only, no file bytes)
adminRoutes.get("/support-issues", async (c) => {
  const parsed = supportIssueListQuerySchema.safeParse({
    search: c.req.query("search"),
    status: c.req.query("status"),
    page: c.req.query("page"),
    limit: c.req.query("limit")
  });

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION_ERROR");
  }

  const { page, limit, skip } = parsePagination(c);
  const search = (parsed.data.search ?? "").trim();
  const status = (parsed.data.status ?? "").trim().toUpperCase();

  const where: Prisma.SupportIssueWhereInput = {};
  if (status) {
    where.status = status;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { issue: { contains: search, mode: "insensitive" } }
    ];
  }

  const [total, issues] = await Promise.all([
    prisma.supportIssue.count({ where }),
    prisma.supportIssue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        issue: true,
        status: true,
        documentName: true,
        documentMimeType: true,
        documentSizeBytes: true,
        voiceName: true,
        voiceMimeType: true,
        voiceDurationSec: true,
        voiceSizeBytes: true,
        createdAt: true
      }
    })
  ]);

  return successResponse(c, { items: issues, total, page, limit });
});

// GET /admin/support-issues/:id/document — stream the uploaded document bytes
adminRoutes.get("/support-issues/:id/document", async (c) => {
  const id = c.req.param("id");
  const row = await prisma.supportIssue.findUnique({
    where: { id },
    select: { documentBytes: true, documentMimeType: true, documentName: true }
  });

  if (!row?.documentBytes) {
    return errorResponse(c, "Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const bytes = new Uint8Array(row.documentBytes);
  const filename = (row.documentName ?? "document").replace(/"/g, "");
  return new Response(bytes, {
    headers: {
      "Content-Type": row.documentMimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength)
    }
  });
});

// GET /admin/support-issues/:id/voice — stream the recorded voice message for playback
adminRoutes.get("/support-issues/:id/voice", async (c) => {
  const id = c.req.param("id");
  const row = await prisma.supportIssue.findUnique({
    where: { id },
    select: { voiceBytes: true, voiceMimeType: true }
  });

  if (!row?.voiceBytes) {
    return errorResponse(c, "Voice message not found", 404, "VOICE_NOT_FOUND");
  }

  const bytes = new Uint8Array(row.voiceBytes);
  return new Response(bytes, {
    headers: {
      "Content-Type": row.voiceMimeType ?? "audio/webm",
      "Content-Length": String(bytes.byteLength)
    }
  });
});

const supportIssueStatusSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED"])
});

// PATCH /admin/support-issues/:id — update the triage status (OPEN | RESOLVED)
adminRoutes.patch("/support-issues/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = supportIssueStatusSchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
  }

  const existing = await prisma.supportIssue.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return errorResponse(c, "Support issue not found", 404, "SUPPORT_ISSUE_NOT_FOUND");
  }

  const updated = await prisma.supportIssue.update({
    where: { id },
    data: { status: parsed.data.status },
    select: { id: true, status: true }
  });

  return successResponse(c, { issue: updated });
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
