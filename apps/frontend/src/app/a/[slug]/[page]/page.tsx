import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { findPage } from "@coreai/shared";
import { productHomePath } from "@/components/agent-page/spec/site";
import { LiveProductSite } from "@/components/agent-page/spec/live-product-site";
import { loadPublicProduct } from "../product-data";
import { buildProductMetadata } from "../product-metadata";

/**
 * A sub-page of a published product: triven.ai/a/<slug>/<page>.
 *
 * `pricing`, `about`, `privacy`, `terms`, `contact`, `thanks` or any custom
 * slug the architect wrote — the route does not know or care which. It resolves
 * the product, finds the page whose `path` matches, and renders it inside the
 * same site chrome as the home page.
 *
 * Three deliberate behaviors:
 *
 *   • **`/a/<slug>/home` redirects to `/a/<slug>`.** One page, one URL — a
 *     product should never be indexed twice for the same content.
 *   • **An unknown page is a real 404**, not a card served with a 200. Search
 *     engines are told the truth; the visitor sees ./not-found.tsx, which is a
 *     friendly card with a link back into the product.
 *   • **An agent with no stored ProductSpec has exactly one page.** Every
 *     sub-page under it 404s, which is what it did before this route existed.
 */

type PageRouteProps = { params: Promise<{ slug: string; page: string }> };

export async function generateMetadata({ params }: PageRouteProps): Promise<Metadata> {
  const { slug, page } = await params;
  return buildProductMetadata({ slug, path: page });
}

export default async function PublishedProductSubPage({ params }: PageRouteProps) {
  const { slug, page: pagePath } = await params;

  const resolved = await loadPublicProduct(slug);
  if (!resolved) notFound();

  const page = findPage(resolved.product, pagePath);
  if (!page) notFound();

  // The home page owns /a/<slug>. Reaching it through a sub-path (or through
  // an agent that only has a home page) is a redirect, not a second copy.
  if (page.path === "") redirect(productHomePath(slug));

  // A synthesized product is a single page — nothing here can resolve.
  if (resolved.source !== "spec") notFound();

  return (
    <LiveProductSite
      slug={slug}
      product={resolved.product}
      page={page}
      listingName={resolved.listing.name}
    />
  );
}
