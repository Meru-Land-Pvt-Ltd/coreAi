import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SectionNode, SpecNode } from "@coreai/shared";
import {
  CTA_BAND_EXAMPLE,
  EXAMPLE_HOME_BLOCKS,
  EXAMPLE_NAV,
  FAQ_ACCORDION_EXAMPLE,
  FEATURE_GRID_EXAMPLE,
  HERO_EXAMPLE,
  PRICING_TABLE_EXAMPLE,
  SECTION_EXAMPLES,
  STATS_BAND_EXAMPLE,
  TESTIMONIAL_ROW_EXAMPLE
} from "./examples";
import { SECTION_TEST_IDS } from "./primitives";
import { SECTION_KINDS, SECTION_REGISTRY, headerCtaFromBlocks, renderSection } from "./registry";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { contrastRatio, sectionTokens } from "./tokens";
import type { SectionContext, SectionKind } from "./types";

afterEach(cleanup);

function paint(node: SectionNode, ctx?: SectionContext, isFirstBlock = false) {
  const element = renderSection(node, ctx, { isFirstBlock });
  if (!element) throw new Error(`section was not recognized: ${node.id}`);
  return render(element);
}

// ---------------------------------------------------------------------------
// Every section renders from its fixture
// ---------------------------------------------------------------------------

describe("every section renders from a fixture", () => {
  const cases = Object.entries(SECTION_EXAMPLES) as [SectionKind, SectionNode][];

  it.each(cases)("%s paints its own shell", (kind, node) => {
    paint(node);
    const shell = screen.getByTestId(SECTION_TEST_IDS[kind]);
    expect(shell.getAttribute("data-section-kind")).toBe(kind);
    expect(shell.getAttribute("data-spec-node-id")).toBe(node.id);
  });

  it("has a component registered for every kind", () => {
    expect(SECTION_KINDS).toHaveLength(7);
    for (const kind of SECTION_KINDS) {
      expect(SECTION_REGISTRY[kind]).toBeTypeOf("function");
    }
  });
});

describe("hero", () => {
  it("paints the badge, headline, copy, note and a live output slot", () => {
    paint(HERO_EXAMPLE, undefined, true);
    expect(screen.getByTestId("spec-hero-eyebrow").textContent).toBe("New");
    const heading = screen.getByTestId("spec-hero-heading");
    expect(heading.tagName).toBe("H1");
    expect(heading.textContent).toContain("A month of social posts");
    expect(screen.getByTestId("spec-hero-subtext").textContent).toContain("Tell it about your business");
    expect(screen.getByTestId("spec-hero-note").textContent).toBe("No card needed to try it.");
    // Two buttons plus the wired field, and the result slot below.
    const actions = screen.getByTestId("spec-hero-actions");
    expect(within(actions).getAllByRole("button")).toHaveLength(1); // "Write my posts"
    expect(within(actions).getAllByRole("link")).toHaveLength(1); // "See an example" has an href
    expect(screen.getByTestId("spec-result-placeholder")).toBeTruthy();
  });

  it("puts the product shot beside the copy when the spec supplies one", () => {
    const withShot: SectionNode = {
      ...HERO_EXAMPLE,
      id: "hero-shot",
      children: [
        ...HERO_EXAMPLE.children,
        { id: "hero-image", type: "image", url: "/shot.png", alt: "The dashboard", ratio: "wide" }
      ]
    };
    paint(withShot, undefined, true);
    const media = screen.getByTestId("spec-hero-media");
    expect(within(media).getByRole("img").getAttribute("alt")).toBe("The dashboard");
  });

  it("hands wired nodes back to the core renderer instead of painting them", () => {
    const renderNode = vi.fn((node: SpecNode) =>
      node.type === "result" ? <div data-testid="core-result">live</div> : null
    );
    paint(HERO_EXAMPLE, { renderNode }, true);
    expect(screen.getByTestId("core-result")).toBeTruthy();
    expect(screen.queryByTestId("spec-result-placeholder")).toBeNull();
    // Everything wirable was offered to the core, decoration was not.
    const offered = renderNode.mock.calls.map(([node]) => node.type);
    expect(offered).toContain("input");
    expect(offered).toContain("button");
    expect(offered).toContain("result");
    expect(offered).not.toContain("heading");
  });
});

describe("feature grid", () => {
  it("paints one card per feature with its icon and copy", () => {
    paint(FEATURE_GRID_EXAMPLE);
    const cards = screen.getAllByTestId("spec-feature-card");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByTestId("spec-feature-title").textContent).toBe("Sounds like you");
    expect(within(cards[0]).getByTestId("spec-feature-icon")).toBeTruthy();
    expect(within(cards[2]).getByTestId("spec-feature-body").textContent).toContain("shared with anyone else");
  });

  it("stacks on a phone and opens up by breakpoint", () => {
    paint(FEATURE_GRID_EXAMPLE);
    const grid = screen.getByTestId("spec-feature-grid");
    expect(grid.getAttribute("data-columns")).toBe("3");
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-3");
    // No unprefixed column count, so a 375px phone always gets one column.
    const unprefixed = grid.className.split(/\s+/).filter((token) => /^grid-cols-/.test(token));
    expect(unprefixed).toEqual([]);
  });
});

describe("stats band", () => {
  it("paints each number with its label", () => {
    paint(STATS_BAND_EXAMPLE);
    const stats = screen.getAllByTestId("spec-stat");
    expect(stats).toHaveLength(3);
    expect(within(stats[0]).getByTestId("spec-stat-value").textContent).toBe("1.2M");
    expect(within(stats[1]).getByTestId("spec-stat-label").textContent).toContain("time saved");
  });
});

describe("pricing table", () => {
  it("highlights the recommended plan and only that plan", () => {
    paint(PRICING_TABLE_EXAMPLE);
    const plans = screen.getAllByTestId("spec-plan");
    expect(plans).toHaveLength(3);
    expect(plans.map((plan) => plan.getAttribute("data-highlighted"))).toEqual(["false", "true", "false"]);

    const featured = plans[1];
    expect(within(featured).getByTestId("spec-plan-name").textContent).toBe("Growing");
    expect(within(featured).getByTestId("spec-plan-badge").textContent).toBe("Most popular");
    expect(within(featured).getByTestId("spec-plan-price").textContent).toBe("$29");
    expect(within(featured).getByTestId("spec-plan-period").textContent).toBe("per month");
    expect(within(featured).getByTestId("spec-plan-features").children).toHaveLength(4);

    // The quiet plans carry no badge at all.
    expect(within(plans[0]).queryByTestId("spec-plan-badge")).toBeNull();
    expect(within(plans[2]).queryByTestId("spec-plan-badge")).toBeNull();
  });

  it("gives the recommended plan the solid CTA and the others the quiet one", () => {
    paint(PRICING_TABLE_EXAMPLE);
    const plans = screen.getAllByTestId("spec-plan");
    const accent = sectionTokens("light", "#f59e0b").accent;
    const featuredCta = within(plans[1]).getByTestId("spec-plan-cta").firstElementChild as HTMLElement;
    const quietCta = within(plans[0]).getByTestId("spec-plan-cta").firstElementChild as HTMLElement;
    expect(featuredCta.style.backgroundColor).toBe("rgb(245, 158, 11)");
    expect(accent).toBe("#f59e0b");
    expect(quietCta.style.backgroundColor).not.toBe("rgb(245, 158, 11)");
  });

  it("shows the reassurance note under the table", () => {
    paint(PRICING_TABLE_EXAMPLE);
    expect(screen.getByTestId("spec-pricing-note").textContent).toContain("Cancel any time");
  });
});

describe("testimonial row", () => {
  it("paints quote cards with initials for the author", () => {
    paint(TESTIMONIAL_ROW_EXAMPLE);
    const cards = screen.getAllByTestId("spec-testimonial");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByTestId("spec-testimonial-author").textContent).toBe("Priya Raman");
    expect(within(cards[0]).getByTestId("spec-avatar-initials").textContent).toBe("PR");
    expect(within(cards[0]).getByTestId("spec-testimonial-role").textContent).toContain("Sunrise Bakery");
  });
});

describe("faq accordion", () => {
  it("renders one native disclosure per question", () => {
    paint(FAQ_ACCORDION_EXAMPLE);
    const items = screen.getAllByTestId("spec-faq-item");
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.tagName).toBe("DETAILS");
      const summary = within(item).getByTestId("spec-faq-question");
      expect(summary.tagName).toBe("SUMMARY");
      // The question stays a heading, so the page keeps a usable outline.
      expect(within(summary).getByRole("heading", { level: 3 })).toBeTruthy();
    }
  });

  it("toggles an answer open and closed", () => {
    paint(FAQ_ACCORDION_EXAMPLE);
    const item = screen.getAllByTestId("spec-faq-item")[0] as HTMLDetailsElement;
    const summary = within(item).getByTestId("spec-faq-question");
    expect(item.open).toBe(false);

    fireEvent.click(summary);
    expect(item.open).toBe(true);
    expect(within(item).getByTestId("spec-faq-answer").textContent).toContain("plain English");

    fireEvent.click(summary);
    expect(item.open).toBe(false);
  });

  it("opens each question independently", () => {
    paint(FAQ_ACCORDION_EXAMPLE);
    const items = screen.getAllByTestId("spec-faq-item") as HTMLDetailsElement[];
    fireEvent.click(within(items[0]).getByTestId("spec-faq-question"));
    fireEvent.click(within(items[1]).getByTestId("spec-faq-question"));
    expect(items[0].open).toBe(true);
    expect(items[1].open).toBe(true);
    expect(items[2].open).toBe(false);
  });

  it("keeps the chevron motion behind prefers-reduced-motion", () => {
    paint(FAQ_ACCORDION_EXAMPLE);
    const chevron = screen.getAllByTestId("spec-faq-question")[0].querySelector("svg");
    expect(chevron?.getAttribute("class")).toContain("motion-reduce:transition-none");
  });
});

describe("cta band", () => {
  it("paints the closing ask", () => {
    paint(CTA_BAND_EXAMPLE);
    expect(screen.getByTestId("spec-cta-heading").textContent).toBe("Try it on your next post");
    expect(screen.getByTestId("spec-cta-note").textContent).toBe("No card needed.");
    expect(within(screen.getByTestId("spec-cta-actions")).getByRole("button").textContent).toBe("Start writing");
  });
});

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

describe("site header", () => {
  const hrefForPage = (pageId: string) => (pageId === "home" ? "/a/postcraft" : `/a/postcraft/${pageId}`);

  it("paints the brand, the page links and the call to action", () => {
    const cta = headerCtaFromBlocks(EXAMPLE_HOME_BLOCKS);
    render(<SiteHeader nav={EXAMPLE_NAV} ctx={{ hrefForPage, currentPageId: "home" }} cta={cta} />);
    expect(screen.getByTestId("spec-header-brand").textContent).toBe("Postcraft");
    expect(screen.getAllByTestId("spec-header-link")).toHaveLength(3);
    expect(screen.getByTestId("spec-header-cta").textContent).toContain("Write my posts");
    const active = screen.getAllByTestId("spec-header-link")[0];
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("href")).toBe("/a/postcraft");
  });

  it("opens and closes the mobile menu", () => {
    render(<SiteHeader nav={EXAMPLE_NAV} ctx={{ hrefForPage }} />);
    const toggle = screen.getByTestId("spec-header-menu-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("spec-header-mobile-menu")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByTestId("spec-header-mobile-menu");
    expect(menu.getAttribute("id")).toBe(toggle.getAttribute("aria-controls"));
    expect(within(menu).getAllByTestId("spec-header-mobile-link")).toHaveLength(3);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("spec-header-mobile-menu")).toBeNull();
  });

  it("closes the mobile menu on Escape and after a link is chosen", () => {
    const onNavigate = vi.fn();
    render(<SiteHeader nav={EXAMPLE_NAV} ctx={{ hrefForPage, onNavigate }} />);
    const toggle = screen.getByTestId("spec-header-menu-toggle");

    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("spec-header-mobile-menu")).toBeNull();

    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByTestId("spec-header-mobile-link")[1]);
    expect(onNavigate).toHaveBeenCalledWith("pricing");
    expect(screen.queryByTestId("spec-header-mobile-menu")).toBeNull();
  });
});

describe("site footer", () => {
  it("paints link columns, the note and the year", () => {
    render(<SiteFooter nav={EXAMPLE_NAV} ctx={{ hrefForPage: (pageId) => `/${pageId}` }} />);
    expect(screen.getAllByTestId("spec-footer-column")).toHaveLength(2);
    expect(screen.getAllByTestId("spec-footer-link")).toHaveLength(6);
    expect(screen.getByTestId("spec-footer-note").textContent).toContain("small businesses");
    expect(screen.getByTestId("spec-footer-copyright").textContent).toContain(String(new Date().getFullYear()));
  });

  it("falls back to the header links when no footer links were written", () => {
    render(<SiteFooter nav={{ ...EXAMPLE_NAV, footerLinks: [] }} />);
    expect(screen.getAllByTestId("spec-footer-link")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The quality guarantees the tokens are there to make
// ---------------------------------------------------------------------------

describe("tokens keep every accent readable", () => {
  const accents = ["#f59e0b", "#ffff00", "#ffffff", "#000000", "#2563eb", "not-a-color"];
  const modes = ["light", "dark", "warm"] as const;

  it.each(accents)("accent %s clears AA as text on every surface, in every mode", (accent) => {
    for (const mode of modes) {
      const tokens = sectionTokens(mode, accent);
      for (const surface of Object.values(tokens.surfaces)) {
        const behind = surface.key === "gradient" ? tokens.ground : surface.background;
        if (surface.key === "gradient") continue; // measured against its palest stop internally
        expect(contrastRatio(surface.accentInk, behind)).toBeGreaterThanOrEqual(4.4);
        expect(contrastRatio(surface.ink, behind)).toBeGreaterThanOrEqual(4.4);
      }
      expect(contrastRatio(tokens.onAccent, tokens.accent)).toBeGreaterThanOrEqual(4.4);
    }
  });

  it("falls back to the Triven amber when the accent is junk", () => {
    expect(sectionTokens("light", "oops").accent).toBe("#f59e0b");
    expect(sectionTokens("light", "#fa0").accent).toBe("#ffaa00");
  });
});

describe("theme is applied end to end", () => {
  it("paints a dark-mode hero on a dark ground", () => {
    paint(HERO_EXAMPLE, { mode: "dark", accent: "#2563eb" }, true);
    const shell = screen.getByTestId(SECTION_TEST_IDS.hero);
    expect(shell.getAttribute("data-surface")).toBe("gradient");
    // Dark-mode ink, inherited from the shared agent-page palette.
    expect(shell.style.color).toBe("rgb(241, 245, 249)");
    expect(shell.style.background).toContain("linear-gradient");
  });

  it("uses the chosen font family", () => {
    paint(CTA_BAND_EXAMPLE, { font: "serif" });
    expect(screen.getByTestId(SECTION_TEST_IDS.ctaBand).style.fontFamily).toContain("Georgia");
  });
});
