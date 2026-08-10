"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CoreFooter } from "@/components/common/footer";
import { MarketplaceFeaturedSection } from "@/components/common/marketplace-featured-section";
import { apiGet } from "@/lib/api";
import { ASSIGNMENT_PATH, businessCheckoutPath, publicAgentPath } from "@/lib/routes";
import {
  BROWSE_INDUSTRIES,
  BROWSE_INDUSTRY_ICONS,
  BROWSE_INDUSTRY_TILE_INITIAL_COUNT,
  browseIndustryFromSlug,
  browseIndustrySlug,
  getCategoriesForIndustry,
  getConnectorIncludedItem,
  INDUSTRY_SECTION_INITIAL_COUNT,
  resolveBrowseIndustries,
  resolveBrowseIndustry,
  tagsMatchVerticalCategory,
  type BrowseIndustry,
} from "@coreai/shared";
import { getWorkflowFeatures } from "@/components/agent-description/shared/agent-listing";
import { BotIcon, Download, Search } from "lucide-react";

type Agent = {
  id: string;
  name: string;
  category: string;
  industry: string;
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
  iconUrl?: string | null;
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

type ApiWorkflow = {
  id?: string;
  name?: string;
  description?: string | null;
  isTemplate?: boolean;
  createdAt?: string;
  updatedAt?: string;
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

type Industry = {
  id: string;
  label: string;
  count: number;
  icon: string;
};

const LISTINGS_API_PATH = "/architect/listings/public";
const MARKETPLACE_AGENTS_SECTION_ID = "marketplace-agents";

const baseIndustries: Omit<Industry, "count">[] = [
  { id: "all", label: "All industries", icon: "✨" },
  { id: "dental", label: "Dental", icon: "🦷" },
  { id: "hvac", label: "HVAC & Plumbing", icon: "🔧" },
  { id: "realestate", label: "Real Estate", icon: "🏠" },
  { id: "legal", label: "Legal", icon: "⚖️" },
  { id: "medical", label: "Medical & Wellness", icon: "❤️" },
  { id: "automotive", label: "Automotive", icon: "🚗" },
  { id: "ecommerce", label: "E-commerce", icon: "🛍️" },
  { id: "spa-wellness", label: "Spa & Wellness", icon: "🌿" }
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
  { id: "ecommerce", label: "E-commerce", icon: "🛍️" }
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
  "e-commerce": "ecommerce"
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
    "senior-care"
  ],
  automotive: ["auto-repair"],
  ecommerce: ["ecommerce"],
  "spa-wellness": ["spa-wellness", "med-spa", "salon", "barbershop", "yoga-studio", "gym-fitness"]
};

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatLabel(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeIndustryId(value: string) {
  const normalized = normalizeFilterValue(value);

  return industryAliasByTag[normalized] ?? normalized;
}

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
  if (industries.length === 0) return "all";
  return normalizeFilterValue(industries[0]);
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

  if (listing.workflow?.name) {
    return "Workflow";
  }

  return "AI Agent";
}

function isRecentlyCreated(createdAt?: string) {
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();

  if (Number.isNaN(createdTime)) return false;

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  return Date.now() - createdTime <= thirtyDays;
}

/**
 * Speech-bubble-with-dots fallback matching the marketplace card reference.
 * Kept byte-identical to the business-side marketplace copy so the public and
 * signed-in cards render the same badge.
 */
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
    iconUrl: listing.iconUrl?.trim() || null
  };
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
    industryMatchesFilter(normalizeIndustryId(label), industryId)
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
      count: getIndustryAgentCount(id, agents)
    };
  });
}

function resolveSelectedBrowseIndustry(
  industryId: string,
  options: Omit<Industry, "count">[] | Industry[]
): BrowseIndustry | null {
  if (industryId === "all") return null;
  const fromSlug = browseIndustryFromSlug(industryId);
  if (fromSlug) return fromSlug;
  const label = options.find((item) => item.id === industryId)?.label;
  if (label) return resolveBrowseIndustry(label);
  return resolveBrowseIndustry(industryId);
}

function getIndustryDisplayLabel(industryId: string) {
  if (industryId === "all") return "All industries";
  const browse = browseIndustryFromSlug(industryId);
  if (browse) return browse;

  return (
    filterIndustries.find((item) => item.id === industryId)?.label ??
    baseIndustries.find((item) => item.id === industryId)?.label ??
    formatLabel(industryId)
  );
}

function buildIndustriesWithCounts(agents: Agent[]): Industry[] {
  return [
    { id: "all", label: "All industries", icon: "✨", count: agents.length },
    ...buildBrowseIndustryTiles(agents)
  ];
}

function buildFilterIndustriesWithCounts(agents: Agent[]): Industry[] {
  return filterIndustries.map((item) => ({
    ...item,
    count: getIndustryAgentCount(item.id, agents)
  }));
}

const sortOptions = [
  { value: "popular", label: "Most popular" },
  { value: "priceLow", label: "Price: low to high" },
  { value: "priceHigh", label: "Price: high to low" },
  { value: "newest", label: "Newest" }
] as const;

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

const HOME_PATH = "/" as Route;
const BUSINESS_LOGIN_PATH = "/business/login" as Route;
const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;

type SortValue = (typeof sortOptions)[number]["value"];

export default function MarketplacePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [query, setQuery] = useState("");
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState<SortValue>("popular");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [freeTrialOnly, setFreeTrialOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [openFilter, setOpenFilter] = useState<"industry" | "subCategory" | "price" | "rating" | "sort" | null>(null);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(200);
  const [minRating, setMinRating] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [expandedIndustries, setExpandedIndustries] = useState<Record<string, boolean>>({});
  const [showAllBrowseIndustries, setShowAllBrowseIndustries] = useState(false);
  const [subCategory, setSubCategory] = useState("all");

  const scrollToAgents = useCallback(() => {
    const section = document.getElementById(MARKETPLACE_AGENTS_SECTION_ID);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const timer = window.setTimeout(() => {
      scrollToAgents();
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, scrollToAgents]);

  useEffect(() => {
    let mounted = true;

    async function loadListings() {
      try {
        setIsLoading(true);
        setApiError("");

        const response = (await apiGet<ListingsApiResponse>(LISTINGS_API_PATH)) as ListingsApiResponse;

        const listings = response?.data?.listings ?? response?.listings ?? [];

        if (!mounted) return;

        setAgents(listings.map(mapListingToAgent));
      } catch (error) {
        console.error(error);

        if (!mounted) return;

        setApiError(
          error instanceof Error
            ? error.message
            : "Could not load marketplace agents"
        );
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
  }, []);

  const industries = useMemo(() => buildIndustriesWithCounts(agents), [agents]);
  const dropdownIndustries = useMemo(
    () => [
      { id: "all", label: "All industries", icon: "✨", count: agents.length },
      ...buildBrowseIndustryTiles(agents)
    ],
    [agents]
  );
  const featuredAgent = agents[0] ?? null;

  const selectedBrowseIndustry = useMemo(
    () => resolveSelectedBrowseIndustry(industry, dropdownIndustries),
    [industry, dropdownIndustries]
  );

  const subCategoryOptions = useMemo(
    () => (selectedBrowseIndustry ? [...getCategoriesForIndustry(selectedBrowseIndustry)] : []),
    [selectedBrowseIndustry]
  );

  useEffect(() => {
    setSubCategory("all");
  }, [industry]);

  const filteredAgents = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    const filtered = agents.filter((agent) => {
      const matchesQuery =
        !cleanQuery ||
        `${agent.name} ${agent.category} ${agent.description} ${agent.tags.join(" ")} ${agent.industries.join(" ")} ${agent.requiredConnectors.join(" ")} ${agent.supportedLlms.join(" ")}`
          .toLowerCase()
          .includes(cleanQuery);

      const matchesIndustry = industry === "all" || agentMatchesIndustry(agent, industry);
      const matchesSubCategory =
        subCategory === "all" || tagsMatchVerticalCategory(agent.industries, subCategory);

      const matchesPrice = agent.price >= priceMin && agent.price <= priceMax;
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
        return (
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime()
        );
      }
      return b.installs - a.installs;
    });
  }, [agents, query, industry, subCategory, priceMin, priceMax, minRating, sort, freeTrialOnly, newOnly]);

  useEffect(() => {
    setExpandedIndustries({});
  }, [query, industry, subCategory, priceMin, priceMax, minRating, sort, freeTrialOnly, newOnly]);

  const industrySections = useMemo(() => {
    const byIndustry = new Map<string, Agent[]>();
    for (const browse of BROWSE_INDUSTRIES) {
      byIndustry.set(browse, []);
    }
    byIndustry.set("Other", []);

    for (const agent of filteredAgents) {
      const browseList = resolveBrowseIndustries(agent.industries);
      if (browseList.length === 0) {
        byIndustry.get("Other")!.push(agent);
        continue;
      }
      for (const browse of browseList) {
        byIndustry.get(browse)!.push(agent);
      }
    }

    const sections: { industry: string; agents: Agent[] }[] = [];
    for (const browse of BROWSE_INDUSTRIES) {
      const agentsForIndustry = byIndustry.get(browse) ?? [];
      if (agentsForIndustry.length > 0) {
        sections.push({ industry: browse, agents: agentsForIndustry });
      }
    }
    const other = byIndustry.get("Other") ?? [];
    if (other.length > 0) {
      sections.push({ industry: "Other", agents: other });
    }
    return sections;
  }, [filteredAgents]);

  function toggleIndustryExpanded(industryName: string) {
    setExpandedIndustries((prev) => ({
      ...prev,
      [industryName]: !prev[industryName],
    }));
  }

  const industryLabel =
    dropdownIndustries.find((item) => item.id === industry)?.label ??
    industries.find((item) => item.id === industry)?.label ??
    "All industries";

  const sortLabel =
    sortOptions.find((item) => item.value === sort)?.label ?? "Most popular";

  const priceActive = priceMin !== 0 || priceMax !== 200;
  const ratingActive = minRating > 0;

  const activeFilters = [
    query.trim()
      ? {
        key: "query",
        label: `"${query.trim()}"`
      }
      : null,
    industry !== "all"
      ? {
        key: "industry",
        label: industryLabel
      }
      : null,
    subCategory !== "all"
      ? {
        key: "subCategory",
        label: subCategory
      }
      : null,
    priceActive
      ? {
        key: "price",
        label: priceMax >= 200 ? `$${priceMin}+` : `$${priceMin}–$${priceMax}`
      }
      : null,
    ratingActive
      ? {
        key: "rating",
        label: `${minRating}.0+ ★`
      }
      : null,
    freeTrialOnly
      ? {
        key: "free",
        label: "Free trial"
      }
      : null,
    newOnly
      ? {
        key: "new",
        label: "New this month"
      }
      : null
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
      setPriceMax(200);
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
    setPriceMax(200);
    setMinRating(0);
    setFreeTrialOnly(false);
    setNewOnly(false);
    setOpenFilter(null);
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

  useEffect(() => {
    if (!selectedAgent) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedAgent(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [selectedAgent]);

  function openDetailsModal(agent: Agent) {
    setSelectedAgent(agent);
  }

  return (
    <main data-testid="app-marketplace-page-main-1" className="min-h-screen bg-white text-slate-900">
      <nav data-testid="app-marketplace-page-nav-1" className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 shadow-sm backdrop-blur">
        <div data-testid="app-marketplace-page-div-1" className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div data-testid="app-marketplace-page-div-2" className="flex items-center gap-3 py-3">
            <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Triven home">
              <Image
                src={TRIVEN_LOGO_SRC}
                alt="Triven logo"
                width={36}
                height={36}
                priority
                className="h-9 w-9 object-contain"
              />
              <span className="text-xl font-extrabold tracking-tight text-amber-500">
                Triven.ai
              </span>
            </a>

            <div data-testid="app-marketplace-page-div-3" className="hidden min-w-0 flex-1 justify-center px-4 md:flex lg:px-8">
              <div data-testid="app-marketplace-page-div-4" className="relative w-full max-w-2xl">
                <span data-testid="app-marketplace-page-span-3" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Search className="h-4 w-4" />
                </span>
                <input data-testid="marketplace-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && query.trim()) {
                      event.preventDefault();
                      scrollToAgents();
                    }
                  }}
                  placeholder="Search agents by name, industry, or problem..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
                />
              </div>
            </div>

            <div data-testid="app-marketplace-page-div-5" className="ml-auto flex shrink-0 items-center gap-2">
              <Link data-testid="app-marketplace-page-link-2"
                href={ARCHITECT_LOGIN_PATH}
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:block"
              >
                For Architects
              </Link>
              <Link data-testid="marketplace-log-in-link"
                href={BUSINESS_LOGIN_PATH}
                className="rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-50"
              >
                Log in
              </Link>
              <Link data-testid="marketplace-get-started-link"
                href={ASSIGNMENT_PATH}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-amber-500/30 transition hover:bg-amber-600"
              >
                Get started
              </Link>
            </div>
          </div>

          <div data-testid="app-marketplace-page-div-3-mobile" className="pb-3 md:hidden">
            <div data-testid="app-marketplace-page-div-4-mobile" className="relative w-full">
              <span data-testid="app-marketplace-page-span-3-mobile" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <Search className="h-4 w-4" />
              </span>
              <input data-testid="app-marketplace-page-input-1-mobile"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && query.trim()) {
                    event.preventDefault();
                    scrollToAgents();
                  }
                }}
                placeholder="Search agents by name, industry, or problem..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-amber-100"
              />
            </div>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50">
        <div className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700" data-testid="marketplace-new-agents-added-every-week-text">
              ✨ New agents added every week
            </span>

            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl" data-testid="marketplace-ai-agents-that-work-while-you-sleep-heading">
              AI Agents That Work
              <br className="hidden sm:block" /> While You Sleep
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 sm:text-xl" data-testid="marketplace-browse-pre-built-ai-agents-install-in-text">
              Browse pre-built AI agents. Install in minutes. No code required.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              <Metric label="Agents" value="Verified" />
              <Metric label="Businesses" value="2,400+" />
              <Metric label="Average rating" value="4.9 ⭐" />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900" data-testid="marketplace-browse-by-industry-heading">
              Browse by industry
            </h2>
            <p className="mt-2 text-slate-600" data-testid="marketplace-find-agents-built-specifically-for-your-business-text">
              Find agents built specifically for your business type.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {industries
              .filter((item) => item.id !== "all")
              .slice(
                0,
                showAllBrowseIndustries ? undefined : BROWSE_INDUSTRY_TILE_INITIAL_COUNT
              )
              .map((item) => {
                const hasAgents = item.count > 0;

                return (
                  <button data-testid={`marketplace-industry-${item.id}`}
                    key={item.id}
                    type="button"
                    disabled={!hasAgents}
                    onClick={() => {
                      if (!hasAgents) return;
                      setIndustry(item.id);
                      setSubCategory("all");
                      scrollToAgents();
                    }}
                    className={`group relative rounded-2xl border bg-white p-6 text-center shadow-sm transition-all duration-300 ${hasAgents
                      ? `hover:-translate-y-1 hover:border-amber-200 hover:shadow-lg ${industry === item.id
                        ? "border-amber-300 ring-4 ring-amber-100"
                        : "border-gray-100"
                      }`
                      : "cursor-not-allowed border-gray-100 opacity-70"
                      }`}
                  >
                    <span
                      data-testid="marketplace-icon-text"
                      className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl transition ${hasAgents
                        ? "bg-amber-50 group-hover:scale-105 group-hover:bg-amber-500"
                        : "bg-slate-100 grayscale"
                        }`}
                    >
                      {item.icon}
                    </span>

                    <p className="mt-3 font-semibold text-slate-900" data-testid="marketplace-label-text">
                      {item.label}
                    </p>

                    <p data-testid="app-marketplace-page-p-7" className="text-sm text-slate-500">
                      {hasAgents ? `${item.count} agents` : "Coming soon"}
                    </p>
                  </button>
                );
              })}
          </div>

          {industries.filter((item) => item.id !== "all").length > BROWSE_INDUSTRY_TILE_INITIAL_COUNT ? (
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

        {featuredAgent ? (
          <MarketplaceFeaturedSection
            agent={featuredAgent}
            primaryAction={
              <Link
                data-testid="marketplace-start-free-trial-link"
                href={businessCheckoutPath(featuredAgent.id)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
              >
                {featuredAgent.pricingModel === "FREE"
                  ? "Install Agent"
                  : featuredAgent.freeTrialEnabled && (featuredAgent.trialDays ?? 7) > 0
                    ? `Start ${featuredAgent.trialDays ?? 7} days free trial`
                    : featuredAgent.pricingModel === "ONE_TIME"
                      ? "Get It Now"
                      : "Get Access Instantly"}
              </Link>
            }
            secondaryAction={
              <Link
                href={publicAgentPath(featuredAgent.id)}
                data-testid="marketplace-featured-details"
                className="rounded-xl border-2 border-gray-200 px-5 py-3 font-semibold text-slate-700 transition hover:border-amber-300 hover:text-amber-600"
              >
                View details
              </Link>
            }
          />
        ) : null}
      </section>

      <section className="sticky top-[73px] z-[70] overflow-visible border-y border-gray-100 bg-white/95 backdrop-blur transition-shadow">
        <div className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div className="relative flex flex-wrap items-center gap-3 overflow-visible py-3">
            <div className="flex items-center gap-2.5">
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
                  <span data-testid="marketplace-industry-label-text">{industryLabel}</span>
                  <ChevronIcon open={openFilter === "industry"} />
                </button>

                {openFilter === "industry" ? (
                  <div
                    data-filter-panel="industry"
                    className="absolute left-0 top-full z-[90] mt-2 max-h-80 w-72 overflow-y-auto overscroll-contain rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                  >
                    {dropdownIndustries.map((item) => {
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
                          <span data-testid="marketplace-label-text-2">{item.label}</span>

                          <span className="text-xs text-slate-400" data-testid="marketplace-unlocked-count-coming-soon-text">
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
                    <span data-testid="marketplace-subcategory-label-text">
                      {subCategory === "all" ? "Category" : subCategory}
                    </span>
                    <ChevronIcon open={openFilter === "subCategory"} />
                  </button>

                  {openFilter === "subCategory" ? (
                    <div
                      data-filter-panel="subCategory"
                      data-testid="marketplace-subcategory-filters"
                      className="absolute left-0 top-full z-[90] mt-2 max-h-80 w-72 overflow-y-auto overscroll-contain rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
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
                  <span data-testid="marketplace-price-active-price-max-200-price-min-text">
                    {priceActive
                      ? priceMax >= 200
                        ? `$${priceMin}+`
                        : `$${priceMin}–$${priceMax}`
                      : "Price range"}
                  </span>
                  <ChevronIcon open={openFilter === "price"} />
                </button>

                {openFilter === "price" ? (
                  <div
                    data-filter-panel="price"
                    className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold text-slate-700" data-testid="marketplace-price-range-text">Price range</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceMin(0);
                          setPriceMax(200);
                        }}
                        data-testid="marketplace-price-reset"
                        className="text-xs font-medium text-amber-600 transition hover:text-amber-700"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mb-2 flex items-center justify-between px-1 text-sm text-slate-600">
                      <span data-testid="marketplace-price-min-text">${priceMin}</span>
                      <span data-testid="marketplace-price-max-200-any-price-max-text">{priceMax >= 200 ? "Any" : `$${priceMax}`}</span>
                    </div>

                    <div className="relative h-9 px-1">
                      <div className="absolute left-1 right-1 top-4 h-1 rounded-full bg-slate-200" />
                      <div
                        className="absolute top-4 h-1 rounded-full bg-amber-500"
                        style={{
                          left: `${(priceMin / 200) * 100}%`,
                          width: `${((priceMax - priceMin) / 200) * 100}%`
                        }}
                      />

                      <input data-testid="marketplace-minimum-price-input"
                        type="range"
                        min={0}
                        max={200}
                        step={10}
                        value={priceMin}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setPriceMin(Math.min(value, priceMax));
                        }}
                        className="pointer-events-none absolute left-0 top-2 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                        aria-label="Minimum price"
                      />

                      <input data-testid="marketplace-maximum-price-input"
                        type="range"
                        min={0}
                        max={200}
                        step={10}
                        value={priceMax}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setPriceMax(Math.max(value, priceMin));
                        }}
                        className="pointer-events-none absolute left-0 top-2 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                        aria-label="Maximum price"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {[
                        { label: "Under $80", min: 0, max: 80 },
                        { label: "$80–120", min: 80, max: 120 },
                        { label: "$120+", min: 120, max: 200 }
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setPriceMin(preset.min);
                            setPriceMax(preset.max);
                          }}
                          data-testid={`marketplace-price-preset-${preset.min}-${preset.max}`}
                          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
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

            <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
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
                  data-testid="marketplace-filter-sort"
                  data-filter-trigger="sort"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:border-amber-300 hover:text-slate-900"
                  aria-haspopup="true"
                  aria-expanded={openFilter === "sort"}
                >
                  Sort:
                  <span className="font-semibold text-slate-800" data-testid="marketplace-sort-label-text">{sortLabel}</span>
                  <ChevronIcon open={openFilter === "sort"} />
                </button>

                {openFilter === "sort" ? (
                  <div
                    data-filter-panel="sort"
                    className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_24px_50px_-16px_rgba(15,23,42,.22)]"
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
                        <span data-testid="marketplace-label-text-3">{item.label}</span>
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
              <span className="text-xs font-medium text-slate-400" data-testid="marketplace-filters-text">Filters:</span>

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
        id={MARKETPLACE_AGENTS_SECTION_ID}
        data-testid="app-marketplace-page-section-4"
        className="scroll-mt-28 bg-gray-50 py-12"
      >
        <div data-testid="app-marketplace-page-div-33" className="w-full max-w-none px-4 sm:px-6 lg:px-8">
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
            <div data-testid="app-marketplace-page-div-35" className="rounded-2xl border border-red-100 bg-white py-16 text-center">
              <div data-testid="app-marketplace-page-div-36" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-2xl">
                ⚠️
              </div>
              <h3 data-testid="app-marketplace-page-h3-1" className="mt-4 text-lg font-semibold text-slate-900">
                Could not load marketplace agents
              </h3>
              <p data-testid="app-marketplace-page-p-8" className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {apiError}
              </p>
            </div>
          ) : filteredAgents.length ? (
            <div className="flex flex-col gap-10" data-testid="marketplace-industry-sections">
              {industrySections.map((section) => {
                const isExpanded = Boolean(expandedIndustries[section.industry]);
                const visibleAgents = isExpanded
                  ? section.agents
                  : section.agents.slice(0, INDUSTRY_SECTION_INITIAL_COUNT);
                const canToggle = section.agents.length > INDUSTRY_SECTION_INITIAL_COUNT;
                const sectionSlug = section.industry
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/(^-|-$)/g, "");

                return (
                  <section key={section.industry} data-testid={`marketplace-industry-section-${sectionSlug}`}>
                    <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <h3 className="text-xl font-bold tracking-tight text-slate-900">{section.industry}</h3>
                      <p className="text-sm font-medium text-slate-400">
                        {section.agents.length} {section.agents.length === 1 ? "agent" : "agents"}
                      </p>
                    </div>
                    <div
                      data-testid="app-marketplace-page-div-34"
                      className={
                        view === "grid"
                          ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                          : "flex flex-col gap-4"
                      }
                    >
                      {visibleAgents.map((agent) =>
                        view === "grid" ? (
                          <AgentGridCard
                            key={`${section.industry}-${agent.id}`}
                            agent={agent}
                            onViewDetails={() => openDetailsModal(agent)}
                          />
                        ) : (
                          <AgentListCard
                            key={`${section.industry}-${agent.id}`}
                            agent={agent}
                            onViewDetails={() => openDetailsModal(agent)}
                          />
                        )
                      )}
                    </div>
                    {canToggle ? (
                      <div className="mt-6 flex justify-center">
                        <button
                          type="button"
                          data-testid={`marketplace-industry-show-more-${sectionSlug}`}
                          onClick={() => toggleIndustryExpanded(section.industry)}
                          className="inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 px-8 py-3 font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
                        >
                          {isExpanded ? "Show less" : "Show More"}
                        </button>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
                <Search className="h-6 w-6 text-amber-600 " />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900" data-testid="marketplace-no-agents-match-those-filters-heading">
                No agents found.
              </h3>
              <p className="mt-1 text-sm text-slate-500" data-testid="marketplace-try-clearing-search-or-selecting-another-industry-text">
                Try clearing search or selecting another industry.
              </p>
              <button data-testid="marketplace-clear-filters-button"
                onClick={() => {
                  setQuery("");
                  setIndustry("all");
                  setFreeTrialOnly(false);
                  setNewOnly(false);
                }}
                className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                Clear filters
              </button>
            </div>
          )}

          {!isLoading && !apiError ? (
            <p data-testid="app-marketplace-page-p-9" className="mt-8 text-center text-sm text-slate-400">
              Showing {filteredAgents.length} of {agents.length} agents
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-t border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-2xl">
            ✨
          </div>
          <h2 className="text-3xl font-bold text-slate-900" data-testid="marketplace-not-sure-which-agent-is-right-heading">
            Not sure which agent is right?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-600" data-testid="marketplace-take-a-free-2-minute-assessment-and-text">
            Take a free 2-minute assessment and get a personalized
            recommendation built around your business.
          </p>
          <Link data-testid="marketplace-get-your-free-ai-score-link"
            href={ASSIGNMENT_PATH}
            className="mx-auto mt-7 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:-translate-y-0.5 hover:bg-amber-600"
          >
            Get your free AI score →
          </Link>
        </div>
      </section>

      <section data-testid="app-marketplace-page-section-6" className="bg-slate-900 py-8">
        <div data-testid="app-marketplace-page-div-39" className="w-full max-w-none px-4 sm:px-6 lg:px-8">
          <div data-testid="app-marketplace-page-div-40" className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-white/80">
            <TrustItem text="256-bit encryption" />
            <TrustItem text="99.9% uptime" />
            <TrustItem text="SOC 2 compliant" />
            <TrustItem text="30-day money back" />
            <TrustItem text="24/7 support" />
          </div>
        </div>
      </section>

      <CoreFooter />
      {selectedAgent ? (
        <AgentDetailsModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-slate-900" data-testid={`marketplace-metric-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</span>
      <span className="text-slate-500" data-testid="marketplace-label-text-4">{label}</span>
    </div>
  );
}

function AgentGridCard({
  agent,
  onViewDetails
}: {
  agent: Agent;
  onViewDetails: () => void;
}) {
  const category = agent.category;
  const otherTags = Array.from(
    new Set(
      [...(agent.industries ?? []), ...(agent.tags ?? [])].map((t) => t.trim()).filter(Boolean)
    )
  ).filter((tag) => tag.toLowerCase() !== category.toLowerCase());
  const visibleOtherTags = otherTags.slice(0, 3);
  const extraOtherTagsCount = Math.max(0, otherTags.length - 3);

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="flex-1 p-6">
        <div className="flex items-start justify-between">
          <AgentCardIcon iconUrl={agent.iconUrl} size={12} />

          <div className="text-right flex flex-col items-end">
            <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white block" data-testid="marketplace-agent-price-text">
              {agent.pricingModel === "FREE" ? "Free" : agent.pricingModel === "ONE_TIME" ? `$${agent.price}` : `$${agent.price}/mo`}
            </span>
            <span className="block text-[10px] font-semibold text-slate-600 mt-1">
              {agent.pricingModel === "FREE" ? "Free to install" : agent.pricingModel === "ONE_TIME" ? "One-time purchase" : "Monthly subscription"}
            </span>
            <span className="block text-[9px] text-slate-400 italic text-right leading-tight max-w-[140px]">
              {agent.pricingModel === "FREE" ? "Pay only for usage" : agent.pricingModel === "ONE_TIME" ? "Usage charges apply separately" : "Usage charges billed separately"}
            </span>
            {agent.pricingModel !== "FREE" && agent.freeTrialEnabled && (agent.trialDays ?? 7) > 0 ? (
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mt-1 block">
                {agent.trialDays ?? 7}-Day Trial
              </span>
            ) : null}
          </div>
        </div>

        <h3 className="mt-4 flex items-center gap-2 text-lg font-bold text-slate-900" data-testid="marketplace-agent-is-new-heading">
          {agent.name}
          {agent.isNew ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700" data-testid="marketplace-new-text">
              New
            </span>
          ) : null}
        </h3>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {category ? (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="marketplace-agent-category-text">
              {category}
            </span>
          ) : null}

          {otherTags.length > 0 ? (
            <div className="group/tags relative" data-testid={`marketplace-agent-tags-container-${agent.id}`}>
              <div className="inline-flex max-w-full flex-wrap items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                {visibleOtherTags.map((tag, index) => (
                  <span
                    key={`${tag}-${index}`}
                    className="flex items-center text-[11px] font-semibold text-amber-700"
                  >
                    {tag}
                    {index < visibleOtherTags.length - 1 || extraOtherTagsCount > 0 ? (
                      <span className="mx-1 font-bold text-amber-700">·</span>
                    ) : null}
                  </span>
                ))}
                {extraOtherTagsCount > 0 ? (
                  <span
                    className="text-[11px] font-bold text-amber-700"
                    data-testid={`marketplace-agent-tags-more-${agent.id}`}
                    aria-label={`${extraOtherTagsCount} more tags`}
                  >
                    +{extraOtherTagsCount}
                  </span>
                ) : null}
              </div>
              {extraOtherTagsCount > 0 ? (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden max-w-[min(100%,18rem)] rounded-xl border border-amber-100 bg-white px-3 py-2 shadow-lg group-hover/tags:block"
                  data-testid={`marketplace-agent-tags-tooltip-${agent.id}`}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {otherTags.map((tag, index) => (
                      <span
                        key={`${tag}-${index}`}
                        className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="marketplace-agent-industry-all-industries-agent-industry-text">
              {getIndustryDisplayLabel(agent.industry)}
            </span>
          )}
        </div>

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600" data-testid="marketplace-agent-description-text">
          {agent.description}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-50 bg-gray-50/60 px-6 py-3">
        <span className="flex gap-1 items-center text-xs text-slate-500" data-testid="marketplace-agent-installs-text">
          <Download className="h-3 w-3" />{agent.installs} installs
        </span>
        <span data-testid="app-marketplace-page-span-29" className="truncate text-xs text-slate-500">
          {agent.author}
        </span>
      </div>

      <div className="px-6 pb-6 pt-4">
        <button data-testid="marketplace-agent-open-grid"
          type="button"
          onClick={onViewDetails}
          className="w-full rounded-xl border-2 border-amber-500 py-2.5 font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          Open
        </button>
      </div>
    </article>
  );
}

function AgentListCard({
  agent,
  onViewDetails
}: {
  agent: Agent;
  onViewDetails: () => void;
}) {
  return (
    <article className="group flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-center">
      <AgentCardIcon iconUrl={agent.iconUrl} size={14} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-slate-900" data-testid="marketplace-agent-heading">{agent.name}</h3>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600" data-testid="marketplace-agent-category-text-2">
            {agent.category}
          </span>
          {agent.isNew ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-700" data-testid="marketplace-new-text-2">
              New
            </span>
          ) : null}
        </div>

        <p className="mt-1.5 line-clamp-2 text-sm text-slate-600" data-testid="marketplace-agent-description-text-2">
          {agent.description}
        </p>

        <div data-testid="app-marketplace-page-div-56" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span data-testid="app-marketplace-page-span-33">{agent.installs} installs</span>
          <span data-testid="app-marketplace-page-span-35">{agent.author}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-3">
        <div className="text-right flex flex-col items-end">
          <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm font-bold text-white block" data-testid="marketplace-agent-price-text-2">
            {agent.pricingModel === "FREE" ? "Free" : agent.pricingModel === "ONE_TIME" ? `$${agent.price}` : `$${agent.price}/mo`}
          </span>
          <span className="block text-[10px] font-semibold text-slate-600 mt-1">
            {agent.pricingModel === "FREE" ? "Free to install" : agent.pricingModel === "ONE_TIME" ? "One-time purchase" : "Monthly subscription"}
          </span>
          <span className="block text-[9px] text-slate-400 italic text-right leading-tight max-w-[140px]">
            {agent.pricingModel === "FREE" ? "Pay only for usage" : agent.pricingModel === "ONE_TIME" ? "Usage charges apply separately" : "Usage charges billed separately"}
          </span>
          {agent.pricingModel !== "FREE" && agent.freeTrialEnabled && (agent.trialDays ?? 7) > 0 ? (
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mt-1 block">
              {agent.trialDays ?? 7}-Day Trial
            </span>
          ) : null}
        </div>

        <button data-testid="marketplace-agent-open-list"
          type="button"
          onClick={onViewDetails}
          className="rounded-xl border-2 border-amber-500 px-5 py-2 text-sm font-semibold text-amber-600 transition hover:bg-amber-500 hover:text-white"
        >
          Open
        </button>
      </div>
    </article>
  );
}

function AgentDetailsModal({
  agent,
  onClose
}: {
  agent: Agent;
  onClose: () => void;
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
    agent.industries && agent.industries.length > 0
      ? agent.industries.join(" · ")
      : agent.industry === "all"
        ? "All industries"
        : getIndustryDisplayLabel(agent.industry);

  const hasFreeTrial = Boolean(agent.freeTrialEnabled) && (agent.trialDays ?? 7) > 0 && agent.pricingModel !== "FREE";
  const trialDays = agent.trialDays ?? 7;

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
          data-testid="marketplace-modal-close"
          className="absolute right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-full text-2xl font-light text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close modal"
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
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600" data-testid="marketplace-agent-category-text-3">
                  {agent.category}
                </span>

                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" data-testid="marketplace-agent-industry-all-industries-agent-industry-text-2">
                  {industryLabel}
                </span>

                {hasFreeTrial ? (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700" data-testid="marketplace-free-trial-text">
                    {trialDays}-day trial
                  </span>
                ) : null}
              </div>

              <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-[26px]" data-testid="marketplace-agent-heading-2">
                {agent.name}
              </h2>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-slate-500">{agent.installs} installs</span>

                <span className="text-slate-300">·</span>

                <span className="text-slate-500">{agent.author}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-7 sm:px-7">
          <p className="text-[17px] leading-8 text-slate-600" data-testid="marketplace-agent-description-text-3">
            {agent.description}
          </p>

          <div className="mt-7">
            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-400" data-testid="marketplace-what-you-get-heading">
              What's Included
            </h3>

            <div className="mt-4 space-y-3">
              {agent.whatYouGet.map((feature) => (
                <div key={feature} className="flex items-start gap-3">
                  <span className="mt-0.5 text-sm font-black text-amber-500">✓</span>
                  <p className="text-sm leading-6 text-slate-600" data-testid="marketplace-feature-text">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-col">
            <div className="flex items-end gap-2">
              {agent.pricingModel === "FREE" ? (
                <span className="text-3xl font-black tracking-tight text-slate-900" data-testid="marketplace-agent-price-text-3">
                  Free
                </span>
              ) : (
                <>
                  <span className="text-3xl font-black tracking-tight text-slate-900" data-testid="marketplace-agent-price-text-3">
                    ${agent.price}
                  </span>
                  {agent.pricingModel !== "ONE_TIME" && (
                    <span className="pb-1 text-sm font-medium text-slate-400" data-testid="marketplace-one-time-text-2">
                      /month
                    </span>
                  )}
                </>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-600 mt-1">
              {agent.pricingModel === "FREE" ? "Free to install" : agent.pricingModel === "ONE_TIME" ? "One-time purchase" : "Monthly subscription"}
            </span>
            <span className="text-[10px] text-slate-400 italic">
              {agent.pricingModel === "FREE" ? "Pay only for usage" : agent.pricingModel === "ONE_TIME" ? "Usage charges apply separately" : "Usage charges billed separately"}
            </span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              data-testid="marketplace-start-free-trial-link-2"
              href={businessCheckoutPath(agent.id)}
              className="inline-flex min-w-[166px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-600"
            >
              {hasFreeTrial
                ? `Start ${trialDays}-day Free Trial`
                : agent.pricingModel === "FREE"
                  ? "Install Agent"
                  : "Buy This Agent"}
            </Link>

            <Link
              data-testid="marketplace-modal-view-full-details"
              href={publicAgentPath(agent.id)}
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

function TrustItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-amber-400">✓</span>
      {text}
    </div>
  );
}

function FooterGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900" data-testid="marketplace-title-heading">{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} data-testid={`marketplace-footer-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <Link data-testid="marketplace-footer-link"
              href={"#" as Route}
              className="text-sm text-slate-500 transition hover:text-amber-600"
            >
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function filterPillClass(active: boolean) {
  return [
    "inline-flex shrink-0 items-center gap-1.5 rounded-xl border bg-white px-3.5 py-2 text-sm font-medium transition",
    active
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : "border-gray-200 text-slate-600 hover:border-amber-300 hover:text-slate-900"
  ].join(" ");
}

function popoverOptionClass(active: boolean) {
  return [
    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
    active
      ? "bg-amber-50 font-semibold text-amber-700"
      : "text-slate-600 hover:bg-amber-50 hover:text-amber-700"
  ].join(" ");
}

function viewButtonClass(active: boolean) {
  return [
    "grid h-8 w-8 place-items-center rounded-md transition",
    active ? "bg-amber-50 text-amber-600" : "text-slate-400 hover:text-slate-700"
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

function StarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m12 3.4 2.6 5.34 5.9.86-4.27 4.16 1 5.88L12 16.9l-5.27 2.77 1-5.88L3.46 9.6l5.9-.86L12 3.4Z" />
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
