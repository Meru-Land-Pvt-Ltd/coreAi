import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { llmProviderApiKey } from "../ai-provider-engine/llm-credentials";

export type DocumentProfileSuggestion = {
  /** Primary business / hospital / clinic name candidate */
  businessName: string | null;
  /** All business name candidates found in document */
  businessNameCandidates: string[];
  /** Designated main doctor / primary contact practitioner */
  primaryDoctor: string | null;
  /** All detected doctor / practitioner names */
  doctorNames: string[];
  /** True when multiple doctors are detected in document */
  multipleDoctorsDetected: boolean;
  /** Inferred business category / specialty (e.g. dental, clinic, salon) */
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

// In-Memory Cache: Stores extracted results by businessId + contentHash
const profileCache = new Map<string, { hash: string; suggestion: DocumentProfileSuggestion }>();

// In-Flight Request Map: Deduplicates concurrent extractions for the same businessId
const pendingExtractions = new Map<string, Promise<DocumentProfileSuggestion | null>>();

export function invalidateDocumentProfileCache(businessId: string) {
  profileCache.delete(businessId);
  pendingExtractions.delete(businessId);
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

const JOB_TITLE_SUFFIXES = /\s+(?:general|experience|dentist|surgeon|cardiologist|pediatric|orthodontist|physician|specialist|director|doctor|practitioner|owner|consultant|staff|team|lead|senior)\b/gi;

const COMMON_SERVICE_KEYWORDS = [
  "Teeth Cleaning", "Dental Cleaning", "Root Canal", "Teeth Whitening", "Dental Implants",
  "Crowns", "Bridges", "Extractions", "Dental Extraction", "Fillings", "Scaling & Polishing", "Dentures",
  "Dental X-Ray", "Pediatric Dentistry", "Orthodontics", "Invisalign", "Braces", "Periodontics", "Endodontics",
  "General Checkup", "Vaccination", "Lab Tests", "Haircut", "Hair Coloring", "Manicure", "Pedicure", "Facial", "Massage"
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
  name = name.replace(/^(?:contact|owner|practitioner|doctor|provider|staff)\s*[:\-]\s*/i, "");
  if (/^dr\b/i.test(name) && !/^dr\./i.test(name)) {
    name = name.replace(/^dr\b/i, "Dr.");
  } else if (/^dr\./i.test(name)) {
    name = name.replace(/^dr\./i, "Dr.");
  }

  name = name.replace(/,\s*(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?|D\.?O\.?|N\.?P\.?|Ph\.?D\.?).*$/i, "");
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
    const prompt = `Analyze this business document text and extract structured profile information in JSON format.

    JSON Schema:
    {
      "businessName": string | null (e.g. "Central Perk Dental Clinic"),
      "doctorNames": string[] (Array of ONLY real human doctor/practitioner names, e.g. ["Dr. Emily Carter", "Dr. Michael Johnson"]. DO NOT include job titles, sentences, or phrases like "Frequently Asked Questions", "Dentist Experience", or "Yes"),
      "primaryDoctor": string | null (Main doctor or first doctor listed),
      "businessType": string | null ("clinic", "dental", "salon", "hospital", "law", "restaurant", "other"),
      "services": string[] (Array of short 1-3 word service names ONLY, e.g. ["Teeth Cleaning", "Root Canal", "Implants", "Crowns"]. DO NOT include prices, policies, reviews, or full sentences),
      "registrationNumber": string | null (Medical license, NPI, or registration number)
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

/**
 * Extract comprehensive, structured profile data from uploaded documents for a business.
 */
export async function extractProfileFromDocuments(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<DocumentProfileSuggestion | null> {
  const existingPending = pendingExtractions.get(input.businessId);
  if (existingPending) {
    return existingPending;
  }

  const promise = runExtraction(input).finally(() => {
    pendingExtractions.delete(input.businessId);
  });

  pendingExtractions.set(input.businessId, promise);
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

  const cached = profileCache.get(input.businessId);
  if (cached && cached.hash === contentHash) {
    console.log(`[document-profile-extractor] Cache HIT for businessId=${input.businessId} (0 API calls)`);
    return cached.suggestion;
  }

  console.log(`[document-profile-extractor] Cache MISS for businessId=${input.businessId}. Running extraction...`);

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
    const doctorCandidates = new Set<string>();
    const businessNameCandidates = new Set<string>();
    let registrationNumber: string | null = null;
    let detectedType: string | null = null;

    const STRICT_DR_REGEX = /\bDr\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    const STRICT_CRED_REGEX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}),?\s+(?:M\.?D\.?|D\.?D\.?S\.?|D\.?M\.?D\.?|M\.?B\.?B\.?S\.?)\b/g;

    let match: RegExpExecArray | null;
    STRICT_DR_REGEX.lastIndex = 0;
    while ((match = STRICT_DR_REGEX.exec(fullText)) !== null) {
      const cleaned = sanitizeDoctorName(match[0]);
      if (cleaned) doctorCandidates.add(cleaned);
    }

    STRICT_CRED_REGEX.lastIndex = 0;
    while ((match = STRICT_CRED_REGEX.exec(fullText)) !== null) {
      const cleaned = sanitizeDoctorName(match[0]);
      if (cleaned) doctorCandidates.add(cleaned);
    }

    const regMatch = fullText.match(/\b(?:reg(?:istration)?\.?|lic(?:ense)?\.?|npi|tax\s*id)\s*[:#\-]?\s*([a-z0-9\-]{5,20})\b/i);
    if (regMatch?.[1]) registrationNumber = regMatch[1].trim();

    const lower = fullText.toLowerCase();
    if (lower.includes("dental") || lower.includes("teeth") || lower.includes("dentist")) detectedType = "dental";
    else if (lower.includes("hospital") || lower.includes("medical") || lower.includes("clinic")) detectedType = "clinic";
    else if (lower.includes("salon") || lower.includes("spa")) detectedType = "salon";

    const doctorNames = Array.from(doctorCandidates);
    const primaryDoctor = doctorNames.length > 0 ? doctorNames[0] : null;

    suggestion = {
      businessName: Array.from(businessNameCandidates)[0] ?? null,
      businessNameCandidates: Array.from(businessNameCandidates),
      primaryDoctor,
      doctorNames,
      multipleDoctorsDetected: doctorNames.length > 1,
      businessType: detectedType,
      services: fallbackServices.filter(isValidServiceName).slice(0, 12),
      registrationNumber,
      phone,
      email,
      website,
      address: null,
      sourceFilename,
      extractedAt: new Date().toISOString()
    };
  }

  profileCache.set(input.businessId, { hash: contentHash, suggestion });
  return suggestion;
}
