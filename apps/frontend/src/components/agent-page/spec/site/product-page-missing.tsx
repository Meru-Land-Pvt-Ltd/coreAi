"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ProductTheme } from "@coreai/shared";
import { sectionTokens, surfaceFor, withAlpha } from "../sections";

/**
 * The friendly dead end.
 *
 * A visitor who typed /a/<slug>/pricng gets a card in the product's own colors
 * and one obvious way back — never a stack trace, never a bare "404", and
 * never a dead end. The link is a real Next `<Link>`, so returning home is a
 * client-side push with the page already prefetched.
 */

export type ProductPageMissingProps = {
  /** Where "back home" goes. Always the product's own front door. */
  homeHref: Route;
  /** The product's theme, when we know which product the visitor is inside. */
  theme?: ProductTheme | null;
  title?: string;
  body?: string;
  homeLabel?: string;
};

export function ProductPageMissing({
  homeHref,
  theme,
  title = "We couldn't find that page",
  body = "The link may be out of date, or the page may have been renamed. Everything else is still right here.",
  homeLabel = "Back to home"
}: ProductPageMissingProps) {
  const tokens = sectionTokens(theme?.mode, theme?.accent, theme?.font);
  const surface = surfaceFor(tokens, "plain");

  return (
    <div
      data-testid="product-page-not-found"
      className="flex w-full flex-1 items-center justify-center px-5 py-20 sm:px-6 sm:py-28"
      style={{ backgroundColor: tokens.ground, fontFamily: tokens.fontFamily }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center sm:p-10"
        style={{
          backgroundColor: surface.card,
          border: `1px solid ${surface.border}`,
          color: surface.ink
        }}
      >
        <span
          data-testid="product-page-not-found-code"
          className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide"
          style={{ backgroundColor: withAlpha(surface.accent, 0.14), color: surface.accentInk }}
        >
          404
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-2.5 text-sm leading-relaxed" style={{ color: surface.inkMuted }}>
          {body}
        </p>
        <Link
          href={homeHref}
          data-testid="product-page-home-link"
          className="mt-6 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none"
          style={{
            backgroundColor: surface.accent,
            color: surface.onAccent,
            // @ts-expect-error -- custom property drives the focus ring color
            "--tw-ring-color": withAlpha(surface.accent, 0.35)
          }}
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}

export default ProductPageMissing;
