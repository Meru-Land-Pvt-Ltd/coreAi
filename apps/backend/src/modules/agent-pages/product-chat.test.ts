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
  summarizeAgentGraph
} from "./product-chat";
import { registerAgentPageManageRoutes } from "./manage-routes";

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

function buildApp() {
  const app = new Hono();
  registerAgentPageManageRoutes(app);
  return app;
}

function productChat(app: Hono, body: unknown, workflowId = "workflow-1") {
  return app.request(`/manage/${workflowId}/product-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

/** The ProductSpec the route actually wrote to the database. */
function persistedProduct(): ProductSpec {
  expect(mocks.pageUpdate).toHaveBeenCalled();
  const call = mocks.pageUpdate.mock.calls[0][0] as { data: { productJson: ProductSpec } };
  return call.data.productJson;
}

function systemPrompt(callIndex = 0): string {
  return mocks.execute.mock.calls[callIndex][1].systemPrompt as string;
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

describe("POST /manage/:workflowId/product-chat — ownership and input", () => {
  it("404s for a workflow the architect does not own, and never calls the model", async () => {
    mocks.workflowFindFirst.mockResolvedValue(null);

    const res = await productChat(buildApp(), { instruction: "build me a site" }, "someone-elses");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("WORKFLOW_NOT_FOUND");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("422s an empty instruction and 422s one over 800 characters", async () => {
    const app = buildApp();

    const empty = await productChat(app, { instruction: "   " });
    expect(empty.status).toBe(422);

    const long = await productChat(app, { instruction: "a".repeat(801) });
    expect(long.status).toBe(422);

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("503s when no LLM provider is configured", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const res = await productChat(buildApp(), { instruction: "build me a site" });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("LLM_NOT_CONFIGURED");
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });
});

describe("the system prompt", () => {
  beforeEach(() => {
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Done.", product: modelProduct([homePage()]) }))
    );
  });

  it("calls the provider engine the ai.llm_call way, with room for a whole product", async () => {
    await productChat(buildApp(), { instruction: "build me a proper website" });

    // The provider comes from the admin design battery, never a constant here.
    expect(mocks.resolveProvider).toHaveBeenCalledWith("openai");
    const [providerId, request] = mocks.execute.mock.calls[0];
    expect(providerId).toBe("openai");
    expect(request.model).toBe("gpt-4.1-mini");
    expect(request.outputFormat).toBe("json");
    expect(request.maxTokens).toBeGreaterThanOrEqual(8000);
    expect(request.task).toBe("agent-page-product-chat");
    expect(request.messages).toEqual([{ role: "user", content: "build me a proper website" }]);
  });

  it("carries the FULL contract, generated from the shared schemas", async () => {
    await productChat(buildApp(), { instruction: "build me a proper website" });
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
    await productChat(buildApp(), { instruction: "build me a proper website" });
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
    await productChat(buildApp(), { instruction: "build me a proper website" });
    const prompt = systemPrompt();

    expect(prompt).toContain("blk-composer — block.prompt_composer (\"Prompt Box\")");
    expect(prompt).toContain("ai-brain — ai.llm_call (\"AI Brain\")");
    expect(prompt).toContain("blk-output — block.output_stage (\"Result Viewer\")");
    expect(prompt).toContain('role "input" → "nodeId": "blk-composer"');
    expect(prompt).toContain('role "output" → "nodeId": "blk-output"');
  });

  it("tells the model to leave nodeId out when the canvas is empty", async () => {
    mocks.workflowFindFirst.mockResolvedValue({ ...workflowRow, workflowJson: { nodes: [], edges: [] } });

    await productChat(buildApp(), { instruction: "build me a proper website" });

    expect(systemPrompt()).toContain("this agent has no steps on its canvas yet");
  });

  it("puts the admin house rules first, and omits the block entirely when there are none", async () => {
    const rules = "1. Mobile first, always.\n2. Never use jargon.";
    mocks.getDesignBrainRules.mockResolvedValue(rules);

    await productChat(buildApp(), { instruction: "build me a proper website" });
    const withRules = systemPrompt();
    expect(withRules.startsWith(`HOUSE RULES you must always obey:\n${rules}`)).toBe(true);
    expect(withRules.indexOf("HOUSE RULES")).toBeLessThan(withRules.indexOf("THE PRODUCT SPEC"));

    mocks.execute.mockClear();
    mocks.getDesignBrainRules.mockResolvedValue("");
    await productChat(buildApp(), { instruction: "build me a proper website" });
    expect(systemPrompt()).not.toContain("HOUSE RULES");
  });

  it("survives a house-rules accessor that throws — the architect still gets a reply", async () => {
    mocks.getDesignBrainRules.mockRejectedValue(new Error("database is down"));

    const res = await productChat(buildApp(), { instruction: "build me a proper website" });

    expect(res.status).toBe(200);
    expect(systemPrompt()).not.toContain("HOUSE RULES");
  });

  it("shows the stored product back to the model so it can edit instead of rewrite", async () => {
    const stored = sanitizeProductSpec(modelProduct([homePage(), aboutPage()]));
    mocks.pageFindFirst.mockResolvedValue({ ...pageRow, productJson: stored });

    await productChat(buildApp(), { instruction: "add a pricing page" });

    const prompt = systemPrompt();
    expect(prompt).toContain("THE PRODUCT RIGHT NOW");
    expect(prompt).toContain('"id":"about"');
  });
});

describe("generation", () => {
  it("persists a whole multi-page product and reports the pages it created", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        `Here you go:\n\`\`\`json\n${JSON.stringify({
          reply: "Built your site: a working home page, pricing and an about page.",
          product: modelProduct([homePage(), pricingPage(), aboutPage()], {
            brand: { text: "Thumbnail Genie" },
            links: [
              { label: "Home", pageId: "home" },
              { label: "Pricing", pageId: "pricing" },
              { label: "About", pageId: "about" }
            ],
            footerLinks: [],
            footerNote: "© Thumbnail Genie"
          })
        })}\n\`\`\``
      )
    );

    const res = await productChat(buildApp(), {
      instruction: "build me the full website for this, ready to sell"
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reply).toBe("Built your site: a working home page, pricing and an about page.");

    // Persisted through the service, in one update on the page row.
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.pageUpdate.mock.calls[0][0].where).toEqual({ id: "page-1" });

    const stored = persistedProduct();
    expect(stored.version).toBe(1);
    expect(pageIds(stored)).toEqual(expect.arrayContaining(["home", "pricing", "about"]));
    // The echo is byte-identical to what was stored.
    expect(body.data.product).toEqual(stored);
    expect(body.data.pagesCreated).toEqual(expect.arrayContaining(["home", "pricing", "about"]));
    // Exactly one front door, at the root path.
    expect(stored.pages.filter((page) => page.path === "").map((page) => page.id)).toEqual(["home"]);
  });

  it("binds wires to the agent's real graph node ids", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Done.", product: modelProduct([homePage()]) }))
    );

    const res = await productChat(buildApp(), { instruction: "build me a site" });
    const body = await res.json();
    const wires = collectWires(body.data.product);

    expect(wires).toEqual([
      expect.objectContaining({ specNodeId: "hero-input", wire: { role: "input", nodeId: "blk-composer" } }),
      expect.objectContaining({ specNodeId: "hero-go", wire: { role: "action", nodeId: "blk-output" } }),
      expect.objectContaining({ specNodeId: "hero-result", wire: { role: "output", nodeId: "blk-output" } })
    ]);
    // The AI-facing string `style` was normalized, not dropped.
    const stored = persistedProduct();
    const hero = stored.pages[0].blocks[0] as { children: { children: { id: string; variant?: string }[] }[] };
    expect(hero.children[0].children.find((node) => node.id === "hero-go")?.variant).toBe("primary");
  });

  it("re-reads only pages that are new: an edit of a stored product reports nothing created", async () => {
    const stored = sanitizeProductSpec(modelProduct([homePage(), aboutPage()]));
    mocks.pageFindFirst.mockResolvedValue({ ...pageRow, productJson: stored });
    mocks.execute.mockResolvedValue(
      llmSuccess(
        JSON.stringify({
          reply: "Softened the headline.",
          product: modelProduct([homePage(), aboutPage()])
        })
      )
    );

    const res = await productChat(buildApp(), { instruction: "make the headline friendlier" });
    const body = await res.json();

    expect(body.data.pagesCreated).toEqual([]);
    expect(body.data.legalNote).toBeNull();
  });

  it("clamps a long reply instead of throwing the product away", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        JSON.stringify({ reply: "x".repeat(400), product: modelProduct([homePage()]) })
      )
    );

    const res = await productChat(buildApp(), { instruction: "build me a site" });
    const body = await res.json();

    expect(body.data.reply.length).toBeLessThanOrEqual(200);
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("auto-fix", () => {
  it("makes a brochure home page actually work, wired to the real graph", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        JSON.stringify({ reply: "Here is your page.", product: modelProduct([brochureHomePage()]) })
      )
    );

    const res = await productChat(buildApp(), { instruction: "make me a landing page" });
    const body = await res.json();
    const wires = collectWires(body.data.product);

    expect(wires.map((ref) => ref.wire)).toEqual([
      { role: "input", nodeId: "blk-composer" },
      { role: "action", nodeId: "ai-brain" },
      { role: "output", nodeId: "blk-output" }
    ]);
    // The decoration the model wrote is untouched — the fix is appended.
    expect(body.data.product.pages[0].blocks[0].id).toBe("hero");
    expect(body.data.product.pages[0].blocks.length).toBe(2);
  });

  it("adds only what is missing: a home page with input and action keeps them and gains a result", async () => {
    const partial = {
      id: "home",
      title: "Thumbnail Genie",
      path: "",
      blocks: [
        {
          id: "hero",
          type: "section",
          children: [
            { id: "hero-title", type: "heading", level: 1, text: "Thumbnails that get clicked" },
            { id: "hero-input", type: "input", placeholder: "Your video?", wire: { role: "input" } },
            { id: "hero-go", type: "button", label: "Go", wire: { role: "action" } }
          ]
        }
      ]
    };
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Done.", product: modelProduct([partial]) }))
    );

    const res = await productChat(buildApp(), { instruction: "make me a landing page" });
    const body = await res.json();
    const roles = collectWires(body.data.product).map((ref) => ref.wire.role);

    expect(roles).toEqual(["input", "action", "output"]);
    // The added result is bound to the canvas; the model's own wires are left alone.
    const wires = collectWires(body.data.product);
    expect(wires[0].wire).toEqual({ role: "input" });
    expect(wires[2].wire).toEqual({ role: "output", nodeId: "blk-output" });
  });

  it("adds privacy and terms when the architect asks for a sellable product", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        JSON.stringify({
          reply: "Built your site with pricing.",
          product: modelProduct([homePage(), pricingPage()])
        })
      )
    );

    const res = await productChat(buildApp(), {
      instruction: "build the full product so I can sell it"
    });
    const body = await res.json();
    const stored = persistedProduct();

    expect(pageIds(stored)).toEqual(expect.arrayContaining(["privacy", "terms"]));
    expect(body.data.pagesCreated).toEqual(expect.arrayContaining(["privacy", "terms"]));
    // Reachable from the footer, and never in the top bar.
    expect(stored.nav.footerLinks).toEqual(
      expect.arrayContaining([
        { label: "Privacy", pageId: "privacy" },
        { label: "Terms", pageId: "terms" }
      ])
    );
    expect(stored.nav.links.map((link) => link.pageId)).not.toContain("privacy");
    // The architect is told, in words, that these need a read.
    expect(body.data.legalNote).toContain("not legal advice");
    // Written from the architect's real details, in plain English.
    const privacy = stored.pages.find((page) => page.id === "privacy");
    expect(JSON.stringify(privacy)).toContain("architect@example.com");
    expect(privacy?.path).toBe("privacy");
  });

  it("never overwrites legal pages the AI wrote itself", async () => {
    const ownPrivacy = {
      id: "privacy",
      title: "Privacy",
      path: "privacy",
      blocks: [
        {
          id: "privacy-body",
          type: "section",
          children: [{ id: "privacy-text", type: "text", text: "We keep nothing you do not send us." }]
        }
      ]
    };
    mocks.execute.mockResolvedValue(
      llmSuccess(
        JSON.stringify({
          reply: "Done.",
          product: modelProduct([homePage(), pricingPage(), ownPrivacy])
        })
      )
    );

    const res = await productChat(buildApp(), { instruction: "build the full product to sell" });
    const body = await res.json();
    const stored = persistedProduct();

    expect(JSON.stringify(stored.pages.find((page) => page.id === "privacy"))).toContain(
      "We keep nothing you do not send us."
    );
    // The missing half is still generated.
    expect(pageIds(stored)).toContain("terms");
    expect(body.data.pagesCreated).toEqual(expect.arrayContaining(["terms"]));
    // The generated half reads like the generator, not like the model.
    expect(JSON.stringify(stored.pages.find((page) => page.id === "terms"))).toContain(
      "Terms of Service"
    );
  });

  it("leaves a small one-page tweak alone — no legal pages bolted on", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Shorter now.", product: modelProduct([homePage()]) }))
    );

    const res = await productChat(buildApp(), { instruction: "make the headline shorter" });
    const body = await res.json();

    expect(pageIds(body.data.product)).toEqual(["home"]);
    expect(body.data.legalNote).toBeNull();
  });

  it("links every page the model forgot to put in the nav, but keeps a thanks page out of the top bar", async () => {
    const thanksPage = {
      id: "thanks",
      title: "Thanks",
      path: "thanks",
      blocks: [
        {
          id: "thanks-section",
          type: "section",
          children: [{ id: "thanks-text", type: "text", text: "You're in. Check your email." }]
        }
      ]
    };
    mocks.execute.mockResolvedValue(
      llmSuccess(
        JSON.stringify({
          reply: "Added an about page.",
          product: modelProduct([homePage(), aboutPage(), thanksPage], {
            brand: { text: "Thumbnail Genie" },
            // The model wrote the page but never linked it, and linked a page
            // that does not exist.
            links: [{ label: "Careers", pageId: "careers" }],
            footerLinks: []
          })
        })
      )
    );

    const res = await productChat(buildApp(), { instruction: "add an about page" });
    const stored = (await res.json()).data.product as ProductSpec;

    expect(stored.nav.links).toEqual([
      { label: "Home", pageId: "home" },
      { label: "About", pageId: "about" }
    ]);
  });
});

describe("the gate", () => {
  it("retries once with the validation error, then persists the corrected product", async () => {
    mocks.execute
      .mockResolvedValueOnce(llmSuccess("Sure! I'll build that for you."))
      .mockResolvedValueOnce(
        llmSuccess(JSON.stringify({ reply: "Fixed.", product: modelProduct([homePage()]) }))
      );

    const res = await productChat(buildApp(), { instruction: "build me a site" });
    const body = await res.json();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const retryMessages = mocks.execute.mock.calls[1][1].messages;
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[2].content).toContain("Your previous output was invalid");
    expect(retryMessages[2].content).toContain("No JSON object found");
    expect(body.data.reply).toBe("Fixed.");
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when the model fails twice, and replies kindly", async () => {
    mocks.execute.mockResolvedValue(llmSuccess("I cannot do that."));

    const res = await productChat(buildApp(), { instruction: "build me a site" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(body.data.reply).toBe(PRODUCT_CHAT_FALLBACK_REPLY);
    expect(body.data.pagesCreated).toEqual([]);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
    // The architect still gets a product back: the one they already had.
    expect(body.data.product.version).toBe(1);
    expect(pageIds(body.data.product)).toContain("home");
  });

  it("returns the stored product untouched when the model fails twice", async () => {
    const stored = sanitizeProductSpec(modelProduct([homePage(), aboutPage()]));
    mocks.pageFindFirst.mockResolvedValue({ ...pageRow, productJson: stored });
    mocks.execute.mockResolvedValue(llmSuccess("{ not json"));

    const body = await (await productChat(buildApp(), { instruction: "redo it" })).json();

    expect(body.data.product).toEqual(stored);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("does not retry a provider transport failure", async () => {
    mocks.execute.mockRejectedValue(new Error("socket hang up"));

    const body = await (await productChat(buildApp(), { instruction: "build me a site" })).json();

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(body.data.reply).toBe(PRODUCT_CHAT_FALLBACK_REPLY);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("does not retry a provider error response", async () => {
    mocks.execute.mockResolvedValue(llmError("quota exceeded"));

    const body = await (await productChat(buildApp(), { instruction: "build me a site" })).json();

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(body.data.reply).toBe(PRODUCT_CHAT_FALLBACK_REPLY);
  });

  it("takes structuredOutput when the provider returns parsed JSON", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(null, { reply: "Structured.", product: modelProduct([homePage()]) })
    );

    const body = await (await productChat(buildApp(), { instruction: "build me a site" })).json();

    expect(body.data.reply).toBe("Structured.");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("drops a hallucinated node instead of the whole page", async () => {
    const home = homePage([
      {
        id: "weird",
        type: "section",
        children: [
          { id: "weird-hologram", type: "hologram", spin: true },
          { id: "weird-text", type: "text", text: "This part is fine." }
        ]
      }
    ]);
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Done.", product: modelProduct([home]) }))
    );

    const body = await (await productChat(buildApp(), { instruction: "build me a site" })).json();
    const json = JSON.stringify(body.data.product);

    expect(json).not.toContain("hologram");
    expect(json).toContain("This part is fine.");
  });

  it("strips a javascript: url a model tried to smuggle into an image", async () => {
    const home = homePage([
      {
        id: "shot",
        type: "section",
        children: [{ id: "shot-img", type: "image", url: "javascript:alert(1)", alt: "x" }]
      }
    ]);
    mocks.execute.mockResolvedValue(
      llmSuccess(JSON.stringify({ reply: "Done.", product: modelProduct([home]) }))
    );

    const body = await (await productChat(buildApp(), { instruction: "add a screenshot" })).json();

    expect(JSON.stringify(body.data.product)).not.toContain("javascript:");
  });
});

describe("pure helpers", () => {
  it("describes every node type from the schemas, with nothing left unknown", () => {
    const contract = describeProductSpecContract();
    expect(contract).not.toContain("unknown");
    expect(contract).toContain('"type": "history"');
    expect(contract).toContain('"listStyle"?: "check" | "bullet" | "number"');
  });

  it("keeps the worked example valid against the contract it teaches", () => {
    const clean = sanitizeProductSpec(PRODUCT_CHAT_EXAMPLE.product);
    expect(clean).toEqual(PRODUCT_CHAT_EXAMPLE.product);
    expect(PRODUCT_CHAT_EXAMPLE.reply.length).toBeLessThanOrEqual(200);
    expect(collectWires(PRODUCT_CHAT_EXAMPLE.product).map((ref) => ref.wire.role)).toEqual([
      "input",
      "action",
      "output"
    ]);
  });

  it("summarizes a canvas into ids, kinds and titles", () => {
    const graph = summarizeAgentGraph(canvasWorkflowJson());
    expect(graph.nodes).toEqual([
      { id: "blk-composer", slug: "block.prompt_composer", kind: "block", title: "Prompt Box" },
      { id: "ai-brain", slug: "ai.llm_call", kind: "ai", title: "AI Brain" },
      { id: "blk-output", slug: "block.output_stage", kind: "block", title: "Result Viewer" }
    ]);
    expect(graph.inputNodeId).toBe("blk-composer");
    expect(graph.actionNodeId).toBe("ai-brain");
    expect(graph.outputNodeId).toBe("blk-output");
  });

  it("never throws on a graph that is not a graph", () => {
    expect(summarizeAgentGraph(null).nodes).toEqual([]);
    expect(summarizeAgentGraph("nonsense").nodes).toEqual([]);
    expect(summarizeAgentGraph({ nodes: [1, null, { data: {} }] }).nodes).toEqual([]);
  });

  it("reads JSON out of fences and prose, and refuses everything else", () => {
    expect(extractProductChatJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractProductChatJson('Sure: {"a":{"b":"}"}} — done')).toEqual({ a: { b: "}" } });
    expect(extractProductChatJson("no object here")).toBeNull();
    expect(extractProductChatJson(null)).toBeNull();
  });

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
