import type { Metadata } from "next";
import { findPage } from "@coreai/shared";
import { LiveProductSite } from "@/components/agent-page/spec/live-product-site";
import { LegacyAgentPage } from "./legacy-agent-page";
import { loadPublicProduct } from "./product-data";
import { buildProductMetadata } from "./product-metadata";

/**
 * The product's front door: triven.ai/a/<slug>.
 *
 * Two paths, decided on the server:
 *
 *   • **The architect designed a product** (`source === "spec"`) — the page is
 *     rendered from the ProductSpec: site header, the page's blocks, site
 *     footer. It is server-rendered, so the marketing copy is in the HTML a
 *     crawler receives, not assembled after a client fetch.
 *
 *   • **Everything else** — the page renders exactly as it always has, through
 *     `LegacyAgentPage`. That covers every agent published before the Product
 *     Spec existed, an unreachable API, and an unknown slug (which keeps its
 *     own "this agent isn't available" card and its retry). Zero regression is
 *     the whole point of this branch.
 *
 * The sub-pages live in ./[page]; this route is only ever the home page.
 */

type HomeRouteProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: HomeRouteProps): Promise<Metadata> {
  const { slug } = await params;
  return buildProductMetadata({ slug, path: "" });
}

export default async function PublishedProductHomePage({ params }: HomeRouteProps) {
  const { slug } = await params;

  const resolved = await loadPublicProduct(slug);
  if (!resolved || resolved.source !== "spec") {
    return <LegacyAgentPage slug={slug} />;
  }

  const page = findPage(resolved.product, "");
  // A sanitized spec always has a home page; if one ever does not, the agent
  // still deserves to render.
  if (!page) return <LegacyAgentPage slug={slug} />;

  return (
    <LiveProductSite
      slug={slug}
      product={resolved.product}
      page={page}
      listingName={resolved.listing.name}
      contentWidth={resolved.contentWidth}
    />
  );
}
