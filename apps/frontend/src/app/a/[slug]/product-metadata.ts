import type { Metadata } from "next";
import { findPage } from "@coreai/shared";
import { SITE_NAME, absoluteUrl } from "@/lib/site-metadata";
import { loadPublicProduct, type PublicProduct } from "./product-data";

/**
 * Server-side metadata for a published product page.
 *
 * Architects paste /a/<slug> URLs into socials and DMs and search engines
 * index every page of the product, so each page carries its OWN title,
 * description and canonical — never one generic card for the whole site.
 *
 * The pre-Product-Spec contract is preserved exactly: for an agent that has no
 * stored spec, the home page still resolves to the listing name plus the
 * architect's headline, which is byte-for-byte what the old layout produced.
 * Nothing about a live agent's unfurl changes when this ships.
 */

const FALLBACK_METADATA: Metadata = { title: "AI Agent" };

/** A page the product does not have. Friendly title, and never indexed. */
const NOT_FOUND_METADATA: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true }
};

function joinTitle(pageTitle: string, productName: string): string {
  const clean = pageTitle.trim();
  if (!clean || clean.toLowerCase() === productName.toLowerCase()) return productName;
  return `${clean} | ${productName}`;
}

/**
 * The description the page shipped with before the Product Spec existed:
 * headline first, then the listing's own copy.
 */
function legacyDescription(resolved: PublicProduct): string | undefined {
  return (
    resolved.page.headline ??
    resolved.listing.tagline ??
    resolved.listing.shortDescription ??
    undefined
  );
}

export type ProductMetadataInput = {
  slug: string;
  /** "" for the home page, else the sub-page segment. */
  path: string;
};

export async function buildProductMetadata({ slug, path }: ProductMetadataInput): Promise<Metadata> {
  const resolved = await loadPublicProduct(slug);
  if (!resolved) return FALLBACK_METADATA;

  const page = findPage(resolved.product, path);
  if (!page) return NOT_FOUND_METADATA;

  const name = resolved.listing.name;
  const title = joinTitle(page.title, name);

  // A stored spec means the architect wrote this page's SEO on purpose; a
  // synthesized one means we are still serving the pre-spec contract.
  const description =
    resolved.source === "spec"
      ? (page.seo?.description ?? legacyDescription(resolved))
      : legacyDescription(resolved);

  // A page's own OG image is a wide social card; the listing icon is a square
  // avatar, so it keeps the small card it has always had.
  const ogImage = page.seo?.ogImageUrl ?? undefined;
  const image = ogImage ?? resolved.listing.iconUrl ?? undefined;
  const socialTitle = `${title} | ${SITE_NAME}`;
  const encodedSlug = encodeURIComponent(slug);
  const canonical = absoluteUrl(page.path ? `/a/${encodedSlug}/${page.path}` : `/a/${encodedSlug}`);

  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical },
    openGraph: {
      title: socialTitle,
      ...(description ? { description } : {}),
      url: canonical,
      siteName: name,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {})
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: socialTitle,
      ...(description ? { description } : {}),
      ...(image ? { images: [image] } : {})
    }
  };
}
