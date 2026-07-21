import { businessOpenStatus, describeOpenStatus, formatWeeklySummaryLines } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import type { RetrievedKnowledgeSection } from "./agent-knowledge";
import { buildHoursPromptLines, loadBusinessHoursState } from "./business-hours-state";

export type BusinessAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  landmark: string | null;
  directions: string | null;
  mapsLink: string | null;
  source: string | null;
  confirmedAt: string | null;
};

/** "1234 Sunset Boulevard, Las Vegas, Nevada 89109" — one logical fact. */
export function formatAddressOneLine(address: BusinessAddress): string | null {
  const cityStateZip = [address.city, [address.state, address.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const parts = [address.line1, address.line2, cityStateZip, address.country].filter(
    (part) => typeof part === "string" && part.trim()
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Complete enough to state to a caller: street + city + (state or postal). */
export function isAddressComplete(address: BusinessAddress): boolean {
  return Boolean(address.line1?.trim() && address.city?.trim() && (address.state?.trim() || address.postalCode?.trim()));
}

type ProfileAddressRow = {
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  addressLandmark: string | null;
  addressDirections: string | null;
  addressMapsLink: string | null;
  addressSource: string | null;
  addressConfirmedAt: Date | null;
};

export function addressFromProfile(profile: ProfileAddressRow | null | undefined): BusinessAddress {
  return {
    line1: profile?.addressLine1 ?? null,
    line2: profile?.addressLine2 ?? null,
    city: profile?.addressCity ?? null,
    state: profile?.addressState ?? null,
    postalCode: profile?.addressPostalCode ?? null,
    country: profile?.addressCountry ?? null,
    landmark: profile?.addressLandmark ?? null,
    directions: profile?.addressDirections ?? null,
    mapsLink: profile?.addressMapsLink ?? null,
    source: profile?.addressSource ?? null,
    confirmedAt: profile?.addressConfirmedAt?.toISOString() ?? null
  };
}

export type BusinessFacts = {
  businessName: string;
  address: BusinessAddress;
  addressFormatted: string | null;
  addressComplete: boolean;
  addressConfirmed: boolean;
  phone: string | null;
  bookingUrl: string | null;
  timeZone: string | null;
  /** Prompt-ready "Verified business facts" lines. */
  promptLines: string[];
};

export async function loadBusinessFacts(businessId: string): Promise<BusinessFacts | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      profile: true,
      phoneNumbers: { where: { isActive: true }, take: 1, select: { phoneNumber: true } }
    }
  });
  if (!business) return null;

  const address = addressFromProfile(business.profile);
  const addressFormatted = formatAddressOneLine(address);
  const phone = business.profile?.teamPhone ?? business.phoneNumbers?.[0]?.phoneNumber ?? null;

  const promptLines: string[] = [];
  if (addressFormatted) {
    promptLines.push(`Business address: ${addressFormatted}`);
    if (address.landmark) promptLines.push(`Landmark: ${address.landmark}`);
    if (address.directions) promptLines.push(`Directions: ${address.directions}`);
    if (address.mapsLink) promptLines.push(`Google Maps: ${address.mapsLink}`);
  }
  if (phone) promptLines.push(`Business phone: ${phone}`);
  if (business.profile?.bookingUrl) promptLines.push(`Website / booking page: ${business.profile.bookingUrl}`);

  return {
    businessName: business.name,
    address,
    addressFormatted,
    addressComplete: isAddressComplete(address),
    addressConfirmed: Boolean(business.profile?.addressConfirmedAt),
    phone,
    bookingUrl: business.profile?.bookingUrl ?? null,
    timeZone: business.profile?.timeZone ?? null,
    promptLines
  };
}

/* ------------------------------ fact intents ------------------------------ */

export type FactIntent = "address" | "phone" | "hours" | "website" | "parking";

const INTENT_PATTERNS: Record<FactIntent, RegExp> = {
  address:
    /\b(address|location|located|situated|direction|directions|landmark|maps?|where (are|is|do|should|can)|where('s| is)? (the|your)|which (part|area)|how (do|can) i (get|reach|find|come)|send .*(location|address)|where .*(come|arrive|reach|go|visit)|arrive)\b/i,
  phone: /\b(phone|call you|contact number|telephone|mobile number|reach you (on|at))\b/i,
  hours: /\b(hours|open|close|closing|opening|timing|timings|what time)\b/i,
  website: /\b(website|web site|online|url|book online|booking (page|link))\b/i,
  parking: /\b(park|parking|car park|garage)\b/i
};

export function detectFactIntents(query: string): FactIntent[] {
  const text = String(query ?? "");
  return (Object.keys(INTENT_PATTERNS) as FactIntent[]).filter((intent) => INTENT_PATTERNS[intent].test(text));
}

export async function lookupStructuredFacts(input: {
  businessId: string;
  query: string;
}): Promise<RetrievedKnowledgeSection[]> {
  const intents = detectFactIntents(input.query);
  if (intents.length === 0) return [];

  const facts = await loadBusinessFacts(input.businessId);
  if (!facts) return [];

  const sections: RetrievedKnowledgeSection[] = [];

  if (intents.includes("address") && facts.addressFormatted && facts.addressComplete) {
    const extras = [
      facts.address.landmark ? `Landmark: ${facts.address.landmark}` : null,
      facts.address.directions ? `Directions: ${facts.address.directions}` : null,
      facts.address.mapsLink ? `Google Maps: ${facts.address.mapsLink}` : null
    ].filter(Boolean);
    sections.push({
      title: "Business address (confirmed configuration)",
      content: `${facts.businessName} is located at ${facts.addressFormatted}.${extras.length ? `\n${extras.join("\n")}` : ""}`,
      sourceFilename: null,
      score: 100
    });
  }

  if (intents.includes("phone") && facts.phone) {
    sections.push({
      title: "Business phone (confirmed configuration)",
      content: `You can reach ${facts.businessName} at ${facts.phone}.`,
      sourceFilename: null,
      score: 100
    });
  }

  if (intents.includes("website") && facts.bookingUrl) {
    sections.push({
      title: "Website / booking page (confirmed configuration)",
      content: `${facts.businessName}: ${facts.bookingUrl}`,
      sourceFilename: null,
      score: 100
    });
  }

  if (intents.includes("hours")) {
    sections.push(await buildHoursFactSection(input.businessId, facts.businessName));
  }

  return sections;
}

export async function buildHoursFactSection(
  businessId: string,
  businessName: string
): Promise<RetrievedKnowledgeSection> {
  const state = await loadBusinessHoursState(businessId);

  if (!state.configured) {
    return {
      title: "Business hours (not configured)",
      content:
        `${businessName} has not confirmed its operating hours yet. Tell the caller the hours are not confirmed and offer to have the team follow up. Do NOT guess or invent hours.`,
      sourceFilename: null,
      score: 100
    };
  }

  const status = businessOpenStatus({
    weekly: state.weekly,
    special: state.special,
    timeZone: state.timeZone
  });

  const weeklyLines = formatWeeklySummaryLines(state.weekly) ?? [];
  const contentLines = [
    `Right now: ${describeOpenStatus(status)}`,
    `Today is ${status.weekday} (${status.date}, ${state.timeZone}).`,
    "Weekly schedule:",
    ...weeklyLines.map((line) => `  ${line}`)
  ];

  // Upcoming special dates so holiday questions are answered correctly.
  const upcoming = state.special.filter((entry) => entry.date >= status.date).slice(0, 10);
  if (upcoming.length > 0) {
    contentLines.push("Special dates (these override the weekly schedule):");
    for (const entry of upcoming) {
      const note = entry.note ? ` (${entry.note})` : "";
      contentLines.push(
        entry.closed
          ? `  ${entry.date}: Closed${note}`
          : `  ${entry.date}: ${entry.periods.map((p) => `${p.open}–${p.close}`).join(", ")}${note}`
      );
    }
  }

  contentLines.push(
    "These are general business hours. Appointment availability can differ — use the availability tools for booking questions."
  );

  return {
    title: "Business hours (confirmed configuration)",
    content: contentLines.join("\n"),
    sourceFilename: null,
    score: 100
  };
}

/* -------------------------- PDF address extraction ------------------------- */

const STREET_WORDS =
  "(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|plaza|square|highway|hwy|parkway|pkwy|circle|terrace|place|pl)";

// The street word must be its OWN trailing word ("... Drive"), never a suffix
// inside another word ("Crest" must not satisfy "st").
const STREET_LINE = new RegExp(
  `\\b(\\d{1,6}[A-Za-z]?(?:\\s+[A-Za-z0-9.'’-]+){0,6}?\\s+${STREET_WORDS}\\b\\.?)`,
  "i"
);
const CITY_STATE_ZIP = /\b([A-Za-z .'-]{2,40}),\s*([A-Za-z .'-]{2,30})\s+(\d{4,6}(?:-\d{4})?)\b/;

export type AddressSuggestion = {
  formatted: string;
  line1: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  sourceFilename: string | null;
};

/**
 * Detect a complete address inside document chunks — multi-line values under
 * an "Address" heading, paragraphs, tables, and footers all collapse to ONE
 * logical fact. Returned as a suggestion only; it becomes structured data
 * exclusively after the buyer confirms it.
 */
export async function extractAddressFromDocuments(input: {
  businessId: string;
  installedAgentId?: string | null;
}): Promise<AddressSuggestion | null> {
  const chunks = await prisma.businessKnowledgeBase.findMany({
    where: {
      businessId: input.businessId,
      sourceFileId: { not: null },
      ...(input.installedAgentId === undefined
        ? {}
        : { OR: [{ installedAgentId: null }, { installedAgentId: input.installedAgentId }] })
    },
    select: { content: true, sourceFile: { select: { filename: true } } },
    orderBy: { createdAt: "asc" }
  });

  for (const chunk of chunks) {
    // Join wrapped lines so "1234 Sunset Boulevard,\nLas Vegas, Nevada 89109"
    // (and heading/value layouts) become one searchable string.
    const flattened = (chunk.content ?? "").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ");

    const streetMatch = flattened.match(STREET_LINE);
    if (!streetMatch) continue;

    const afterStreet = flattened.slice((streetMatch.index ?? 0) + streetMatch[0].length);
    const cityMatch = afterStreet.slice(0, 120).match(CITY_STATE_ZIP);

    const line1 = streetMatch[1].replace(/[.,]+$/, "").trim();
    if (!cityMatch) {
      // Street alone is not confident enough to suggest.
      continue;
    }

    const city = cityMatch[1].trim();
    const state = cityMatch[2].trim();
    const postalCode = cityMatch[3].trim();

    return {
      formatted: `${line1}, ${city}, ${state} ${postalCode}`,
      line1,
      city,
      state,
      postalCode,
      sourceFilename: chunk.sourceFile?.filename ?? null
    };
  }

  return null;
}

/* ------------------------- suggestion comparison -------------------------- */

/** Street-type abbreviations that must compare equal ("Blvd" = "Boulevard"). */
const STREET_ABBREVIATIONS: Record<string, string> = {
  blvd: "boulevard",
  st: "street",
  rd: "road",
  ave: "avenue",
  av: "avenue",
  dr: "drive",
  ln: "lane",
  hwy: "highway",
  pkwy: "parkway",
  ct: "court",
  pl: "place",
  sq: "square",
  ter: "terrace"
};

function normalizeAddressPart(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_ABBREVIATIONS[word] ?? word)
    .join(" ");
}

function streetNumberOf(line1: string | null | undefined): string | null {
  return (line1 ?? "").match(/\d{1,6}/)?.[0] ?? null;
}

export function addressesMateriallyDiffer(
  confirmed: Pick<BusinessAddress, "line1" | "city" | "postalCode">,
  suggestion: Pick<AddressSuggestion, "line1" | "city" | "postalCode">
): boolean {
  const confirmedNumber = streetNumberOf(confirmed.line1);
  const suggestedNumber = streetNumberOf(suggestion.line1);
  if (confirmedNumber && suggestedNumber && confirmedNumber !== suggestedNumber) return true;

  const confirmedPostal = (confirmed.postalCode ?? "").replace(/\s+/g, "").toLowerCase();
  const suggestedPostal = (suggestion.postalCode ?? "").replace(/\s+/g, "").toLowerCase();
  if (confirmedPostal && suggestedPostal && confirmedPostal !== suggestedPostal) return true;

  const confirmedCity = normalizeAddressPart(confirmed.city);
  const suggestedCity = normalizeAddressPart(suggestion.city);
  if (confirmedCity && suggestedCity && confirmedCity !== suggestedCity) return true;

  // Same street number backed by the same postal code or city — same place,
  // however the street name happens to be abbreviated.
  const sameNumber = Boolean(confirmedNumber && suggestedNumber && confirmedNumber === suggestedNumber);
  const samePostal = Boolean(confirmedPostal && suggestedPostal && confirmedPostal === suggestedPostal);
  const sameCity = Boolean(confirmedCity && suggestedCity && confirmedCity === suggestedCity);
  if (sameNumber && (samePostal || sameCity)) return false;

  return normalizeAddressPart(confirmed.line1) !== normalizeAddressPart(suggestion.line1);
}
