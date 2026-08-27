import { Hono } from "hono";
import { z } from "zod";
import {
  BROWSE_INDUSTRIES,
  getCategoriesForIndustry,
  resolveBrowseIndustries,
  tagsMatchVerticalCategory,
  targetIndustryForSubindustry
} from "@coreai/shared";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { resolvePrimaryBusinessId } from "./primary-business";

export const businessOnboardingRoutes = new Hono();

const PAIN_KEYWORDS: Record<string, string[]> = {
  "missed-calls": ["missed", "call", "text-back", "text back", "receptionist", "phone", "after hours"],
  scheduling: ["scheduling", "appointment", "booking", "calendar", "reservation", "viewing", "test drive"],
  communication: ["sms", "communication", "reminder", "confirmation", "follow-up", "follow up"],
  reviews: ["review", "reputation", "google", "yelp"],
  billing: ["billing", "collection", "payment", "balance", "invoice"],
  intake: ["intake", "form", "lead", "client", "customer", "qualification"],
  analytics: ["analytics", "report", "insight", "performance"],
  recall: ["recall", "re-engage", "reengage", "overdue", "follow-up", "follow up"],
  frontdesk: ["receptionist", "front desk", "automation", "virtual", "ai receptionist", "assistant"]
};

const onboardingDataSchema = z.object({
  lastStep: z.number().int().min(1).max(5).optional(),
  skippedFrom: z.number().int().min(1).max(5).optional(),
  businessName: z.string().trim().min(1).optional(),
  /** Stored in the existing field for backward compatibility; now means Subindustry. */
  businessType: z.string().trim().min(1).optional(),
  teamSize: z.string().trim().min(1).optional(),
  monthlyVolume: z.string().trim().min(1).optional(),
  software: z.array(z.string().trim().min(1)).optional(),
  /** Parent Industry (Healthcare, Real Estate, Automotive, Legal). */
  industry: z.string().trim().optional(),
  challenges: z.array(z.string().trim().min(1)).optional()
});

const saveOnboardingSchema = z.object({
  action: z.enum(["save", "complete", "skip"]),
  data: onboardingDataSchema.optional()
});

type OnboardingData = z.infer<typeof onboardingDataSchema>;

const LEGACY_BUSINESS_TYPE_TO_SUBINDUSTRY: Record<string, string> = {
  solo: "Dental Clinics",
  group: "Dental Clinics",
  dso: "Dental Clinics",
  ortho: "Dental Clinics",
  pedo: "Dental Clinics",
  oral: "Dental Clinics",
  health: "Medical Clinics",
  dental: "Dental Clinics",
  "dental practice": "Dental Clinics",
  "dental clinic": "Dental Clinics",
  clinic: "Medical Clinics",
  "medical clinic": "Medical Clinics",
  law: "Law Firms",
  "law firm": "Law Firms",
  realestate: "Residential Real Estate",
  "real estate": "Residential Real Estate",
  "auto repair": "Auto Service Centers"
};

export function normalizeOnboardingTaxonomy(data: OnboardingData | null | undefined): OnboardingData {
  const next: OnboardingData = { ...(data ?? {}) };
  const rawType = next.businessType?.trim() ?? "";
  const mappedType = LEGACY_BUSINESS_TYPE_TO_SUBINDUSTRY[rawType.toLowerCase()] ?? rawType;
  if (mappedType) next.businessType = mappedType;

  const expectedIndustry =
    targetIndustryForSubindustry(mappedType) ??
    (mappedType
      ? BROWSE_INDUSTRIES.find((industry) => getCategoriesForIndustry(industry).includes(mappedType))
      : undefined);
  if (expectedIndustry && !next.industry?.trim()) next.industry = expectedIndustry;
  return next;
}

export function onboardingTaxonomyMismatch(data: OnboardingData): { expected: string; actual: string } | null {
  const subindustry = data.businessType?.trim() ?? "";
  const actual = data.industry?.trim() ?? "";
  if (!subindustry || !actual) return null;

  const expectedTarget = targetIndustryForSubindustry(subindustry);
  if (expectedTarget && expectedTarget !== actual) return { expected: expectedTarget, actual };

  if ((BROWSE_INDUSTRIES as readonly string[]).includes(actual)) {
    const allowed = getCategoriesForIndustry(actual);
    if (allowed.length > 0 && !allowed.includes(subindustry)) {
      const expectedBrowse = BROWSE_INDUSTRIES.find((industry) =>
        getCategoriesForIndustry(industry).includes(subindustry)
      );
      return { expected: expectedBrowse ?? actual, actual };
    }
  }
  return null;
}

export function onboardingInvalidTargetSubindustry(data: OnboardingData): string | null {
  const industry = data.industry?.trim() ?? "";
  const subindustry = data.businessType?.trim() ?? "";
  if (!industry || !subindustry || !(BROWSE_INDUSTRIES as readonly string[]).includes(industry)) return null;
  const allowed = getCategoriesForIndustry(industry);
  return allowed.length > 0 && !allowed.includes(subindustry) ? subindustry : null;
}

function mergeOnboardingData(existing: OnboardingData | null, incoming: OnboardingData | undefined): OnboardingData {
  if (!incoming) return normalizeOnboardingTaxonomy(existing);
  return normalizeOnboardingTaxonomy({
    ...existing,
    ...incoming,
    software: incoming.software ?? existing?.software,
    challenges: incoming.challenges ?? existing?.challenges
  });
}

function parseOnboardingData(value: unknown): OnboardingData | null {
  if (!value || typeof value !== "object") return null;
  const parsed = onboardingDataSchema.safeParse(value);
  return parsed.success ? normalizeOnboardingTaxonomy(parsed.data) : null;
}

async function loadBuyerBusiness(userId: string) {
  const primaryId = await resolvePrimaryBusinessId(userId);
  return prisma.business.findFirst({ where: { id: primaryId ?? "" }, include: { profile: true } });
}

type RecommendationListing = {
  id: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  tags?: string[];
  industryTags?: string[];
  category?: string | null;
  priceCents?: number | null;
  pricingModel?: string | null;
  installCount?: number;
  architect?: { architectProfile?: { rating?: number | null } | null } | null;
};

function listingSearchText(listing: RecommendationListing) {
  return [
    listing.name,
    listing.shortDescription ?? "",
    listing.description ?? "",
    listing.category ?? "",
    ...(listing.industryTags ?? []),
    ...(listing.tags ?? [])
  ].join(" ").toLowerCase();
}

export function scoreListingForOnboarding(listing: RecommendationListing, data: OnboardingData) {
  const haystack = listingSearchText(listing);
  let score = 0;
  const matchedChallenges: string[] = [];
  const subindustry = data.businessType?.trim() ?? "";
  const industry = data.industry?.trim() ?? "";
  const taxonomyTags = Array.from(new Set([...(listing.industryTags ?? []), ...(listing.tags ?? [])]));

  if (subindustry) {
    if (listing.category?.trim().toLowerCase() === subindustry.toLowerCase()) score += 60;
    else if (tagsMatchVerticalCategory(taxonomyTags, subindustry)) score += 45;
  }

  if (industry && (BROWSE_INDUSTRIES as readonly string[]).includes(industry)) {
    const resolved = resolveBrowseIndustries(taxonomyTags);
    if (resolved.includes(industry as (typeof BROWSE_INDUSTRIES)[number])) score += 25;
  }

  for (const challenge of data.challenges ?? []) {
    const keywords = PAIN_KEYWORDS[challenge] ?? [challenge.replace(/-/g, " ")];
    if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      score += 10;
      matchedChallenges.push(challenge);
    }
  }

  score += Math.min((listing.installCount ?? 0) / 10, 5);
  score += listing.architect?.architectProfile?.rating ?? 0;
  return { score, matchedChallenges };
}

async function buildRecommendations(data: OnboardingData) {
  const listings = await prisma.agentListing.findMany({
    where: { status: "APPROVED" },
    include: {
      architect: { select: { architectProfile: { select: { rating: true } } } },
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
    const result = scoreListingForOnboarding(
      { ...listing, installCount: listing._count.installedAgents },
      data
    );
    return { listing, ...result };
  });
  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, 3);
  return selected.map(({ listing, matchedChallenges }) => ({
    id: listing.id,
    name: listing.name,
    description: listing.shortDescription ?? listing.description ?? "",
    priceCents: listing.priceCents ?? 0,
    pricingModel: (listing.pricingModel as string | null) ?? "subscription",
    /* NO INVENTED RATING (found by the platform audit, 2026-08-27). An
       architect with no rating was given 4.8 and it was shipped to a
       business as fact. null means "not rated yet", and a screen must say
       that rather than print a number nobody earned. */
    rating: listing.architect?.architectProfile?.rating || null,
    installCount: listing._count.installedAgents,
    matchedChallenges,
    tags: listing.tags ?? [],
    category: listing.category ?? null,
    industryTags: listing.industryTags ?? []
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
  const data = normalizeOnboardingTaxonomy(
    parseOnboardingData(params.business?.profile?.onboardingDataJson) ?? {
      businessType: params.business?.type ?? undefined
    }
  );
  const isLegacyExistingBusiness = Boolean(
    params.business &&
      (!params.business.profile ||
        (!params.business.profile.onboardingCompletedAt &&
          !params.business.profile.onboardingSkippedAt &&
          !params.business.profile.onboardingDataJson))
  );
  const completed = Boolean(params.business?.profile?.onboardingCompletedAt || isLegacyExistingBusiness);
  const skipped = Boolean(params.business?.profile?.onboardingSkippedAt);

  return {
    completed,
    skipped,
    displayName: params.user.fullName?.trim() || params.user.email.split("@")[0] || "there",
    businessId: params.business?.id ?? null,
    data: {
      businessName: data.businessName ?? params.business?.name ?? "",
      businessType: data.businessType ?? "",
      teamSize: data.teamSize ?? params.business?.profile?.businessSize ?? "",
      monthlyVolume: data.monthlyVolume ?? "",
      software: data.software ?? [],
      industry: data.industry ?? "",
      challenges: data.challenges ?? [],
      lastStep: data.lastStep ?? 1,
      skippedFrom: data.skippedFrom ?? null
    },
    recommendations: params.recommendations ?? []
  };
}

businessOnboardingRoutes.get("/", async (c) => {
  try {
    const authUser = c.get("authUser");
    const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { fullName: true, email: true } });
    if (!user) return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");

    const business = await loadBuyerBusiness(authUser.id);
    const data = normalizeOnboardingTaxonomy(parseOnboardingData(business?.profile?.onboardingDataJson));
    const recommendations = await buildRecommendations(data);
    return successResponse(c, serializeOnboardingResponse({ user, business, recommendations }), "Onboarding loaded");
  } catch {
    return errorResponse(c, "Could not load onboarding", 500, "ONBOARDING_LOAD_FAILED");
  }
});

businessOnboardingRoutes.post("/", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = saveOnboardingSchema.parse(await c.req.json());
    const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { fullName: true, email: true } });
    if (!user) return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");

    let business = await loadBuyerBusiness(authUser.id);
    const existingData = parseOnboardingData(business?.profile?.onboardingDataJson);
    const mergedData = mergeOnboardingData(existingData, input.data);
    const invalidSubindustry = onboardingInvalidTargetSubindustry(mergedData);
    if (invalidSubindustry) {
      return errorResponse(
        c,
        `${invalidSubindustry} is not an approved subindustry for ${mergedData.industry}.`,
        422,
        "INVALID_SUBINDUSTRY"
      );
    }

    const mismatch = onboardingTaxonomyMismatch(mergedData);
    if (mismatch) {
      return errorResponse(
        c,
        `${mergedData.businessType} belongs to ${mismatch.expected}, not ${mismatch.actual}.`,
        422,
        "SUBINDUSTRY_INDUSTRY_MISMATCH"
      );
    }

    const businessName = mergedData.businessName?.trim() || business?.name || user.fullName || "New Business";
    const businessType = mergedData.businessType?.trim() || business?.type || "Pending Setup";

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
      await prisma.business.update({ where: { id: business.id }, data: { name: businessName, type: businessType } });
      await prisma.businessProfile.upsert({
        where: { businessId: business.id },
        update: {
          businessSize: mergedData.teamSize ?? business.profile?.businessSize ?? null,
          onboardingDataJson: mergedData as never,
          ...(input.action === "complete" ? { onboardingCompletedAt: new Date(), onboardingSkippedAt: null } : {}),
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

    const recommendations = await buildRecommendations(mergedData);
    return successResponse(
      c,
      serializeOnboardingResponse({ user, business, recommendations }),
      input.action === "complete" ? "Onboarding completed" : input.action === "skip" ? "Onboarding skipped" : "Onboarding saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid onboarding input", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not save onboarding", 500, "ONBOARDING_SAVE_FAILED");
  }
});
