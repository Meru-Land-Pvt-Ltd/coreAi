import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Public product routing: /a/<slug> and /a/<slug>/<page>.
 *
 * What these lock down:
 *
 *   • A designed product renders as a real multi-page site — header, page,
 *     footer — with nav links that are genuine hrefs AND client-side pushes.
 *   • An unknown sub-page is a real 404, and /a/<slug>/home collapses onto the
 *     canonical /a/<slug>.
 *   • Metadata is built per page, on the server.
 *   • An agent with no stored ProductSpec still renders through the old path.
 *     That last one is the whole compatibility contract: it must not budge.
 *
 * The API is mocked at `fetch` (the routes read it server-side, not through
 * the axios client) and next/navigation is mocked because these components run
 * outside a Next router in jsdom.
 */

const { pushMock, prefetchMock, replaceMock, apiGetMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  prefetchMock: vi.fn(),
  replaceMock: vi.fn(),
  apiGetMock: vi.fn(),
  pathnameMock: vi.fn(() => "/a/thumbnail-genie/pricing")
}));

class NotFoundSignal extends Error {}
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, prefetch: prefetchMock, replace: replaceMock, refresh: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => pathnameMock(),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  }
}));

// The legacy path fetches through the axios client; keep it inert.
vi.mock("@/lib/api", () => ({
  apiGet: apiGetMock,
  apiPost: vi.fn()
}));

import HomeRoute, { generateMetadata as homeMetadata } from "./page";
import SubPageRoute, { generateMetadata as subPageMetadata } from "./[page]/page";
import ProductSubPageNotFound from "./[page]/not-found";
import { LegacyAgentPage } from "./legacy-agent-page";

const SLUG = "thumbnail-genie";

function specProduct() {
  return {
    version: 1,
    pages: [
      {
        id: "home",
        title: "Thumbnail Genie",
        path: "",
        seo: { description: "Turn a rough idea into a finished thumbnail." },
        blocks: [
          {
            id: "hero",
            type: "section",
            padding: "xl",
            background: "gradient",
            children: [
              { id: "hero-title", type: "heading", level: 1, text: "Thumbnails that get clicked" },
              { id: "hero-sub", type: "text", text: "Describe the video, get three finished thumbnails." }
            ]
          }
        ]
      },
      {
        id: "pricing",
        title: "Pricing",
        path: "pricing",
        seo: { description: "Simple pricing. Cancel any time." },
        blocks: [
          {
            id: "plans",
            type: "section",
            padding: "lg",
            children: [
              { id: "plans-title", type: "heading", level: 2, text: "One plan, everything included" },
              { id: "plans-note", type: "text", text: "19 dollars a month." }
            ]
          }
        ]
      },
      {
        id: "privacy",
        title: "Privacy",
        path: "privacy",
        blocks: [
          {
            id: "privacy-body",
            type: "section",
            children: [{ id: "privacy-title", type: "heading", level: 2, text: "Privacy policy" }]
          }
        ]
      }
    ],
    nav: {
      brand: { text: "Thumbnail Genie" },
      links: [
        { label: "Home", pageId: "home" },
        { label: "Pricing", pageId: "pricing" }
      ],
      footerLinks: [{ label: "Privacy", pageId: "privacy" }],
      footerNote: "Made with Triven."
    },
    theme: { accent: "#6d28d9", mode: "light", font: "sans" }
  };
}

function productPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      slug: SLUG,
      source: "spec",
      product: specProduct(),
      page: { headline: "Thumbnails that get clicked", welcomeMessage: null },
      listing: {
        id: "listing-1",
        name: "Thumbnail Genie",
        tagline: "Great thumbnails in one click.",
        shortDescription: "Turns a rough idea into a finished YouTube thumbnail.",
        iconUrl: "https://cdn.example.com/icon.png"
      },
      architect: { displayName: "Dana R.", photoUrl: null },
      ...overrides
    }
  };
}

function mockProduct(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: async () => body
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function params(extra: Record<string, string> = {}) {
  return Promise.resolve({ slug: SLUG, ...extra }) as Promise<never>;
}

async function renderRoute(element: Promise<ReactElement> | ReactElement) {
  render(await element);
}

beforeEach(() => {
  pushMock.mockReset();
  prefetchMock.mockReset();
  apiGetMock.mockReset().mockImplementation(() => new Promise(() => {}));
  pathnameMock.mockReturnValue(`/a/${SLUG}/pricing`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// The multi-page site
// ---------------------------------------------------------------------------

describe("/a/<slug> — a designed product", () => {
  it("renders the home page inside the site chrome", async () => {
    mockProduct(productPayload());

    await renderRoute(HomeRoute({ params: params() }));

    const site = screen.getByTestId("product-site");
    expect(site.getAttribute("data-product-page")).toBe("home");
    expect(screen.getByTestId("spec-site-header")).toBeTruthy();
    expect(screen.getByTestId("spec-site-footer")).toBeTruthy();
    expect(screen.getByTestId("product-site-main").textContent).toContain("Thumbnails that get clicked");
  });

  it("paints the page through the professional sections, in the architect's accent", async () => {
    mockProduct(productPayload());

    await renderRoute(HomeRoute({ params: params() }));

    // A headline-led first block is a hero — the hand-built section, not a
    // generic stack of nodes.
    const hero = screen.getByTestId("spec-section-hero");
    expect(hero.getAttribute("data-spec-node-id")).toBe("hero");
    expect(within(hero).getByTestId("spec-hero-heading").tagName).toBe("H1");

    // The spec's accent reaches the paint, not the amber default.
    expect(screen.getByTestId("spec-page").getAttribute("style")).toContain("#6d28d9");
  });

  it("gives every nav link a real /a/<slug>/<page> href and marks the active one", async () => {
    mockProduct(productPayload());

    await renderRoute(HomeRoute({ params: params() }));

    const nav = screen.getByTestId("spec-header-nav");
    const links = within(nav).getAllByTestId("spec-header-link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/a/${SLUG}`, `/a/${SLUG}/pricing`]);

    const active = links.filter((link) => link.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute("data-page-id")).toBe("home");

    // Footer links resolve through the same page table.
    const footerLinks = screen.getAllByTestId("spec-footer-link");
    expect(footerLinks.map((link) => link.getAttribute("href"))).toEqual([`/a/${SLUG}/privacy`]);
  });

  it("renders a sub-page and moves the active state onto it", async () => {
    mockProduct(productPayload());

    await renderRoute(SubPageRoute({ params: params({ page: "pricing" }) }));

    expect(screen.getByTestId("product-site").getAttribute("data-product-page")).toBe("pricing");
    expect(screen.getByTestId("product-site-main").textContent).toContain("One plan, everything included");

    const active = within(screen.getByTestId("spec-header-nav"))
      .getAllByTestId("spec-header-link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute("data-page-id")).toBe("pricing");
  });

  it("turns a plain left click on a nav link into a client-side push", async () => {
    mockProduct(productPayload());
    await renderRoute(HomeRoute({ params: params() }));

    const pricing = screen
      .getAllByTestId("spec-header-link")
      .find((link) => link.getAttribute("data-page-id") === "pricing");
    expect(pricing).toBeTruthy();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    pricing?.dispatchEvent(event);

    expect(pushMock).toHaveBeenCalledWith(`/a/${SLUG}/pricing`);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a cmd/ctrl click to the browser so links still open in a new tab", async () => {
    mockProduct(productPayload());
    await renderRoute(HomeRoute({ params: params() }));

    const pricing = screen
      .getAllByTestId("spec-header-link")
      .find((link) => link.getAttribute("data-page-id") === "pricing");

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    pricing?.dispatchEvent(event);

    expect(pushMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 404 and canonicalization
// ---------------------------------------------------------------------------

describe("/a/<slug>/<page> — pages that do not exist", () => {
  it("404s an unknown page", async () => {
    mockProduct(productPayload());
    await expect(SubPageRoute({ params: params({ page: "pricng" }) })).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("404s when the agent itself is not publicly live", async () => {
    mockProduct({ success: false, error: "gone" }, false);
    await expect(SubPageRoute({ params: params({ page: "pricing" }) })).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("404s every sub-page of an agent that has no stored ProductSpec", async () => {
    mockProduct(productPayload({ source: "blueprint" }));
    await expect(SubPageRoute({ params: params({ page: "pricing" }) })).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("redirects /a/<slug>/home onto the canonical /a/<slug>", async () => {
    mockProduct(productPayload());
    await expect(SubPageRoute({ params: params({ page: "home" }) })).rejects.toMatchObject({
      to: `/a/${SLUG}`
    });
  });

  it("shows a friendly card that links back into the product", () => {
    render(<ProductSubPageNotFound />);

    expect(screen.getByTestId("product-page-not-found")).toBeTruthy();
    expect(screen.getByTestId("product-page-home-link").getAttribute("href")).toBe(`/a/${SLUG}`);
  });

  it("falls back to the marketplace when the path carries no slug", () => {
    pathnameMock.mockReturnValue("/somewhere/else");
    render(<ProductSubPageNotFound />);

    expect(screen.getByTestId("product-page-home-link").getAttribute("href")).toBe("/marketplace");
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe("metadata", () => {
  it("builds the home page's title, description and social card", async () => {
    mockProduct(productPayload());

    const metadata = await homeMetadata({ params: params() });

    // The home page's title IS the product name — never "Name | Name".
    expect(metadata.title).toBe("Thumbnail Genie");
    expect(metadata.description).toBe("Turn a rough idea into a finished thumbnail.");
    expect(metadata.alternates?.canonical).toContain(`/a/${SLUG}`);
    expect(metadata.openGraph?.title).toBe("Thumbnail Genie | Triven.ai");
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("https://cdn.example.com/icon.png");
  });

  it("titles a sub-page with its own name plus the product's", async () => {
    mockProduct(productPayload());

    const metadata = await subPageMetadata({ params: params({ page: "pricing" }) });

    expect(metadata.title).toBe("Pricing | Thumbnail Genie");
    expect(metadata.description).toBe("Simple pricing. Cancel any time.");
    expect(metadata.alternates?.canonical).toContain(`/a/${SLUG}/pricing`);
  });

  it("prefers the page's own OG image over the listing icon", async () => {
    const payload = productPayload();
    const product = payload.data.product as ReturnType<typeof specProduct>;
    product.pages[1].seo = {
      description: "Simple pricing. Cancel any time.",
      ogImageUrl: "https://cdn.example.com/pricing-card.png"
    } as never;
    mockProduct(payload);

    const metadata = await subPageMetadata({ params: params({ page: "pricing" }) });
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("pricing-card.png");
  });

  it("never lets an unknown page be indexed", async () => {
    mockProduct(productPayload());

    const metadata = await subPageMetadata({ params: params({ page: "pricng" }) });
    expect(metadata.title).toBe("Page not found");
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("keeps the pre-Product-Spec unfurl for an agent with no stored spec", async () => {
    mockProduct(productPayload({ source: "blueprint" }));

    const metadata = await homeMetadata({ params: params() });

    // Exactly what the old layout produced: the listing name and the headline.
    expect(metadata.title).toBe("Thumbnail Genie");
    expect(metadata.description).toBe("Thumbnails that get clicked");
  });

  it("falls back to a generic title when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const metadata = await homeMetadata({ params: params() });
    expect(metadata.title).toBe("AI Agent");
  });
});

// ---------------------------------------------------------------------------
// The compatibility contract
// ---------------------------------------------------------------------------

describe("agents with no stored ProductSpec render exactly as before", () => {
  it("hands a blueprint-era agent to the legacy page", async () => {
    mockProduct(productPayload({ source: "blueprint" }));

    const element = (await HomeRoute({ params: params() })) as ReactElement;
    expect(element.type).toBe(LegacyAgentPage);
    expect((element.props as { slug: string }).slug).toBe(SLUG);

    render(element);
    // The old client page owns the fetch, so it starts on its skeleton.
    expect(screen.getByTestId("agent-page-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("product-site")).toBeNull();
  });

  it("hands an unknown slug to the legacy page, which keeps its own card", async () => {
    mockProduct({ success: false, error: "gone" }, false);
    apiGetMock.mockResolvedValue({ success: false, code: "AGENT_PAGE_NOT_FOUND", status: 404 });

    const element = (await HomeRoute({ params: params() })) as ReactElement;
    expect(element.type).toBe(LegacyAgentPage);
  });

  it("falls back to the legacy page when the product API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const element = (await HomeRoute({ params: params() })) as ReactElement;
    expect(element.type).toBe(LegacyAgentPage);
  });
});
