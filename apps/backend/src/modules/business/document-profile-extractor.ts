import { createHash } from "node:crypto";
import { TRIVEN_TARGET_SUBINDUSTRIES } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { llmProviderApiKey } from "../ai-provider-engine/llm-credentials";

export type DocumentProfileSuggestion = {
  /** Primary business / hospital / clinic name candidate */
  businessName: string | null;
  /** All business name candidates found in document */
  businessNameCandidates: string[];
  /** Backward-compatible field: designated primary provider / team contact */
  primaryDoctor: string | null;
  /** Backward-compatible field: detected provider / team-member names */
  doctorNames: string[];
  /** True when multiple provider/team names are detected in document */
  multipleDoctorsDetected: boolean;
  /** Inferred business type / subindustry */
  businessType: string | null;
  /** Extracted list of services / treatments / offerings */
  services: string[];
  /** Medical license / registration / NPI / tax ID number */
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

// In-Memory Cache: Stores extracted results by businessId + installedAgentId + contentHash
const profileCache = new Map<string, { hash: string; suggestion: DocumentProfileSuggestion }>();

// In-Flight Request Map: Deduplicates concurrent extractions for the same scope
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

const BLACKLISTED_NAME_PHRASES = [
  "frequently asked questions",
  "spanish",
  "english",
  "questions",
  "availability",
  "depending on",
  "yes",
  "no",
  "experience",
  "dentist experience",
  "oral surgeon experience",
  "contact us",
  "our services",
  "location",
  "address",
  "hours",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

const JOB_TITLE_SUFFIXES = /\s+(?:general|experience|dentist|surgeon|cardiologist|pediatric|orthodontist|physician|specialist|director|doctor|practitioner|owner|consultant|staff|team|lead|senior|attorney|lawyer|notary|broker|realtor|agent|advisor|sales|manager|technician|therapist)\b/gi;

const COMMON_SERVICE_KEYWORDS = [
  "Teeth Cleaning", "Dental Cleaning", "Root Canal", "Teeth Whitening", "Dental Implants",
  "Crowns", "Bridges", "Extractions", "Dental Extraction", "Fillings", "Scaling & Polishing", "Dentures",
  "Dental X-Ray", "Pediatric Dentistry", "Orthodontics", "Invisalign", "Braces", "Periodontics", "Endodontics",
  "General Checkup", "Vaccination", "Lab Tests", "Haircut", "Hair Coloring", "Manicure", "Pedicure", "Facial", "Massage",
  "Consultation", "Property Viewing", "Listing Inquiry", "Buyer Consultation", "Seller Consultation",
  "Vehicle Test Drive", "Vehicle Service", "Oil Change", "Brake Service", "Car Rental",
  "Case Consultation", "Document Review", "Notary Appointment"
];

const INVALID_SERVICE_PATTERNS = [
  /\$/, /http/i, /www/i, /policy/i, /payment/i, /insurance/i, /review/i, /rating/i,
  /visa/i, /mastercard/i, /accepted/i, /cancellation/i, /parking/i, /question/i,
  /frequently/i, /walk-in/i, /instruction/i, /receptionist/i, /schedule/i, /phone/i,
  /email/i, /patient/i, /arrive/i, /fee/i, /starting/i, /appointment/i, /experience/i
];

function isCleanDoctorName(name: string): boolean {
  if (!name || name.length < 5 || name.length > 50) return false;
  const lower = name.toLowerCase();
  for (const blacklisted of BLACKLISTED_NAME_PHRASES) {
    if (lower.includes(blacklisted)) return false;
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/\bdo\.?$/i.test(name) && !/\bdr\b/i.test(name) && !/\bmd\b/i.test(name)) return false;
  return true;
}

function sanitizeDoctorName(raw: string): string | null {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(/^(?:contact|owner|practitioner|doctor|provider|staff|attorney|lawyer|notary|broker|realtor|agent|advisor|manager|technician)\s*[:\-]\s*/i, "");
  if (/^dr\b/i.test(name) && !/^dr\./i.test(name)) {
    name = name.replace(/^dr\b/i, "Dr.");
  } else if (/^dr\./i.test(name)) {
    name = name.replace(/^dr\./i, "Dr.");
  }

  name = name.replace(/,?\s*(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?|D\.?O\.?|N\.?P\.?|Ph\.?D\.?|J\.?D\.?|Esq\.?).*$/i, "");
  name = name.replace(/\s*[-–—].*$/, "");
  name = name.replace(JOB_TITLE_SUFFIXES, "");

  name = name.trim();
  return isCleanDoctorName(name) ? name : null;
}

function isValidServiceName(service: string): boolean {
  if (!service || service.length < 3 || service.length > 35) return false;
  for (const pattern of INVALID_SERVICE_PATTERNS) {
    if (pattern.test(service)) return false;
  }
  // Must be 1 to 4 words max
  const words = service.split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  return true;
}

function extractFallbackServices(fullText: string): string[] {
  const extractedServices = new Set<string>();

  for (const keyword of COMMON_SERVICE_KEYWORDS) {
    const re = new RegExp(`\\b${keyword.replace(/&/g, "&?")}\\b`, "i");
    if (re.test(fullText)) {
      extractedServices.add(keyword);
    }
  }

  return Array.from(extractedServices);
}

/**
 * AI-powered extraction attempt using Gemma-4-31b-it (or configurable via OCR_MODEL env var)
 */
async function extractProfileWithAI(fullText: string): Promise<Partial<DocumentProfileSuggestion> | null> {
  const apiKey = llmProviderApiKey("gemini") || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const modelName = process.env.OCR_MODEL || "gemma-4-31b-it";
    const supportedBusinessTypes = TRIVEN_TARGET_SUBINDUSTRIES.join(", ");
    const prompt = `Analyze this business document text and extract structured profile information in JSON format.

    JSON Schema:
    {
      "businessName": string | null (the organization/business name),
      "doctorNames": string[] (BACKWARD-COMPATIBLE FIELD NAME: extract ONLY real human providers or team contacts. Healthcare: doctors/practitioners/therapists. Legal: attorneys/notaries. Real Estate: agents/brokers. Automotive: sales/service contacts. Do not include job-title-only phrases or non-person text),
      "primaryDoctor": string | null (BACKWARD-COMPATIBLE FIELD NAME: primary provider/team contact or first real person listed),
      "businessType": string | null (prefer one exact matching subindustry when supported: ${supportedBusinessTypes}; otherwise use a short accurate business type),
      "services": string[] (Array of short 1-4 word service/offer names ONLY. Examples: "Teeth Cleaning", "Property Viewing", "Vehicle Service", "Case Consultation". Do not include prices, policies, reviews, or full sentences),
      "registrationNumber": string | null (license, NPI, registration, tax, or business identifier when explicitly present)
    }

    Document Text:
    ${fullText.slice(0, 8000)}`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const text = response.text;
    if (!text) return null;
    const parsed = JSON.parse(text);

    const validDoctors = Array.isArray(parsed.doctorNames)
      ? (parsed.doctorNames
          .map((d: unknown) => (typeof d === "string" ? sanitizeDoctorName(d) : null))
          .filter(Boolean) as string[])
      : [];

    const validServices = Array.isArray(parsed.services)
      ? (parsed.services
          .map((s: unknown) => (typeof s === "string" ? s.trim() : ""))
          .filter((s: string) => isValidServiceName(s)))
      : [];

    const uniqueDoctors = Array.from(new Set(validDoctors));
    const primaryDoctor = uniqueDoctors.length > 0 ? uniqueDoctors[0] : null;

    return {
      businessName: typeof parsed.businessName === "string" ? parsed.businessName.trim() : null,
      doctorNames: uniqueDoctors,
      primaryDoctor,
      multipleDoctorsDetected: uniqueDoctors.length > 1,
      businessType: typeof parsed.businessType === "string" ? parsed.businessType.trim() : null,
      services: Array.from(new Set(validServices)),
      registrationNumber: typeof parsed.registrationNumber === "string" ? parsed.registrationNumber.trim() : null
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    if (errMessage.includes("429") || errMessage.includes("RESOURCE_EXHAUSTED") || errMessage.includes("quota")) {
      console.warn("[document-profile-extractor] Gemini API quota hit (429). Silently falling back to strict rule-based parser.");
    } else {
      console.warn("[document-profile-extractor] AI extraction fallback due to:", errMessage);
    }
    return null;
  }
}

export function extractProfileFallbackFromText(fullText: string): Pick<
  DocumentProfileSuggestion,
  "businessName" | "businessNameCandidates" | "primaryDoctor" | "doctorNames" |
  "multipleDoctorsDetected" | "businessType" | "services" | "registrationNumber"
> {
  const doctorCandidates = new Set<string>();
  const businessNameCandidates = new Set<string>();

  const strictDrRegex = /\bDr\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  const strictCredRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}),?\s+(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?|D\.?O\.?|N\.?P\.?|Ph\.?D\.?|J\.?D\.?|Esq\.?)\b/g;
  const rolePrefixRegex = /\b(?:Attorney|Lawyer|Notary|Broker|Realtor|Real Estate Agent|Property Agent|Sales Manager|Sales Representative|Service Advisor|Technician|Therapist|Physiotherapist|Physical Therapist|Veterinarian|Veterinary Doctor|Provider|Practitioner)\s*[:\-–—]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  const roleSuffixRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*(?:,|\-|–|—)\s*(?:Attorney|Lawyer|Notary|Broker|Realtor|Real Estate Agent|Property Agent|Sales Manager|Sales Representative|Service Advisor|Technician|Therapist|Physiotherapist|Physical Therapist|Veterinarian|Veterinary Doctor|Provider|Practitioner)\b/g;

  let match: RegExpExecArray | null;
  while ((match = strictDrRegex.exec(fullText)) !== null) {
    const cleaned = sanitizeDoctorName(match[0]);
    if (cleaned) doctorCandidates.add(cleaned);
  }
  while ((match = strictCredRegex.exec(fullText)) !== null) {
    const cleaned = sanitizeDoctorName(match[0]);
    if (cleaned) doctorCandidates.add(cleaned);
  }
  for (const pattern of [rolePrefixRegex, roleSuffixRegex]) {
    while ((match = pattern.exec(fullText)) !== null) {
      const cleaned = sanitizeDoctorName(match[1] ?? "");
      if (cleaned) doctorCandidates.add(cleaned);
    }
  }

  const organizationLine = fullText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) =>
      line.length >= 3 && line.length <= 120 &&
      /\b(?:clinic|hospital|medical|dental|veterinary|diagnostic|laborator(?:y|ies)|law\s+firm|legal|notary|real\s+estate|realty|properties|property|motors|automotive|auto\s+service|dealership|car\s+rental|rentals)\b/i.test(line)
    );
  if (organizationLine) businessNameCandidates.add(organizationLine.replace(/^[#*\-\s]+/, "").trim());

  const regMatch = fullText.match(/\b(?:reg(?:istration)?\.?|lic(?:ense)?\.?|npi|tax\s*id)\s*[:#\-]?\s*([a-z0-9\-]{5,20})\b/i);
  const lower = fullText.toLowerCase();
  const fallbackTypeRules: Array<[RegExp, string]> = [
    [/\bnotary\b/, "Notary Services"],
    [/\b(law firm|attorney|lawyer|legal practice)\b/, "Law Firms"],
    [/\bcommercial real estate|commercial property\b/, "Commercial Real Estate"],
    [/\b(real estate|realty|realtor|residential property)\b/, "Residential Real Estate"],
    [/\b(car rental|vehicle rental|rental fleet)\b/, "Car Rental Services"],
    [/\b(dealership|vehicle sales|car sales)\b/, "Car Dealerships"],
    [/\b(auto service|auto repair|vehicle service|mechanic)\b/, "Auto Service Centers"],
    [/\bfertility|ivf\b/, "Fertility Clinics"],
    [/\bcardiolog/, "Cardiology Clinics"],
    [/\bdermatolog/, "Dermatology Clinics"],
    [/\b(mental health|therapy|therapist|psycholog|psychiatr)\b/, "Mental Health Clinics"],
    [/\bphysiotherap|physical therapy\b/, "Physiotherapy Clinics"],
    [/\bchiropract/, "Chiropractic Clinics"],
    [/\borthopedic|orthopaedic\b/, "Orthopedic Clinics"],
    [/\b(veterinary|veterinarian|animal hospital)\b/, "Veterinary Clinics"],
    [/\b(eye clinic|optometr|ophthalmolog)\b/, "Eye Clinics"],
    [/\bdiagnostic|laborator(?:y|ies)|lab test\b/, "Diagnostic Labs"],
    [/\bplastic surgery\b/, "Plastic Surgery Clinics"],
    [/\bcosmetic surgery\b/, "Cosmetic Surgery Clinics"],
    [/\burgent care\b/, "Urgent Care Centers"],
    [/\bpediatric|paediatric\b/, "Pediatric Clinics"],
    [/\b(ent clinic|ear nose throat|otolaryngolog)\b/, "ENT Clinics"],
    [/\b(dental|teeth|dentist)\b/, "Dental Clinics"],
    [/\bhospital\b/, "Hospitals"],
    [/\b(medical|clinic|physician)\b/, "Medical Clinics"]
  ];
  const doctorNames = Array.from(doctorCandidates);
  return {
    businessName: Array.from(businessNameCandidates)[0] ?? null,
    businessNameCandidates: Array.from(businessNameCandidates),
    primaryDoctor: doctorNames[0] ?? null,
    doctorNames,
    multipleDoctorsDetected: doctorNames.length > 1,
    businessType: fallbackTypeRules.find(([pattern]) => pattern.test(lower))?.[1] ?? null,
    services: extractFallbackServices(fullText),
    registrationNumber: regMatch?.[1]?.trim() ?? null
  };
}

/**
 * Extract comprehensive, structured profile data from uploaded documents for a business.
 */
export async function extractProfileFromDocuments(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<DocumentProfileSuggestion | null> {
  const scopeKey = extractionScopeKey(input);
  const existingPending = pendingExtractions.get(scopeKey);
  if (existingPending) {
    return existingPending;
  }

  const promise = runExtraction(input).finally(() => {
    pendingExtractions.delete(scopeKey);
  });

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

  if (chunks.length === 0) {
    return null;
  }

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
  const fallbackServices = extractFallbackServices(fullText);

  const phoneMatch = fullText.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  const emailMatch = fullText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  const websiteMatch = fullText.match(/\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?\b/);

  const phone = phoneMatch ? phoneMatch[0].trim() : null;
  const email = emailMatch ? emailMatch[0].trim() : null;
  const website = websiteMatch ? websiteMatch[0].trim() : null;

  let suggestion: DocumentProfileSuggestion;

  // 1. Try Gemini AI Structured Extraction first
  const aiResult = await extractProfileWithAI(fullText);
  if (aiResult && (aiResult.doctorNames?.length || aiResult.businessName || aiResult.services?.length)) {
    const mergedServices = Array.from(
      new Set([...(aiResult.services ?? []), ...fallbackServices])
    ).filter(isValidServiceName).slice(0, 12);

    console.log(
      `[document-profile-extractor] AI extraction succeeded: ` +
        `doctors=${aiResult.doctorNames?.length}, primaryDoctor="${aiResult.primaryDoctor}", businessName="${aiResult.businessName}", services=${mergedServices.length}`
    );
    suggestion = {
      businessName: aiResult.businessName ?? null,
      businessNameCandidates: aiResult.businessName ? [aiResult.businessName] : [],
      primaryDoctor: aiResult.primaryDoctor ?? null,
      doctorNames: aiResult.doctorNames ?? [],
      multipleDoctorsDetected: Boolean(aiResult.multipleDoctorsDetected),
      businessType: aiResult.businessType ?? null,
      services: mergedServices,
      registrationNumber: aiResult.registrationNumber ?? null,
      phone,
      email,
      website,
      address: null,
      sourceFilename,
      extractedAt: new Date().toISOString()
    };
  } else {
    // 2. Strict Rule-Based Parser (Fallback)
    console.log(`[document-profile-extractor] Running strict rule-based fallback parser...`);
    const fallback = extractProfileFallbackFromText(fullText);
    suggestion = {
      ...fallback,
      phone,
      email,
      website,
      address: null,
      sourceFilename,
      extractedAt: new Date().toISOString()
    };
  }

  profileCache.set(scopeKey, { hash: contentHash, suggestion });
  return suggestion;
}
