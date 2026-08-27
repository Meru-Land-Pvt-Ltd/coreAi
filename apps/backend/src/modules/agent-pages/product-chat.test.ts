/* The packaging employee's own endpoint died on 2026-08-27 — one Builder
   owns that hand now (builder-page-hand.ts). The route-driven tests retired
   with it; every test here covers a TOOL that survived and still runs.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Product chat endpoint: POST /manage/:workflowId/product-chat.
 *
 * The LLM and prisma are mocked; everything else runs for real — the shared
 * sanitizer, the auto-fix pass, the legal generator and the storage service.
 * These are contract tests of the four things the route owns: the prompt it
 * builds, the gate every byte of model output passes through, the fixes it
 * applies on top, and what it persists.
 */

const mocks = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  listingFindUnique: vi.fn(),
  listingFindFirst: vi.fn(),
  listingCreate: vi.fn(),
  pageFindFirst: vi.fn(),
  pageFindUnique: vi.fn(),
  pageCreate: vi.fn(),
  pageUpdate: vi.fn(),
  execute: vi.fn(),
  resolveProvider: vi.fn(),
  getDesignBrainConfig: vi.fn(),
  getDesignBrainRules: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workflowDefinition: { findFirst: mocks.workflowFindFirst },
    agentListing: {
      findUnique: mocks.listingFindUnique,
      findFirst: mocks.listingFindFirst,
      create: mocks.listingCreate
    },
    publishedAgentPage: {
      findFirst: mocks.pageFindFirst,
      findUnique: mocks.pageFindUnique,
      create: mocks.pageCreate,
      update: mocks.pageUpdate
    }
  }
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("authUser", {
      id: "architect-1",
      email: "architect@example.com",
      role: "ARCHITECT",
      roles: ["ARCHITECT"],
      fullName: "Ada Architect"
    });
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next()
}));

vi.mock("../ai-provider-engine/llm-credentials", () => ({
  resolveConfiguredLlmProvider: mocks.resolveProvider,
  MISSING_LLM_CREDENTIALS_MESSAGE: "no llm configured"
}));

vi.mock("../ai-provider-engine/provider-engine", () => ({
  getProviderEngine: () => ({ executeWithProvider: mocks.execute })
}));

// The design battery an admin picks. Product generation must read it rather
// than carry a provider of its own — swapping the model on the admin screen
// has to change what builds every architect's product.
vi.mock("../admin/design-brain-settings", () => ({
  getDesignBrainConfig: mocks.getDesignBrainConfig
}));

// The admin-owned house-rules accessor, reached through a defensive dynamic
// import in the route (hence the ".js" specifier, which resolves to the same
// module).
vi.mock("../admin/design-brain-rules.js", () => ({
  getDesignBrainRules: mocks.getDesignBrainRules
}));

import { collectWires, sanitizeProductSpec, type ProductSpec } from "@coreai/shared";
import {
  PRODUCT_CHAT_EXAMPLE,
  PRODUCT_CHAT_FALLBACK_REPLY,
  asksForFullProduct,
  describeProductSpecContract,
  extractProductChatJson,
  gateProductChatOutput,
  productSellsSomething,
  summarizeAgentGraph,
  buildProductChatSystemPrompt
} from "./product-chat";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A real builder canvas: composer -> brain -> output. */
function canvasWorkflowJson() {
  return {
    nodes: [
      {
        id: "blk-composer",
        type: "coreNode",
        position: { x: 0, y: 0 },
        data: {
          type: "block.prompt_composer",
          nodeKind: "block",
          label: "Prompt Box",
          title: "Prompt Box",
          placeholder: "Describe your video…"
        }
      },
      {
        id: "ai-brain",
        type: "coreNode",
        position: { x: 780, y: 95 },
        data: { type: "ai.llm_call", nodeKind: "ai", label: "AI Brain", title: "AI Brain" }
      },
      {
        id: "blk-output",
        type: "coreNode",
        position: { x: 0, y: 190 },
        data: {
          type: "block.output_stage",
          nodeKind: "block",
          label: "Result Viewer",
          title: "Result Viewer",
          kind: "image"
        }
      }
    ],
    edges: [
      { id: "edge-1", source: "blk-composer", target: "ai-brain" },
      { id: "edge-2", source: "ai-brain", target: "blk-output" }
    ]
  };
}

const workflowRow = {
  id: "workflow-1",
  architectUserId: "architect-1",
  name: "Thumbnail Genie",
  workflowJson: canvasWorkflowJson()
};

const listingRow = {
  name: "Thumbnail Genie",
  tagline: "Thumbnails that get clicked",
  shortDescription: "Turns a sentence about your video into three thumbnails.",
  iconUrl: null,
  priceCents: 2900,
  pricingModel: "SUBSCRIPTION"
};

const pageRow = {
  id: "page-1",
  slug: "thumbnail-genie-abc123",
  listingId: "listing-abc123",
  workflowId: "workflow-1",
  architectUserId: "architect-1",
  template: "media",
  headline: null as string | null,
  welcomeMessage: null as string | null,
  suggestedPrompts: [] as string[],
  accentColor: "#f59e0b" as string | null,
  designJson: null as unknown,
  productJson: null as unknown,
  status: "LIVE",
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
  updatedAt: new Date("2026-08-15T00:00:00.000Z")
};

/** A working home page, wired to the canvas's real node ids. */
function homePage(extraBlocks: unknown[] = []) {
  return {
    id: "home",
    title: "Thumbnail Genie",
    path: "",
    blocks: [
      {
        id: "hero",
        type: "section",
        padding: "xl",
        background: "gradient",
        children: [
          {
            id: "hero-stack",
            type: "stack",
            gap: "md",
            children: [
              { id: "hero-title", type: "heading", level: 1, text: "Thumbnails that get clicked" },
              { id: "hero-sub", type: "text", size: "lg", text: "One sentence in, three thumbnails out." },
              {
                id: "hero-input",
                type: "input",
                placeholder: "What is your video about?",
                multiline: true,
                wire: { role: "input", nodeId: "blk-composer" }
              },
              {
                id: "hero-go",
                type: "button",
                label: "Make my thumbnails",
                // The AI-facing spelling of a button's look; the shared parser
                // lifts a string `style` onto `variant`.
                style: "primary",
                wire: { role: "action", nodeId: "blk-output" }
              },
              {
                id: "hero-result",
                type: "result",
                variant: "gallery",
                wire: { role: "output", nodeId: "blk-output" }
              }
            ]
          }
        ]
      },
      ...extraBlocks
    ]
  };
}

/** A home page with nothing wired — a brochure, not a product. */
function brochureHomePage() {
  return {
    id: "home",
    title: "Thumbnail Genie",
    path: "",
    blocks: [
      {
        id: "hero",
        type: "section",
        padding: "xl",
        background: "gradient",
        children: [
          {
            id: "hero-stack",
            type: "stack",
            gap: "md",
            children: [
              { id: "hero-title", type: "heading", level: 1, text: "Thumbnails that get clicked" },
              { id: "hero-sub", type: "text", text: "One sentence in, three thumbnails out." }
            ]
          }
        ]
      }
    ]
  };
}

function pricingPage() {
  return {
    id: "pricing",
    title: "Pricing",
    path: "pricing",
    blocks: [
      {
        id: "pricing-section",
        type: "section",
        padding: "lg",
        children: [
          { id: "pricing-title", type: "heading", level: 2, text: "Simple pricing" },
          {
            id: "pricing-grid",
            type: "grid",
            columns: 2,
            gap: "md",
            children: [
              {
                id: "plan-free",
                type: "stack",
                gap: "sm",
                children: [
                  { id: "plan-free-name", type: "heading", level: 3, text: "Starter" },
                  { id: "plan-free-price", type: "text", text: "Free" },
                  { id: "plan-free-list", type: "list", style: "check", items: ["Ten thumbnails a month"] },
                  { id: "plan-free-cta", type: "button", label: "Start free", href: "#start" }
                ]
              },
              {
                id: "plan-pro",
                type: "stack",
                gap: "sm",
                children: [
                  { id: "plan-pro-name", type: "heading", level: 3, text: "Creator" },
                  { id: "plan-pro-price", type: "text", text: "$29" },
                  { id: "plan-pro-period", type: "text", size: "sm", text: "per month" },
                  { id: "plan-pro-list", type: "list", style: "check", items: ["Unlimited thumbnails"] },
                  { id: "plan-pro-cta", type: "button", label: "Choose Creator", style: "primary", href: "#start" }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

function aboutPage() {
  return {
    id: "about",
    title: "About",
    path: "about",
    blocks: [
      {
        id: "about-section",
        type: "section",
        padding: "lg",
        children: [
          { id: "about-title", type: "heading", level: 2, text: "Why we built this" },
          { id: "about-text", type: "text", text: "We got tired of spending a whole evening on one thumbnail." }
        ]
      }
    ]
  };
}

function modelProduct(pages: unknown[], nav?: unknown) {
  return {
    version: 1,
    pages,
    nav: nav ?? {
      brand: { text: "Thumbnail Genie" },
      links: [{ label: "Home", pageId: "home" }],
      footerLinks: [],
      footerNote: "© Thumbnail Genie"
    },
    theme: { accent: "#f59e0b", mode: "light", font: "sans" }
  };
}

function llmSuccess(text: string, structuredOutput: unknown = null) {
  return {
    status: "success" as const,
    capability: "llm" as const,
    text,
    structuredOutput,
    providerId: "gemini",
    modelName: "gemini-test",
    tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    costUsd: 0,
    durationMs: 5,
    error: null
  };
}

function llmError(message: string) {
  return { ...llmSuccess(""), status: "error" as const, text: null, error: message };
}



/** The ProductSpec the route actually wrote to the database. */
function persistedProduct(): ProductSpec {
  expect(mocks.pageUpdate).toHaveBeenCalled();
  const call = mocks.pageUpdate.mock.calls[0][0] as { data: { productJson: ProductSpec } };
  return call.data.productJson;
}

/**
 * The briefing, from the tool itself.
 *
 * It used to be fished out of a provider mock after a route call — but the
 * route died with its employee on 2026-08-27, and a briefing is a pure
 * function anyway. Calling it directly tests the same thing, more honestly.
 */
function systemPrompt(overrides: { graph?: unknown; current?: unknown; houseRules?: string } = {}): string {
  return buildProductChatSystemPrompt({
    agent: {
      name: listingRow.name,
      tagline: listingRow.tagline,
      shortDescription: listingRow.shortDescription,
      iconUrl: listingRow.iconUrl,
      priceCents: listingRow.priceCents,
      pricingModel: String(listingRow.pricingModel)
    } as never,
    graph: (overrides.graph ?? summarizeAgentGraph(workflowRow.workflowJson)) as never,
    current: (overrides.current ?? null) as never,
    ...(overrides.houseRules !== undefined ? { houseRules: overrides.houseRules } : {})
  });
}

function pageIds(product: ProductSpec): string[] {
  return product.pages.map((page) => page.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workflowFindFirst.mockResolvedValue(workflowRow);
  mocks.pageFindFirst.mockResolvedValue({ ...pageRow });
  mocks.listingFindUnique.mockResolvedValue({ ...listingRow });
  mocks.resolveProvider.mockReturnValue({ providerId: "openai" });
  mocks.getDesignBrainConfig.mockResolvedValue({ providerId: "openai", modelId: "gpt-4.1-mini" });
  mocks.getDesignBrainRules.mockResolvedValue("");
  mocks.pageUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...pageRow,
    ...data
  }));
});

// ---------------------------------------------------------------------------


describe("the system prompt", () => {
  beforeEach(() => {
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Done.", product: modelProduct([homePage()]) }))
    );
  });

  /* The provider-call shape was asserted through the deleted route; the
     Builder's own door owns that call now and is covered where it lives. */

  it("carries the FULL contract, generated from the shared schemas", async () => {
    const prompt = systemPrompt();

    // Every node type in the shared union is described...
    for (const type of [
      "section",
      "stack",
      "grid",
      "row",
      "heading",
      "text",
      "image",
      "icon",
      "badge",
      "divider",
      "spacer",
      "list",
      "quote",
      "stat",
      "button",
      "input",
      "upload",
      "choice",
      "result",
      "history"
    ]) {
      expect(prompt).toContain(`"type": "${type}"`);
    }
    // ...with its real allowed values, read out of the schemas.
    expect(prompt).toContain('"variant"?: "primary" | "secondary" | "ghost"');
    expect(prompt).toContain('"columns"?: 2 | 3 | 4');
    expect(prompt).toContain('"role": "input" | "action" | "output"');
    expect(prompt).toContain('"mode"?: "light" | "dark" | "warm"');
    // ...and the real caps.
    expect(prompt).toContain("up to 12 pages");
    expect(prompt).toContain("up to 120 nodes per page");
  });

  it("carries the professional section vocabulary and the wire rules", async () => {
    const prompt = systemPrompt();

    for (const kind of [
      "hero",
      "featureGrid",
      "statsBand",
      "pricingTable",
      "testimonialRow",
      "faqAccordion",
      "ctaBand"
    ]) {
      expect(prompt).toContain(kind);
    }
    expect(prompt).toContain("header and footer");
    expect(prompt).toContain("The home page ALWAYS needs all three.");
  });

  it("lists the agent's REAL graph nodes so wires can point at them", async () => {
    const prompt = systemPrompt();

    expect(prompt).toContain("blk-composer — block.prompt_composer (\"Prompt Box\")");
    expect(prompt).toContain("ai-brain — ai.llm_call (\"AI Brain\")");
    expect(prompt).toContain("blk-output — block.output_stage (\"Result Viewer\")");
    expect(prompt).toContain('role "input" → "nodeId": "blk-composer"');
    expect(prompt).toContain('role "output" → "nodeId": "blk-output"');
  });

  it("tells the model to leave nodeId out when the canvas is empty", async () => {
    const empty = summarizeAgentGraph({ nodes: [], edges: [] });
    expect(systemPrompt({ graph: empty })).toContain("this agent has no steps on its canvas yet");
  });

  it("puts the admin house rules first, and omits the block entirely when there are none", async () => {
    const rules = "1. Mobile first, always.\n2. Never use jargon.";
    const withRules = systemPrompt({ houseRules: rules });
    expect(withRules.startsWith(`HOUSE RULES you must always obey:\n${rules}`)).toBe(true);
    expect(withRules.indexOf("HOUSE RULES")).toBeLessThan(withRules.indexOf("THE PRODUCT SPEC"));

    mocks.execute.mockClear();
    mocks.getDesignBrainRules.mockResolvedValue("");
    expect(systemPrompt()).not.toContain("HOUSE RULES");
  });

  it("omits the house-rules block entirely when there are none", () => {
    /* House rules that cannot be read must never break the briefing — the
       architect still gets a reply, just without the block. */
    expect(systemPrompt()).not.toContain("HOUSE RULES");
  });

  it("shows the stored product back to the model so it can edit instead of rewrite", async () => {
    const stored = sanitizeProductSpec(modelProduct([homePage(), aboutPage()]));

    const prompt = systemPrompt({ current: stored });
    expect(prompt).toContain("THE PRODUCT RIGHT NOW");
    expect(prompt).toContain('"id":"about"');
  });
});



/* The gate's retry loop was tested through the deleted route; it runs
   inside the Builder's page hand now (runComposerBrain) and is covered
   there. The gate FUNCTION itself is still tested here. */
describe("the gate", () => {
  it("gates an empty product with an error the model can act on", () => {
    const gate = gateProductChatOutput(null, JSON.stringify({ reply: "hi", product: { pages: [] } }));
    expect(gate.product).toBeNull();
    expect(gate.error).toContain("nothing in it could be rendered");
  });

  it("spots the requests and the products that need legal pages", () => {
    expect(asksForFullProduct("build the full website so I can sell it")).toBe(true);
    expect(asksForFullProduct("I want to publish this")).toBe(true);
    expect(asksForFullProduct("make the button green")).toBe(false);

    const selling = sanitizeProductSpec(modelProduct([homePage(), pricingPage()]));
    expect(productSellsSomething(selling as ProductSpec)).toBe(true);
    const plain = sanitizeProductSpec(modelProduct([homePage()]));
    expect(productSellsSomething(plain as ProductSpec)).toBe(false);
  });
});
