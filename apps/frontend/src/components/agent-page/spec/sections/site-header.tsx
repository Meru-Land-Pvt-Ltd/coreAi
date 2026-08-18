"use client";

import { useCallback, useEffect, useId, useState } from "react";
import type { MouseEvent } from "react";
import type { NavLink } from "@coreai/shared";
import { InteractiveSlot, SECTION_TEST_IDS } from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionSurface } from "./tokens";
import type { ChromeProps, SectionContext } from "./types";

/**
 * Site header — brand, page links, one call to action, and a real mobile menu.
 *
 * Driven by `ProductSpec.nav`, not by a spec node, because the same header sits
 * on every page of the product. The menu button is a proper disclosure
 * (`aria-expanded` + `aria-controls`), closes on Escape and closes when a link
 * is chosen, so a phone visitor is never trapped behind an open panel.
 */

function hrefFor(ctx: SectionContext | undefined, pageId: string): string {
  return ctx?.hrefForPage?.(pageId) ?? "#";
}

function HeaderLink({
  link,
  ctx,
  surface,
  onDone,
  className,
  testId
}: {
  link: NavLink;
  ctx?: SectionContext;
  surface: SectionSurface;
  onDone?: () => void;
  className?: string;
  testId: string;
}) {
  const active = Boolean(ctx?.currentPageId) && ctx?.currentPageId === link.pageId;
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (ctx?.onNavigate) {
      event.preventDefault();
      ctx.onNavigate(link.pageId);
    }
    onDone?.();
  };
  return (
    <a
      href={hrefFor(ctx, link.pageId)}
      onClick={handleClick}
      data-testid={testId}
      data-page-id={link.pageId}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none ${
        active ? "font-semibold" : "font-medium"
      } ${className ?? ""}`}
      style={{
        color: active ? surface.accentInk : surface.inkMuted,
        // @ts-expect-error -- custom property drives the focus ring color
        "--tw-ring-color": withAlpha(surface.accent, 0.35)
      }}
    >
      {link.label}
    </a>
  );
}

export function SiteHeader({ nav, ctx, cta }: ChromeProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, "plain");
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const links = nav.links ?? [];
  const brandText = nav.brand?.text?.trim();
  const brandLogo = nav.brand?.logoUrl;
  const homeHref = hrefFor(ctx, "home");

  const brand = brandText || brandLogo ? (
    <a
      href={homeHref}
      data-testid="spec-header-brand"
      onClick={(event) => {
        if (ctx?.onNavigate) {
          event.preventDefault();
          ctx.onNavigate("home");
        }
        close();
      }}
      className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-4"
      style={{
        color: surface.ink,
        // @ts-expect-error -- custom property drives the focus ring color
        "--tw-ring-color": withAlpha(surface.accent, 0.35)
      }}
    >
      {brandLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brandLogo} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
      ) : null}
      {brandText ? (
        <span className="truncate text-base font-semibold tracking-tight sm:text-lg">{brandText}</span>
      ) : null}
    </a>
  ) : (
    <span />
  );

  return (
    <header
      data-testid={SECTION_TEST_IDS.siteHeader}
      className="sticky top-0 z-50 w-full backdrop-blur"
      style={{
        backgroundColor: withAlpha(tokens.ground, 0.88),
        borderBottom: `1px solid ${surface.border}`,
        color: surface.ink,
        fontFamily: tokens.fontFamily
      }}
    >
      <div className="mx-auto flex h-16 w-full items-center justify-between gap-3 px-5 sm:px-6 lg:max-w-[var(--spec-measure,72rem)] lg:px-8">
        {brand}

        {links.length > 0 ? (
          <nav data-testid="spec-header-nav" aria-label="Pages" className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <HeaderLink key={`${link.pageId}-${link.label}`} link={link} ctx={ctx} surface={surface} testId="spec-header-link" />
            ))}
          </nav>
        ) : null}

        <div className="flex shrink-0 items-center gap-2">
          {cta ? (
            <div className="hidden md:block" data-testid="spec-header-cta">
              <InteractiveSlot node={{ ...cta, size: "sm", variant: cta.variant ?? "primary" }} ctx={ctx} surface={surface} />
            </div>
          ) : null}

          {links.length > 0 || cta ? (
            <button
              type="button"
              data-testid="spec-header-menu-toggle"
              aria-expanded={open}
              aria-controls={menuId}
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((value) => !value)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none md:hidden"
              style={{
                border: `1px solid ${surface.borderStrong}`,
                color: surface.ink,
                // @ts-expect-error -- custom property drives the focus ring color
                "--tw-ring-color": withAlpha(surface.accent, 0.35)
              }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                {open ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div
          id={menuId}
          data-testid="spec-header-mobile-menu"
          className="md:hidden"
          style={{ borderTop: `1px solid ${surface.border}`, backgroundColor: tokens.ground }}
        >
          <nav aria-label="Pages" className="mx-auto flex w-full flex-col gap-1 px-4 py-4 sm:px-6 lg:max-w-[var(--spec-measure,72rem)]">
            {links.map((link) => (
              <HeaderLink
                key={`m-${link.pageId}-${link.label}`}
                link={link}
                ctx={ctx}
                surface={surface}
                onDone={close}
                testId="spec-header-mobile-link"
                className="w-full !px-3 !py-3 text-base"
              />
            ))}
            {cta ? (
              <div className="mt-2" data-testid="spec-header-mobile-cta">
                <InteractiveSlot
                  node={{ ...cta, variant: cta.variant ?? "primary" }}
                  ctx={ctx}
                  surface={surface}
                  fullWidthOnMobile
                />
              </div>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
