import { createHash } from "node:crypto";
import { TRIVEN_TARGET_SUBINDUSTRIES } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { llmProviderApiKey } from "../ai-provider-engine/llm-credentials";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BusinessCategory =
  | "education"
  | "healthcare"
  | "home_services"
  | "finance"
  | "legal"
  | "real_estate"
  | "retail"
  | "hospitality"
  | "saas"
  | "general";

/** Lightweight metadata used everywhere (AI path + fallback path) */
export interface CategoryMeta {
  id: BusinessCategory;
  label: string;
  teamLabel: string;
  offeringsLabel: string;
  licenseOrRegLabel: string;
}

/** Extended config used only by the regex fallback parser */
interface FallbackCategoryConfig extends CategoryMeta {
  subindustries: string[];
  orgPattern: RegExp;
  rolePrefixes: RegExp[];
  roleSuffixes: RegExp[];
  serviceKeywords: string[];
}

export type DocumentProfileSuggestion = {
  /** Primary business / hospital / clinic / school name candidate */
  businessName: string | null;
  /** All business name candidates found in document */
  businessNameCandidates: string[];
  /** Primary contact / provider / team lead name */
  primaryDoctor: string | null;
  /** Detected provider / team-member / staff names */
  doctorNames: string[];
  /** True when multiple provider/team names are detected in document */
  multipleDoctorsDetected: boolean;
  /** Inferred business type / subindustry */
  businessType: string | null;
  /** Classified category identifier (e.g. "education", "healthcare", "home_services") */
  category?: BusinessCategory;
  /** Human-readable category label (e.g. "Education", "Healthcare", "Home Services") */
  categoryLabel?: string;
  /** Context-aware label for team members (e.g. "Faculty & Staff", "Doctors & Practitioners") */
  teamLabel?: string;
  /** Context-aware label for offerings (e.g. "Courses & Programs", "Services & Treatments") */
  offeringsLabel?: string;
  /** Context-aware label for license / registration */
  licenseOrRegLabel?: string;
  /** All extracted team members / personnel */
  teamMembers?: string[];
  /** Extracted list of services / treatments / courses / offerings */
  services: string[];
  /** Medical license / registration / NPI / school code / tax ID number */
  registrationNumber: string | null;
  /** Extracted phone number */
  phone: string | null;
  /** Extracted email address */
  email: string | null;
  /** Extracted website / booking URL */
  website: string | null;
  /** Main authoritative business address suggestion */
  address: {
    formatted: string;
    line1: string;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
  /** Primary source document filename */
  sourceFilename: string | null;
  /** Extraction confidence timestamp */
  extractedAt: string;
};

// ---------------------------------------------------------------------------
// Category metadata (labels only — used by both AI path and fallback path)
// ---------------------------------------------------------------------------

export const CATEGORY_META: Record<BusinessCategory, CategoryMeta> = {
  education:     { id: "education",     label: "Education",              teamLabel: "Faculty & Staff",            offeringsLabel: "Courses & Programs",               licenseOrRegLabel: "School Code / Accreditation No." },
  healthcare:    { id: "healthcare",    label: "Healthcare",             teamLabel: "Doctors & Practitioners",    offeringsLabel: "Services & Treatments",            licenseOrRegLabel: "Medical License / NPI" },
  home_services: { id: "home_services", label: "Home Services",          teamLabel: "Technicians & Team",         offeringsLabel: "Services & Rates",                 licenseOrRegLabel: "Contractor License No." },
  finance:       { id: "finance",       label: "Finance & Advisory",     teamLabel: "Advisors & Consultants",     offeringsLabel: "Financial Products & Services",    licenseOrRegLabel: "FINRA / NMLS / Registration No." },
  legal:         { id: "legal",         label: "Legal Services",         teamLabel: "Attorneys & Legal Team",     offeringsLabel: "Practice Areas & Services",        licenseOrRegLabel: "State Bar / License No." },
  real_estate:   { id: "real_estate",   label: "Real Estate",            teamLabel: "Agents & Brokers",           offeringsLabel: "Property Services",                licenseOrRegLabel: "Real Estate License No." },
  retail:        { id: "retail",        label: "Retail & E-commerce",    teamLabel: "Store Team & Staff",         offeringsLabel: "Products & Categories",            licenseOrRegLabel: "Tax Registration No." },
  hospitality:   { id: "hospitality",   label: "Hospitality & Travel",   teamLabel: "Hospitality Team",           offeringsLabel: "Amenities & Packages",             licenseOrRegLabel: "Hospitality / Food License" },
  saas:          { id: "saas",          label: "SaaS & Technology",      teamLabel: "Tech & Support Team",        offeringsLabel: "Plans & Solutions",                licenseOrRegLabel: "Corporate Registration No." },
  general:       { id: "general",       label: "General Business",       teamLabel: "Team Members",               offeringsLabel: "Services & Offerings",             licenseOrRegLabel: "Registration / Tax No." },
};

// ---------------------------------------------------------------------------
// Fallback-only category config (regex classifiers — NOT used in AI path)
// ---------------------------------------------------------------------------

const FALLBACK_CATEGORY_CONFIG: Record<BusinessCategory, FallbackCategoryConfig> = {
  education: {
    ...CATEGORY_META.education,
    subindustries: ["School", "College", "University", "Coaching Center", "Academy", "Tutoring Institute", "K-12", "Training Center"],
    orgPattern: /\b(?:school|college|coaching|academy|universit(?:y|ies)|institute|tutoring|education|high\s+school|grammar\s+school|preparatory)\b/i,
    rolePrefixes: [
      /\b(?:Principal|Director|Dean|Prof\.?|Professor|Teacher|Instructor|Counselor|Coordinator|HOD|Headmaster|Headmistress|Lecturer|Tutor)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g,
      /\b(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)\b[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Principal|Director|Dean|Professor|Teacher|Instructor|Counselor|Coordinator|HOD|Lecturer|Tutor)\b/g
    ],
    serviceKeywords: [
      "Course Enrollment", "Student Support", "College Counseling", "Peer Tutoring", "Learning Support",
      "Academic Advising", "Test Preparation", "Curriculum Development", "Admissions Guidance", "Class Registration",
      "STEM Program", "Language Immersion", "Advanced Placement", "Career Counseling", "Online Classes"
    ]
  },
  healthcare: {
    ...CATEGORY_META.healthcare,
    subindustries: ["Dental Practice", "Medical Clinic", "Hospital", "Diagnostic Lab", "Mental Health Clinic", "Physiotherapy Clinic", "Veterinary Clinic", "Urgent Care Center"],
    orgPattern: /\b(?:clinic|hospital|medical|dental|veterinary|diagnostic|laborator(?:y|ies)|health|wellness|surgery|urgent\s+care|pediatric|cardiolog|dermatolog|orthopedic|physiotherapy|mental\s+health)\b/i,
    rolePrefixes: [
      /\bDr\.[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g,
      /\b(?:Doctor|Physician|Surgeon|Dentist|Therapist|Practitioner|Nurse|Pediatrician|Cardiologist|Dermatologist)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2}),?[ \t]+(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?|D\.?O\.?|N\.?P\.?|Ph\.?D\.?)\b/g,
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Physician|Surgeon|Dentist|Therapist|Practitioner|Doctor|Pediatrician|Cardiologist|Dermatologist)\b/g
    ],
    serviceKeywords: [
      "General Checkup", "Teeth Cleaning", "Root Canal Therapy", "Vaccination", "Blood Test", "Physical Therapy",
      "Dermatology Consultation", "Eye Examination", "Dental Extraction", "Teeth Whitening", "Health Screening",
      "Orthodontics", "Pediatric Care", "Lab Diagnostics", "Cardiology Consultation"
    ]
  },
  home_services: {
    ...CATEGORY_META.home_services,
    subindustries: ["Plumbing Services", "Electrical Services", "HVAC & Air Conditioning", "Cleaning Services", "Landscaping & Lawn Care", "Roofing Services", "Pest Control", "Handyman Services"],
    orgPattern: /\b(?:plumbing|electrical|hvac|air\s+conditioning|cleaning|landscaping|roofing|pest\s+control|handyman|home\s+repair|contractor|appliances?)\b/i,
    rolePrefixes: [
      /\b(?:Technician|Tech|Master Electrician|Plumber|Contractor|Inspector|Installer|Handyman|Specialist)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Technician|Master Electrician|Plumber|Contractor|Inspector|Installer|Handyman|Specialist)\b/g
    ],
    serviceKeywords: [
      "Emergency Plumbing", "HVAC Inspection", "Drain Cleaning", "Electrical Repair", "Lawn Care", "Roof Repair",
      "Pest Control Treatment", "Air Conditioning Maintenance", "Deep Cleaning", "Appliance Repair",
      "Circuit Breaker Repair", "Water Heater Installation", "Gutter Cleaning", "Pipe Leak Repair"
    ]
  },
  finance: {
    ...CATEGORY_META.finance,
    subindustries: ["Bank", "Accounting Firm", "Insurance Agency", "Lending & Mortgages", "Wealth Management", "Financial Planning"],
    orgPattern: /\b(?:bank|banking|accounting|insurance|lending|wealth|financial|mortgage|cpa|tax|audit|credit\s+union|capital)\b/i,
    rolePrefixes: [
      /\b(?:Financial Advisor|Advisor|Accountant|Loan Officer|Portfolio Manager|Analyst|Consultant|Broker)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Financial Advisor|Advisor|Accountant|CPA|Loan Officer|Portfolio Manager|Analyst|Consultant)\b/g
    ],
    serviceKeywords: [
      "Tax Preparation", "Mortgage Consultation", "Wealth Management", "Financial Audit", "Insurance Planning",
      "Retirement Planning", "Portfolio Review", "Business Loan Advisory", "Credit Counseling", "Estate Tax Advisory"
    ]
  },
  legal: {
    ...CATEGORY_META.legal,
    subindustries: ["Law Firms", "Attorneys", "Notary Services", "Legal Practice", "Corporate Law", "Estate Planning"],
    orgPattern: /\b(?:law\s+firm|attorney|lawyer|legal|notary|advocacy|litigation|legal\s+practice)\b/i,
    rolePrefixes: [
      /\b(?:Attorney|Lawyer|Advocate|Counselor|Partner|Paralegal|Notary)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2}),?[ \t]+(?:J\.?D\.?|Esq\.?)\b/g,
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Attorney|Lawyer|Advocate|Counselor|Partner|Paralegal|Notary|Esq)\b/g
    ],
    serviceKeywords: [
      "Case Consultation", "Document Review", "Notary Appointment", "Contract Drafting", "Estate Planning",
      "Corporate Legal Advisory", "Litigation Support", "Trademark Filing", "Family Law Consultation"
    ]
  },
  real_estate: {
    ...CATEGORY_META.real_estate,
    subindustries: ["Residential Real Estate", "Commercial Real Estate", "Property Management", "Realty & Brokerage"],
    orgPattern: /\b(?:real\s+estate|realty|realtor|property|properties|brokerage|leasing|property\s+management)\b/i,
    rolePrefixes: [
      /\b(?:Realtor|Real Estate Agent|Property Agent|Broker|Property Manager|Listing Agent)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Realtor|Real Estate Agent|Property Agent|Broker|Property Manager|Listing Agent)\b/g
    ],
    serviceKeywords: [
      "Property Viewing", "Listing Inquiry", "Buyer Consultation", "Seller Consultation", "Lease Negotiation",
      "Property Valuation", "Tenant Screening", "Commercial Property Tour", "Open House Consultation"
    ]
  },
  retail: {
    ...CATEGORY_META.retail,
    subindustries: ["Retail Store", "Boutique", "E-commerce", "Showroom", "Specialty Retail"],
    orgPattern: /\b(?:store|retail|boutique|shop|merchandise|showroom|e-commerce|catalog)\b/i,
    rolePrefixes: [
      /\b(?:Store Manager|Sales Manager|Stylist|Associate|Buyer|Specialist)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Store Manager|Sales Manager|Stylist|Associate|Buyer)\b/g
    ],
    serviceKeywords: [
      "Custom Fitting", "Product Demo", "Styling Session", "Gift Registry", "Order Pickup", "Warranty Claim", "In-Store Consultation"
    ]
  },
  hospitality: {
    ...CATEGORY_META.hospitality,
    subindustries: ["Hotel", "Resort", "Restaurant", "Event Venue", "Travel Agency", "Catering"],
    orgPattern: /\b(?:hotel|resort|restaurant|cafe|catering|venue|travel\s+agency|hospitality|lodging)\b/i,
    rolePrefixes: [
      /\b(?:Chef|Concierge|Event Coordinator|General Manager|Host|Travel Specialist)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Chef|Concierge|Event Coordinator|General Manager|Host|Travel Specialist)\b/g
    ],
    serviceKeywords: [
      "Room Reservation", "Venue Booking", "Event Catering", "Dining Reservation", "Private Event Package", "Guided Tour Package", "Concierge Service"
    ]
  },
  saas: {
    ...CATEGORY_META.saas,
    subindustries: ["Software Platform", "Cloud Services", "IT Consulting", "Cybersecurity", "Tech Solutions"],
    orgPattern: /\b(?:software|saas|cloud|platform|it\s+services|cybersecurity|tech\s+startup|technology)\b/i,
    rolePrefixes: [
      /\b(?:Solutions Architect|Support Lead|Account Executive|Tech Lead|CTO|Product Manager)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Solutions Architect|Support Lead|Account Executive|Tech Lead|CTO|Product Manager)\b/g
    ],
    serviceKeywords: [
      "Product Demo", "API Integration", "Custom Onboarding", "Technical Support SLA", "Security Assessment", "Cloud Migration", "Software Subscription"
    ]
  },
  general: {
    ...CATEGORY_META.general,
    subindustries: ["Business Services", "Consulting", "Professional Services"],
    orgPattern: /\b(?:company|services|consulting|agency|enterprise|solutions|group)\b/i,
    rolePrefixes: [
      /\b(?:Manager|Director|Owner|Consultant|Founder|Lead|Specialist)\b[ \t]*[:\-–—]?[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g
    ],
    roleSuffixes: [
      /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})[ \t]*(?:,|\-|–|—)[ \t]*(?:Manager|Director|Owner|Consultant|Founder|Lead|Specialist)\b/g
    ],
    serviceKeywords: [
      "General Consultation", "Custom Service", "Project Planning", "Strategy Session", "Support Services"
    ]
  }
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** In-memory cache keyed by businessId:installedAgentId + content hash */
const profileCache = new Map<string, { hash: string; suggestion: DocumentProfileSuggestion }>();

/** Deduplicates concurrent extractions for the same scope */
const pendingExtractions = new Map<string, Promise<DocumentProfileSuggestion | null>>();

function extractionScopeKey(input: { businessId: string; installedAgentId?: string | null }): string {
  return `${input.businessId}:${input.installedAgentId ?? "all"}`;
}

export function invalidateDocumentProfileCache(businessId: string) {
  for (const key of profileCache.keys()) {
    if (key === businessId || key.startsWith(`${businessId}:`)) profileCache.delete(key);
  }
  for (const key of pendingExtractions.keys()) {
    if (key === businessId || key.startsWith(`${businessId}:`)) pendingExtractions.delete(key);
  }
  console.log(`[document-profile-extractor] Cache invalidated for businessId=${businessId}`);
}

// ---------------------------------------------------------------------------
// Shared name / service validators (used by both AI post-processing + fallback)
// ---------------------------------------------------------------------------

const BLACKLISTED_NAME_PHRASES = [
  /\bfrequently asked questions\b/i, /\bspanish\b/i, /\benglish\b/i, /\bquestions?\b/i, /\bavailability\b/i,
  /\bdepending on\b/i, /\byes\b/i, /\bno\b/i, /\bexperience\b/i, /\bdentist experience\b/i, /\boral surgeon experience\b/i,
  /\bcontact us\b/i, /\bour services\b/i, /\blocation\b/i, /\baddress\b/i, /\bhours\b/i, /\bmonday\b/i, /\btuesday\b/i,
  /\bwednesday\b/i, /\bthursday\b/i, /\bfriday\b/i, /\bsaturday\b/i, /\bsunday\b/i
];

const TITLE_ONLY_WORDS = /^(?:senior|junior|director|lead|manager|head|doctor|physician|surgeon|dentist|cardiologist|orthodontist|pediatrician|dermatologist|therapist|practitioner|attorney|lawyer|notary|broker|realtor|agent|advisor|technician|tech|plumber|electrician|inspector|installer|principal|teacher|professor|dean|counselor|instructor|\s)+$/i;

const JOB_TITLE_SUFFIXES = /\s+(?:general|experience|dentist|surgeon|cardiologist|pediatric|orthodontist|physician|specialist|director|doctor|practitioner|owner|consultant|staff|team|lead|senior|attorney|lawyer|notary|broker|realtor|agent|advisor|sales|manager|technician|therapist|principal|teacher|professor|dean|counselor|instructor)\b/gi;

const PERSON_TITLE_PREFIXES = /^(?:contact|owner|practitioner|doctor|provider|staff|attorney|lawyer|notary|broker|realtor|agent|real estate agent|financial advisor|advisor|accountant|cpa|loan officer|portfolio manager|analyst|consultant|manager|technician|tech|master electrician|master|plumber|electrician|installer|inspector|therapist|principal|teacher|professor|dean|counselor|instructor|sales manager)\s*[:\-]?\s*/i;

const INVALID_SERVICE_PATTERNS = [
  /\$/, /http/i, /www/i, /policy/i, /payment/i, /insurance/i, /review/i, /rating/i,
  /visa/i, /mastercard/i, /accepted/i, /cancellation/i, /parking/i, /question/i,
  /frequently/i, /walk-in/i, /instruction/i, /receptionist/i, /schedule/i, /phone/i,
  /email/i, /patient/i, /student/i, /arrive/i, /fee/i, /starting/i, /appointment/i, /experience/i
];

function isCleanPersonName(name: string): boolean {
  if (!name || name.length < 4 || name.length > 50) return false;
  for (const blacklisted of BLACKLISTED_NAME_PHRASES) {
    if (blacklisted.test(name)) return false;
  }
  const nameWithoutHonorific = name.replace(/^(?:Dr|Prof|Mr|Ms|Mrs)\.\s*/i, "").trim();
  if (TITLE_ONLY_WORDS.test(nameWithoutHonorific)) return false;
  const words = nameWithoutHonorific.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/\bdo\.?$/i.test(name) && !/\bdr\b/i.test(name) && !/\bmd\b/i.test(name)) return false;
  return true;
}

function sanitizePersonName(raw: string): string | null {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(PERSON_TITLE_PREFIXES, "");

  if (/^dr\b/i.test(name) && !/^dr\./i.test(name)) {
    name = name.replace(/^dr\b/i, "Dr.");
  } else if (/^prof\b/i.test(name) && !/^prof\./i.test(name)) {
    name = name.replace(/^prof\b/i, "Prof.");
  }

  name = name.replace(/,?\s*(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?|D\.?O\.?|N\.?P\.?|Ph\.?D\.?|J\.?D\.?|Esq\.?|CPA|NMLS)\b.*$/i, "");
  name = name.replace(/\s*[-–—].*$/, "");
  name = name.replace(JOB_TITLE_SUFFIXES, "");
  name = name.trim();
  return isCleanPersonName(name) ? name : null;
}

function isValidServiceName(service: string): boolean {
  if (!service || service.length < 3 || service.length > 45) return false;
  for (const pattern of INVALID_SERVICE_PATTERNS) {
    if (pattern.test(service)) return false;
  }
  return service.split(/\s+/).filter(Boolean).length <= 5;
}

// ---------------------------------------------------------------------------
// Fallback-only: regex category classifier
// ---------------------------------------------------------------------------

function classifyDocumentCategory(text: string): FallbackCategoryConfig {
  const lower = text.toLowerCase();
  const headerLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10).join(" ").toLowerCase();

  const scores = {} as Record<BusinessCategory, number>;
  for (const key of Object.keys(FALLBACK_CATEGORY_CONFIG) as BusinessCategory[]) {
    scores[key] = 0;
    const config = FALLBACK_CATEGORY_CONFIG[key];
    if (config.orgPattern.test(headerLines)) scores[key] += 10;
    else if (config.orgPattern.test(lower)) scores[key] += 4;
    for (const kw of config.serviceKeywords) {
      if (new RegExp(`\\b${kw.replace(/&/g, "&?")}\\b`, "i").test(lower)) scores[key] += 2;
    }
  }

  let topCategory: BusinessCategory = "general";
  let maxScore = 0;
  for (const [cat, score] of Object.entries(scores) as Array<[BusinessCategory, number]>) {
    if (score > maxScore) { maxScore = score; topCategory = cat; }
  }
  return FALLBACK_CATEGORY_CONFIG[topCategory];
}

// ---------------------------------------------------------------------------
// Fallback-only: service extractor
// ---------------------------------------------------------------------------

function extractFallbackServices(fullText: string, config: FallbackCategoryConfig): string[] {
  const extracted = new Set<string>();

  for (const catConfig of Object.values(FALLBACK_CATEGORY_CONFIG)) {
    for (const keyword of catConfig.serviceKeywords) {
      if (new RegExp(`\\b${keyword.replace(/&/g, "&?")}\\b`, "i").test(fullText)) {
        extracted.add(keyword);
      }
    }
  }

  for (const line of fullText.split(/\r?\n/).map((l) => l.trim())) {
    const m = line.match(/^[-•*]\s*([A-Za-z0-9\s&'/]{3,40})$/);
    if (m?.[1]) {
      const cleaned = m[1].trim();
      if (isValidServiceName(cleaned)) extracted.add(cleaned);
    }
  }

  return Array.from(extracted);
}

// ---------------------------------------------------------------------------
// AI extraction — Gemma structured JSON prompt
// ---------------------------------------------------------------------------

async function extractProfileWithAI(fullText: string): Promise<Partial<DocumentProfileSuggestion> | null> {
  if (process.env.VITEST) return null;

  const apiKey = llmProviderApiKey("gemini") || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const modelName = process.env.OCR_MODEL || "gemma-4-31b-it";
    const supportedBusinessTypes = TRIVEN_TARGET_SUBINDUSTRIES.join(", ");

    const prompt = `You are a business document parser. Read the document below and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

## Task
Extract structured business profile data from the document text.

## Output JSON Schema
Return exactly this structure (all fields required; use null or [] for missing data):

{
  "category": "<one of: education | healthcare | home_services | finance | legal | real_estate | retail | hospitality | saas | general>",
  "categoryLabel": "<human-readable category name, e.g. Healthcare, Education, Home Services>",
  "businessName": "<official business / clinic / school / firm name, or null>",
  "businessType": "<specific sub-industry from this list: ${supportedBusinessTypes}; or a short accurate type if not listed, or null>",
  "primaryContact": "<full name of the primary contact, owner, or first listed person — or null>",
  "teamMembers": ["<Full Name>", "..."],
  "teamLabel": "<context-aware label: Doctors & Practitioners | Faculty & Staff | Attorneys & Legal Team | Agents & Brokers | Technicians & Team | Advisors & Consultants | Hospitality Team | Tech & Support Team | Team Members>",
  "offeringsLabel": "<context-aware label: Services & Treatments | Courses & Programs | Practice Areas & Services | Financial Products & Services | Property Services | Products & Categories | Amenities & Packages | Plans & Solutions | Services & Offerings>",
  "services": ["<1–5 word service name>", "..."],
  "registrationNumber": "<license / NPI / school code / tax ID — or null>"
}

## Field Rules
- category: Pick the BEST match from the allowed values based on the document content.
- businessName: The official name of the organization (not a person name). null if absent.
- businessType: Pick from the supported list if possible: ${supportedBusinessTypes}
- primaryContact: The main doctor, attorney, owner, or primary person. null if none found.
- teamMembers: ONLY real human names. Include honorifics (Dr., Prof., Mr., Ms.). No job titles alone. Empty array [] if none found.
- services: Short 1–5 word names only. No prices, no sentences, no URLs. Empty array [] if none found.
- registrationNumber: Raw value only (e.g. "NPI-1234567890", "TX-REG-00123"). null if absent.
- teamLabel / offeringsLabel: Pick the most accurate label for the detected category.

## Document Text
${fullText.slice(0, 8000)}`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const text = response.text;
    if (!text) return null;
    const parsed = JSON.parse(text);

    const validMembers = Array.isArray(parsed.teamMembers)
      ? (parsed.teamMembers
          .map((d: unknown) => (typeof d === "string" ? sanitizePersonName(d) : null))
          .filter(Boolean) as string[])
      : [];

    const validServices = Array.isArray(parsed.services)
      ? (parsed.services
          .map((s: unknown) => (typeof s === "string" ? s.trim() : ""))
          .filter((s: string) => isValidServiceName(s)))
      : [];

    const uniqueMembers = Array.from(new Set(validMembers));
    const primaryDoctor =
      uniqueMembers.length > 0
        ? uniqueMembers[0]
        : typeof parsed.primaryContact === "string"
        ? parsed.primaryContact
        : null;

    const catKey: BusinessCategory =
      parsed.category && CATEGORY_META[parsed.category as BusinessCategory]
        ? (parsed.category as BusinessCategory)
        : "general";
    const catMeta = CATEGORY_META[catKey];

    return {
      category: catKey,
      categoryLabel: parsed.categoryLabel ?? catMeta.label,
      teamLabel: parsed.teamLabel ?? catMeta.teamLabel,
      offeringsLabel: parsed.offeringsLabel ?? catMeta.offeringsLabel,
      licenseOrRegLabel: catMeta.licenseOrRegLabel,
      businessName: typeof parsed.businessName === "string" ? parsed.businessName.trim() : null,
      teamMembers: uniqueMembers,
      doctorNames: uniqueMembers,
      primaryDoctor,
      multipleDoctorsDetected: uniqueMembers.length > 1,
      businessType: typeof parsed.businessType === "string" ? parsed.businessType.trim() : null,
      services: Array.from(new Set(validServices)),
      registrationNumber: typeof parsed.registrationNumber === "string" ? parsed.registrationNumber.trim() : null
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    if (errMessage.includes("429") || errMessage.includes("RESOURCE_EXHAUSTED") || errMessage.includes("quota")) {
      console.warn("[document-profile-extractor] Gemma API quota hit (429). Falling back to rule-based parser.");
    } else {
      console.warn("[document-profile-extractor] AI extraction fallback due to:", errMessage);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback parser — regex-based, used when AI is unavailable or returns nothing
// ---------------------------------------------------------------------------

export function extractProfileFallbackFromText(fullText: string): Pick<
  DocumentProfileSuggestion,
  "businessName" | "businessNameCandidates" | "primaryDoctor" | "doctorNames" |
  "multipleDoctorsDetected" | "businessType" | "category" | "categoryLabel" |
  "teamLabel" | "offeringsLabel" | "licenseOrRegLabel" | "teamMembers" | "services" | "registrationNumber"
> {
  const categoryConfig = classifyDocumentCategory(fullText);
  const businessNameCandidates = new Set<string>();
  const candidateKeys = new Map<string, string>();

  const addTeamCandidate = (candidate: string | null) => {
    if (!candidate) return;
    const cleanKey = candidate
      .toLowerCase()
      .replace(/^(?:dr|prof|mr|ms|mrs|attorney|lawyer|technician|tech|advisor|realtor|broker|agent)\.?\s+/i, "")
      .replace(/[^a-z]/g, "");
    if (!cleanKey || cleanKey.length < 3) return;
    const existing = candidateKeys.get(cleanKey);
    if (!existing) {
      candidateKeys.set(cleanKey, candidate);
    } else if (!/^(?:Dr|Prof|Mr|Ms|Mrs)\./i.test(existing) && /^(?:Dr|Prof|Mr|Ms|Mrs)\./i.test(candidate)) {
      candidateKeys.set(cleanKey, candidate);
    }
  };

  const defaultHonorificRegex = /\b(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})\b/g;
  const defaultCredRegex = /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2}),?[ \t]+(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?|D\.?O\.?|N\.?P\.?|Ph\.?D\.?|J\.?D\.?|Esq\.?|CPA)\b/g;

  let match: RegExpExecArray | null;
  while ((match = defaultHonorificRegex.exec(fullText)) !== null) addTeamCandidate(sanitizePersonName(match[0]));
  while ((match = defaultCredRegex.exec(fullText)) !== null) addTeamCandidate(sanitizePersonName(match[0]));

  for (const regex of categoryConfig.rolePrefixes) {
    regex.lastIndex = 0;
    while ((match = regex.exec(fullText)) !== null) addTeamCandidate(sanitizePersonName(match[1] ?? match[0]));
  }
  for (const regex of categoryConfig.roleSuffixes) {
    regex.lastIndex = 0;
    while ((match = regex.exec(fullText)) !== null) addTeamCandidate(sanitizePersonName(match[1] ?? match[0]));
  }

  const organizationLine = fullText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) =>
      line.length >= 3 && line.length <= 120 &&
      /\b(?:academy|school|college|university|clinic|hospital|medical|dental|veterinary|diagnostic|laborator(?:y|ies)|law\s+firm|legal|notary|real\s+estate|realty|properties|property|motors|automotive|auto\s+service|dealership|car\s+rental|rentals|plumbing|hvac|roofing|bank|accounting|firm|store|resort|hotel)\b/i.test(line)
    );
  if (organizationLine) businessNameCandidates.add(organizationLine.replace(/^[#*\-\s]+/, "").trim());

  const regMatch = fullText.match(/\b(?:reg(?:istration)?\.?|lic(?:ense)?\.?|npi|tax\s*id|accreditation|school\s+code)(?:[ \t]+(?:no\.?|number))?[ \t]*[:#\-]?[ \t]*([a-z0-9\-]{4,20})\b/i);

  const teamMembers = Array.from(candidateKeys.values());

  const fallbackTypeRules: Array<[RegExp, string]> = [
    [/\bnotary\b/i, "Notary Services"],
    [/\b(law firm|attorney|lawyer|legal practice)\b/i, "Law Firms"],
    [/\bcommercial real estate|commercial property\b/i, "Commercial Real Estate"],
    [/\b(real estate|realty|realtor|residential property)\b/i, "Residential Real Estate"],
    [/\b(car rental|vehicle rental|rental fleet)\b/i, "Car Rental Services"],
    [/\b(dealership|vehicle sales|car sales|motors)\b/i, "Car Dealerships"],
    [/\b(auto service|auto repair|vehicle service|mechanic)\b/i, "Auto Service Centers"],
    [/\b(dental|teeth|dentist)\b/i, "Dental Clinics"],
    [/\bfertility|ivf\b/i, "Fertility Clinics"],
    [/\bcardiolog/i, "Cardiology Clinics"],
    [/\bdermatolog/i, "Dermatology Clinics"],
    [/\b(mental health|therapy|therapist|psycholog|psychiatr)\b/i, "Mental Health Clinics"],
    [/\bphysiotherap|physical therapy\b/i, "Physiotherapy Clinics"],
    [/\bchiropract/i, "Chiropractic Clinics"],
    [/\borthopedic|orthopaedic\b/i, "Orthopedic Clinics"],
    [/\b(veterinary|veterinarian|animal hospital)\b/i, "Veterinary Clinics"],
    [/\b(eye clinic|optometr|ophthalmolog)\b/i, "Eye Clinics"],
    [/\bdiagnostic|laborator(?:y|ies)|lab test\b/i, "Diagnostic Labs"],
    [/\burgent care\b/i, "Urgent Care Centers"],
    [/\bpediatric|paediatric\b/i, "Pediatric Clinics"],
    [/\bhospital\b/i, "Hospitals"],
    [/\b(medical|clinic|physician)\b/i, "Medical Clinics"],
    [/\b(school|college|academy|university|coaching)\b/i, "Education & Academies"],
    [/\b(plumbing|hvac|electrical|house cleaning|carpet cleaning|roofing|pest control)\b/i, "Home Services"]
  ];

  const matchedType = fallbackTypeRules.find(([pattern]) => pattern.test(fullText))?.[1];
  const businessType = matchedType ?? (categoryConfig.subindustries[0] ?? categoryConfig.label);

  return {
    category: categoryConfig.id,
    categoryLabel: categoryConfig.label,
    teamLabel: categoryConfig.teamLabel,
    offeringsLabel: categoryConfig.offeringsLabel,
    licenseOrRegLabel: categoryConfig.licenseOrRegLabel,
    businessName: Array.from(businessNameCandidates)[0] ?? null,
    businessNameCandidates: Array.from(businessNameCandidates),
    primaryDoctor: teamMembers[0] ?? null,
    doctorNames: teamMembers,
    teamMembers,
    multipleDoctorsDetected: teamMembers.length > 1,
    businessType,
    services: extractFallbackServices(fullText, categoryConfig),
    registrationNumber: regMatch?.[1]?.trim() ?? null
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Extract comprehensive, structured profile data from uploaded documents for a business.
 */
export async function extractProfileFromDocuments(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<DocumentProfileSuggestion | null> {
  const scopeKey = extractionScopeKey(input);
  const existingPending = pendingExtractions.get(scopeKey);
  if (existingPending) return existingPending;

  const promise = runExtraction(input).finally(() => pendingExtractions.delete(scopeKey));
  pendingExtractions.set(scopeKey, promise);
  return promise;
}

async function runExtraction(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<DocumentProfileSuggestion | null> {
  const chunks = await prisma.businessKnowledgeBase.findMany({
    where: {
      businessId: input.businessId,
      sourceFileId: { not: null },
      ...(input.installedAgentId === undefined
        ? {}
        : { OR: [{ installedAgentId: null }, { installedAgentId: input.installedAgentId }] })
    },
    select: { id: true, content: true, sourceFile: { select: { filename: true } } },
    orderBy: { createdAt: "asc" }
  });

  if (chunks.length === 0) return null;

  const fullText = chunks.map((c) => c.content ?? "").join("\n\n");
  const contentHash = createHash("md5").update(fullText).digest("hex");

  const scopeKey = extractionScopeKey(input);
  const cached = profileCache.get(scopeKey);
  if (cached && cached.hash === contentHash) {
    console.log(`[document-profile-extractor] Cache HIT for scope=${scopeKey} (0 API calls)`);
    return cached.suggestion;
  }

  console.log(`[document-profile-extractor] Cache MISS for scope=${scopeKey}. Running extraction...`);

  const sourceFilename = chunks[0]?.sourceFile?.filename ?? null;

  const phone = fullText.match(/(?:\+?1[-.\ s]?)?\(?\d{3}\)?[-.\ s]?\d{3}[-.\ s]?\d{4}\b/)?.[0]?.trim() ?? null;
  const email = fullText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)?.[0]?.trim() ?? null;
  const website = fullText.match(/\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?\b/)?.[0]?.trim() ?? null;

  let suggestion: DocumentProfileSuggestion;

  const aiResult = await extractProfileWithAI(fullText);

  if (aiResult && (aiResult.doctorNames?.length || aiResult.businessName || aiResult.services?.length)) {
    // AI succeeded — trust its output fully, no regex merge needed
    console.log(
      `[document-profile-extractor] AI extraction succeeded: ` +
        `category=${aiResult.category}, members=${aiResult.teamMembers?.length}, businessName="${aiResult.businessName}", services=${aiResult.services?.length}`
    );
    suggestion = {
      category: aiResult.category ?? "general",
      categoryLabel: aiResult.categoryLabel ?? CATEGORY_META[aiResult.category ?? "general"].label,
      teamLabel: aiResult.teamLabel ?? CATEGORY_META[aiResult.category ?? "general"].teamLabel,
      offeringsLabel: aiResult.offeringsLabel ?? CATEGORY_META[aiResult.category ?? "general"].offeringsLabel,
      licenseOrRegLabel: aiResult.licenseOrRegLabel ?? CATEGORY_META[aiResult.category ?? "general"].licenseOrRegLabel,
      businessName: aiResult.businessName ?? null,
      businessNameCandidates: aiResult.businessName ? [aiResult.businessName] : [],
      primaryDoctor: aiResult.primaryDoctor ?? null,
      doctorNames: aiResult.doctorNames ?? [],
      teamMembers: aiResult.teamMembers ?? [],
      multipleDoctorsDetected: Boolean(aiResult.multipleDoctorsDetected),
      businessType: aiResult.businessType ?? null,
      services: (aiResult.services ?? []).filter(isValidServiceName).slice(0, 15),
      registrationNumber: aiResult.registrationNumber ?? null,
      phone,
      email,
      website,
      address: null,
      sourceFilename,
      extractedAt: new Date().toISOString()
    };
  } else {
    // AI unavailable or returned nothing — run regex fallback
    console.log(`[document-profile-extractor] Running rule-based fallback parser...`);
    const fallback = extractProfileFallbackFromText(fullText);
    suggestion = { ...fallback, phone, email, website, address: null, sourceFilename, extractedAt: new Date().toISOString() };
  }

  profileCache.set(scopeKey, { hash: contentHash, suggestion });
  return suggestion;
}
