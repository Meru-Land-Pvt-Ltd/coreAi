import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";

export const businessOnboardingRoutes = new Hono();

const PAIN_KEYWORDS: Record<string, string[]> = {
  "missed-calls": ["missed", "call", "text-back", "text back", "receptionist", "phone", "after hours"],
  scheduling: ["scheduling", "appointment", "booking", "calendar"],
  communication: ["sms", "communication", "reminder", "confirmation", "follow"],
  reviews: ["review", "reputation", "google", "yelp"],
  billing: ["billing", "collection", "payment", "balance"],
  intake: ["intake", "form", "patient"],
  analytics: ["analytics", "report", "insight", "performance"],
  recall: ["recall", "hygiene", "overdue", "reminder"],
  frontdesk: ["receptionist", "front desk", "automation", "virtual", "ai receptionist"]
};

const onboardingDataSchema = z.object({
  lastStep: z.number().int().min(1).max(5).optional(),
  skippedFrom: z.number().int().min(1).max(5).optional(),
  businessName: z.string().trim().min(1).optional(),
  businessType: z.string().trim().min(1).optional(),
  teamSize: z.string().trim().min(1).optional(),
  monthlyVolume: z.string().trim().min(1).optional(),
  software: z.array(z.string().trim().min(1)).optional(),
  industry: z.string().trim().optional(),
  challenges: z.array(z.string().trim().min(1)).optional()
});

const saveOnboardingSchema = z.object({
  action: z.enum(["save", "complete", "skip"]),
  data: onboardingDataSchema.optional()
});

type OnboardingData = z.infer<typeof onboardingDataSchema>;

function mergeOnboardingData(
  existing: OnboardingData | null,
  incoming: OnboardingData | undefined
): OnboardingData {
  if (!incoming) return existing ?? {};
  return {
    ...existing,
    ...incoming,
    software: incoming.software ?? existing?.software,
    challenges: incoming.challenges ?? existing?.challenges
  };
}

function parseOnboardingData(value: unknown): OnboardingData | null {
  if (!value || typeof value !== "object") return null;
  const parsed = onboardingDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function loadBuyerBusiness(userId: string) {
  return prisma.business.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
    include: { profile: true }
  });
}

function listingSearchText(listing: {
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  tags?: string[];
}) {
  return [
    listing.name,
    listing.shortDescription ?? "",
    listing.description ?? "",
    ...(listing.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();
}

function scoreListingForChallenges(
  listing: {
    id: string;
    name: string;
    shortDescription?: string | null;
    description?: string | null;
    tags?: string[];
    priceCents?: number | null;
    installCount?: number;
    architect?: {
      architectProfile?: { rating?: number | null } | null;
    } | null;
  },
  challenges: string[]
) {
  const haystack = listingSearchText(listing);
  let score = 0;
  const matchedChallenges: string[] = [];

  for (const challenge of challenges) {
    const keywords = PAIN_KEYWORDS[challenge] ?? [challenge.replace(/-/g, " ")];
    const hit = keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    if (hit) {
      score += 10;
      matchedChallenges.push(challenge);
    }
  }

  score += Math.min((listing.installCount ?? 0) / 10, 5);
  const rating = listing.architect?.architectProfile?.rating ?? 0;
  score += rating;

  return { score, matchedChallenges };
}

async function buildRecommendations(challenges: string[]) {
  const listings = await prisma.agentListing.findMany({
    where: { status: "APPROVED" },
    include: {
      architect: {
        select: {
          architectProfile: {
            select: { rating: true }
          }
        }
      },
      _count: { select: { installedAgents: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  const seenWorkflowIds = new Set<string>();
  const unique = listings.filter((listing) => {
    if (!listing.workflowId) return true;
    if (seenWorkflowIds.has(listing.workflowId)) return false;
    seenWorkflowIds.add(listing.workflowId);
    return true;
  });

  const scored = unique.map((listing) => {
    const { score, matchedChallenges } = scoreListingForChallenges(
      {
        ...listing,
        installCount: listing._count.installedAgents
      },
      challenges
    );
    return { listing, score, matchedChallenges };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected = (challenges.length > 0
    ? scored.filter((item) => item.matchedChallenges.length > 0)
    : scored
  ).slice(0, 3);

  const fallback = selected.length > 0 ? selected : scored.slice(0, 3);

  return fallback.map(({ listing, matchedChallenges }) => ({
    id: listing.id,
    name: listing.name,
    description: listing.shortDescription ?? listing.description ?? "",
    priceCents: listing.priceCents ?? 0,
    pricingModel: (listing.pricingModel as string | null) ?? "subscription",
    rating: listing.architect?.architectProfile?.rating ?? 4.8,
    installCount: listing._count.installedAgents,
    matchedChallenges,
    tags: listing.tags ?? []
  }));
}

function serializeOnboardingResponse(params: {
  user: { fullName: string | null; email: string };
  business: {
    id: string;
    name: string;
    type: string;
    profile: {
      businessSize: string | null;
      onboardingCompletedAt: Date | null;
      onboardingSkippedAt: Date | null;
      onboardingDataJson: unknown;
    } | null;
  } | null;
  recommendations?: Awaited<ReturnType<typeof buildRecommendations>>;
}) {
  const data = parseOnboardingData(params.business?.profile?.onboardingDataJson);
  // Businesses created before onboarding was introduced have no onboarding
  // markers or saved progress. Treat them as already onboarded so this gate is
  // only shown to genuinely new users. Once a new user saves any onboarding
  // step, onboardingDataJson exists and the normal completed/skipped flags win.
  const isLegacyExistingBusiness = Boolean(
    params.business &&
      (!params.business.profile ||
        (!params.business.profile.onboardingCompletedAt &&
          !params.business.profile.onboardingSkippedAt &&
          !params.business.profile.onboardingDataJson))
  );
  const completed = Boolean(
    params.business?.profile?.onboardingCompletedAt || isLegacyExistingBusiness
  );
  const skipped = Boolean(params.business?.profile?.onboardingSkippedAt);

  return {
    completed,
    skipped,
    displayName: params.user.fullName?.trim() || params.user.email.split("@")[0] || "there",
    businessId: params.business?.id ?? null,
    data: {
      businessName: data?.businessName ?? params.business?.name ?? "",
      businessType: data?.businessType ?? params.business?.type ?? "",
      teamSize: data?.teamSize ?? params.business?.profile?.businessSize ?? "",
      monthlyVolume: data?.monthlyVolume ?? "",
      software: data?.software ?? [],
      industry: data?.industry ?? "",
      challenges: data?.challenges ?? [],
      lastStep: data?.lastStep ?? 1,
      skippedFrom: data?.skippedFrom ?? null
    },
    recommendations: params.recommendations ?? []
  };
}

businessOnboardingRoutes.get("/", async (c) => {
  try {
    const authUser = c.get("authUser");
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { fullName: true, email: true }
    });

    if (!user) {
      return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
    }

    const business = await loadBuyerBusiness(authUser.id);
    const challenges = parseOnboardingData(business?.profile?.onboardingDataJson)?.challenges ?? [];
    const recommendations = await buildRecommendations(challenges);

    return successResponse(
      c,
      serializeOnboardingResponse({ user, business, recommendations }),
      "Onboarding loaded"
    );
  } catch {
    return errorResponse(c, "Could not load onboarding", 500, "ONBOARDING_LOAD_FAILED");
  }
});

businessOnboardingRoutes.post("/", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = saveOnboardingSchema.parse(await c.req.json());

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { fullName: true, email: true }
    });

    if (!user) {
      return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
    }

    let business = await loadBuyerBusiness(authUser.id);
    const existingData = parseOnboardingData(business?.profile?.onboardingDataJson);
    const mergedData = mergeOnboardingData(existingData, input.data);

    const businessName =
      mergedData.businessName?.trim() ||
      business?.name ||
      user.fullName ||
      "New Business";
    const businessType =
      mergedData.businessType?.trim() ||
      business?.type ||
      "Pending Setup";

    if (!business) {
      business = await prisma.business.create({
        data: {
          ownerId: authUser.id,
          name: businessName,
          type: businessType,
          profile: {
            create: {
              businessSize: mergedData.teamSize ?? null,
              onboardingDataJson: mergedData as never,
              onboardingCompletedAt: input.action === "complete" ? new Date() : null,
              onboardingSkippedAt: input.action === "skip" ? new Date() : null
            }
          }
        },
        include: { profile: true }
      });
    } else {
      await prisma.business.update({
        where: { id: business.id },
        data: { name: businessName, type: businessType }
      });

      await prisma.businessProfile.upsert({
        where: { businessId: business.id },
        update: {
          businessSize: mergedData.teamSize ?? business.profile?.businessSize ?? null,
          onboardingDataJson: mergedData as never,
          ...(input.action === "complete"
            ? { onboardingCompletedAt: new Date(), onboardingSkippedAt: null }
            : {}),
          ...(input.action === "skip" ? { onboardingSkippedAt: new Date() } : {})
        },
        create: {
          businessId: business.id,
          businessSize: mergedData.teamSize ?? null,
          onboardingDataJson: mergedData as never,
          onboardingCompletedAt: input.action === "complete" ? new Date() : null,
          onboardingSkippedAt: input.action === "skip" ? new Date() : null
        }
      });

      business = await loadBuyerBusiness(authUser.id);
    }

    const challenges = mergedData.challenges ?? [];
    const recommendations = await buildRecommendations(challenges);

    return successResponse(
      c,
      serializeOnboardingResponse({ user, business, recommendations }),
      input.action === "complete"
        ? "Onboarding completed"
        : input.action === "skip"
          ? "Onboarding skipped"
          : "Onboarding saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid onboarding input",
        422,
        "VALIDATION_ERROR"
      );
    }
    return errorResponse(c, "Could not save onboarding", 500, "ONBOARDING_SAVE_FAILED");
  }
});
