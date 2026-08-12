"use client";

import type { Route } from "next";
import { apiGet } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketplaceFeaturedSection } from "@/components/common/marketplace-featured-section";
import { CategoryTagsPill } from "@/components/common/category-tags-pill";
import {
  BUSINESS_AGENTS_PATH,
  BUSINESS_LOGIN_PATH,
  BUSINESS_MARKETPLACE_PATH,
  businessAgentDetailPath,
  businessCheckoutPath,
  businessSetupPath,
  publicAgentPath,
} from "@/lib/routes";
import {
  BROWSE_INDUSTRIES,
  BROWSE_INDUSTRY_ICONS,
  BROWSE_INDUSTRY_TILE_INITIAL_COUNT,
  browseIndustryFromSlug,
  browseIndustrySlug,
  getCategoriesForIndustry,
  getConnectorIncludedItem,
  getLlmIncludedItem,
  resolveBrowseIndustries,
  resolveBrowseIndustry,
  tagsMatchVerticalCategory,
  type BrowseIndustry,
} from "@coreai/shared";
import { getWorkflowFeatures } from "@/components/agent-description/shared/agent-listing";
import { X, Check, Download, Search, BotIcon } from "lucide-react";
import {
  ExecutionPricingSummary,
  useBuyerExecutionPricing,
  type BuyerExecutionPricingPayload,
} from "@/components/business/execution-pricing-summary";

type Agent = {
  id: string;
  name: string;
  category: string;
  industry: string;
  /** Human-readable industry labels from listing.industryTags (e.g. "Dental"). */
  industries: string[];
  description: string;
  price: number;
  installs: number;
  rating: number;
  author: string;
  isNew?: boolean;
  freeTrial?: boolean;
  tags: string[];
  requiredConnectors: string[];
  supportedLlms: string[];
  whatYouGet: string[];
  createdAt?: string;
  pricingModel?: string | null;
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
  /** Real listing icon from Configure; shown on marketplace cards. */
  iconUrl?: string | null;
  /** Admin-curated marketplace Featured slot. */
  featured?: boolean;
};

type ApiArchitectProfile = {
  title?: string | null;
  bio?: string | null;
  portfolioUrl?: string | null;
  skills?: string[];
  hourlyRateCents?: number | null;
  rating?: number | null;
  completedJobs?: number | null;
};

type ApiArchitect = {
  id?: string;
  fullName?: string | null;
  email?: string | null;
  architectProfile?: ApiArchitectProfile | null;
};

type ApiWorkflowNode = {
  data?: {
    label?: string;
    title?: string;
  };
};

type ApiWorkflow = {
  id?: string;
  name?: string;
  description?: string | null;
  isTemplate?: boolean;
  createdAt?: string;
  updatedAt?: string;
  workflowJson?: {
    nodes?: ApiWorkflowNode[];
  } | null;
};

type ApiListing = {
  id: string;
  architectUserId?: string;
  workflowId?: string | null;
  name: string;
  shortDescription?: string;
  description?: string | null;
  priceCents?: number | null;
  status?: string;
  tags?: string[];
  industryTags?: string[];
  category?: string | null;
  requiredConnectors?: string[];
  supportedLlms?: string[];
  createdAt?: string;
  updatedAt?: string;
  installCount?: number;
  architect?: ApiArchitect | null;
  workflow?: ApiWorkflow | null;
  pricingModel?: string | null;
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
  iconUrl?: string | null;
  includedFeatures?: string[];
  capabilities?: string[];
};

type ListingsApiResponse = {
  success?: boolean;
  message?: string;
  data?: {
    listings?: ApiListing[];
  };
  listings?: ApiListing[];
};

type MyAgentsResponse = {
  agents?: Array<{
    installedAgentId?: string | null;
    installedAgentStatus?: string | null;
    listing: {
      id: string;
    };
  }>;
};

type Industry = {
  id: string;
  label: string;
  count: number;
  icon: string;
};

const LISTINGS_API_PATH = "/architect/listings/public";
const PRICE_MAX_DEFAULT = 10000;

const sortOptions = [
  { value: "popular", label: "Most popular" },
  { value: "priceLow", label: "Price: low to high" },
  { value: "priceHigh", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
] as const;

type SortValue = (typeof sortOptions)[number]["value"];
type OpenFilter = "industry" | "subCategory" | "price" | "rating" | "sort" | null;

const baseIndustries: Omit<Industry, "count">[] = [
  { id: "all", label: "All industries", icon: "✨" },
  { id: "dental", label: "Dental", icon: "🦷" },
  { id: "hvac", label: "HVAC & Plumbing", icon: "🔧" },
  { id: "realestate", label: "Real Estate", icon: "🏠" },
  { id: "legal", label: "Legal", icon: "⚖️" },
  { id: "medical", label: "Medical & Wellness", icon: "❤️" },
  { id: "automotive", label: "Automotive", icon: "🚗" },
  { id: "ecommerce", label: "E-commerce", icon: "🛍️" },
  { id: "spa-wellness", label: "Spa & Wellness", icon: "🌿" },
];

const filterIndustries: Omit<Industry, "count">[] = [
  { id: "all", label: "All industries", icon: "✨" },
  { id: "dental", label: "Dental", icon: "🦷" },
  { id: "medical-clinic", label: "Medical Clinic", icon: "🏥" },
  { id: "dermatology", label: "Dermatology", icon: "🧴" },
  { id: "physiotherapy", label: "Physiotherapy", icon: "🦵" },
  { id: "chiropractor", label: "Chiropractor", icon: "🦴" },
  { id: "optometry", label: "Optometry", icon: "👓" },
  { id: "veterinary", label: "Veterinary", icon: "🐾" },
  { id: "med-spa", label: "Med Spa", icon: "💆" },
  { id: "salon", label: "Salon", icon: "💇" },
  { id: "barbershop", label: "Barbershop", icon: "💈" },
  { id: "spa-wellness", label: "Spa & Wellness", icon: "🌿" },
  { id: "yoga-studio", label: "Yoga Studio", icon: "🧘" },
  { id: "gym-fitness", label: "Gym / Fitness", icon: "🏋️" },
  { id: "legal", label: "Law Firm", icon: "⚖️" },
  { id: "plumber", label: "Plumber", icon: "🚰" },
  { id: "hvac", label: "HVAC", icon: "❄️" },
  { id: "electrician", label: "Electrician", icon: "💡" },
  { id: "garage-door", label: "Garage Door", icon: "🚪" },
  { id: "roofing", label: "Roofing", icon: "🏠" },
  { id: "landscaping", label: "Landscaping", icon: "🌳" },
  { id: "pool-service", label: "Pool Service", icon: "🏊" },
  { id: "realestate", label: "Real Estate", icon: "🏡" },
  { id: "auto-repair", label: "Auto Repair", icon: "🔧" },
  { id: "restaurant", label: "Restaurant", icon: "🍽️" },
  { id: "insurance", label: "Insurance", icon: "🛡️" },
  { id: "mortgage-broker", label: "Mortgage Broker", icon: "🏦" },
  { id: "urgent-care", label: "Urgent Care", icon: "🚑" },
  { id: "senior-care", label: "Senior Care", icon: "👵" },
  { id: "property-management", label: "Property Management", icon: "🏢" },
  { id: "ecommerce", label: "E-commerce", icon: "🛍️" },
];

const industryAliasByTag: Record<string, string> = {
  dental: "dental",
  medical: "medical-clinic",
  "medical-clinic": "medical-clinic",
  dermatology: "dermatology",
  physiotherapy: "physiotherapy",
  chiropractor: "chiropractor",
  optometry: "optometry",
  veterinary: "veterinary",
  vet: "veterinary",
  "med-spa": "med-spa",
  "mea-spa": "med-spa",
  salon: "salon",
  barbershop: "barbershop",
  "barber-shop": "barbershop",
  "spa-wellness": "spa-wellness",
  wellness: "spa-wellness",
  "yoga-studio": "yoga-studio",
  yoga: "yoga-studio",
  "gym-fitness": "gym-fitness",
  gym: "gym-fitness",
  fitness: "gym-fitness",
  "law-firm": "legal",
  legal: "legal",
  law: "legal",
  plumber: "plumber",
  plumbing: "plumber",
  hvac: "hvac",
  electrician: "electrician",
  "garage-door": "garage-door",
  roofing: "roofing",
  landscaping: "landscaping",
  "pool-service": "pool-service",
  "real-estate": "realestate",
  realestate: "realestate",
  "auto-repair": "auto-repair",
  automotive: "auto-repair",
  restaurant: "restaurant",
  insurance: "insurance",
  "mortgage-broker": "mortgage-broker",
  "urgent-care": "urgent-care",
  "senior-care": "senior-care",
  "property-management": "property-management",
  ecommerce: "ecommerce",
  "e-commerce": "ecommerce",
};

const broadIndustryGroups: Record<string, string[]> = {
  dental: ["dental"],
  hvac: ["hvac", "plumber"],
  realestate: ["realestate", "mortgage-broker", "property-management"],
  legal: ["legal"],
  medical: [
    "medical-clinic",
    "dermatology",
    "physiotherapy",
    "chiropractor",
    "optometry",
    "veterinary",
    "urgent-care",
    "senior-care",
  ],
  automotive: ["auto-repair"],
  ecommerce: ["ecommerce"],
  "spa-wellness": ["spa-wellness", "med-spa", "salon", "barbershop", "yoga-studio", "gym-fitness"],
};

function filterPillClass(active: boolean) {
  return [
    "inline-flex shrink-0 items-center gap-1.5 rounded-xl border bg-white px-3.5 py-2 text-sm font-medium transition",
    active
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : "border-gray-200 text-slate-600 hover:border-amber-300 hover:text-slate-900",
  ].join(" ");
}

function popoverOptionClass(active: boolean) {
  return [
    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
    active
      ? "bg-amber-50 font-semibold text-amber-700"
      : "text-slate-600 hover:bg-amber-50 hover:text-amber-700",
  ].join(" ");
}

function viewButtonClass(active: boolean) {
  return [
    "grid h-8 w-8 place-items-center rounded-md transition",
    active ? "bg-amber-50 text-amber-600" : "text-slate-400 hover:text-slate-700",
  ].join(" ");
}

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.2 4.2L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

function normalizeFilterValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatLabel(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeIndustryId(value: string) {
  const normalized = normalizeFilterValue(value);
  return industryAliasByTag[normalized] ?? normalized;
}

function industryMatchesFilter(agentIndustry: string, selectedIndustry: string) {
  if (selectedIndustry === "all" || agentIndustry === "all") return true;
  if (agentIndustry === selectedIndustry) return true;
  return broadIndustryGroups[selectedIndustry]?.includes(agentIndustry) ?? false;
}

function agentMatchesIndustry(agent: Agent, industryId: string) {
  if (industryId === "all") return true;
  const browse = browseIndustryFromSlug(industryId);
  if (browse) {
    return resolveBrowseIndustries(agent.industries).includes(browse);
  }
  if (industryMatchesFilter(agent.industry, industryId)) return true;
  return agent.industries.some((label) =>
    industryMatchesFilter(normalizeIndustryId(label), industryId),
  );
}

function getIndustryAgentCount(industryId: string, agents: Agent[]) {
  if (industryId === "all") return agents.length;
  return agents.filter((agent) => agentMatchesIndustry(agent, industryId)).length;
}

function isIndustryAvailable(id: string, agents: Agent[]) {
  if (id === "all") return true;
  return getIndustryAgentCount(id, agents) > 0;
}

function buildBrowseIndustryTiles(agents: Agent[]): Industry[] {
  return BROWSE_INDUSTRIES.map((label) => {
    const id = browseIndustrySlug(label);
    return {
      id,
      label,
      icon: BROWSE_INDUSTRY_ICONS[label],
      count: getIndustryAgentCount(id, agents),
    };
  });
}

function resolveSelectedBrowseIndustry(
  industryId: string,
  options: Omit<Industry, "count">[] | Industry[],
): BrowseIndustry | null {
  if (industryId === "all") return null;
  const fromSlug = browseIndustryFromSlug(industryId);
  if (fromSlug) return fromSlug;
  const label = options.find((item) => item.id === industryId)?.label;
  if (label) return resolveBrowseIndustry(label);
  return resolveBrowseIndustry(industryId);
}

/** First chip on marketplace agent cards: browse industry label. */
function getCardIndustryLabel(agent: Agent): string {
  const fromBrowse = resolveBrowseIndustries(agent.industries);
  if (fromBrowse[0]) return fromBrowse[0];
  const fromSlug = browseIndustryFromSlug(agent.industry);
  if (fromSlug) return fromSlug;
  const raw = (agent.industries[0] ?? "").trim();
  if (raw && raw.toLowerCase() !== "all") return raw;
  return "";
}

/** Category chips on marketplace agent cards (all selected categories). */
function getCardCategoryLabels(agent: Agent): string[] {
  const raw = (agent.category ?? "").trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    )
  ];
}

/** Prefer AgentListing.industryTags; fall back to legacy industry:/plain tags. */
function getAgentIndustries(listing: ApiListing): string[] {
  const fromIndustryTags = (listing.industryTags ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (fromIndustryTags.length > 0) {
    return Array.from(new Set(fromIndustryTags));
  }

  const tags = listing.tags ?? [];
  const prefixed = tags
    .filter((tag) => tag.toLowerCase().startsWith("industry:"))
    .map((tag) => tag.replace(/^industry:/i, "").trim())
    .filter(Boolean);
  if (prefixed.length > 0) {
    return Array.from(new Set(prefixed));
  }

  return [];
}

function getAgentIndustry(listing: ApiListing) {
  const industries = getAgentIndustries(listing);
  if (industries.length > 0) {
    return normalizeIndustryId(industries[0]);
  }

  const tags = listing.tags ?? [];
  const industryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("industry:")) ??
    tags.find((tag) => Boolean(industryAliasByTag[normalizeFilterValue(tag)]));

  if (!industryTag) return "all";

  return normalizeIndustryId(industryTag.replace(/^industry:/i, ""));
}

function getAgentCategory(listing: ApiListing) {
  if (listing.category?.trim()) {
    return formatLabel(listing.category.trim());
  }

  const industrySet = new Set(getAgentIndustries(listing).map((tag) => tag.toLowerCase()));
  const tags = listing.tags ?? [];

  const categoryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
    tags.find((tag) => {
      const lower = tag.toLowerCase();
      if (lower.startsWith("industry:")) return false;
      return !industrySet.has(lower);
    });

  if (categoryTag) {
    return formatLabel(categoryTag.replace(/^category:/i, ""));
  }

  return "Uncategorized";
}

function isRecentlyCreated(createdAt?: string) {
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();

  if (Number.isNaN(createdTime)) return false;

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  return Date.now() - createdTime <= thirtyDays;
}

function getWhatYouGetItems(listing: ApiListing): string[] {
  return getWorkflowFeatures(listing as any);
}

function mapListingToAgent(listing: ApiListing): Agent {
  const profile = listing.architect?.architectProfile;

  const industries = getAgentIndustries(listing);

  return {
    id: listing.id,
    name: listing.name,
    category: getAgentCategory(listing),
    industry: getAgentIndustry(listing),
    industries,
    description:
      listing.shortDescription ||
      listing.description ||
      listing.workflow?.description ||
      "This AI agent is ready to help automate business workflows.",
    price: Math.round((listing.priceCents ?? 0) / 100),
    installs: listing.installCount ?? 0,
    rating: profile?.rating ?? 0,
    author:
      listing.architect?.fullName ||
      profile?.title ||
      listing.architect?.email ||
      "Triven Architect",
    isNew: isRecentlyCreated(listing.createdAt),
    featured: Boolean((listing as { featured?: boolean }).featured),
    freeTrial:
      (listing.priceCents ?? 0) === 0 ||
      listing.pricingModel === "FREE" ||
      Boolean(listing.freeTrialEnabled),
    tags: listing.tags ?? [],
    requiredConnectors: listing.requiredConnectors ?? [],
    supportedLlms: listing.supportedLlms ?? [],
    whatYouGet: getWhatYouGetItems(listing),
    createdAt: listing.createdAt,
    pricingModel: listing.pricingModel,
    freeTrialEnabled: listing.freeTrialEnabled,
    trialDays: listing.trialDays,
    iconUrl: listing.iconUrl?.trim() || null,
  };
}

/** Speech-bubble-with-dots fallback matching the marketplace card reference. */
function AgentCardIcon({ iconUrl, size = 12 }: { iconUrl?: string | null; size?: 12 | 14 }) {
  const box = size === 14 ? "h-14 w-14 rounded-2xl" : "h-12 w-12 rounded-xl";
  const svg = size === 14 ? "h-7 w-7" : "h-6 w-6";

  if (iconUrl) {
    return (
      <span
        className={`relative grid ${box} shrink-0 place-items-center overflow-hidden bg-amber-50 ring-1 ring-amber-100`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- listing icons may be data URLs */}
        <img src={iconUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      className={`grid ${box} shrink-0 place-items-center bg-amber-50 text-amber-600 ring-1 ring-amber-100`}
    >
      <svg
        className={svg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

function buildIndustriesWithCounts(agents: Agent[]): Industry[] {
  return [
    { id: "all", label: "All industries", icon: "✨", count: agents.length },
    ...buildBrowseIndustryTiles(agents),
  ];
}
function buildFilterIndustriesWithCounts(agents: Agent[]): Industry[] {
  return filterIndustries.map((item) => ({
    ...item,
    count: getIndustryAgentCount(item.id, agents),
  }));
}

export default function MarketplacePage() {
    const router = useRouter();
    const agentListRef = useRef<HTMLElement>(null);

  const [authReady, setAuthReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [query, setQuery] = useState("");
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState<SortValue>("popular");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [freeTrialOnly, setFreeTrialOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [openFilter, setOpenFilter] = useState<OpenFilter>(null);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(PRICE_MAX_DEFAULT);
  const [minRating, setMinRating] = useState(0);
  const [detailsAgent, setDetailsAgent] = useState<Agent | null>(null);
  const [ownedListingIds, setOwnedListingIds] = useState<Set<string>>(() => new Set());
  const [setupPendingListingIds, setSetupPendingListingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showAllBrowseIndustries, setShowAllBrowseIndustries] = useState(false);
  const [subCategory, setSubCategory] = useState("all");

  const scrollToAgents = useCallback(() => {
    agentListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const timer = window.setTimeout(() => {
      scrollToAgents();
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, scrollToAgents]);

  const {
    pricing: executionPricing,
    loading: executionPricingLoading,
    error: executionPricingError,
  } = useBuyerExecutionPricing();

  useEffect(() => {
    const token = localStorage.getItem("coreai-token") || localStorage.getItem("coreai_token");

    const userRaw = localStorage.getItem("coreai-user") || localStorage.getItem("coreai_user");

    let user: { role?: string; roles?: string[] } | null = null;

    try {
      user = userRaw ? JSON.parse(userRaw) : null;
    } catch {
      user = null;
    }

    // Capability check: dual-role accounts (e.g. ARCHITECT + BUSINESS)
    // keep their session — only truly unauthenticated visitors are
    // cleared and sent to login.
    const hasBusinessCapability =
      user?.role === "BUSINESS" || (Array.isArray(user?.roles) && user.roles.includes("BUSINESS"));

    if (!token || !hasBusinessCapability) {
      localStorage.removeItem("coreai-token");
      localStorage.removeItem("coreai_token");
      localStorage.removeItem("coreai-user");
      localStorage.removeItem("coreai_user");
      sessionStorage.clear();
      router.replace(BUSINESS_LOGIN_PATH);
      return;
    }

    setAuthReady(true);
  }, [router]);

  useEffect(() => {
    if (!authReady) return;

    let mounted = true;

    async function loadListings() {
      try {
        setIsLoading(true);
        setApiError("");

        const response = (await apiGet<ListingsApiResponse>(
          LISTINGS_API_PATH,
        )) as ListingsApiResponse;

        const listings = response?.data?.listings ?? response?.listings ?? [];

        if (!mounted) return;

        setAgents(listings.map(mapListingToAgent));
      } catch (error) {
        console.error(error);

        if (!mounted) return;

        setApiError(error instanceof Error ? error.message : "Could not load marketplace agents");
        setAgents([]);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadListings();

    return () => {
      mounted = false;
    };
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;

    let mounted = true;

    async function loadOwnedAgents() {
      try {
        const response = await apiGet<MyAgentsResponse>("/payments/my-agents");

        if (!mounted || !response.success) return;

        const entries = response.data?.agents ?? [];
        const ownedIds = new Set(entries.map((entry) => entry.listing.id));
        // Setup not finished yet: either never installed, or installed
        // automatically at purchase/trial time but not taken live
        // (auto-installs start as PROVISIONING until Go live).
        const pendingIds = new Set(
          entries
            .filter(
              (entry) =>
                !entry.installedAgentId ||
                !["ACTIVE", "PAUSED"].includes(entry.installedAgentStatus ?? ""),
            )
            .map((entry) => entry.listing.id),
        );

        setOwnedListingIds(ownedIds);
        setSetupPendingListingIds(pendingIds);
      } catch {
        if (mounted) {
          setOwnedListingIds(new Set());
          setSetupPendingListingIds(new Set());
        }
      }
    }

    loadOwnedAgents();

    return () => {
      mounted = false;
    };
  }, [authReady]);

  function isOwnedAgent(listingId: string) {
    return ownedListingIds.has(listingId);
  }

  function needsSetup(listingId: string) {
    return setupPendingListingIds.has(listingId);
  }

  useEffect(() => {
    if (!openFilter) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const trigger = document.querySelector(`[data-filter-trigger="${openFilter}"]`);
      const panel = document.querySelector(`[data-filter-panel="${openFilter}"]`);

      if (trigger?.contains(target) || panel?.contains(target)) return;

      setOpenFilter(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFilter(null);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openFilter]);

  function openAgentPage(agent: Agent) {
    router.push(businessAgentDetailPath(agent.id));
  }

  function openDetailsModal(agent: Agent) {
    setDetailsAgent(agent);
  }

  function closeDetailsModal() {
    setDetailsAgent(null);
  }

  const industries = useMemo(() => buildIndustriesWithCounts(agents), [agents]);
  const filterIndustryOptions = useMemo(
    () => [
      { id: "all", label: "All industries", icon: "✨", count: agents.length },
      ...buildBrowseIndustryTiles(agents),
    ],
    [agents],
  );
  // Admin-curated only: with nothing featured, the slot is hidden rather
  // than silently promoting whichever agent happened to sort first.
  const featuredAgent = agents.find((agent) => agent.featured) ?? null;

  const selectedBrowseIndustry = useMemo(
    () => resolveSelectedBrowseIndustry(industry, filterIndustryOptions),
    [industry, filterIndustryOptions],
  );

  const subCategoryOptions = useMemo(
    () => (selectedBrowseIndustry ? [...getCategoriesForIndustry(selectedBrowseIndustry)] : []),
    [selectedBrowseIndustry],
  );

  useEffect(() => {
    setSubCategory("all");
  }, [industry]);

  const industryLabel =
    filterIndustryOptions.find((item) => item.id === industry)?.label ??
    industries.find((item) => item.id === industry)?.label ??
    "All industries";

  const sortLabel = sortOptions.find((item) => item.value === sort)?.label ?? "Most popular";

  const priceActive = priceMin !== 0 || priceMax !== PRICE_MAX_DEFAULT;
  const ratingActive = minRating > 0;

  const activeFilters = [
    query.trim() ? { key: "query", label: `"${query.trim()}"` } : null,
    industry !== "all" ? { key: "industry", label: industryLabel } : null,
    subCategory !== "all" ? { key: "subCategory", label: subCategory } : null,
    priceActive
      ? {
          key: "price",
          label: priceMax >= 200 ? `$${priceMin}+` : `$${priceMin}–$${priceMax}`,
        }
      : null,
    ratingActive ? { key: "rating", label: `${minRating}.0+ ★` } : null,
    freeTrialOnly ? { key: "free", label: "Free trial" } : null,
    newOnly ? { key: "new", label: "New this month" } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  function clearFilter(key: string) {
    if (key === "query") setQuery("");
    if (key === "industry") {
      setIndustry("all");
      setSubCategory("all");
    }
    if (key === "subCategory") setSubCategory("all");
    if (key === "price") {
      setPriceMin(0);
      setPriceMax(PRICE_MAX_DEFAULT);
    }
    if (key === "rating") setMinRating(0);
    if (key === "free") setFreeTrialOnly(false);
    if (key === "new") setNewOnly(false);
  }

  function clearAllFilters() {
    setQuery("");
    setIndustry("all");
    setSubCategory("all");
    setPriceMin(0);
    setPriceMax(PRICE_MAX_DEFAULT);
    setMinRating(0);
    setFreeTrialOnly(false);
    setNewOnly(false);
    setOpenFilter(null);
  }

  const filteredAgents = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    const filtered = agents.filter((agent) => {
      const matchesQuery =
        !cleanQuery ||
        `${agent.name} ${agent.category} ${agent.description} ${agent.tags.join(" ")} ${agent.requiredConnectors.join(" ")} ${agent.supportedLlms.join(" ")}`
          .toLowerCase()
          .includes(cleanQuery);

      const matchesIndustry = industry === "all" || agentMatchesIndustry(agent, industry);
      const matchesSubCategory =
        subCategory === "all" || tagsMatchVerticalCategory(agent.industries, subCategory);

      const matchesPrice =
        agent.price >= priceMin && (priceMax >= PRICE_MAX_DEFAULT || agent.price <= priceMax);
      const matchesRating = agent.rating >= minRating;
      const matchesTrial = !freeTrialOnly || agent.freeTrial;
      const matchesNew = !newOnly || agent.isNew;

      return (
        matchesQuery &&
        matchesIndustry &&
        matchesSubCategory &&
        matchesPrice &&
        matchesRating &&
        matchesTrial &&
        matchesNew
      );
    });

    return filtered.sort((a, b) => {
      if (sort === "priceLow") return a.price - b.price;
      if (sort === "priceHigh") return b.price - a.price;
      if (sort === "newest") {
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      }

      return b.installs - a.installs;
    });
  }, [agents, query, industry, subCategory, priceMin, priceMax, minRating, sort, freeTrialOnly, newOnly]);

  if (!authReady) {
    return <main className="min-h-screen bg-white" />;
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <nav className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 py-2.5 sm:px-4">
          <div className="relative mx-auto max-w-3xl">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400  z-10">
              <Search className="h-4 w-4" />
            </span>

            <input
              data-testid="business-marketplace-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query.trim()) {
                  event.preventDefault();
                  scrollToAgents();
                }
              }}
              placeholder="Search agents by name, industry, or problem..."
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3 pl-12 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
            />
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50">
        <div className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-3 py-8 sm:px-4 sm:py-10">
          <div className="mx-auto max-w-3xl text-center">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700"
              data-testid="business-protected-marketplace-live-marketplace-agents-text"
            >
              ✨ Live marketplace agents
            </span>

            <h1
              className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl"
              data-testid="business-protected-marketplace-ai-agents-that-work-while-you-sleep-heading"
            >
              AI Agents That Work
              <br className="hidden sm:block" /> While You Sleep
            </h1>

            <p
              className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 sm:text-xl"
              data-testid="business-protected-marketplace-browse-pre-built-ai-agents-install-in-text"
            >
              Browse pre-built AI agents. Install in minutes. No code required.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              <Metric label="Agents" value={`${agents.length}`} />
              <Metric label="Industries" value={`${Math.max(industries.length - 1, 0)}`} />

              <Metric label="Average rating" value={"4.9 ⭐"} />
            </div>
          </div>

          <section className="bg-white py-8 sm:py-10 mt-8 sm:mt-10">
            <div className="mx-auto max-w-6xl px-3 sm:px-4">
              <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900">Browse by industry</h2>
                <p className="mt-2 text-slate-600">
                  Find agents built specifically for your business type.
                </p>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {industries
                  .filter((item) => item.id !== "all")
                  .slice(
                    0,
                    showAllBrowseIndustries
                      ? undefined
                      : BROWSE_INDUSTRY_TILE_INITIAL_COUNT,
                  )
                  .map((item) => {
                    const hasAgents = item.count > 0;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!hasAgents}
                        data-testid={`marketplace-industry-${item.id}`}
                        onClick={() => {
                          if (!hasAgents) return;
                          setIndustry(item.id);
                          setSubCategory("all");
                          scrollToAgents();
                        }}
                        className={`group relative rounded-2xl border bg-white p-6 text-center shadow-sm transition-all duration-300 ${
                          hasAgents
                            ? `hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg ${
                                industry === item.id
                                  ? "border-amber-300 ring-4 ring-amber-100"
                                  : "border-gray-100"
                              }`
                            : "cursor-not-allowed border-gray-100 opacity-70"
                        }`}
                      >
                        <span
                          className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl transition ${
                            hasAgents
                              ? "bg-amber-50 group-hover:scale-105 group-hover:bg-amber-500"
                              : "bg-slate-100 grayscale"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <p className="mt-3 font-semibold text-slate-900">{item.label}</p>
                        <p className="text-sm text-slate-500">
                          {hasAgents ? `${item.count} agents` : "Coming soon"}
                        </p>
                      </button>
                    );
                  })}
              </div>

              {industries.filter((item) => item.id !== "all").length >
              BROWSE_INDUSTRY_TILE_INITIAL_COUNT ? (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    data-testid="marketplace-browse-industry-show-more"
                    onClick={() => setShowAllBrowseIndustries((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 px-8 py-3 font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
                  >
                    {showAllBrowseIndustries ? "Show less" : "Show More"}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          {featuredAgent ? (
            <MarketplaceFeaturedSection
              agent={featuredAgent}
              testIds={{
                badge: "business-protected-marketplace-featured-text",
                category: "business-protected-marketplace-featured-agent-category-text",
                title: "business-protected-marketplace-featured-agent-heading",
                description: "business-protected-marketplace-featured-agent-description-text",
                price: "business-protected-marketplace-featured-agent-price-text",
                avatar: "business-protected-marketplace-ai-text",
                phoneName: "business-protected-marketplace-featured-agent-text",
                activeNow: "business-protected-marketplace-active-now-text"
              }}
              primaryAction={
                isOwnedAgent(featuredAgent.id) ? (
                  <Link
                    href={
                      needsSetup(featuredAgent.id)
                        ? businessSetupPath(featuredAgent.id)
                        : BUSINESS_AGENTS_PATH
                    }
                    data-testid="business-marketplace-featured-manage-agent"
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                  >
                    {needsSetup(featuredAgent.id) ? "Continue Setup" : "Manage agent"}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAgentPage(featuredAgent)}
                    data-testid="business-marketplace-featured-open"
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
                  >
                    {featuredAgent.pricingModel === "FREE"
                      ? "Install Agent"
                      : featuredAgent.freeTrialEnabled && (featuredAgent.trialDays ?? 7) > 0
                        ? `Start ${featuredAgent.trialDays ?? 7} days free trial`
                        : featuredAgent.pricingModel === "ONE_TIME"
                          ? "Get It Now"
                          : "Get Access Instantly"}
                  </button>
                )
              }
              secondaryAction={
                <button
                  type="button"
                  onClick={() => openDetailsModal(featuredAgent)}
                  data-testid="business-marketplace-featured-details"
                  className="rounded-xl border-2 border-gray-200 px-5 py-3 font-semibold text-slate-700 transition hover:border-amber-300 hover:text-amber-600"
                >
                  View details
                </button>
              }
            />
          ) : null}
        </div>
      </section>

      <section className="sticky top-[73px] z-20 overflow-visible border-y border-gray-100 bg-white/95 backdrop-blur transition-shadow">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          <div className="relative flex flex-col gap-3 overflow-visible py-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "industry" ? null : "industry")}
                  data-testid="marketplace-filter-industry"
                  data-filter-trigger="industry"
                  className={filterPillClass(industry !== "all")}
                  aria-haspopup="true"
                  aria-expanded={openFilter === "industry"}
                >
                  <span>{industryLabel}</span>
                  <ChevronIcon open={openFilter === "industry"} />
                </button>

                {openFilter === "industry" ? (
                  <div
                    data-filter-panel="industry"
                    className="
        absolute top-full z-[90] mt-2
        left-1/2 -translate-x-1/2
        sm:left-0 sm:translate-x-0

        w-[calc(100vw-2rem)]
        max-w-xs
        sm:w-72

        max-h-80 overflow-y-auto overscroll-contain
        rounded-2xl border border-slate-100 bg-white p-2
        shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]
    "
                  >
                    {filterIndustryOptions.map((item) => {
                      const unlocked = isIndustryAvailable(item.id, agents);

                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={!unlocked}
                          data-testid={`marketplace-industry-option-${item.id}`}
                          onClick={() => {
                            if (!unlocked) return;
                            setIndustry(item.id);
                            setSubCategory("all");
                            setOpenFilter(null);
                          }}
                          className={
                            unlocked
                              ? popoverOptionClass(industry === item.id)
                              : "flex w-full cursor-not-allowed items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-400 opacity-70"
                          }
                        >
                          <span>{item.label}</span>

                          <span className="text-xs text-slate-400">
                            {unlocked ? item.count : "Coming soon"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {subCategoryOptions.length > 0 ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenFilter(openFilter === "subCategory" ? null : "subCategory")}
                    data-testid="marketplace-filter-subcategory"
                    data-filter-trigger="subCategory"
                    className={filterPillClass(subCategory !== "all")}
                    aria-haspopup="true"
                    aria-expanded={openFilter === "subCategory"}
                  >
                    <span>{subCategory === "all" ? "Category" : subCategory}</span>
                    <ChevronIcon open={openFilter === "subCategory"} />
                  </button>

                  {openFilter === "subCategory" ? (
                    <div
                      data-filter-panel="subCategory"
                      data-testid="marketplace-subcategory-filters"
                      className="
        absolute top-full z-[90] mt-2
        left-1/2 -translate-x-1/2
        sm:left-0 sm:translate-x-0

        w-[calc(100vw-2rem)]
        max-w-xs
        sm:w-72

        max-h-80 overflow-y-auto overscroll-contain
        rounded-2xl border border-slate-100 bg-white p-2
        shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]
    "
                    >
                      <button
                        type="button"
                        data-testid="marketplace-subcategory-all"
                        onClick={() => {
                          setSubCategory("all");
                          setOpenFilter(null);
                        }}
                        className={popoverOptionClass(subCategory === "all")}
                      >
                        <span>All categories</span>
                      </button>
                      {subCategoryOptions.map((option) => {
                        const slug = option.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                        return (
                          <button
                            key={option}
                            type="button"
                            data-testid={`marketplace-subcategory-${slug}`}
                            onClick={() => {
                              setSubCategory(option);
                              setOpenFilter(null);
                            }}
                            className={popoverOptionClass(subCategory === option)}
                          >
                            <span>{option}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "price" ? null : "price")}
                  data-testid="marketplace-filter-price"
                  data-filter-trigger="price"
                  className={filterPillClass(priceActive)}
                  aria-haspopup="true"
                  aria-expanded={openFilter === "price"}
                >
                  <span>
                    {priceActive
                      ? priceMax >= PRICE_MAX_DEFAULT
                        ? `$${priceMin}+`
                        : `$${priceMin}–$${priceMax}`
                      : "Price"}
                  </span>
                  <ChevronIcon open={openFilter === "price"} />
                </button>

                {openFilter === "price" ? (
                  <div
                    data-filter-panel="price"
                    className="
        absolute top-full z-50 mt-2
        left-1/2 -translate-x-1/2
        sm:left-0 sm:translate-x-0

        w-[calc(100vw-2rem)]
        max-w-sm
        sm:w-80

        rounded-2xl
        border border-slate-100
        bg-white
        p-4

        shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]
    "
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">Price range</span>

                      <button
                        type="button"
                        onClick={() => {
                          setPriceMin(0);
                          setPriceMax(PRICE_MAX_DEFAULT);
                        }}
                        data-testid="marketplace-price-reset"
                        className="text-xs font-medium text-amber-600 transition hover:text-amber-700"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mb-3 flex items-center justify-between text-sm text-slate-600">
                      <span>${priceMin}</span>
                      <span>{priceMax >= PRICE_MAX_DEFAULT ? "Any" : `$${priceMax}`}</span>
                    </div>

                    <div className="relative h-10 px-2">
                      <div className="absolute left-2 right-2 top-4 h-1 rounded-full bg-slate-200" />

                      <div
                        className="absolute top-4 h-1 rounded-full bg-amber-500"
                        style={{
                          left: `${Math.min((priceMin / 500) * 100, 100)}%`,
                          width: `${Math.min(
                            ((Math.min(priceMax, 500) - priceMin) / 500) * 100,
                            100,
                          )}%`,
                        }}
                      />

                      <input
                        type="range"
                        min={0}
                        max={500}
                        step={10}
                        value={Math.min(priceMin, 500)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setPriceMin(Math.min(value, Math.min(priceMax, 500)));
                        }}
                        className="pointer-events-none absolute left-0 top-2 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
                        aria-label="Minimum price"
                      />

                      <input
                        type="range"
                        min={0}
                        max={500}
                        step={10}
                        value={Math.min(priceMax, 500)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setPriceMax(value >= 500 ? PRICE_MAX_DEFAULT : Math.max(value, priceMin));
                        }}
                        className="pointer-events-none absolute left-0 top-2 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
                        aria-label="Maximum price"
                      />
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {[
                        { label: "Under $80", min: 0, max: 80 },
                        { label: "$80–200", min: 80, max: 200 },
                        { label: "$200+", min: 200, max: PRICE_MAX_DEFAULT },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setPriceMin(preset.min);
                            setPriceMax(preset.max);
                          }}
                          data-testid={`marketplace-price-preset-${preset.min}-${preset.max}`}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setFreeTrialOnly((current) => !current)}
                data-testid="marketplace-filter-free-trial"
                className={filterPillClass(freeTrialOnly)}
              >
                Free trial
              </button>

              <button
                type="button"
                onClick={() => setNewOnly((current) => !current)}
                data-testid="marketplace-filter-new"
                className={filterPillClass(newOnly)}
              >
                New this month
              </button>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 sm:ml-auto sm:justify-end sm:pl-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 p-0.5">
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  data-testid="marketplace-view-grid"
                  className={viewButtonClass(view === "grid")}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                >
                  <GridIcon />
                </button>

                <button
                  type="button"
                  onClick={() => setView("list")}
                  data-testid="marketplace-view-list"
                  className={viewButtonClass(view === "list")}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                >
                  <ListIcon />
                </button>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenFilter(openFilter === "sort" ? null : "sort")}
                  data-testid="business-marketplace-filter-sort"
                  data-filter-trigger="sort"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:border-amber-300 hover:text-slate-900"
                  aria-haspopup="true"
                  aria-expanded={openFilter === "sort"}
                >
                  Sort:
                  <span className="font-semibold text-slate-800">{sortLabel}</span>
                  <ChevronIcon open={openFilter === "sort"} />
                </button>

                {openFilter === "sort" ? (
                  <div
                    data-filter-panel="sort"
                    className="
        absolute top-full z-50 mt-2
        right-0
        left-auto

        w-[calc(100vw-2rem)]
        max-w-xs
        sm:w-64

        rounded-2xl border border-slate-100 bg-white p-2
        shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]
    "
                  >
                    {sortOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          setSort(item.value);
                          setOpenFilter(null);
                        }}
                        data-testid={`marketplace-sort-option-${item.value}`}
                        className={popoverOptionClass(sort === item.value)}
                      >
                        <span>{item.label}</span>
                        {sort === item.value ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {activeFilters.length ? (
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <span className="text-xs font-medium text-slate-400">Filters:</span>

              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => clearFilter(filter.key)}
                  data-testid={`marketplace-active-filter-${filter.key}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                >
                  {filter.label}
                  <XIcon />
                </button>
              ))}

              <button
                type="button"
                onClick={clearAllFilters}
                data-testid="marketplace-clear-all-filters"
                className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-amber-600 hover:underline"
              >
                Clear all
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section
        id="marketplace-agents"
        ref={agentListRef}
        className="scroll-mt-[140px] bg-gray-50 py-12"
      >
        <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-5">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-72 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm"
                />
              ))}
            </div>
          ) : apiError ? (
            <div className="rounded-2xl border border-red-100 bg-white py-16 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-2xl">
                ⚠️
              </div>
              <h3
                className="mt-4 text-lg font-semibold text-slate-900"
                data-testid="business-protected-marketplace-could-not-load-marketplace-agents-heading"
              >
                Could not load marketplace agents
              </h3>
              <p
                className="mx-auto mt-1 max-w-md text-sm text-slate-500"
                data-testid="business-protected-marketplace-api-error-text"
              >
                {apiError}
              </p>
            </div>
          ) : filteredAgents.length ? (
            <>
              <div
                data-testid="marketplace-agent-list"
                className={
                  view === "grid"
                    ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                    : "flex flex-col gap-4"
                }
              >
                {filteredAgents.map((agent) =>
                  view === "grid" ? (
                    <AgentGridCard
                      key={agent.id}
                      agent={agent}
                      onOpen={() => openAgentPage(agent)}
                      onViewDetails={() => openDetailsModal(agent)}
                      executionPricing={executionPricing}
                      executionPricingLoading={executionPricingLoading}
                      executionPricingUnavailable={executionPricingError}
                    />
                  ) : (
                    <AgentListCard
                      key={agent.id}
                      agent={agent}
                      onOpen={() => openAgentPage(agent)}
                      onViewDetails={() => openDetailsModal(agent)}
                      executionPricing={executionPricing}
                      executionPricingLoading={executionPricingLoading}
                      executionPricingUnavailable={executionPricingError}
                    />
                  ),
                )}
              </div>

              <div className="mt-10 flex flex-col items-center gap-3">
                <p
                  className="text-sm text-slate-400"
                  data-testid="business-protected-marketplace-showing-filtered-agents-of-agents-text"
                >
                  Showing {filteredAgents.length} of {filteredAgents.length} agents
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
                <Search className="h-6 w-6 text-amber-600 " />
              </div>
              <h3
                className="mt-2 text-md font-semibold text-slate-900"
                data-testid="business-protected-marketplace-no-agents-match-those-filters-heading"
              >
                No agents found.
              </h3>
            </div>
          )}

          {!isLoading && !apiError && !filteredAgents.length ? (
            <p
              className="mt-8 text-center text-sm text-slate-400"
              data-testid="business-protected-marketplace-showing-filtered-agents-of-agents-text-empty"
            >
              Showing 0 of {agents.length} agents
            </p>
          ) : null}
        </div>
      </section>

      <section className="bg-slate-900 py-8">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-white/80">
            <TrustItem text="256-bit encryption" />
            <TrustItem text="99.9% uptime" />
            <TrustItem text="SOC 2 compliant" />
            <TrustItem text="30-day money back" />
            <TrustItem text="24/7 support" />
          </div>
        </div>
      </section>

      {detailsAgent ? (
        <AgentDetailsModal
          agent={detailsAgent}
          isOwned={isOwnedAgent(detailsAgent.id)}
          setupPending={needsSetup(detailsAgent.id)}
          onClose={closeDetailsModal}
          executionPricing={executionPricing}
          executionPricingLoading={executionPricingLoading}
          executionPricingUnavailable={executionPricingError}
        />
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="font-bold text-slate-900"
        data-testid={`business-marketplace-metric-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
        {value}
      </span>
      <span className="text-slate-500" data-testid="business-protected-marketplace-label-text-3">
        {label}
      </span>
    </div>
  );
}

function AgentDetailsModal({
  agent,
  isOwned,
  setupPending,
  onClose,
}: {
  agent: Agent;
  isOwned: boolean;
  setupPending?: boolean;
  onClose: () => void;
  executionPricing?: BuyerExecutionPricingPayload | null;
  executionPricingLoading?: boolean;
  executionPricingUnavailable?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const industryLabel =
    agent.industries.length > 0
      ? agent.industries.join(" · ")
      : agent.industry === "all"
        ? "All industries"
        : formatLabel(agent.industry);

  const hasFreeTrial = !isOwned && Boolean(agent.freeTrialEnabled) && (agent.trialDays ?? 7) > 0 && agent.pricingModel !== "FREE";
  const trialDays = agent.trialDays ?? 7;

  const primaryCtaText = isOwned
    ? setupPending
      ? "Continue Setup"
      : "Manage Agent"
    : hasFreeTrial
      ? `Start ${trialDays}-Day Free Trial`
      : agent.pricingModel === "FREE"
        ? "Install Agent"
        : "Buy This Agent";

  const primaryCtaHref = isOwned
    ? setupPending
      ? businessSetupPath(agent.id)
      : BUSINESS_AGENTS_PATH
    : businessCheckoutPath(agent.id);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.name} details`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[1.6rem] bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          data-testid="business-marketplace-agent-details-modal-close"
          className="absolute right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-full text-2xl font-light text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          ×
        </button>

        <div className="border-b border-slate-100 px-6 py-6 sm:px-7">
          <div className="flex items-start gap-4 pr-10">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-amber-200 bg-amber-50 text-3xl">
              {agent.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={agent.iconUrl} alt={agent.name} className="h-full w-full object-cover rounded-2xl" />
              ) : (
                <BotIcon className="h-6 w-6 text-amber-500" />
              )}
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {agent.category}
                </span>

                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  {industryLabel}
                </span>

                {hasFreeTrial ? (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                    {trialDays}-day trial
                  </span>
                ) : null}
              </div>

              <h2
                id="marketplace-agent-modal-title"
                className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-[26px]"
                data-testid="business-marketplace-agent-details-modal-title"
              >
                {agent.name}
              </h2>

              <div
                className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                data-testid="business-marketplace-agent-details-modal-meta"
              >
                <span className="text-slate-500">{agent.installs} installs</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">By {agent.author}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-7 sm:px-7">
          <p
            className="text-[17px] leading-8 text-slate-600"
            data-testid="business-marketplace-agent-details-modal-description"
          >
            {agent.description}
          </p>

          <div className="mt-7">
            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400">
              What's Included
            </h3>

            <div className="mt-4 space-y-3">
              {agent.whatYouGet.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3"
                  data-testid={`business-marketplace-agent-details-modal-bullet-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <span className="mt-0.5 text-sm font-black text-amber-500">✓</span>
                  <p className="text-sm leading-6 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-col">
            <div className="flex items-end gap-2">
              {agent.pricingModel === "FREE" ? (
                <span
                  className="text-3xl font-black tracking-tight text-slate-900"
                  data-testid="business-marketplace-agent-details-modal-price"
                >
                  Free
                </span>
              ) : (
                <>
                  <span
                    className="text-3xl font-black tracking-tight text-slate-900"
                    data-testid="business-marketplace-agent-details-modal-price"
                  >
                    ${agent.price}
                  </span>
                  {agent.pricingModel !== "ONE_TIME" && (
                    <span className="pb-1 text-sm font-medium text-slate-400">
                      /month
                    </span>
                  )}
                </>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-600 mt-1">
              {agent.pricingModel === "FREE"
                ? "Free to install"
                : agent.pricingModel === "ONE_TIME"
                  ? "One-time purchase"
                  : "Monthly subscription"}
            </span>
            <span className="text-[10px] text-slate-400 italic">
              {agent.pricingModel === "FREE"
                ? "Pay only for usage"
                : agent.pricingModel === "ONE_TIME"
                  ? "Usage charges apply separately"
                  : "Usage charges billed separately"}
            </span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={primaryCtaHref}
              data-testid="business-marketplace-agent-details-modal-primary-cta"
              className="inline-flex min-w-[166px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-600"
            >
              {primaryCtaText}
            </Link>

            <Link
              href={publicAgentPath(agent.id)}
              data-testid="business-marketplace-agent-details-modal-view-full-details"
              className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded-xl border-2 border-amber-500 px-5 py-3 text-sm font-bold text-amber-600 transition hover:bg-amber-50"
            >
              View Full Details
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentGridCard({
  agent,
  onOpen,
  onViewDetails,
  executionPricing,
  executionPricingLoading,
  executionPricingUnavailable,
}: {
  agent: Agent;
  onOpen: () => void;
  onViewDetails: () => void;
  executionPricing: BuyerExecutionPricingPayload | null;
  executionPricingLoading: boolean;
  executionPricingUnavailable: boolean;
}) {
  const industryLabel = getCardIndustryLabel(agent);
  const categoryLabels = getCardCategoryLabels(agent);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      data-testid={`business-marketplace-agent-card-${agent.id}`}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div className="flex-1 min-w-0 p-6">
        <div className="flex items-start justify-between">
          <AgentCardIcon iconUrl={agent.iconUrl} size={12} />

          <div className="text-right flex flex-col items-end">
            <span
              className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white block"
              data-testid="business-protected-marketplace-agent-price-text"
            >
              {agent.pricingModel === "FREE"
                ? "Free"
                : agent.pricingModel === "ONE_TIME"
                  ? `$${agent.price}`
                  : `$${agent.price}/mo`}
            </span>
            <span className="block text-[10px] font-semibold text-slate-600 mt-1">
              {agent.pricingModel === "FREE"
                ? "Free to install"
                : agent.pricingModel === "ONE_TIME"
                  ? "One-time purchase"
                  : "Monthly subscription"}
            </span>
            <span className="block text-[9px] text-slate-400 italic text-right leading-tight max-w-[140px]">
              {agent.pricingModel === "FREE"
                ? "Pay only for usage"
                : agent.pricingModel === "ONE_TIME"
                  ? "Usage charges apply separately"
                  : "Usage charges billed separately"}
            </span>

          </div>
        </div>

        <h3
          className="mt-4 flex items-center gap-2 text-lg font-bold text-slate-900"
          data-testid="business-protected-marketplace-agent-is-new-heading"
        >
          {agent.name}
          {agent.isNew ? (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
              data-testid="business-protected-marketplace-new-text"
            >
              New 
            </span>
          ) : null}
        </h3>

        <div className="mt-2 flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-hidden">
          {industryLabel ? (
            <span
              className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600"
              data-testid="business-protected-marketplace-agent-industry-text"
            >
              {industryLabel}
            </span>
          ) : null}

          {categoryLabels.length > 0 ? (
            <CategoryTagsPill
              labels={categoryLabels}
              className="min-w-0"
              testId="business-protected-marketplace-agent-category-text"
              moreTestId={`business-marketplace-agent-category-more-${agent.id}`}
              tooltipTestId={`business-marketplace-agent-category-tooltip-${agent.id}`}
            />
          ) : null}
        </div>

        <p
          className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600"
          data-testid="business-protected-marketplace-agent-description-text"
        >
          {agent.description}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
        <span className="text-xs text-slate-500 flex items-center gap-1">
          <Download className="h-3 w-3" />
          {agent.installs} installs
        </span>
        <span className="truncate text-xs text-slate-500">{agent.author}</span>
      </div>

      <div className="px-6 pb-6 pt-4">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewDetails();
          }}
          data-testid={`business-marketplace-agent-details-${agent.id}`}
          className="w-full rounded-xl border-2 border-amber-500 py-2.5 font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          View details
        </button>
      </div>
    </article>
  );
}

function AgentListCard({
  agent,
  onOpen,
  onViewDetails,
  executionPricing,
  executionPricingLoading,
  executionPricingUnavailable,
}: {
  agent: Agent;
  onOpen: () => void;
  onViewDetails: () => void;
  executionPricing: BuyerExecutionPricingPayload | null;
  executionPricingLoading: boolean;
  executionPricingUnavailable: boolean;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      data-testid={`business-marketplace-agent-card-${agent.id}`}
      className="group flex cursor-pointer flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg sm:flex-row sm:items-center"
    >
      <AgentCardIcon iconUrl={agent.iconUrl} size={14} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden">
          <h3
            className="min-w-0 shrink truncate text-base font-bold text-slate-900"
            data-testid="business-protected-marketplace-agent-heading"
          >
            {agent.name}
          </h3>

          {agent.isNew ? (
            <span
              className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700"
              data-testid="business-protected-marketplace-new-text-2"
            >
              New
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
          {getCardIndustryLabel(agent) ? (
            <span
              className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600"
              data-testid="business-protected-marketplace-agent-industry-text-2"
            >
              {getCardIndustryLabel(agent)}
            </span>
          ) : null}

          {getCardCategoryLabels(agent).length > 0 ? (
            <CategoryTagsPill
              labels={getCardCategoryLabels(agent)}
              compact
              className="min-w-0"
              testId="business-protected-marketplace-agent-category-text-2"
              moreTestId={`business-marketplace-agent-category-more-list-${agent.id}`}
              tooltipTestId={`business-marketplace-agent-category-tooltip-list-${agent.id}`}
            />
          ) : null}
        </div>

        <p
          className="mt-1.5 line-clamp-2 text-sm text-slate-600"
          data-testid="business-protected-marketplace-agent-description-text-2"
        >
          {agent.description}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>{agent.installs} installs</span>
          <span>{agent.author}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
        <div className="text-right flex flex-col items-end">
          <span
            className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white block"
            data-testid="business-protected-marketplace-agent-price-text-2"
          >
            {agent.pricingModel === "FREE"
              ? "Free"
              : agent.pricingModel === "ONE_TIME"
                ? `$${agent.price}`
                : `$${agent.price}/mo`}
          </span>
          <span className="block text-[10px] font-semibold text-slate-600 mt-1">
            {agent.pricingModel === "FREE"
              ? "Free to install"
              : agent.pricingModel === "ONE_TIME"
                ? "One-time purchase"
                : "Monthly subscription"}
          </span>
          <span className="block text-[9px] text-slate-400 italic text-right leading-tight max-w-[140px]">
            {agent.pricingModel === "FREE"
              ? "Pay only for usage"
              : agent.pricingModel === "ONE_TIME"
                ? "Usage charges apply separately"
                : "Usage charges billed separately"}
          </span>

          {agent.pricingModel !== "FREE" && agent.freeTrialEnabled && (agent.trialDays ?? 7) > 0 ? (
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mt-1 block">
              {agent.trialDays ?? 7}-Day Trial
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewDetails();
          }}
          data-testid={`business-marketplace-agent-details-${agent.id}`}
          className="rounded-xl border-2 border-amber-500 px-5 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          View details
        </button>
      </div>
    </article>
  );
}

function TrustItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-amber-400">✓</span>
      {text}
    </div>
  );
}

function FooterGroup({
  title,
  items,
}: {
  title: string;
  items: {
    label: string;
    href: string;
  }[];
}) {
  return (
    <div>
      <h4
        className="text-sm font-semibold text-slate-900"
        data-testid="business-protected-marketplace-title-heading"
      >
        {title}
      </h4>

      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.label} data-testid="business-protected-marketplace-label-item">
            <Link
              data-testid="business-marketplace-footer-link"
              href={item.href as any}
              className="text-sm text-slate-500 transition hover:text-amber-600"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
