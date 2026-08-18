import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /agent-pages/:slug/product — the public product read.
 *
 * Route-contract tests only: resolution itself is covered by
 * product-spec-service.test.ts, so the service is mocked and these assert the
 * two things the route owns — the 404 idiom for a page that is not publicly
 * resolvable, and the exact shape of the success payload the frontend renders
 * from.
 */

const { resolveProductForPublicMock } = vi.hoisted(() => ({
  resolveProductForPublicMock: vi.fn()
}));

vi.mock("./product-spec-service", () => ({
  resolveProductForPublic: resolveProductForPublicMock
}));

import { registerAgentPageProductRoutes } from "./product-routes";

const SLUG = "thumbnail-genie-abc123";

function resolvedProduct() {
  return {
    slug: SLUG,
    workflowId: "workflow-1",
    source: "spec" as const,
    product: {
      version: 1 as const,
      pages: [
        { id: "home", title: "Thumbnail Genie", path: "", blocks: [{ id: "h", type: "heading", text: "Hi" }] },
        { id: "pricing", title: "Pricing", path: "pricing", blocks: [{ id: "p", type: "text", text: "$19" }] }
      ],
      nav: {
        brand: { text: "Thumbnail Genie" },
        links: [
          { label: "Home", pageId: "home" },
          { label: "Pricing", pageId: "pricing" }
        ],
        footerLinks: []
      },
      theme: { accent: "#f59e0b", mode: "light" as const }
    },
    page: {
      slug: SLUG,
      template: "media" as const,
      headline: "Thumbnails that get clicked",
      welcomeMessage: null,
      suggestedPrompts: [],
      accentColor: "#f59e0b",
      status: "LIVE" as const
    },
    listing: {
      id: "listing-1",
      name: "Thumbnail Genie",
      tagline: "Great thumbnails in one click.",
      shortDescription: "Turns a rough idea into a finished thumbnail.",
      iconUrl: "https://cdn.example.com/icon.png",
      category: "Creative",
      pricingModel: "SUBSCRIPTION",
      priceCents: 1900,
      freeTrialEnabled: true,
      trialDays: 7
    },
    architect: { displayName: "Dana R.", photoUrl: null },
    design: { theme: "light", composerPosition: "center", density: "cozy", bubbleStyle: "bubbles", showHistorySidebar: false },
    blueprint: null
  };
}

function app() {
  const routes = new Hono();
  registerAgentPageProductRoutes(routes);
  return routes;
}

beforeEach(() => {
  resolveProductForPublicMock.mockReset();
});

describe("GET /:slug/product", () => {
  it("404s with the shared code when the page is not publicly resolvable", async () => {
    resolveProductForPublicMock.mockResolvedValue(null);

    const response = await app().request(`/${SLUG}/product`);
    expect(response.status).toBe(404);

    const body = (await response.json()) as { success: boolean; code: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("AGENT_PAGE_NOT_FOUND");
    expect(resolveProductForPublicMock).toHaveBeenCalledWith(SLUG);
  });

  it("returns the resolved product, listing and architect", async () => {
    resolveProductForPublicMock.mockResolvedValue(resolvedProduct());

    const response = await app().request(`/${SLUG}/product`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      data: {
        slug: string;
        source: string;
        product: { pages: { id: string; path: string }[]; nav: { links: unknown[] } };
        listing: { name: string };
        architect: { displayName: string } | null;
        page: { template: string };
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.slug).toBe(SLUG);
    expect(body.data.source).toBe("spec");
    expect(body.data.product.pages.map((page) => page.path)).toEqual(["", "pricing"]);
    expect(body.data.product.nav.links).toHaveLength(2);
    expect(body.data.listing.name).toBe("Thumbnail Genie");
    expect(body.data.architect?.displayName).toBe("Dana R.");
    expect(body.data.page.template).toBe("media");
  });

  it("never leaks the workflow id or the raw blueprint", async () => {
    resolveProductForPublicMock.mockResolvedValue(resolvedProduct());

    const response = await app().request(`/${SLUG}/product`);
    const body = (await response.json()) as { data: Record<string, unknown> };

    expect(Object.keys(body.data).sort()).toEqual([
      "architect",
      "design",
      "listing",
      "page",
      "product",
      "slug",
      "source"
    ]);
  });

  it("reports a synthesized product as source \"blueprint\"", async () => {
    resolveProductForPublicMock.mockResolvedValue({ ...resolvedProduct(), source: "blueprint" as const });

    const response = await app().request(`/${SLUG}/product`);
    const body = (await response.json()) as { data: { source: string } };
    expect(body.data.source).toBe("blueprint");
  });
});
