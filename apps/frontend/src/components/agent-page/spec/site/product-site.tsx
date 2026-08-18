"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { ButtonNode, PageSpec, ProductSpec, SpecNode } from "@coreai/shared";
import { SpecRenderer, type SpecNodeRenderer } from "../spec-renderer";
import { specMeasureVars } from "../spec-tokens";
import {
  SiteFooter,
  SiteHeader,
  headerCtaFromBlocks,
  renderSection,
  sectionTokens,
  surfaceFor,
  type SectionContext
} from "../sections";
import { productHomePage, productPathForPageId } from "./product-links";
import type { ContentWidth } from "../../types";

/**
 * The published product site: header, one page, footer.
 *
 * This is the shell every public /a/<slug>[/<page>] route renders. It owns
 * three things and nothing else:
 *
 *   1. **The chrome.** `SiteHeader` and `SiteFooter` are driven by
 *      `ProductSpec.nav`, so the same header sits on every page of the product
 *      and the current page is the one marked active.
 *   2. **Real navigation.** Every nav link is a real `<a href="/a/slug/page">`
 *      — crawlable, shareable, cmd-clickable — and a capture-phase handler
 *      turns a plain left click into a Next client-side push (typed-route
 *      cast) so moving between pages never reloads the site. Modifier clicks,
 *      new-tab clicks and external links are left alone.
 *   3. **The seam.** Wired nodes (button/input/upload/choice/result/history)
 *      are not painted here. They arrive through `renderNode`, which is handed
 *      both to the core spec renderer and to the professional sections, so the
 *      fleet that owns the agent runtime never has to edit this file.
 *
 * Everything visual comes from the spec: this component chooses no colors, no
 * copy and no layout of its own.
 */

export type ProductSiteProps = {
  /** The published page slug — the /a/<slug> segment. */
  slug: string;
  /** The sanitized product. */
  product: ProductSpec;
  /** The page being shown. Must be one of `product.pages`. */
  page: PageSpec;
  /**
   * Paints the wired nodes. Absent, they are skipped and the sections paint
   * their static (non-functional) versions, which is exactly what a preview
   * or a crawler should see.
   *
   * INTEGRATOR: mount the live runtime renderer here — one prop, no edits
   * inside this file.
   */
  renderNode?: SpecNodeRenderer;
  /**
   * The architect's width dial — how wide the product runs on large screens.
   * Absent means the standard measure. Small screens ignore it entirely.
   */
  contentWidth?: ContentWidth | null;
  /** Replaces the page body. Used by the in-product 404 card. */
  children?: ReactNode;
  /**
   * Rendered inside a third-party site's iframe. Drops our own header and
   * footer (their page already has chrome) and the full-viewport floor.
   */
  embed?: boolean;
  /**
   * Overrides where a page link lands. The public /a/ routes leave this
   * absent and get real router navigation; the builder's preview passes a
   * handler so clicking the site's nav switches the previewed page in place
   * instead of leaving the builder.
   */
  navigate?: (href: string) => void;
};

function hasBrand(product: ProductSpec): boolean {
  return Boolean(product.nav.brand?.text || product.nav.brand?.logoUrl);
}

/** An anchor a left click should turn into a client-side push. */
function softNavHref(anchor: HTMLAnchorElement): string | null {
  if (anchor.hasAttribute("download")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  const href = anchor.getAttribute("href");
  // Site-relative only. Protocol-relative ("//evil.example") is not ours, and
  // "#anchor" / "mailto:" / "https://" must keep the browser's own behavior.
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  return href;
}

function anchorFrom(event: { target: EventTarget | null }): HTMLAnchorElement | null {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") return null;
  return target.closest("a[href]");
}

export function ProductSite({
  slug,
  product,
  page,
  renderNode,
  contentWidth,
  children,
  navigate,
  embed = false
}: ProductSiteProps) {
  const router = useRouter();
  const prefetched = useRef<Set<string>>(new Set());

  const theme = product.theme;
  const tokens = useMemo(
    () => sectionTokens(theme?.mode, theme?.accent, theme?.font),
    [theme?.mode, theme?.accent, theme?.font]
  );

  const hrefForPage = useCallback(
    (pageId: string) => productPathForPageId(product, slug, pageId),
    [product, slug]
  );

  /**
   * Client-side navigation without giving up real hrefs. Runs in the capture
   * phase so it decides before any section's own click handler, and bails out
   * of everything a browser is entitled to handle itself.
   */
  const handleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = anchorFrom(event);
      if (!anchor) return;
      const href = softNavHref(anchor);
      if (!href) return;
      event.preventDefault();
      if (navigate) {
        navigate(href);
        return;
      }
      router.push(href as Route);
    },
    [router, navigate]
  );

  /** Warm the next page the moment a link is pointed at — same as <Link>. */
  const handlePointerOver = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const anchor = anchorFrom(event);
      if (!anchor) return;
      const href = softNavHref(anchor);
      if (!href || prefetched.current.has(href)) return;
      prefetched.current.add(href);
      // With a navigate override there is no route to warm — page switches
      // happen in place.
      if (navigate) return;
      try {
        router.prefetch(href as Route);
      } catch {
        // Prefetching is an optimization; a router without it is not an error.
      }
    },
    [router, navigate]
  );

  const sectionCtx = useMemo<SectionContext>(
    () => ({
      accent: theme?.accent ?? null,
      mode: theme?.mode ?? null,
      font: theme?.font ?? null,
      hrefForPage,
      currentPageId: page.id,
      // The sections ask for a wired node the same way the core renderer does.
      renderNode: renderNode
        ? (node: SpecNode) => renderNode({ node, surface: "base", align: "left" })
        : undefined
    }),
    [theme?.accent, theme?.mode, theme?.font, hrefForPage, page.id, renderNode]
  );

  /**
   * The renderer extension: a top-level `section` that the recognizer knows
   * (hero, feature grid, pricing, FAQ, …) is painted by its hand-built
   * component; everything else is declined so the core walker paints it, or
   * the wire renderer claims it.
   */
  const firstBlockId = page.blocks[0]?.id;
  const topLevelIds = useMemo(() => new Set(page.blocks.map((block) => block.id)), [page.blocks]);

  const specRenderNode = useMemo<SpecNodeRenderer>(
    () => (ctx) => {
      if (ctx.node.type === "section" && topLevelIds.has(ctx.node.id)) {
        const section = renderSection(ctx.node, sectionCtx, { isFirstBlock: ctx.node.id === firstBlockId });
        if (section) return section;
      }
      return renderNode?.(ctx);
    },
    [topLevelIds, firstBlockId, sectionCtx, renderNode]
  );

  /**
   * The header's call to action, repeated from the page's hero (or the home
   * page's, on a page that has none). A wired button with nothing to run it is
   * a dead button, so it only appears when it links somewhere or when the wire
   * renderer is mounted.
   */
  const headerCta = useMemo<ButtonNode | null>(() => {
    const home = productHomePage(product);
    const found =
      headerCtaFromBlocks(page.blocks) ?? (home && home.id !== page.id ? headerCtaFromBlocks(home.blocks) : null);
    if (!found) return null;
    if (found.href) return found;
    return renderNode ? found : null;
  }, [page, product, renderNode]);

  // Embedded on someone else's website, the product is a widget inside THEIR
  // page: their header is above it and their footer below it, so ours would be
  // a second set of chrome nobody asked for.
  const showHeader = !embed && (product.nav.links.length > 0 || hasBrand(product));
  const showFooter =
    !embed &&
    (product.nav.footerLinks.length > 0 ||
      product.nav.links.length > 0 ||
      Boolean(product.nav.footerNote) ||
      hasBrand(product));

  return (
    <div
      data-testid="product-site"
      data-product-page={page.id}
      data-product-slug={slug}
      onClickCapture={handleClickCapture}
      onPointerOver={handlePointerOver}
      data-product-width={contentWidth ?? "standard"}
      // In a frame, a 100dvh floor means the widget can grow but can never
      // shrink again — the measured height would always include the height the
      // frame already has.
      className={
        embed
          ? "flex w-full flex-col overflow-x-clip antialiased"
          : "flex min-h-[100dvh] w-full flex-col overflow-x-clip antialiased"
      }
      // The page's measure sits on the site root, not just on the spec root,
      // so the header and the footer line up with the bands between them.
      style={{
        backgroundColor: tokens.ground,
        color: surfaceFor(tokens, "plain").ink,
        fontFamily: tokens.fontFamily,
        ...specMeasureVars(contentWidth)
      }}
    >
      {showHeader ? <SiteHeader nav={product.nav} ctx={sectionCtx} cta={headerCta} /> : null}

      <main data-testid="product-site-main" className="w-full flex-1">
        {children ?? (
          <SpecRenderer
            page={page}
            theme={theme}
            renderNode={specRenderNode}
            contentWidth={contentWidth}
          />
        )}
      </main>

      {showFooter ? <SiteFooter nav={product.nav} ctx={sectionCtx} /> : null}
    </div>
  );
}

export default ProductSite;
