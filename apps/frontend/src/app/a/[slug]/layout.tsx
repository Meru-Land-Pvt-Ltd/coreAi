import type { ReactNode } from "react";

/**
 * Shell for a published product (/a/<slug> and /a/<slug>/<page>).
 *
 * Deliberately empty: the product paints its own chrome from `ProductSpec.nav`
 * and must never inherit Triven's marketing frame — a customer visiting an
 * architect's product is visiting THEIR site.
 *
 * Metadata used to be built here, for the home route only. It now lives on
 * each page (`./product-metadata.ts`), because a multi-page product needs a
 * title, description, canonical and OG image PER PAGE, and only the page knows
 * which one it is. The two routes share one cached fetch, so this is not an
 * extra round trip.
 */
export default function PublishedProductLayout({ children }: { children: ReactNode }) {
  return children;
}
