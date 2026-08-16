"use client";

import { usePathname } from "next/navigation";
import { MARKETPLACE_PATH } from "@/lib/routes";
import { ProductPageMissing, productHomePath } from "@/components/agent-page/spec/site";

/**
 * The 404 boundary for a product's sub-pages.
 *
 * Reached whenever ./page.tsx calls `notFound()` — an unknown page, or a slug
 * that is not publicly live. Being a real Next 404 boundary is the point: the
 * response carries a 404 status, so a mistyped link is never indexed as if it
 * were a page of the product.
 *
 * The route's params are not handed to a not-found boundary, so the slug is
 * read back off the path (/a/<slug>/<page>) to point "back to home" at the
 * product the visitor was actually trying to reach. Without a slug — which
 * should not happen — the link falls back to the marketplace.
 */

function slugFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "a" || !segments[1]) return null;
  try {
    return decodeURIComponent(segments[1]);
  } catch {
    return segments[1];
  }
}

export default function ProductSubPageNotFound() {
  const slug = slugFromPathname(usePathname());

  return (
    <div className="flex min-h-[100dvh] w-full flex-col">
      <ProductPageMissing
        homeHref={slug ? productHomePath(slug) : MARKETPLACE_PATH}
        homeLabel={slug ? "Back to home" : "Explore agents"}
        body={
          slug
            ? "The link may be out of date, or the page may have been renamed. Everything else is still right here."
            : "This page isn't available. It may have moved or is no longer published."
        }
      />
    </div>
  );
}
