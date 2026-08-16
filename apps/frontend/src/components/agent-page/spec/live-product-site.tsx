"use client";

import { useMemo } from "react";
import type { PageSpec, ProductSpec } from "@coreai/shared";
import { createPublicAgentPageRuntime } from "../types";
import { ProductSite } from "./site/product-site";
import { SpecRunProvider } from "./spec-run";
import { buildSpecTheme } from "./spec-theme";
import { useWiredNodeRenderer } from "./wired-nodes";

/**
 * The published product site with its wires live.
 *
 * `ProductSite` paints the chrome and the page but deliberately knows nothing
 * about running an agent — it exposes a `renderNode` seam instead. This is the
 * component that fills that seam on a real /a/<slug> route: it opens the
 * public runtime for the slug, mounts the shared run state, and hands the
 * wired-node renderer down.
 *
 * Rendering `ProductSite` directly is still the right call anywhere the page
 * should look right without doing anything — a crawler, a screenshot, the
 * builder's static preview. There, every socket paints itself inert.
 */

export type LiveProductSiteProps = {
  /** The published page slug — the /a/<slug> segment. */
  slug: string;
  /** The sanitized product. */
  product: ProductSpec;
  /** The page being shown. Must be one of `product.pages`. */
  page: PageSpec;
  /** Listing name — used for generated-media download filenames. */
  listingName?: string;
};

export function LiveProductSite({ slug, product, page, listingName }: LiveProductSiteProps) {
  // The same public runtime the block-rendered pages use: POST
  // /agent-pages/<slug>/run, byte-for-byte on the wire.
  const runtime = useMemo(() => createPublicAgentPageRuntime(slug), [slug]);
  const renderNode = useWiredNodeRenderer();
  // Charts need a concrete hex, and the theme is the one place a color is
  // decided — so it is resolved once, here.
  const accent = useMemo(
    () => buildSpecTheme(product.theme).accent,
    [product.theme?.accent, product.theme?.mode, product.theme?.font] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <SpecRunProvider
      page={page}
      runtime={runtime}
      accent={accent}
      listingName={listingName}
    >
      <ProductSite slug={slug} product={product} page={page} renderNode={renderNode} />
    </SpecRunProvider>
  );
}

export default LiveProductSite;
