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
  Healthcare: [
    "Dental Clinics",
    "Medical Clinics",
    "Hospitals",
    "Veterinary Clinics",
    "Eye Clinics",
    "Physiotherapy Clinics",
    "Mental Health Clinics",
    "Diagnostic Labs"
  ],
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
  "Real Estate": [
    "Residential Brokerages",
    "Commercial Brokerages",
    "Property Management",
    "Mortgage Brokers"
  ],
  Automotive: ["Auto Repair", "Car Dealerships", "Car Wash", "Towing"],
  Education: ["Schools", "Tutoring", "Coaching", "Online Courses"],
  Finance: ["Insurance", "Accounting", "Financial Advisors", "Banking"],
  Legal: ["Law Firms", "Notaries", "Legal Aid"],
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
  "Dental Clinics": ["Dental"],
  "Medical Clinics": ["Medical Clinic", "Medical"],
  Hospitals: ["Medical Clinic", "Medical", "Urgent Care"],
  "Veterinary Clinics": ["Veterinary"],
  "Eye Clinics": ["Optometry"],
  "Physiotherapy Clinics": ["Physiotherapy", "Chiropractor"],
  "Mental Health Clinics": ["Medical Clinic", "Medical"],
  "Diagnostic Labs": ["Medical Clinic", "Medical"],
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
  "Residential Brokerages": ["Real Estate"],
  "Commercial Brokerages": ["Real Estate"],
  "Property Management": ["Property Management", "Real Estate"],
  "Mortgage Brokers": ["Mortgage Broker"],
  "Auto Repair": ["Auto Repair", "Automotive"],
  "Car Dealerships": ["Auto Repair", "Automotive"],
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
  "Law Firms": ["Law Firm", "Legal"],
  Notaries: ["Law Firm", "Legal"],
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
  custom: "SaaS & Technology"
};

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
  return INDUSTRY_TAG_TO_BROWSE[key] ?? null;
}

/** Unique browse industries covered by a set of industry tags. */
export function resolveBrowseIndustries(tags: readonly string[]): BrowseIndustry[] {
  const seen = new Set<BrowseIndustry>();
  const result: BrowseIndustry[] = [];
  for (const tag of tags) {
    const browse = resolveBrowseIndustry(tag);
    if (browse && !seen.has(browse)) {
      seen.add(browse);
      result.push(browse);
    }
  }
  return result;
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
    tags.push(...tagsForVerticalCategory(item));
  }
  return tags;
}

/** Whether any of the listing/configure tags match this vertical subcategory. */
export function isVerticalCategorySelected(tags: readonly string[], vertical: string): boolean {
  return tagsMatchVerticalCategory(tags, vertical);
}
