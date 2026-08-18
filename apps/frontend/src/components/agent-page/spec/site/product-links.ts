import type { Route } from "next";
import type { PageSpec, ProductSpec } from "@coreai/shared";

/**
 * URLs for a published product's pages.
 *
 * The shape of the public site, in one place:
 *
 *   home        → /a/<slug>
 *   every other → /a/<slug>/<page.path>
 *
 * `PageSpec.path` is already slug-safe (the sanitizer slugifies it and gives
 * exactly one page the empty root path), but everything here is encoded again
 * anyway — these strings become hrefs, and a URL builder that trusts its input
 * is a URL builder that eventually paints someone else's link.
 *
 * Typed routes are on, so every return is cast to `Route`; /a/<slug> is a
 * dynamic segment Next cannot check for us.
 */

/** The product's front door. */
export function productHomePath(slug: string): Route {
  return `/a/${encodeURIComponent(slug)}` as Route;
}

/** The URL for one page of the product. Home always collapses to /a/<slug>. */
export function productPagePath(slug: string, path: string | null | undefined): Route {
  const clean = (path ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.toLowerCase() === "home") return productHomePath(slug);
  return `/a/${encodeURIComponent(slug)}/${encodeURIComponent(clean)}` as Route;
}

/** The URL for a page referenced by id (how nav links point at pages). */
export function productPathForPageId(spec: ProductSpec, slug: string, pageId: string): Route {
  const page = spec.pages.find((entry) => entry.id === pageId);
  return productPagePath(slug, page?.path ?? "");
}

/** The page the site's header/footer treat as home. */
export function productHomePage(spec: ProductSpec): PageSpec | null {
  return spec.pages.find((page) => page.id === "home") ?? spec.pages[0] ?? null;
}
