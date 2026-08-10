import type { Context } from "hono";
import {
  buildMarketplacePreview,
  isTrivenTargetIndustry,
  normalizeAgentConfigure,
  requiredConnectorKeys,
  resolveBrowseIndustries,
  targetIndustryForSubindustry,
  validateConfigureForSubmit,
  type AgentConfigureData,
  type AgentPricingModel
} from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";

const PRICING_MODEL_TO_ENUM: Record<AgentPricingModel, "FREE" | "ONE_TIME" | "SUBSCRIPTION"> = {
  free: "FREE",
  one_time: "ONE_TIME",
  subscription: "SUBSCRIPTION"
};

type OwnedWorkflow = NonNullable<Awaited<ReturnType<typeof findOwnedWorkflow>>>;

async function findOwnedWorkflow(workflowId: string, architectUserId: string) {
  return prisma.workflowDefinition.findFirst({
    where: { id: workflowId, architectUserId },
    include: {
      listings: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });
}

function latestListing(workflow: OwnedWorkflow) {
  return workflow.listings[0] ?? null;
}

/** Listing states that lock configure edits (mirrors the builder publish lock). */
function configureLockMessage(workflow: OwnedWorkflow): string | null {
  const listing = latestListing(workflow);
  if (!listing) return null;
  if (listing.status === "PENDING_REVIEW") {
    return "This agent is under review. Configuration is locked until the review completes.";
  }
  if (listing.status === "APPROVED") {
    return "This agent is live on the marketplace. Configuration is locked.";
  }
  return null;
}

function configureSeed(workflow: OwnedWorkflow) {
  const listing = latestListing(workflow);
  return {
    name: workflow.name,
    tagline: listing?.tagline ?? workflow.description,
    description: listing?.description ?? workflow.description,
    priceDollars: listing ? listing.priceCents / 100 : null,
    requiredConnectors: [
      ...(listing?.requiredConnectors ?? []),
      ...requiredConnectorKeys(workflow.workflowJson)
    ],
    // Seeds "What's included" from the connected workflow nodes.
    workflowJson: workflow.workflowJson
  };
}

function resolveConfigure(workflow: OwnedWorkflow): AgentConfigureData {
  return normalizeAgentConfigure(workflow.configureJson, configureSeed(workflow));
}

/** Merge a partial configure payload (section-level) onto the stored raw JSON. */
function mergeConfigureSections(existing: unknown, incoming: unknown): unknown {
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    return existing;
  }

  const base: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  for (const section of ["basics", "media", "template", "pricing", "compliance"] as const) {
    const incomingSection = (incoming as Record<string, unknown>)[section];
    if (typeof incomingSection !== "object" || incomingSection === null) continue;

    const baseSection = base[section];
    base[section] = {
      ...(typeof baseSection === "object" && baseSection !== null ? (baseSection as object) : {}),
      ...(incomingSection as object)
    };
  }

  return base;
}

function listingSummary(workflow: OwnedWorkflow) {
  const listing = latestListing(workflow);
  if (!listing) return null;
  return {
    id: listing.id,
    status: listing.status,
    reviewStatus: listing.reviewStatus,
    publishStatus: listing.publishStatus,
    rejectionReason: listing.rejectionReason,
    submittedAt: listing.submittedAt,
    approvedAt: listing.approvedAt,
    publishedAt: listing.publishedAt
  };
}

function configureResponse(workflow: OwnedWorkflow, configure: AgentConfigureData) {
  return {
    workflowId: workflow.id,
    configure,
    reviewStatus: workflow.reviewStatus,
    publishStatus: workflow.publishStatus,
    listing: listingSummary(workflow),
    locked: Boolean(configureLockMessage(workflow)),
    lockedMessage: configureLockMessage(workflow)
  };
}

async function persistConfigure(
  workflow: OwnedWorkflow,
  incoming: unknown,
  architectName: string
): Promise<AgentConfigureData> {
  const mergedRaw = mergeConfigureSections(workflow.configureJson, incoming);
  const configure = normalizeAgentConfigure(mergedRaw, configureSeed(workflow));
  const preview = buildMarketplacePreview(configure, architectName);

  const name = configure.basics.agentName.trim();
  const tagline = configure.basics.tagline.trim();

  await prisma.workflowDefinition.update({
    where: { id: workflow.id },
    data: {
      configureJson: configure as never,
      marketplaceJson: preview as never,
      requiredIntegrations: configure.template.requiredIntegrations as never,
      buyerSetupSchema: configure.template.requiredBuyerSetup as never,
      publishChecklist: configure.compliance.complianceChecks as never,
      // Keep the builder header/listing cards in sync with Configure basics.
      ...(name ? { name } : {}),
      ...(tagline ? { description: tagline } : {})
    }
  });

  return configure;
}

export async function getWorkflowConfigure(c: Context) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId") ?? "";

  const workflow = await findOwnedWorkflow(workflowId, authUser.id);
  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  return successResponse(c, configureResponse(workflow, resolveConfigure(workflow)));
}

export async function patchWorkflowConfigure(c: Context) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId") ?? "";

  const workflow = await findOwnedWorkflow(workflowId, authUser.id);
  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  const lockMessage = configureLockMessage(workflow);
  if (lockMessage) {
    return errorResponse(c, lockMessage, 409, "CONFIGURE_LOCKED");
  }

  const body = (await c.req.json().catch(() => ({}))) as { configure?: unknown };
  const configure = await persistConfigure(
    workflow,
    body.configure,
    authUser.fullName?.trim() || authUser.email
  );

  const refreshed = await findOwnedWorkflow(workflowId, authUser.id);
  return successResponse(c, configureResponse(refreshed ?? workflow, configure), "Configuration saved");
}

export async function saveWorkflowConfigureDraft(c: Context) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId") ?? "";

  const workflow = await findOwnedWorkflow(workflowId, authUser.id);
  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  const lockMessage = configureLockMessage(workflow);
  if (lockMessage) {
    return errorResponse(c, lockMessage, 409, "CONFIGURE_LOCKED");
  }

  const body = (await c.req.json().catch(() => ({}))) as { configure?: unknown };
  const configure = await persistConfigure(
    workflow,
    body.configure,
    authUser.fullName?.trim() || authUser.email
  );

  const refreshed = await findOwnedWorkflow(workflowId, authUser.id);
  return successResponse(c, configureResponse(refreshed ?? workflow, configure), "Draft saved");
}

export async function submitWorkflowForReview(c: Context) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId") ?? "";

  const workflow = await findOwnedWorkflow(workflowId, authUser.id);
  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  const lockMessage = configureLockMessage(workflow);
  if (lockMessage) {
    return errorResponse(c, lockMessage, 409, "CONFIGURE_LOCKED");
  }

  const nodes = (workflow.workflowJson as { nodes?: unknown[] } | null)?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return errorResponse(
      c,
      "Add at least one node to the workflow before submitting for review.",
      422,
      "EMPTY_WORKFLOW"
    );
  }

  // Persist the latest configure state first so nothing is lost on validation
  // failure, then validate the resolved (complete) object.
  const body = (await c.req.json().catch(() => ({}))) as { configure?: unknown };
  const architectName = authUser.fullName?.trim() || authUser.email;
  const configure = await persistConfigure(workflow, body.configure, architectName);

  const selectedIndustries = resolveBrowseIndustries(configure.basics.industryTags);
  const expectedIndustry = targetIndustryForSubindustry(configure.basics.category);
  const selectedTargetIndustries = selectedIndustries.filter(isTrivenTargetIndustry);

  if (selectedTargetIndustries.length > 0 && !expectedIndustry) {
    return errorResponse(
      c,
      `${configure.basics.category} is not an approved subindustry for the selected Triven launch industry.`,
      422,
      "INVALID_SUBINDUSTRY"
    );
  }

  if (expectedIndustry && !selectedIndustries.includes(expectedIndustry)) {
    return errorResponse(
      c,
      `${configure.basics.category} belongs to ${expectedIndustry}. Select the matching Industry before submitting.`,
      422,
      "SUBINDUSTRY_INDUSTRY_MISMATCH"
    );
  }

  const issues = validateConfigureForSubmit(configure);
  if (issues.length > 0) {
    return c.json(
      {
        success: false,
        error: issues[0]?.message ?? "Configuration is incomplete",
        code: "CONFIGURE_INCOMPLETE",
        data: { issues }
      },
      422
    );
  }

  const plainDescription = configure.media.fullDescription
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const priceCents =
    configure.pricing.pricingModel === "free"
      ? 0
      : Math.max(0, Math.round(configure.pricing.price * 100));

  const requiredConnectors = Array.from(
    new Set([
      ...requiredConnectorKeys(workflow.workflowJson),
      ...Object.entries(configure.template.requiredIntegrations)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
    ])
  );

  const now = new Date();

  const listingData = {
    name: configure.basics.agentName.trim(),
    shortDescription: configure.basics.shortDescription.trim() || configure.basics.tagline.trim(),
    description: plainDescription || null,
    priceCents,
    tags: configure.basics.industryTags,
    requiredConnectors,
    supportedLlms: [] as string[],
    status: "PENDING_REVIEW" as const,
    tagline: configure.basics.tagline.trim(),
    category: configure.basics.category,
    industryTags: configure.basics.industryTags,
    iconUrl: configure.basics.iconUrl || null,
    fullDescription: configure.media.fullDescription || null,
    includedFeatures: configure.media.includedFeatures.map((f) => f.trim()).filter(Boolean),
    screenshotUrls: configure.media.screenshotUrls,
    demoVideoUrl: configure.media.demoVideoUrl.trim() || null,
    pricingModel: PRICING_MODEL_TO_ENUM[configure.pricing.pricingModel],
    executionFeeCents: Math.max(0, Math.round(configure.pricing.executionFee * 100)),
    freeTrialEnabled: configure.pricing.freeTrialEnabled,
    trialDays: configure.pricing.freeTrialEnabled ? Math.round(configure.pricing.trialDays) : 0,
    setupTimeEstimate: configure.template.setupTimeEstimate,
    requiredIntegrations: configure.template.requiredIntegrations as never,
    requiredBuyerSetup: configure.template.requiredBuyerSetup as never,
    buyerSetupInstructions: configure.template.buyerSetupInstructions.trim() || null,
    installInstructions: configure.template.installInstructions.trim() || null,
    dataHandling: {
      processesPersonalData: configure.compliance.processesPersonalData,
      storesConversationHistory: configure.compliance.storesConversationHistory,
      connectsThirdPartyServices: configure.compliance.connectsThirdPartyServices
    } as never,
    complianceChecks: configure.compliance.complianceChecks as never,
    reviewStatus: "SUBMITTED" as const,
    publishStatus: "IN_REVIEW" as const,
    rejectionReason: null,
    submittedAt: now
  };

  const existingListing = latestListing(workflow);

  const listing = existingListing
    ? await prisma.agentListing.update({
        where: { id: existingListing.id },
        data: listingData
      })
    : await prisma.agentListing.create({
        data: {
          architectUserId: authUser.id,
          workflowId: workflow.id,
          ...listingData
        }
      });

  await prisma.workflowDefinition.update({
    where: { id: workflow.id },
    data: { reviewStatus: "SUBMITTED", publishStatus: "IN_REVIEW" }
  });

  const refreshed = await findOwnedWorkflow(workflowId, authUser.id);
  return successResponse(
    c,
    {
      ...configureResponse(refreshed ?? workflow, configure),
      listingId: listing.id
    },
    "Agent submitted for review",
    existingListing ? 200 : 201
  );
}

export async function publishWorkflowListing(c: Context) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId") ?? "";

  const workflow = await findOwnedWorkflow(workflowId, authUser.id);
  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  const listing = latestListing(workflow);
  if (!listing) {
    return errorResponse(c, "Submit this agent for review before publishing.", 409, "NOT_SUBMITTED");
  }

  if (listing.status === "PENDING_REVIEW") {
    return errorResponse(
      c,
      "This agent is still in review. It will go live once approved.",
      409,
      "REVIEW_PENDING"
    );
  }

  if (listing.status !== "APPROVED") {
    return errorResponse(
      c,
      "Only approved agents can be published. Submit for review first.",
      409,
      "NOT_APPROVED"
    );
  }

  const now = new Date();

  const updatedListing = await prisma.agentListing.update({
    where: { id: listing.id },
    data: {
      publishStatus: "PUBLISHED",
      publishedAt: listing.publishedAt ?? now
    }
  });

  await prisma.workflowDefinition.update({
    where: { id: workflow.id },
    data: { publishStatus: "PUBLISHED" }
  });

  return successResponse(
    c,
    {
      listingId: updatedListing.id,
      status: updatedListing.status,
      publishStatus: updatedListing.publishStatus,
      publishedAt: updatedListing.publishedAt
    },
    "Agent published"
  );
}

export async function getWorkflowMarketplacePreview(c: Context) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId") ?? "";

  const workflow = await findOwnedWorkflow(workflowId, authUser.id);
  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  const configure = resolveConfigure(workflow);
  const preview = buildMarketplacePreview(configure, authUser.fullName?.trim() || authUser.email);

  return successResponse(c, { preview });
}
