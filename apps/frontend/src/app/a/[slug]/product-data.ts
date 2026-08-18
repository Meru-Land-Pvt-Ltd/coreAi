import { cache } from "react";
import { sanitizeProductSpec, type ProductSpec } from "@coreai/shared";
import type { ContentWidth } from "@/components/agent-page/types";

/**
 * Server-side read of a published product (GET /agent-pages/:slug/product).
 *
 * Runs on the server, where the axios client in src/lib/api.ts (browser
 * interceptors, localStorage token) does not belong — same resolution the
 * layout has always used.
 *
 * Two rules this file exists to enforce:
 *
 *   1. **Never throws.** A missing agent, an unreachable API and a malformed
 *      payload all resolve to `null`. The routes decide what a visitor sees;
 *      an API hiccup must never turn into an error page for a live product.
 *   2. **Re-sanitize.** The spec is sanitized on the way out of the backend,
 *      but the renderer's guarantees are only worth what the last checkpoint
 *      before painting is worth. `sanitizeProductSpec` runs again here, so no
 *      unvalidated JSON ever reaches a component.
 */

// Same resolution as src/lib/api.ts.
/**
 * The API base, resolved for a SERVER-side fetch.
 *
 * In production NEXT_PUBLIC_API_URL is "/api" — correct in a browser, fatal
 * here: Node's fetch cannot parse a relative URL, so every call threw, every
 * product resolved to null, and every published page quietly fell back to the
 * legacy template. A spec-designed product had never once rendered publicly.
 * A relative value is therefore made absolute against the site's own origin.
 */
function resolveApiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").trim();
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");

  const site = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://triven.ai"
  ).replace(/\/$/, "");
  return `${site}${raw.startsWith("/") ? raw : `/${raw}`}`.replace(/\/$/, "");
}

const API_URL = resolveApiBase();

/** Freshness a marketing page can live with; a publish is not a live edit. */
const REVALIDATE_SECONDS = 60;

export type PublicProductListing = {
  id: string;
  name: string;
  tagline: string | null;
  shortDescription: string | null;
  iconUrl: string | null;
};

export type PublicProductPage = {
  headline: string | null;
  welcomeMessage: string | null;
};

export type PublicProduct = {
  slug: string;
  /** "spec" = the architect's stored design. "blueprint" = synthesized. */
  source: "spec" | "blueprint";
  product: ProductSpec;
  page: PublicProductPage;
  listing: PublicProductListing;
  architect: { displayName: string; photoUrl: string | null } | null;
  /**
   * How wide the architect wants the product to run on large screens. Only
   * this one design dial is read here — the rest of the design belongs to the
   * legacy template pages. An unknown or missing value reads as "standard".
   */
  contentWidth: ContentWidth;
};

type ProductResponse = {
  success?: boolean;
  data?: {
    slug?: string;
    source?: string;
    product?: unknown;
    page?: { headline?: string | null; welcomeMessage?: string | null } | null;
    listing?: {
      id?: string;
      name?: string;
      tagline?: string | null;
      shortDescription?: string | null;
      iconUrl?: string | null;
    } | null;
    architect?: { displayName?: string; photoUrl?: string | null } | null;
    design?: { contentWidth?: unknown } | null;
  };
};

const CONTENT_WIDTHS: ContentWidth[] = ["compact", "standard", "wide", "full"];

/** The stored width dial, or "standard" for anything unrecognized. */
function resolveContentWidth(value: unknown): ContentWidth {
  return CONTENT_WIDTHS.find((width) => width === value) ?? "standard";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The product for a slug, or null when there is nothing publicly renderable.
 *
 * `cache` de-duplicates the call inside one request, so `generateMetadata` and
 * the page body share a single fetch.
 */
export const loadPublicProduct = cache(async (slug: string): Promise<PublicProduct | null> => {
  if (!slug) return null;

  try {
    const response = await fetch(`${API_URL}/agent-pages/${encodeURIComponent(slug)}/product`, {
      next: { revalidate: REVALIDATE_SECONDS }
    });
    if (!response.ok) return null;

    const json = (await response.json()) as ProductResponse;
    const data = json?.data;
    if (!json?.success || !data) return null;

    const product = sanitizeProductSpec(data.product);
    const name = text(data.listing?.name);
    if (!product || !name) return null;

    const architectName = text(data.architect?.displayName);

    return {
      slug: text(data.slug) ?? slug,
      source: data.source === "spec" ? "spec" : "blueprint",
      product,
      page: {
        headline: text(data.page?.headline),
        welcomeMessage: text(data.page?.welcomeMessage)
      },
      listing: {
        id: text(data.listing?.id) ?? "",
        name,
        tagline: text(data.listing?.tagline),
        shortDescription: text(data.listing?.shortDescription),
        iconUrl: text(data.listing?.iconUrl)
      },
      architect: architectName
        ? { displayName: architectName, photoUrl: text(data.architect?.photoUrl) }
        : null,
      contentWidth: resolveContentWidth(data.design?.contentWidth)
    };
  } catch {
    // Unreachable API, invalid JSON, aborted request — the caller falls back.
    return null;
  }
});
