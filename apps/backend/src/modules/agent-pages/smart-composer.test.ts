import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * the AI Builder endpoints: POST /manage/:workflowId/smart-compose and
 * POST /manage/:workflowId/ai-builder-page.
 *
 * The LLM and prisma are mocked; everything else runs for real — the shared
 * declaration derivation, the sanitizer, the composer validator and the
 * storage service. These are contract tests of the founder's guarantees:
 * merged asks become ONE field, an unplaced ask triggers the single retry,
 * an invalid spec is never saved, and packaging requests change nothing.
 */

const mocks = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  listingFindUnique: vi.fn(),
  pageFindFirst: vi.fn(),
  pageUpdate: vi.fn(),
  execute: vi.fn(),
  resolveProvider: vi.fn(),
  getSmartDesignerBrainConfig: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workflowDefinition: { findFirst: mocks.workflowFindFirst },
    agentListing: { findUnique: mocks.listingFindUnique },
    publishedAgentPage: { findFirst: mocks.pageFindFirst, update: mocks.pageUpdate }
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

// The the AI Builder battery an admin picks. The composer must read THIS slot
// — never the Design Brain's, never a provider frozen into the module.
vi.mock("../admin/ai-builder-page-brain-settings", () => ({
  getSmartDesignerBrainConfig: mocks.getSmartDesignerBrainConfig
}));

import { deriveDeclarations, sanitizeProductSpec, type WorkflowDeclarations } from "@coreai/shared";
import {
  SMART_COMPOSER_FALLBACK_REPLY,
  SMART_DESIGNER_BOUNDARY_REPLY,
  checkComposition,
  isPackagingRequest,
  registerPageHandRoutes
} from "./smart-composer";

// ---------------------------------------------------------------------------
// Fixture: two engine nodes sharing {{city}} — the merge that matters.
// ---------------------------------------------------------------------------

const workflowJson = {
  nodes: [
    {
      id: "brain-1",
      data: {
        type: "ai.llm_call",
        label: "Forecast brain",
        prompt: "Weather for {{city}} by {{deadline}}",
        /* Filled the modern way — an unfilled Brain box would derive a
           business ask labeled with the machine key, and the surface law
           (rightly) refuses a customer ever reading one. */
        llmAnswerShouldBe: "Write a short, friendly forecast."
      }
    },
    {
      id: "sms-1",
      data: { type: "action.send_sms", label: "Send the forecast", body: "Forecast for {{city}}", smsTo: "+15550001111" }
    }
  ],
  edges: [{ source: "brain-1", target: "sms-1" }]
};

const declarations = deriveDeclarations(workflowJson);
const cityAsk = declarations.asks.find((ask) => ask.id === "city");
const expectedMerged = declarations.asks.filter((ask) => ask.nodeIds.length > 1).length;

/** A spec that satisfies every declaration — the shape a good model returns. */
function composedSpec(decl: WorkflowDeclarations, options: { omitAskId?: string; resultVariant?: string; extraFieldForAskId?: string } = {}) {
  const fields = decl.asks
    .filter((ask) => ask.id !== options.omitAskId)
    .map((ask) => ({
      id: `field-${ask.id}`,
      type: ask.kind === "choice" ? "choice" : ask.kind === "file" ? "upload" : "input",
      label: ask.label,
      ...(ask.kind === "choice" ? { options: ask.choices ?? ["One", "Two"] } : {}),
      wire: { role: "input", nodeId: ask.satisfiedByNodeId ?? ask.nodeIds[0] }
    }));

  if (options.extraFieldForAskId) {
    const ask = decl.asks.find((entry) => entry.id === options.extraFieldForAskId);
    if (ask) {
      fields.push({
        id: `field-${ask.id}-dup`,
        type: "input",
        label: ask.label,
        wire: { role: "input", nodeId: ask.nodeIds[ask.nodeIds.length - 1] }
      });
    }
  }

  const results = decl.shows.map((show) => ({
    id: `result-${show.nodeId}`,
    type: "result",
    variant: options.resultVariant ?? "auto",
    wire: { role: "output", nodeId: show.satisfiedByNodeId ?? show.nodeId }
  }));

  return {
    version: 1,
    pages: [
      {
        id: "home",
        title: "Weather Bot",
        path: "",
        blocks: [
          {
            id: "product",
            type: "section",
            padding: "lg",
            children: [
              {
                id: "product-stack",
                type: "stack",
                gap: "md",
                children: [
                  ...fields,
                  { id: "run", type: "button", label: "Run it", variant: "primary", wire: { role: "action", nodeId: "brain-1" } },
                  ...results
                ]
              }
            ]
          }
        ]
      }
    ],
    nav: { links: [{ label: "Home", pageId: "home" }], footerLinks: [] }
  };
}

function engineSuccess(payload: unknown) {
  return {
    status: "success",
    text: JSON.stringify(payload),
    structuredOutput: payload,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    providerId: "claude",
    modelName: "claude-opus-5",
    error: null
  };
}

const app = new Hono();
registerPageHandRoutes(app);

function compose() {
  return app.request("/manage/wf-1/smart-compose", { method: "POST" });
}

function designer(instruction: string) {
  return app.request("/manage/wf-1/ai-builder-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction })
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.workflowFindFirst.mockResolvedValue({
    id: "wf-1",
    name: "Weather Bot",
    architectUserId: "architect-1",
    workflowJson
  });
  mocks.pageFindFirst.mockResolvedValue({
    id: "page-1",
    listingId: "listing-1",
    workflowId: "wf-1",
    template: "form",
    headline: null,
    welcomeMessage: null,
    suggestedPrompts: [],
    accentColor: null,
    designJson: null,
    productJson: null
  });
  mocks.listingFindUnique.mockResolvedValue({
    name: "Weather Bot",
    tagline: "Forecasts by text",
    shortDescription: "Sends the weather.",
    iconUrl: null
  });
  mocks.pageUpdate.mockResolvedValue({});
  mocks.resolveProvider.mockReturnValue({ providerId: "claude" });
  mocks.getSmartDesignerBrainConfig.mockResolvedValue({
    providerId: "claude",
    modelId: "claude-opus-5"
  });
});

describe("the fixture", () => {
  it("really merges: two nodes share the city ask", () => {
    expect(cityAsk).toBeDefined();
    expect(cityAsk?.nodeIds).toEqual(expect.arrayContaining(["brain-1", "sms-1"]));
    expect(expectedMerged).toBeGreaterThanOrEqual(1);
    expect(declarations.shows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /manage/:workflowId/smart-compose", () => {
  it("composes, saves, and reports the merge — one field per merged ask", async () => {
    mocks.execute.mockResolvedValue(
      engineSuccess({ reply: "Composed it.", product: composedSpec(declarations) })
    );

    const response = await compose();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.composed).toBe(true);
    expect(body.data.asksPlaced).toBe(declarations.asks.length);
    expect(body.data.merged).toBe(expectedMerged);

    // The merged city ask produced exactly ONE field on the page.
    const savedJson = JSON.stringify(body.data.product);
    expect(savedJson.match(/"field-city"/g)).toHaveLength(1);
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);

    // Runs on the the AI Builder battery — provider and model from the slot.
    expect(mocks.execute.mock.calls[0][0]).toBe("claude");
    const request = mocks.execute.mock.calls[0][1];
    expect(request.model).toBe("claude-opus-5");
    expect(request.outputFormat).toBe("json");
    // The prompt carries the declarations and the component menu.
    expect(request.systemPrompt).toContain("THE DECLARATIONS");
    expect(request.systemPrompt).toContain("THE PRODUCT SPEC");
    expect(request.systemPrompt).toContain('"city"');
  });

  it("drops a duplicate field for an already-placed ask without a retry", async () => {
    mocks.execute.mockResolvedValue(
      engineSuccess({
        reply: "Composed it.",
        product: composedSpec(declarations, { extraFieldForAskId: "city" })
      })
    );

    const body = await (await compose()).json();
    expect(body.data.composed).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    const savedJson = JSON.stringify(body.data.product);
    expect(savedJson).toContain("field-city");
    expect(savedJson).not.toContain("field-city-dup");
  });

  it("flips a non-auto result variant to auto mechanically", async () => {
    mocks.execute.mockResolvedValue(
      engineSuccess({
        reply: "Composed it.",
        product: composedSpec(declarations, { resultVariant: "cards" })
      })
    );

    const body = await (await compose()).json();
    expect(body.data.composed).toBe(true);
    expect(JSON.stringify(body.data.product)).not.toContain('"cards"');
    expect(JSON.stringify(body.data.product)).toContain('"auto"');
  });

  it("feeds an unplaced ask back and succeeds on the single retry", async () => {
    mocks.execute
      .mockResolvedValueOnce(
        engineSuccess({ reply: "Missed one.", product: composedSpec(declarations, { omitAskId: "city" }) })
      )
      .mockResolvedValueOnce(
        engineSuccess({ reply: "Fixed it.", product: composedSpec(declarations) })
      );

    const body = await (await compose()).json();
    expect(body.data.composed).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);

    // The retry carries the exact violation.
    const retryMessages = mocks.execute.mock.calls[1][1].messages;
    const feedback = retryMessages[retryMessages.length - 1].content;
    expect(feedback).toContain('Ask "city"');
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
  });

  it("never saves a spec that fails validation twice", async () => {
    mocks.execute.mockResolvedValue(
      engineSuccess({ reply: "Missed one.", product: composedSpec(declarations, { omitAskId: "city" }) })
    );

    const body = await (await compose()).json();
    expect(body.data.composed).toBe(false);
    expect(body.data.reply).toBe(SMART_COMPOSER_FALLBACK_REPLY);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("404s for a workflow the architect does not own", async () => {
    mocks.workflowFindFirst.mockResolvedValue(null);
    expect((await compose()).status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("503s kindly when no LLM is configured", async () => {
    mocks.resolveProvider.mockReturnValue(null);
    expect((await compose()).status).toBe(503);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

/* The page route's own tests retired with the route on 2026-08-27 — one
   employee owns that hand now, and it is tested at its real door in
   builder-page-hand.test.ts. */

describe("the guardrails on their own", () => {
  it("isPackagingRequest knows the boundary", () => {
    expect(isPackagingRequest("write a privacy policy")).toBe(true);
    expect(isPackagingRequest("I need a landing page")).toBe(true);
    expect(isPackagingRequest("add a sell page with pricing")).toBe(true);
    expect(isPackagingRequest("this box isn't capturing email separately")).toBe(false);
    expect(isPackagingRequest("make the run button bigger")).toBe(false);
  });

  it("checkComposition refuses a wire at a node the graph does not have", () => {
    const clean = sanitizeProductSpec(composedSpec(declarations));
    expect(clean).not.toBeNull();
    if (!clean) return;

    const check = checkComposition(clean, declarations, new Set(["not-brain-1"]));
    expect(check.product).toBeNull();
    expect(check.violations.join(" ")).toContain("does not exist");
  });
});
