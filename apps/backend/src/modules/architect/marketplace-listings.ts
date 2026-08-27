import type { Prisma } from "@prisma/client";
import { getSharedRedis, sharedRedisReady } from "../../lib/redis";
import { prisma } from "../../lib/prisma";

export const MARKETPLACE_PAGE_SIZE_DEFAULT = 24;
export const MARKETPLACE_PAGE_SIZE_MAX = 48;

const MARKETPLACE_IDS_CACHE_TTL_SECONDS = 60;
const MARKETPLACE_IDS_CACHE_PREFIX = "marketplace:deduped-ids:";

export const MARKETPLACE_WORKFLOW_SELECT = {
  select: { id: true, name: true, description: true }
} as const;

type MarketplaceListingWhere = Prisma.AgentListingWhereInput;

type DedupedListingRef = {
  id: string;
  createdAt: Date;
};

export type MarketplacePageResult = {
  ids: string[];
  hasMore: boolean;
  nextCursor: string | null;
};

function marketplaceIdsCacheKey(where: MarketplaceListingWhere): string {
  const status =
    where.status === "APPROVED"
      ? "approved"
      : Array.isArray((where.status as { in?: string[] })?.in)
        ? "completed"
        : "custom";
  return `${MARKETPLACE_IDS_CACHE_PREFIX}${status}`;
}

export function encodeListingCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeListingCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw?.trim()) return null;
  try {
    const decoded = Buffer.from(raw.trim(), "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return null;
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function parseMarketplacePageSize(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return MARKETPLACE_PAGE_SIZE_DEFAULT;
  return Math.min(parsed, MARKETPLACE_PAGE_SIZE_MAX);
}

async function loadDedupedMarketplaceListingRefs(
  where: MarketplaceListingWhere
): Promise<DedupedListingRef[]> {
  const cacheKey = marketplaceIdsCacheKey(where);
  const redis = getSharedRedis();
  if (redis && sharedRedisReady()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as Array<{ id: string; createdAt: string }>;
        if (Array.isArray(parsed)) {
          return parsed.map((row) => ({ id: row.id, createdAt: new Date(row.createdAt) }));
        }
      }
    } catch {
      // fall through to DB
    }
  }

  const rows = await prisma.agentListing.findMany({
    where,
    select: {
      id: true,
      workflowId: true,
      createdAt: true,
      featuredAt: true
    },
    orderBy: [{ featuredAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
  });

  const seenWorkflowIds = new Set<string>();
  const deduped: DedupedListingRef[] = [];
  for (const row of rows) {
    if (row.workflowId) {
      if (seenWorkflowIds.has(row.workflowId)) continue;
      seenWorkflowIds.add(row.workflowId);
    }
    deduped.push({ id: row.id, createdAt: row.createdAt });
  }

  if (redis && sharedRedisReady()) {
    try {
      await redis.set(
        cacheKey,
        JSON.stringify(deduped.map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString() }))),
        "EX",
        MARKETPLACE_IDS_CACHE_TTL_SECONDS
      );
    } catch {
      // cache is best-effort
    }
  }

  return deduped;
}

export async function paginateMarketplaceListingIds(
  where: MarketplaceListingWhere,
  options: { cursor?: string; limit?: number }
): Promise<MarketplacePageResult> {
  const limit = options.limit ?? MARKETPLACE_PAGE_SIZE_DEFAULT;
  const decodedCursor = decodeListingCursor(options.cursor);
  const deduped = await loadDedupedMarketplaceListingRefs(where);

  let startIndex = 0;
  if (decodedCursor) {
    const cursorIndex = deduped.findIndex((row) => row.id === decodedCursor.id);
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  }

  const slice = deduped.slice(startIndex, startIndex + limit + 1);
  const hasMore = slice.length > limit;
  const page = slice.slice(0, limit);
  const last = page.at(-1);

  return {
    ids: page.map((row) => row.id),
    hasMore,
    nextCursor: hasMore && last ? encodeListingCursor(last.createdAt, last.id) : null
  };
}

export async function fetchMarketplaceListingsByIds(ids: string[]) {
  if (!ids.length) return [];

  const listings = await prisma.agentListing.findMany({
    where: { id: { in: ids } },
    include: {
      workflow: MARKETPLACE_WORKFLOW_SELECT,
      architect: {
        select: {
          id: true,
          fullName: true,
          /* NOT THE EMAIL. These listings go out on the public marketplace
             feed, which needs no sign-in, so every architect's email address
             was readable by anyone who asked for the page — and two bylines
             printed it on screen whenever an architect had not set a name.
             Admin screens read emails through their own routes. */
          architectProfile: {
            select: {
              title: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      },
      _count: {
        select: { installedAgents: true }
      }
    }
  });

  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as typeof listings;
}

export function toMarketplaceCard<
  T extends {
    id: string;
    featuredAt?: Date | null;
    includedFeatures?: string[];
    workflow?: { id: string; name: string; description: string | null } | null;
  }
>(listing: T & { _count?: { installedAgents?: number } }, installCount?: number) {
  const { _count, workflow, ...rest } = listing as T & { _count?: { installedAgents?: number } };
  const resolvedInstallCount = installCount ?? _count?.installedAgents ?? 0;
  const capabilities = (listing.includedFeatures ?? []).map((feature) => feature.trim()).filter(Boolean);

  // A shop window shows the product, not the shopkeeper's paperwork. Spreading
  // the whole row leaked Stripe product and price ids, review rejection
  // reasons and internal workflow ids to anyone browsing the marketplace
  // signed out. Strip them by name so a new internal column cannot quietly
  // join them later.
  const shopWindow = rest as Record<string, unknown>;
  for (const internal of [
    "stripeProductId",
    "stripePriceId",
    "stripePriceCents",
    "reviewNotes",
    "rejectionReason",
    "reviewedById",
    "reviewedAt",
    "publishChecklist",
    "workflowId",
    "architectUserId"
  ]) {
    delete shopWindow[internal];
  }

  return {
    ...(shopWindow as typeof rest),
    workflow: workflow
      ? { id: workflow.id, name: workflow.name, description: workflow.description }
      : null,
    capabilities,
    featured: Boolean(listing.featuredAt),
    installCount: resolvedInstallCount
  };
}
