import { TRIVEN_AGENT_TAXONOMY, targetIndustryForSubindustry } from "./agent-industry-taxonomy";

/**
 * Browse-layer industry taxonomy for marketplace grouping and architect
 * Industry → Category filtering. Does not replace AGENT_CATEGORIES /
 * AGENT_INDUSTRIES used by publish/configure APIs.
 */

export const BROWSE_INDUSTRIES = [
  "Healthcare",
  "Beauty & Wellness",
  "Fitness",
  "Hospitality",
  "Real Estate",
  "Automotive",
  "Education",
  "Finance",
  "Legal",
  "Home Services",
  "Retail & E-commerce",
  "Logistics",
  "Recruitment",
  "Telecommunications",
  "Travel",
  "Events",
  "SaaS & Technology"
] as const;

export type BrowseIndustry = (typeof BROWSE_INDUSTRIES)[number];

/**
 * Vertical / business-type categories under each browse industry.
 * Used when an Industry selector should narrow Category options.
 */
export const INDUSTRY_CATEGORY_MAP: Record<BrowseIndustry, readonly string[]> = {
  Healthcare: TRIVEN_AGENT_TAXONOMY.Healthcare.map((entry) => entry.subindustry),
  "Beauty & Wellness": [
    "Hair Salons",
    "Barber Shops",
    "Nail Salons",
    "Beauty Clinics",
    "Spas",
    "Tattoo Studios"
  ],
  Fitness: ["Gyms", "Yoga Studios", "Personal Training", "Sports Clubs"],
  Hospitality: ["Hotels", "Restaurants", "Cafes", "Bars", "Catering"],
  "Real Estate": TRIVEN_AGENT_TAXONOMY["Real Estate"].map((entry) => entry.subindustry),
  Automotive: TRIVEN_AGENT_TAXONOMY.Automotive.map((entry) => entry.subindustry),
  Education: ["Schools", "Tutoring", "Coaching", "Online Courses"],
  Finance: ["Insurance", "Accounting", "Financial Advisors", "Banking"],
  Legal: TRIVEN_AGENT_TAXONOMY.Legal.map((entry) => entry.subindustry),
  "Home Services": [
    "Plumbers",
    "HVAC",
    "Electricians",
    "Roofing",
    "Landscaping",
    "Garage Door",
    "Pool Service",
    "Cleaning"
  ],
  "Retail & E-commerce": ["Online Stores", "Retail Shops", "Marketplaces"],
  Logistics: ["Delivery", "Warehousing", "Freight", "Courier"],
  Recruitment: ["Staffing Agencies", "HR Services", "Executive Search"],
  Telecommunications: ["ISPs", "Mobile Carriers", "Telecom Support"],
  Travel: ["Travel Agencies", "Tour Operators", "Airlines"],
  Events: ["Event Planners", "Venues", "Wedding Services"],
  "SaaS & Technology": ["Software Companies", "IT Services", "Agencies"]
};

/**
 * Map vertical category labels → existing template/listing industry tags
 * so Category selection still filters the current template data source.
 */
export const VERTICAL_CATEGORY_TAGS: Record<string, readonly string[]> = {
  "Dental Clinics": ["Dental Clinics", "Dental"],
  "Medical Clinics": ["Medical Clinics", "Medical Clinic", "Medical"],
  Hospitals: ["Hospitals", "Medical Clinic", "Medical", "Urgent Care"],
  "Veterinary Clinics": ["Veterinary Clinics", "Veterinary"],
  "Eye Clinics": ["Eye Clinics", "Optometry"],
  "Physiotherapy Clinics": ["Physiotherapy Clinics", "Physiotherapy"],
  "Mental Health Clinics": ["Mental Health Clinics", "Medical Clinic", "Medical"],
  "Diagnostic Labs": ["Diagnostic Labs", "Medical Clinic", "Medical"],
  "Orthopedic Clinics": ["Orthopedic Clinics", "Medical Clinic", "Medical"],
  "Cosmetic Surgery Clinics": ["Cosmetic Surgery Clinics", "Medical Clinic", "Medical"],
  "Plastic Surgery Clinics": ["Plastic Surgery Clinics", "Medical Clinic", "Medical"],
  "Chiropractic Clinics": ["Chiropractic Clinics", "Chiropractor"],
  "Urgent Care Centers": ["Urgent Care Centers", "Urgent Care", "Medical Clinic"],
  "Pediatric Clinics": ["Pediatric Clinics", "Medical Clinic", "Medical"],
  "Cardiology Clinics": ["Cardiology Clinics", "Medical Clinic", "Medical"],
  "Dermatology Clinics": ["Dermatology Clinics", "Dermatology"],
  "ENT Clinics": ["ENT Clinics", "Medical Clinic", "Medical"],
  "Fertility Clinics": ["Fertility Clinics", "Medical Clinic", "Medical"],
  "Hair Salons": ["Salon"],
  "Barber Shops": ["Barbershop"],
  "Nail Salons": ["Salon"],
  "Beauty Clinics": ["Med Spa", "Salon"],
  Spas: ["Spa & Wellness", "Med Spa"],
  "Tattoo Studios": ["Salon"],
  Gyms: ["Gym / Fitness"],
  "Yoga Studios": ["Yoga Studio"],
  "Personal Training": ["Gym / Fitness"],
  "Sports Clubs": ["Gym / Fitness"],
  Hotels: ["Hotel / Hospitality"],
  Restaurants: ["Restaurant"],
  Cafes: ["Restaurant"],
  Bars: ["Restaurant"],
  Catering: ["Restaurant", "Hotel / Hospitality"],
  "Residential Real Estate": ["Residential Real Estate", "Real Estate"],
  "Residential Brokerages": ["Residential Real Estate", "Real Estate"],
  "Commercial Real Estate": ["Commercial Real Estate", "Real Estate"],
  "Commercial Brokerages": ["Commercial Real Estate", "Real Estate"],
  "Property Management": ["Property Management", "Real Estate"],
  "Mortgage Brokers": ["Mortgage Broker"],
  "Auto Service Centers": ["Auto Service Centers", "Auto Repair", "Automotive"],
  "Auto Repair": ["Auto Service Centers", "Auto Repair", "Automotive"],
  "Car Dealerships": ["Car Dealerships", "Automotive"],
  "Car Rental Services": ["Car Rental Services", "Automotive"],
  "Car Wash": ["Auto Repair"],
  Towing: ["Auto Repair"],
  Schools: ["Custom"],
  Tutoring: ["Custom"],
  Coaching: ["Custom"],
  "Online Courses": ["Custom"],
  Insurance: ["Insurance"],
  Accounting: ["Custom"],
  "Financial Advisors": ["Insurance", "Mortgage Broker"],
  Banking: ["Mortgage Broker"],
  "Law Firms": ["Law Firms", "Law Firm", "Legal"],
  "Notary Services": ["Notary Services", "Law Firm", "Legal"],
  Notaries: ["Notary Services", "Law Firm", "Legal"],
  "Legal Aid": ["Law Firm", "Legal"],
  Plumbers: ["Plumber", "Plumbing"],
  HVAC: ["HVAC"],
  Electricians: ["Electrician"],
  Roofing: ["Roofing"],
  Landscaping: ["Landscaping"],
  "Garage Door": ["Garage Door"],
  "Pool Service": ["Pool Service"],
  Cleaning: ["Custom"],
  "Online Stores": ["Custom"],
  "Retail Shops": ["Custom"],
  Marketplaces: ["Custom"],
  Delivery: ["Custom"],
  Warehousing: ["Custom"],
  Freight: ["Custom"],
  Courier: ["Custom"],
  "Staffing Agencies": ["Custom"],
  "HR Services": ["Custom"],
  "Executive Search": ["Custom"],
  ISPs: ["Custom"],
  "Mobile Carriers": ["Custom"],
  "Telecom Support": ["Custom"],
  "Travel Agencies": ["Custom"],
  "Tour Operators": ["Custom"],
  Airlines: ["Custom"],
  "Event Planners": ["Custom"],
  Venues: ["Hotel / Hospitality"],
  "Wedding Services": ["Custom"],
  "Software Companies": ["Custom"],
  "IT Services": ["Custom"],
  Agencies: ["Custom"]
};

/**
 * Map existing listing/template industry labels (AGENT_INDUSTRIES + legacy aliases)
 * onto browse industries. Keys are lowercased trimmed labels.
 */
const INDUSTRY_TAG_TO_BROWSE: Record<string, BrowseIndustry> = {
  dental: "Healthcare",
  "medical clinic": "Healthcare",
  medical: "Healthcare",
  dermatology: "Healthcare",
  physiotherapy: "Healthcare",
  chiropractor: "Healthcare",
  optometry: "Healthcare",
  veterinary: "Healthcare",
  vet: "Healthcare",
  "urgent care": "Healthcare",
  "senior care": "Healthcare",
  hospital: "Healthcare",
  hospitals: "Healthcare",
  healthcare: "Healthcare",
  "med spa": "Beauty & Wellness",
  "medical spa": "Beauty & Wellness",
  salon: "Beauty & Wellness",
  "hair salon": "Beauty & Wellness",
  barbershop: "Beauty & Wellness",
  "barber shop": "Beauty & Wellness",
  "spa & wellness": "Beauty & Wellness",
  spa: "Beauty & Wellness",
  wellness: "Beauty & Wellness",
  "beauty & wellness": "Beauty & Wellness",
  "yoga studio": "Fitness",
  yoga: "Fitness",
  "gym / fitness": "Fitness",
  gym: "Fitness",
  fitness: "Fitness",
  "hotel / hospitality": "Hospitality",
  hotel: "Hospitality",
  hospitality: "Hospitality",
  restaurant: "Hospitality",
  "real estate": "Real Estate",
  realestate: "Real Estate",
  "property management": "Real Estate",
  "mortgage broker": "Finance",
  "auto repair": "Automotive",
  automotive: "Automotive",
  insurance: "Finance",
  "law firm": "Legal",
  legal: "Legal",
  law: "Legal",
  plumber: "Home Services",
  plumbing: "Home Services",
  hvac: "Home Services",
  electrician: "Home Services",
  "garage door": "Home Services",
  roofing: "Home Services",
  landscaping: "Home Services",
  "pool service": "Home Services",
  "home services": "Home Services",
  contractor: "Home Services",
  ecommerce: "Retail & E-commerce",
  "e-commerce": "Retail & E-commerce",
  "retail & e-commerce": "Retail & E-commerce",
  retail: "Retail & E-commerce",
  education: "Education",
  logistics: "Logistics",
  recruitment: "Recruitment",
  telecommunications: "Telecommunications",
  travel: "Travel",
  events: "Events",
  "saas & technology": "SaaS & Technology",
  saas: "SaaS & Technology",
  technology: "SaaS & Technology",
  "software companies": "SaaS & Technology",
  "it services": "SaaS & Technology",
  agencies: "SaaS & Technology",
  schools: "Education",
  tutoring: "Education",
  coaching: "Education",
  "online courses": "Education",
  accounting: "Finance",
  "financial advisors": "Finance",
  banking: "Finance",
  cleaning: "Home Services",
  "online stores": "Retail & E-commerce",
  "retail shops": "Retail & E-commerce",
  marketplaces: "Retail & E-commerce",
  delivery: "Logistics",
  warehousing: "Logistics",
  freight: "Logistics",
  courier: "Logistics",
  "staffing agencies": "Recruitment",
  "hr services": "Recruitment",
  "executive search": "Recruitment",
  isps: "Telecommunications",
  "mobile carriers": "Telecommunications",
  "telecom support": "Telecommunications",
  "travel agencies": "Travel",
  "tour operators": "Travel",
  airlines: "Travel",
  "event planners": "Events",
  "wedding services": "Events"
};

export type MarketplaceSearchableAgent = {
  name: string;
  category: string;
  description: string;
  author?: string;
  tags: readonly string[];
  industries: readonly string[];
  requiredConnectors?: readonly string[];
  supportedLlms?: readonly string[];
};

/** True when every search token appears in the agent's marketplace text. */
export function agentMatchesSearchQuery(agent: MarketplaceSearchableAgent, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = [
    agent.name,
    agent.category,
    agent.description,
    agent.author ?? "",
    ...(agent.tags ?? []),
    ...(agent.industries ?? []),
    ...(agent.requiredConnectors ?? []),
    ...(agent.supportedLlms ?? []),
    ...resolveBrowseIndustries(agent.industries ?? [])
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  return tokens.every((token) => haystack.includes(token));
}

function normalizeIndustryKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
}

/** Resolve one industry/tag label to a browse industry, if known. */
export function resolveBrowseIndustry(tag: string): BrowseIndustry | null {
  const key = normalizeIndustryKey(tag);
  if (!key) return null;
  if ((BROWSE_INDUSTRIES as readonly string[]).includes(tag.trim())) {
    return tag.trim() as BrowseIndustry;
  }

  // Exact target subindustries are first-class tags. This keeps parent-industry
  // filtering correct even when a listing is created by a newer client while
  // an older marketplace/client only understands the shared resolver.
  const targetIndustry = targetIndustryForSubindustry(tag);
  if (targetIndustry) return targetIndustry;

  return INDUSTRY_TAG_TO_BROWSE[key] ?? null;
}

/** True for legacy storage labels that must never appear as an industry name. */
export function isPlaceholderIndustryLabel(value: string): boolean {
  const key = value.trim().toLowerCase();
  return key === "custom" || key === "general";
}

/** Unique browse industries covered by a set of industry tags. */
export function resolveBrowseIndustries(tags: readonly string[]): BrowseIndustry[] {
  const seen = new Set<BrowseIndustry>();
  const result: BrowseIndustry[] = [];
  let hasCustomPlaceholder = false;
  for (const tag of tags) {
    if (isPlaceholderIndustryLabel(tag)) {
      hasCustomPlaceholder = true;
      continue;
    }
    const browse = resolveBrowseIndustry(tag);
    if (browse && !seen.has(browse)) {
      seen.add(browse);
      result.push(browse);
    }
  }
  if (result.length === 0 && hasCustomPlaceholder) {
    return ["SaaS & Technology"];
  }
  return result;
}

/** Marketplace-facing industry name. Never returns Custom. */
export function displayBrowseIndustryLabel(tags: readonly string[]): string {
  return resolveBrowseIndustries(tags)[0] ?? "";
}

/** Category chips with placeholder labels such as Custom removed. */
export function visibleCategoryLabels(category: string | null | undefined): string[] {
  if (!category?.trim()) return [];
  return [
    ...new Set(
      category
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !isPlaceholderIndustryLabel(part))
    )
  ];
}

/** Vertical categories for an industry, or empty when none selected. */
export function getCategoriesForIndustry(industry: string | null | undefined): readonly string[] {
  if (!industry || industry === "all") return [];
  const browse = resolveBrowseIndustry(industry);
  if (!browse) return [];
  return INDUSTRY_CATEGORY_MAP[browse] ?? [];
}

/** True when a template/listing tag set matches a vertical category selection. */
export function tagsMatchVerticalCategory(tags: readonly string[], category: string): boolean {
  if (!category || category === "All") return true;
  const expected = VERTICAL_CATEGORY_TAGS[category];
  if (!expected || expected.length === 0) return false;
  const normalizedTags = tags.map((tag) => normalizeIndustryKey(tag));

  // New Triven launch listings persist their exact subindustry as a tag. When
  // exact target-subindustry tags are present, do not let a broad compatibility
  // alias such as "Automotive" or "Medical" make sibling subindustries match.
  // Legacy listings that have no exact launch subindustry tag still fall back
  // to the alias table below for backwards compatibility.
  if (targetIndustryForSubindustry(category)) {
    const hasExactTargetTag = tags.some((tag) => Boolean(targetIndustryForSubindustry(tag)));
    if (hasExactTargetTag) {
      return normalizedTags.includes(normalizeIndustryKey(category));
    }
  }

  return expected.some((label) => normalizedTags.includes(normalizeIndustryKey(label)));
}

export const INDUSTRY_SECTION_INITIAL_COUNT = 8;

/** Initial number of industry tiles shown in marketplace "Browse by industry". */
export const BROWSE_INDUSTRY_TILE_INITIAL_COUNT = 8;

/** Display icons for browse-industry tiles (marketplace). */
export const BROWSE_INDUSTRY_ICONS: Record<BrowseIndustry, string> = {
  Healthcare: "❤️",
  "Beauty & Wellness": "💇",
  Fitness: "🏋️",
  Hospitality: "🍽️",
  "Real Estate": "🏠",
  Automotive: "🚗",
  Education: "🎓",
  Finance: "💰",
  Legal: "⚖️",
  "Home Services": "🔧",
  "Retail & E-commerce": "🛍️",
  Logistics: "📦",
  Recruitment: "👥",
  Telecommunications: "📡",
  Travel: "✈️",
  Events: "🎉",
  "SaaS & Technology": "💻"
};

export function browseIndustrySlug(industry: string): string {
  return industry
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function browseIndustryFromSlug(slug: string): BrowseIndustry | null {
  const normalized = browseIndustrySlug(slug);
  return BROWSE_INDUSTRIES.find((industry) => browseIndustrySlug(industry) === normalized) ?? null;
}

/** Tags associated with a vertical subcategory (may include legacy aliases). */
export function tagsForVerticalCategory(vertical: string): readonly string[] {
  return VERTICAL_CATEGORY_TAGS[vertical] ?? [];
}

/**
 * Tags to persist for Configure Industry + Category selection.
 * Always includes the browse industry so marketplace filters resolve correctly.
 */
export function industryTagsForCategorySelection(
  browseIndustry: BrowseIndustry,
  category: string | readonly string[]
): string[] {
  const tags: string[] = [browseIndustry];
  const categories = (Array.isArray(category) ? category : [category])
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== "custom");
  for (const item of categories) {
    const mapped = tagsForVerticalCategory(item);
    if (mapped.length > 0) tags.push(item);
    tags.push(...mapped);
  }
  return tags;
}

/** Whether any of the listing/configure tags match this vertical subcategory. */
export function isVerticalCategorySelected(tags: readonly string[], vertical: string): boolean {
  return tagsMatchVerticalCategory(tags, vertical);
}
