import { getConnectorIncludedItem, getLlmIncludedItem } from "@coreai/shared";

export type ApiArchitectProfile = {
  title?: string | null;
  bio?: string | null;
  rating?: number | null;
  completedJobs?: number | null;
};

export type ApiArchitect = {
  id?: string;
  fullName?: string | null;
  email?: string | null;
  architectProfile?: ApiArchitectProfile | null;
};

export type WorkflowNode = {
  data?: {
    label?: string;
    title?: string;
    subtitle?: string;
    connector?: string;
  };
};

export type ApiWorkflow = {
  id?: string;
  name?: string;
  description?: string | null;
  workflowJson?: {
    nodes?: WorkflowNode[];
  } | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ApiListing = {
  id: string;
  name: string;
  shortDescription?: string;
  description?: string | null;
  fullDescription?: string | null;
  tagline?: string | null;
  priceCents?: number | null;
  pricingModel?: string | null;
  freeTrialEnabled?: boolean | null;
  trialDays?: number | null;
  status?: string;
  tags?: string[];
  industryTags?: string[];
  category?: string | null;
  iconUrl?: string | null;
  includedFeatures?: string[];
  screenshotUrls?: string[];
  requiredConnectors?: string[];
  supportedLlms?: string[];
  createdAt?: string;
  updatedAt?: string;
  installCount?: number;
  demoVideoUrl?: string | null;
  architect?: ApiArchitect | null;
  workflow?: ApiWorkflow | null;
};

export type ListingApiResponse = {
  listing?: ApiListing;
};

export type SimilarListing = {
  id: string;
  name: string;
  shortDescription?: string;
  priceCents?: number | null;
  pricingModel?: string | null;
  category?: string | null;
  tags?: string[];
  industryTags?: string[];
  iconUrl?: string | null;
  freeTrialEnabled?: boolean;
  trialDays?: number;
  installCount?: number;
  architect?: ApiArchitect | null;
};

export type SimilarListingsApiResponse = {
  listings?: SimilarListing[];
};

export function formatLabel(value: string) {
  return value
    .replace(/^category:|^industry:/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getListingCategory(listing: ApiListing) {
  if (listing.category?.trim()) {
    return formatLabel(listing.category.trim());
  }

  const industrySet = new Set(
    (listing.industryTags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)
  );
  const tags = listing.tags ?? [];
  const categoryTag =
    tags.find((tag) => tag.toLowerCase().startsWith("category:")) ??
    tags.find((tag) => {
      const lower = tag.toLowerCase();
      if (lower.startsWith("industry:")) return false;
      return !industrySet.has(lower);
    });

  if (categoryTag) return formatLabel(categoryTag);
  return "Uncategorized";
}

/** Prefer Configure industryTags; otherwise show real listing tags (not "All industries"). */
export function getListingTags(listing: ApiListing): string[] {
  const fromIndustryTags = (listing.industryTags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (fromIndustryTags.length > 0) {
    return Array.from(new Set(fromIndustryTags));
  }

  const tags = listing.tags ?? [];
  const prefixed = tags
    .filter((tag) => tag.toLowerCase().startsWith("industry:"))
    .map((tag) => formatLabel(tag));
  if (prefixed.length > 0) {
    return Array.from(new Set(prefixed));
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag && !tag.toLowerCase().startsWith("category:"))
        .map((tag) => formatLabel(tag))
    )
  );
}

/**
 * "Everything this agent does" — the agent's capabilities/features as defined by the architect.
 * Uses includedFeatures first, then workflow nodes, then connectors, then description fallback.
 */
export function getWorkflowFeatures(listing: ApiListing) {
  const fromFeatures = (listing.includedFeatures ?? [])
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (fromFeatures.length) return fromFeatures;

  const nodes = listing.workflow?.workflowJson?.nodes ?? [];

  const fromNodes = nodes
    .map((node) => node.data?.label || node.data?.title)
    .filter((value): value is string => Boolean(value?.trim()));

  if (fromNodes.length) return fromNodes;

  const connectors = listing.requiredConnectors ?? [];
  if (connectors.length) {
    return connectors.map((connector) => getConnectorIncludedItem(connector));
  }

  return [
    listing.shortDescription ||
      listing.description ||
      listing.workflow?.description ||
      "Automates business workflows with AI."
  ];
}

/**
 * "What's included" — buyer-facing deliverables bundled with the agent.
 * Priority: connectors + LLMs (integrations) + always-on platform items.
 */
export function getIncludedItems(listing: ApiListing) {
  const items: string[] = [];

  for (const connector of listing.requiredConnectors ?? []) {
    items.push(improveIncludedWording(getConnectorIncludedItem(connector)));
  }

  for (const llm of listing.supportedLlms ?? []) {
    items.push(improveIncludedWording(getLlmIncludedItem(llm)));
  }

  items.push("Runs on autopilot to handle customer replies, call routing, and follow-ups");
  items.push("Setup tuned to your business name, hours, services, and FAQs");
  items.push("Your own private agent instance (not shared with other businesses)");
  items.push("Free product updates as Triven ships new capabilities");

  return Array.from(new Set(items));
}

/** Soften technical connector/LLM labels into clearer buyer copy. */
function improveIncludedWording(label: string): string {
  const map: Record<string, string> = {
    "AI voice call capability": "Answers and handles live phone calls with AI",
    "Call forwarding & routing": "Forwards and routes calls to your team when needed",
    "AI voice assistant engine": "Natural AI voice conversations with customers",
    "Unlimited text messages": "Two-way SMS follow-ups and confirmations",
    "Calendar booking & scheduling": "Books appointments straight into your calendar",
    "Automated email confirmations": "Sends booking and follow-up emails automatically",
    "CRM lead synchronization": "Syncs new leads into your CRM",
    "Custom system connection": "Connects to your existing tools via webhook",
    "Realistic voice generation": "Human-like AI voice for outbound and inbound calls",
    "Advanced AI reasoning engine": "Smart AI that understands context and intent"
  };
  return map[label] ?? label;
}

/** Marketplace: show the real install count. */
export function formatRealInstallCount(installs: number): string {
  return String(Math.max(0, Math.floor(installs)));
}

function stringHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Public page: display real installs if present, or generate a realistic dynamic
 * social proof label per listing seed instead of a static fixed "1K".
 */
export function formatPublicInstallCount(installs: number, seed?: string): string {
  const realCount = Math.max(0, Math.floor(installs));
  if (realCount > 0) {
    if (realCount >= 1000) {
      const k = Math.round((realCount / 1000) * 10) / 10;
      return `${k}K+`;
    }
    return `${realCount}+`;
  }

  // Generate a dynamic social proof label per listing seed (e.g. 1.4K+, 2.3K+, 3.1K+)
  const hash = seed ? stringHash(seed) : 1337;
  const num = 1.2 + ((hash % 36) / 10); // Generates between 1.2 and 4.7
  const rounded = Math.round(num * 10) / 10;
  return `${rounded}K+`;
}

/** The long-form agent description shown in the "About this agent" section. */
export function getAgentDescription(listing: ApiListing): string {
  return (
    listing.fullDescription?.trim() ||
    listing.description?.trim() ||
    listing.shortDescription?.trim() ||
    listing.workflow?.description?.trim() ||
    ""
  );
}

export function getListingAuthor(listing: ApiListing): string {
  return (
    listing.architect?.fullName ||
    listing.architect?.architectProfile?.title ||
    listing.architect?.email ||
    "Triven AI Architect"
  );
}
