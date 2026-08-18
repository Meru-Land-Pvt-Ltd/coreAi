import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

/**
 * The founder's read-through, run as a test.
 *
 * Everything else in this folder tests one seam. This file walks the whole
 * product the way a customer meets it, through the REAL route components:
 *
 *   1. A generated product with home + pricing + privacy + terms answers at
 *      /a/<slug>, /a/<slug>/pricing, /a/<slug>/privacy and /a/<slug>/terms.
 *   2. The home page's input + button + result actually runs the agent's
 *      chain — the customer's words reach the run endpoint and the agent's
 *      answer lands on the page.
 *   3. An agent with no stored ProductSpec still renders through the old path.
 *
 * The run endpoint is `apiPost` (see createPublicAgentPageRuntime); the product
 * read is server-side `fetch`. Both are mocked, nothing else is.
 */

const { pushMock, prefetchMock, apiGetMock, apiPostMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  prefetchMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  pathnameMock: vi.fn(() => "/a/thumbnail-genie")
}));

class NotFoundSignal extends Error {}
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    prefetch: prefetchMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
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

vi.mock("@/lib/api", () => ({
  apiGet: apiGetMock,
  apiPost: apiPostMock
}));

import HomeRoute from "./page";
import SubPageRoute from "./[page]/page";

const SLUG = "thumbnail-genie";

/**
 * The shape the Generation Builder's prompt asks the AI for: a marketing home
 * page whose working surface is a wired input + button + result, plus the
 * pages a sellable product needs.
 */
function fullProduct() {
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
              { id: "hero-sub", type: "text", text: "Describe the video, get a finished thumbnail." }
            ]
          },
          {
            id: "product",
            type: "section",
            padding: "lg",
            children: [
              { id: "product-title", type: "heading", level: 2, text: "Try it now" },
              {
                id: "field",
                type: "input",
                label: "Your video idea",
                wire: { role: "input", nodeId: "in" }
              },
              {
                id: "go",
                type: "button",
                label: "Make my thumbnail",
                wire: { role: "action", nodeId: "gen" }
              },
              { id: "out", type: "result", wire: { role: "output", nodeId: "gen" } }
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
              { id: "plans-price", type: "text", text: "19 dollars a month." }
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
            children: [
              { id: "privacy-title", type: "heading", level: 2, text: "Privacy policy" },
              { id: "privacy-text", type: "text", text: "We keep what you send only to answer you." }
            ]
          }
        ]
      },
      {
        id: "terms",
        title: "Terms",
        path: "terms",
        blocks: [
          {
            id: "terms-body",
            type: "section",
            children: [
              { id: "terms-title", type: "heading", level: 2, text: "Terms of service" },
              { id: "terms-text", type: "text", text: "Use the product fairly and it stays yours." }
            ]
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
      footerLinks: [
        { label: "Privacy", pageId: "privacy" },
        { label: "Terms", pageId: "terms" }
      ],
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
      product: fullProduct(),
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
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body })
  );
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
  apiPostMock.mockReset();
  pathnameMock.mockReturnValue(`/a/${SLUG}`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. Every page of the product answers at its own URL.
// ---------------------------------------------------------------------------

describe("a generated product is a real multi-page site", () => {
  it("serves the home page at /a/<slug>", async () => {
    mockProduct(productPayload());

    await renderRoute(HomeRoute({ params: params() }));

    expect(screen.getByRole("heading", { name: "Thumbnails that get clicked" })).toBeTruthy();
    // Chrome on every page: the brand and the footer note.
    expect(screen.getAllByText("Thumbnail Genie").length).toBeGreaterThan(0);
    expect(screen.getByText("Made with Triven.")).toBeTruthy();
  });

  it.each([
    ["pricing", "One plan, everything included"],
    ["privacy", "Privacy policy"],
    ["terms", "Terms of service"]
  ])("serves /a/<slug>/%s", async (path, headingText) => {
    mockProduct(productPayload());
    pathnameMock.mockReturnValue(`/a/${SLUG}/${path}`);

    await renderRoute(SubPageRoute({ params: params({ page: path }) }));

    expect(screen.getByRole("heading", { name: headingText })).toBeTruthy();
    // Same chrome as home — one site, not four loose pages.
    expect(screen.getByText("Made with Triven.")).toBeTruthy();
  });

  it("links the legal pages from the footer of every page", async () => {
    mockProduct(productPayload());

    await renderRoute(HomeRoute({ params: params() }));

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe(
      `/a/${SLUG}/privacy`
    );
    expect(within(footer).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(
      `/a/${SLUG}/terms`
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The home page's working surface actually runs the agent.
// ---------------------------------------------------------------------------

describe("the product on the home page really runs", () => {
  it("sends the customer's words to the agent and shows the answer", async () => {
    const user = userEvent.setup();
    mockProduct(productPayload());
    apiPostMock.mockResolvedValue({
      success: true,
      data: {
        output: { text: "Here is your thumbnail concept.", mediaUrls: [], structured: null },
        remainingToday: 4
      }
    });

    await renderRoute(HomeRoute({ params: params() }));

    // Before the run: an inviting empty state, never a blank hole.
    expect(screen.getByTestId("spec-result-empty")).toBeTruthy();

    await user.type(screen.getByLabelText("Your video idea"), "a cat riding a bike");
    await user.click(screen.getByRole("button", { name: "Make my thumbnail" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-text")).toBeTruthy());
    expect(screen.getByTestId("spec-result-text").textContent).toContain(
      "Here is your thumbnail concept."
    );

    // It reached the public run endpoint for THIS slug, carrying what the
    // customer typed and which button they pressed.
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    const [path, body] = apiPostMock.mock.calls[0];
    expect(path).toBe(`/agent-pages/${SLUG}/run`);
    expect(body.prompt).toContain("a cat riding a bike");
    expect(body.prompt).toContain("Make my thumbnail");
  });

  it("offers a retry instead of a dead end when the agent fails", async () => {
    const user = userEvent.setup();
    mockProduct(productPayload());
    apiPostMock.mockResolvedValue({ success: false, error: { message: "Upstream is down." } });

    await renderRoute(HomeRoute({ params: params() }));

    await user.type(screen.getByLabelText("Your video idea"), "a cat riding a bike");
    await user.click(screen.getByRole("button", { name: "Make my thumbnail" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-error")).toBeTruthy());
    expect(screen.getByTestId("spec-result-retry")).toBeTruthy();
  });

  it("keeps the marketing pages inert — no run surface on pricing", async () => {
    mockProduct(productPayload());
    pathnameMock.mockReturnValue(`/a/${SLUG}/pricing`);

    await renderRoute(SubPageRoute({ params: params({ page: "pricing" }) }));

    expect(screen.queryByTestId("spec-result-empty")).toBeNull();
    expect(screen.queryByRole("button", { name: "Make my thumbnail" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The compatibility contract.
// ---------------------------------------------------------------------------

describe("agents built before the Product Spec", () => {
  it("renders through the legacy page, untouched", async () => {
    mockProduct(
      productPayload({ source: "blueprint", product: { version: 1, pages: [], nav: { links: [] } } })
    );

    await renderRoute(HomeRoute({ params: params() }));

    // No site chrome and no spec surface — the old page owns the screen, and
    // it is still waiting on its own axios fetch.
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByTestId("spec-result-empty")).toBeNull();
    expect(apiGetMock).toHaveBeenCalled();
  });
});
