import type { CrmProvider } from "@prisma/client";

/**
 * CRM provider catalog.
 *
 * Triven is the AI layer on top of the customer's CRM, not a replacement — so
 * the buyer UI always shows a provider picker even while only one adapter is
 * live. Adding a CRM later is: add the enum value, add modules/crm/<provider>/,
 * flip status to "live" here. The frontend switcher needs no layout change.
 */

export type CrmProviderStatus = "live" | "coming_soon";

/** Ids the UI can render. Only `live` ones exist in the CrmProvider enum. */
export type CrmCatalogId = "HUBSPOT" | "SALESFORCE" | "ZOHO" | "PIPEDRIVE";

export interface CrmCatalogEntry {
  id: CrmCatalogId;
  name: string;
  description: string;
  status: CrmProviderStatus;
}

export const CRM_CATALOG: readonly CrmCatalogEntry[] = [
  {
    id: "HUBSPOT",
    name: "HubSpot",
    description: "Use HubSpot contacts, deals and notes as live customer context on calls",
    status: "live"
  },
  {
    id: "SALESFORCE",
    name: "Salesforce",
    description: "Use Salesforce records as customer context on calls",
    status: "coming_soon"
  },
  {
    id: "ZOHO",
    name: "Zoho CRM",
    description: "Use Zoho CRM records as customer context on calls",
    status: "coming_soon"
  },
  {
    id: "PIPEDRIVE",
    name: "Pipedrive",
    description: "Use Pipedrive records as customer context on calls",
    status: "coming_soon"
  }
] as const;

export function findCatalogEntry(id: string): CrmCatalogEntry | null {
  return CRM_CATALOG.find((entry) => entry.id === id) ?? null;
}

export function isLiveProvider(id: string): id is CrmProvider {
  const entry = findCatalogEntry(id);
  return Boolean(entry && entry.status === "live");
}

export function providerDisplayName(id: string | null | undefined): string {
  if (!id) return "CRM";
  return findCatalogEntry(id)?.name ?? id;
}
