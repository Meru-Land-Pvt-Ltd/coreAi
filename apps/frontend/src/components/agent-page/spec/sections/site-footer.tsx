import type { MouseEvent } from "react";
import type { NavLink } from "@coreai/shared";
import { SECTION_TEST_IDS } from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionSurface } from "./tokens";
import type { ChromeProps, SectionContext } from "./types";

/**
 * Site footer — link columns, the architect's note, and a quiet closing rule.
 *
 * Links are chunked into at most three columns of four, which is the shape that
 * stays balanced whether the product has three pages or twelve. On a phone the
 * columns become two, never a single 12-item ladder.
 */

const MAX_COLUMNS = 3;
const LINKS_PER_COLUMN = 4;

function chunkLinks(links: NavLink[]): NavLink[][] {
  if (links.length === 0) return [];
  const columnCount = Math.min(MAX_COLUMNS, Math.ceil(links.length / LINKS_PER_COLUMN));
  const perColumn = Math.ceil(links.length / columnCount);
  const columns: NavLink[][] = [];
  for (let index = 0; index < links.length; index += perColumn) {
    columns.push(links.slice(index, index + perColumn));
  }
  return columns;
}

function FooterLink({
  link,
  ctx,
  surface
}: {
  link: NavLink;
  ctx?: SectionContext;
  surface: SectionSurface;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!ctx?.onNavigate) return;
    event.preventDefault();
    ctx.onNavigate(link.pageId);
  };
  return (
    <a
      href={ctx?.hrefForPage?.(link.pageId) ?? "#"}
      onClick={handleClick}
      data-testid="spec-footer-link"
      data-page-id={link.pageId}
      className="rounded text-sm transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none"
      style={{
        color: surface.inkMuted,
        // @ts-expect-error -- custom property drives the focus ring color
        "--tw-ring-color": withAlpha(surface.accent, 0.35)
      }}
    >
      {link.label}
    </a>
  );
}

export function SiteFooter({ nav, ctx }: ChromeProps) {
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, "tint");
  const links = (nav.footerLinks?.length ? nav.footerLinks : nav.links) ?? [];
  const columns = chunkLinks(links);
  const brandText = nav.brand?.text?.trim();
  const brandLogo = nav.brand?.logoUrl;
  const year = new Date().getFullYear();

  return (
    <footer
      data-testid={SECTION_TEST_IDS.siteFooter}
      className="w-full"
      style={{
        backgroundColor: surface.background,
        borderTop: `1px solid ${surface.border}`,
        color: surface.ink,
        fontFamily: tokens.fontFamily
      }}
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:gap-16">
          <div className="flex max-w-sm flex-col gap-3">
            {brandText || brandLogo ? (
              <div data-testid="spec-footer-brand" className="flex items-center gap-2.5">
                {brandLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brandLogo} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                ) : null}
                {brandText ? (
                  <span className="text-base font-semibold tracking-tight">{brandText}</span>
                ) : null}
              </div>
            ) : null}
            {nav.footerNote ? (
              <p data-testid="spec-footer-note" className="text-sm leading-relaxed" style={{ color: surface.inkMuted }}>
                {nav.footerNote}
              </p>
            ) : null}
          </div>

          {columns.length > 0 ? (
            <nav
              aria-label="Footer"
              data-testid="spec-footer-links"
              className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3"
            >
              {columns.map((column, index) => (
                <div key={`footer-column-${index}`} data-testid="spec-footer-column" className="flex flex-col gap-2.5">
                  {column.map((link) => (
                    <FooterLink key={`${link.pageId}-${link.label}`} link={link} ctx={ctx} surface={surface} />
                  ))}
                </div>
              ))}
            </nav>
          ) : null}
        </div>

        {brandText ? (
          <div
            className="mt-10 flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderTop: `1px solid ${surface.border}` }}
          >
            <p data-testid="spec-footer-copyright" className="text-xs" style={{ color: surface.inkSubtle }}>
              © {year} {brandText}
            </p>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
