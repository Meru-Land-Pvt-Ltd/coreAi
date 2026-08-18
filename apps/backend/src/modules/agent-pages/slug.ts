import type { PublishedAgentPage } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Slug + page bootstrap for published agent pages (triven.ai/a/<slug>).
 * One PublishedAgentPage row per approved listing; created lazily the first
 * time the architect opens the manage screen (or another caller ensures it).
 */

export type AgentPageTemplate = "chat" | "voice" | "media" | "form";

/** URL-safe slug + short id suffix (unique even for duplicate agent names). */
export function buildAgentPageSlug(listingName: string, listingId: string): string {
  const namePart = listingName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = listingId.slice(-6);
  return [namePart, suffix].filter(Boolean).join("-");
}

type WorkflowJsonNode = {
  type?: unknown;
  data?: { type?: unknown } | null;
};

function nodeTypes(workflowJson: unknown): string[] {
  if (typeof workflowJson !== "object" || workflowJson === null) return [];
  const nodes = (workflowJson as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];

  const types: string[] = [];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const candidate = node as WorkflowJsonNode;
    // Semantic type lives at node.data.type (see workflow-runner); fall back
    // to the top-level React Flow type for older graphs.
    const type = candidate.data?.type ?? candidate.type;
    if (typeof type === "string" && type) types.push(type);
  }
  return types;
}

/**
 * Default template from the workflow graph: voice conversations get the voice
 * template, image/video generation gets media, everything else chats. "form"
 * is only ever chosen manually by the architect.
 */
export function inferAgentPageTemplate(workflowJson: unknown): AgentPageTemplate {
  const types = nodeTypes(workflowJson);
  if (types.some((type) => type.includes("voice_conversation"))) return "voice";
  if (types.some((type) => /(image|video)_generation/.test(type))) return "media";
  return "chat";
}

function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/** Fallback listing name when a workflow was saved without one. */
export const DRAFT_LISTING_FALLBACK_NAME = "Untitled Agent";

/** Short description stamped on auto-created DRAFT listings. */
export const DRAFT_LISTING_SHORT_DESCRIPTION = "Draft — not yet published.";

export type DraftAgentPageWorkflow = {
  id: string;
  name: string | null;
  architectUserId: string;
  workflowJson: unknown;
};

/**
 * Get (or lazily create) the listing AND page for a workflow — the universal
 * bootstrap behind Design Brain chat and the builder's Test preview. A draft
 * workflow with no AgentListing gets a minimal DRAFT one (free, unpublished);
 * the page row is then ensured the usual way. The DRAFT listing never shows
 * publicly: the public page route requires listing status APPROVED.
 * Safe under concurrent calls — a unique-constraint loss re-fetches the
 * winner's listing, and ensurePublishedAgentPage already tolerates page races.
 */
export async function ensureDraftAgentListingAndPage(
  workflow: DraftAgentPageWorkflow
): Promise<PublishedAgentPage> {
  let listing = await prisma.agentListing.findFirst({ where: { workflowId: workflow.id } });

  if (!listing) {
    try {
      listing = await prisma.agentListing.create({
        data: {
          name: workflow.name || DRAFT_LISTING_FALLBACK_NAME,
          shortDescription: DRAFT_LISTING_SHORT_DESCRIPTION,
          priceCents: 0,
          pricingModel: "FREE",
          status: "DRAFT",
          architectUserId: workflow.architectUserId,
          workflowId: workflow.id
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // A concurrent request created the listing first — use the winner's row.
      listing = await prisma.agentListing.findFirst({ where: { workflowId: workflow.id } });
      if (!listing) throw error;
    }
  }

  const page = await ensurePublishedAgentPage({
    listing: {
      id: listing.id,
      name: listing.name,
      architectUserId: listing.architectUserId,
      // The listing was found or created by workflowId, so it is always set.
      workflowId: workflow.id,
      workflow: { workflowJson: workflow.workflowJson }
    }
  });
  if (!page) {
    // Unreachable: ensurePublishedAgentPage only returns null without a workflowId.
    throw new Error(`Could not ensure an agent page for workflow ${workflow.id}`);
  }
  return page;
}

export type EnsureAgentPageListing = {
  id: string;
  name: string;
  architectUserId: string;
  workflowId: string | null;
  /** Pass the workflow when already loaded to skip the extra query. */
  workflow?: { workflowJson: unknown } | null;
};

/**
 * Get (or lazily create) the published page row for a listing. Returns null
 * only when the listing has no workflow yet. Safe under concurrent calls:
 * a listingId collision returns the winner's row, a slug collision retries
 * with a random 4-char suffix.
 */
export async function ensurePublishedAgentPage({
  listing
}: {
  listing: EnsureAgentPageListing;
}): Promise<PublishedAgentPage | null> {
  const existing = await prisma.publishedAgentPage.findUnique({ where: { listingId: listing.id } });
  if (existing) return existing;

  if (!listing.workflowId) return null;

  let workflowJson: unknown = listing.workflow?.workflowJson;
  if (workflowJson === undefined) {
    const workflow = await prisma.workflowDefinition.findUnique({
      where: { id: listing.workflowId },
      select: { workflowJson: true }
    });
    workflowJson = workflow?.workflowJson;
  }

  const template = inferAgentPageTemplate(workflowJson);
  const baseSlug = buildAgentPageSlug(listing.name, listing.id);

  const MAX_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;
    try {
      return await prisma.publishedAgentPage.create({
        data: {
          slug,
          listingId: listing.id,
          workflowId: listing.workflowId,
          architectUserId: listing.architectUserId,
          template,
          status: "LIVE"
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Concurrent create for the same listing — return the winner's row.
      const winner = await prisma.publishedAgentPage.findUnique({ where: { listingId: listing.id } });
      if (winner) return winner;
      // Otherwise the slug is taken by another listing — retry with a suffix.
    }
  }

  throw new Error(`Could not allocate a unique agent page slug for listing ${listing.id}`);
}
