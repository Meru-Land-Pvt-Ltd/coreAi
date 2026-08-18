import type { CrmContactCache } from "@prisma/client";
import type { CrmContactDto } from "../dto/contacts";
import { toE164 } from "./phone";

/**
 * HubSpot property ⇄ Triven DTO mapping.
 *
 * Rule that drives every function here: NEVER invent a company, an email, or a
 * name. Consumer callers legitimately have none of those, and a fabricated
 * value would be written back into the customer's own CRM.
 */

export interface HubSpotContactProperties {
  firstname?: string | null;
  lastname?: string | null;
  phone?: string | null;
  mobilephone?: string | null;
  email?: string | null;
  company?: string | null;
  hubspot_owner_id?: string | null;
  lifecyclestage?: string | null;
  hs_lead_status?: string | null;
  createdate?: string | null;
  lastmodifieddate?: string | null;
  notes_last_updated?: string | null;
  hs_language?: string | null;
  [key: string]: string | null | undefined;
}

export interface HubSpotContact {
  id: string;
  properties: HubSpotContactProperties;
  createdAt?: string;
  updatedAt?: string;
}

/** Properties requested on every contact read. */
export const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "phone",
  "mobilephone",
  "email",
  "company",
  "hubspot_owner_id",
  "lifecyclestage",
  "hs_lead_status",
  "createdate",
  "lastmodifieddate",
  "notes_last_updated",
  "hs_language"
] as const;

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isoOrNull(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Display name. Falls back to the phone number — a consumer contact created
 * from a missed call has no name until someone speaks it, and "Unknown" reads
 * worse than the number the buyer can actually dial.
 */
export function contactDisplayName(params: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  const parts = [clean(params.firstName), clean(params.lastName)].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return clean(params.phone) ?? clean(params.email) ?? "Unknown caller";
}

/** Human-readable stage, preferring an explicit lead status over lifecycle. */
export function resolveStage(properties: HubSpotContactProperties): string | null {
  const leadStatus = clean(properties.hs_lead_status);
  const lifecycle = clean(properties.lifecyclestage);
  const raw = leadStatus ?? lifecycle;
  if (!raw) return null;

  // HubSpot stores these SHOUTING (IN_PROGRESS, SALESQUALIFIEDLEAD); lowercase
  // first so title-casing produces "In Progress", not "IN PROGRESS".
  return raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function mapHubSpotContact(
  contact: HubSpotContact,
  ownerNames?: Map<string, string>
): CrmContactDto {
  const properties = contact.properties ?? {};
  const phone = clean(properties.phone) ?? clean(properties.mobilephone);
  const ownerId = clean(properties.hubspot_owner_id);

  return {
    id: contact.id,
    firstName: clean(properties.firstname),
    lastName: clean(properties.lastname),
    name: contactDisplayName({
      firstName: properties.firstname,
      lastName: properties.lastname,
      phone,
      email: properties.email
    }),
    phone: toE164(phone) ?? phone,
    email: clean(properties.email),
    company: clean(properties.company),
    owner: ownerId ? ownerNames?.get(ownerId) ?? null : null,
    stage: resolveStage(properties),
    vip: isVipStage(properties),
    preferredLanguage: clean(properties.hs_language),
    customerSince: isoOrNull(properties.createdate ?? contact.createdAt),
    lastInteractionAt: isoOrNull(
      properties.notes_last_updated ?? properties.lastmodifieddate ?? contact.updatedAt
    ),
    insight: null
  };
}

/**
 * VIP is a portal convention, not a HubSpot primitive. Treat an explicit
 * `vip`-ish property as truth and never guess from spend or stage.
 */
function isVipStage(properties: HubSpotContactProperties): boolean {
  const raw = clean(properties.vip) ?? clean(properties.is_vip) ?? clean(properties.hs_vip);
  if (!raw) return false;
  return /^(true|yes|1)$/i.test(raw);
}

/** Cache row → DTO, so the table can render without touching HubSpot. */
export function mapCacheRow(row: CrmContactCache): CrmContactDto {
  const payload =
    row.payloadJson && typeof row.payloadJson === "object" && !Array.isArray(row.payloadJson)
      ? (row.payloadJson as Record<string, unknown>)
      : {};

  return {
    id: row.contactId,
    firstName: row.firstName,
    lastName: row.lastName,
    name: contactDisplayName({
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email
    }),
    phone: row.phone,
    email: row.email,
    company: row.company,
    owner: row.owner,
    stage: row.stage,
    vip: payload.vip === true,
    preferredLanguage: typeof payload.preferredLanguage === "string" ? payload.preferredLanguage : null,
    customerSince: typeof payload.customerSince === "string" ? payload.customerSince : null,
    lastInteractionAt: row.lastActivity ? row.lastActivity.toISOString() : null,
    insight: row.insight
  };
}

/**
 * Triven edit → HubSpot properties.
 *
 * Only keys the buyer actually changed are emitted. An explicit `null` clears
 * the property in HubSpot (sent as ""), while `undefined` leaves it untouched —
 * so blanking an email is possible, but omitting one never overwrites it.
 */
export function toHubSpotProperties(input: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  preferredLanguage?: string | null;
  stage?: string | null;
  vip?: boolean;
}): Record<string, string> {
  const properties: Record<string, string> = {};

  const assign = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    properties[key] = value === null ? "" : value.trim();
  };

  assign("firstname", input.firstName);
  assign("lastname", input.lastName);
  assign("email", input.email);
  assign("company", input.company);
  assign("hs_language", input.preferredLanguage);
  if (input.phone !== undefined) {
    properties.phone = input.phone === null ? "" : toE164(input.phone) ?? input.phone.trim();
  }
  if (input.stage !== undefined) assign("hs_lead_status", input.stage);
  if (input.vip !== undefined) properties.vip = input.vip ? "true" : "false";

  return properties;
}
