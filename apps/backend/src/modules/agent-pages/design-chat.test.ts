import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Design Brain chat endpoint: POST /manage/:workflowId/design-chat.
 * The LLM (provider engine) and prisma are mocked — these are pure
 * route-contract tests of the zod gate, retry loop, persistence, and auth.
 */

const mocks = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  workflowUpdate: vi.fn(),
  listingFindFirst: vi.fn(),
  listingCreate: vi.fn(),
  pageFindUnique: vi.fn(),
  pageFindFirst: vi.fn(),
  pageCreate: vi.fn(),
  pageUpdate: vi.fn(),
  execute: vi.fn(),
  resolveProvider: vi.fn(),
  getDesignBrainRules: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workflowDefinition: { findFirst: mocks.workflowFindFirst, update: mocks.workflowUpdate },
    agentListing: { findFirst: mocks.listingFindFirst, create: mocks.listingCreate },
    publishedAgentPage: {
      findUnique: mocks.pageFindUnique,
      findFirst: mocks.pageFindFirst,
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
      roles: ["ARCHITECT"]
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

// The admin-editable constitution accessor: mocked so these tests control the
// rules text directly (its cache + fallback have their own suite in
// ../admin/design-brain-rules.test.ts).
vi.mock("../admin/design-brain-rules", () => ({
  getDesignBrainRules: mocks.getDesignBrainRules
}));

import {
  DESIGN_CHAT_FALLBACK_REPLY,
  designPatchSchema,
  extractDesignChatJson,
  weaveReplyWithNotes
} from "./design-chat";
import { registerAgentPageManageRoutes } from "./manage-routes";

const workflowRow = {
  id: "workflow-1",
  architectUserId: "architect-1",
  name: "Front Desk Agent",
  workflowJson: { nodes: [{ data: { type: "ai.reply" } }] }
};

/** A real block canvas (builder shape) for graphOps tests: composer -> brain -> output. */
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
          placeholder: "Describe your trip…"
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
          kind: "auto"
        }
      }
    ],
    edges: [
      {
        id: "edge-blk-composer-ai-brain",
        source: "blk-composer",
        target: "ai-brain",
        animated: true,
        style: { stroke: "#f59e0b", strokeWidth: 2.6 }
      },
      {
        id: "edge-ai-brain-blk-output",
        source: "ai-brain",
        target: "blk-output",
        animated: true,
        style: { stroke: "#f59e0b", strokeWidth: 2.6 }
      }
    ]
  };
}

type CanvasGraph = {
  nodes: { id: string; data: Record<string, unknown> }[];
  edges: { id: string; source: string; target: string }[];
};

const listingRow = {
  id: "listing-abc123",
  name: "Front Desk Agent",
  architectUserId: "architect-1",
  workflowId: "workflow-1"
};

const pageRow = {
  id: "page-1",
  slug: "front-desk-agent-abc123",
  listingId: "listing-abc123",
  workflowId: "workflow-1",
  architectUserId: "architect-1",
  template: "chat",
  headline: null,
  welcomeMessage: null,
  suggestedPrompts: [] as string[],
  accentColor: null,
  designJson: null as unknown,
  status: "LIVE",
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
  updatedAt: new Date("2026-08-15T00:00:00.000Z")
};

const DEFAULT_DESIGN = {
  theme: "light",
  composerPosition: "center",
  density: "cozy",
  bubbleStyle: "bubbles",
  showHistorySidebar: false,
  layout: {}
};

/** What the system prompt shows as CURRENT DESIGN: the dials only — the
 * Arrange editor's layout is never a dial the model may set. */
const { layout: _defaultLayout, ...DEFAULT_DIALS } = DEFAULT_DESIGN;

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

function designChat(app: Hono, body: unknown, workflowId = "workflow-1") {
  return app.request(`/manage/${workflowId}/design-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workflowFindFirst.mockResolvedValue(workflowRow);
  mocks.pageFindFirst.mockResolvedValue({ ...pageRow });
  mocks.resolveProvider.mockReturnValue({ providerId: "gemini" });
  mocks.getDesignBrainRules.mockResolvedValue("");
  // The updated rows mirror whatever the route persists.
  mocks.pageUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...pageRow,
    ...data
  }));
  mocks.workflowUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...workflowRow,
    ...data
  }));
});

describe("POST /manage/:workflowId/design-chat", () => {
  it("applies a valid patch: designJson merge + columns persisted in one update", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '```json\n{"reply":"Done! Dark theme with a green accent.","patch":{"theme":"dark","accentColor":"#16a34a"}}\n```'
      )
    );

    const res = await designChat(buildApp(), { instruction: "dark theme with a green accent" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.reply).toBe("Done! Dark theme with a green accent.");
    expect(body.data.patch).toEqual({ theme: "dark", accentColor: "#16a34a" });
    expect(body.data.design).toEqual({ ...DEFAULT_DESIGN, theme: "dark" });
    expect(body.data.page.accentColor).toBe("#16a34a");
    expect(body.data.page.slug).toBe(pageRow.slug);
    // No graphOps in the patch: the canvas is untouched and the builder knows it.
    expect(body.data.graphChanged).toBe(false);
    expect(mocks.workflowUpdate).not.toHaveBeenCalled();

    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        designJson: { ...DEFAULT_DESIGN, theme: "dark" },
        accentColor: "#16a34a"
      }
    });
  });

  it("calls the provider engine the ai.llm_call way: gemini default, low temperature, bounded tokens", async () => {
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    await designChat(buildApp(), { instruction: "hello" });

    expect(mocks.resolveProvider).toHaveBeenCalledWith("gemini");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [providerId, request] = mocks.execute.mock.calls[0];
    expect(providerId).toBe("gemini");
    expect(request.temperature).toBe(0.2);
    expect(request.maxTokens).toBe(1200);
    expect(request.outputFormat).toBe("json");
    expect(request.messages).toEqual([{ role: "user", content: "hello" }]);
    // System prompt carries the dial schema + the current design (dials only —
    // the Arrange layout is not a dial and never enters the prompt).
    expect(request.systemPrompt).toContain('"light" | "dark" | "warm"');
    expect(request.systemPrompt).toContain(JSON.stringify(DEFAULT_DIALS));
    expect(request.systemPrompt).not.toContain('"layout"');
    expect(request.systemPrompt).toContain("same language");
  });

  it("prepends the admin house rules to the system prompt when rules exist", async () => {
    const rules = "1. Mobile first, always.\n2. Refuse anything hard to read.";
    mocks.getDesignBrainRules.mockResolvedValue(rules);
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    await designChat(buildApp(), { instruction: "hello" });

    expect(mocks.getDesignBrainRules).toHaveBeenCalledTimes(1);
    const [, request] = mocks.execute.mock.calls[0];
    // The constitution leads the prompt so it outranks everything after it.
    expect(request.systemPrompt.startsWith(`HOUSE RULES you must always obey:\n${rules}`)).toBe(true);
    // And the dial contract still follows in full.
    expect(request.systemPrompt).toContain('"light" | "dark" | "warm"');
    expect(request.systemPrompt).toContain("OUTPUT RULES:");
    // The block catalog rides after the rules and dial contract.
    expect(request.systemPrompt).toContain("PAGE SECTIONS");
    expect(request.systemPrompt).toContain("block.prompt_composer");
    expect(request.systemPrompt.indexOf("HOUSE RULES")).toBeLessThan(
      request.systemPrompt.indexOf("PAGE SECTIONS")
    );
    expect(request.systemPrompt.indexOf('"light" | "dark" | "warm"')).toBeLessThan(
      request.systemPrompt.indexOf("PAGE SECTIONS")
    );
  });

  it("omits the house-rules block entirely when the accessor returns empty", async () => {
    mocks.getDesignBrainRules.mockResolvedValue("");
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    await designChat(buildApp(), { instruction: "hello" });

    const [, request] = mocks.execute.mock.calls[0];
    expect(request.systemPrompt).not.toContain("HOUSE RULES");
    expect(request.systemPrompt.startsWith("You are the Design Brain")).toBe(true);
  });

  it("merges dials into an existing designJson without discarding other stored dials", async () => {
    mocks.pageFindFirst.mockResolvedValue({
      ...pageRow,
      designJson: { theme: "warm", density: "compact" }
    });
    mocks.execute.mockResolvedValue(
      llmSuccess('{"reply":"Sidebar is on.","patch":{"showHistorySidebar":true}}')
    );

    const res = await designChat(buildApp(), { instruction: "show the sidebar" });
    const body = await res.json();

    expect(body.data.design).toEqual({
      ...DEFAULT_DESIGN,
      theme: "warm",
      density: "compact",
      showHistorySidebar: true
    });
    expect(mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        designJson: { ...DEFAULT_DESIGN, theme: "warm", density: "compact", showHistorySidebar: true }
      }
    });
  });

  it("preserves a stored Arrange layout when the chat changes a dial", async () => {
    const layout = { "blk-composer": { x: 16, y: 24, w: 480 } };
    mocks.pageFindFirst.mockResolvedValue({
      ...pageRow,
      designJson: { theme: "warm", layout }
    });
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"Dark it is.","patch":{"theme":"dark"}}'));

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    const body = await res.json();

    expect(mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { designJson: { ...DEFAULT_DESIGN, theme: "dark", layout } }
    });
    expect(body.data.design.layout).toEqual(layout);
  });

  it("never lets the model move blocks: a layout key in the patch is tolerated, not applied", async () => {
    const layout = { "blk-composer": { x: 16, y: 24 } };
    mocks.pageFindFirst.mockResolvedValue({
      ...pageRow,
      designJson: { layout }
    });
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '{"reply":"Moved everything around!","patch":{"theme":"dark","layout":{"blk-composer":{"x":3999,"y":3999}}}}'
      )
    );

    const res = await designChat(buildApp(), { instruction: "move the prompt box" });
    const body = await res.json();

    // Tolerated: no retry burned on the stray key…
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    // …but the stored arrangement is untouched — only the dial lands.
    expect(mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { designJson: { ...DEFAULT_DESIGN, theme: "dark", layout } }
    });
    expect(body.data.design.layout).toEqual(layout);
  });

  it("passes the architect's history as conversationHistory", async () => {
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    await designChat(buildApp(), {
      instruction: "make it darker",
      history: [
        { role: "user", content: "warm theme please" },
        { role: "assistant", content: "Done — warm it is." }
      ]
    });

    const [, request] = mocks.execute.mock.calls[0];
    expect(request.conversationHistory).toEqual([
      { role: "user", content: "warm theme please" },
      { role: "assistant", content: "Done — warm it is." }
    ]);
  });

  it("retries once with the validation error, then applies the corrected patch", async () => {
    mocks.execute
      .mockResolvedValueOnce(llmSuccess("Sure! I set the theme to dark for you."))
      .mockResolvedValueOnce(llmSuccess('{"reply":"Dark theme is on.","patch":{"theme":"dark"}}'));

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    const body = await res.json();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const [, secondRequest] = mocks.execute.mock.calls[1];
    // Retry feeds back: original ask, the bad output, and the error nudge.
    expect(secondRequest.messages).toHaveLength(3);
    expect(secondRequest.messages[1]).toEqual({
      role: "assistant",
      content: "Sure! I set the theme to dark for you."
    });
    expect(secondRequest.messages[2].content).toContain("invalid");

    expect(body.data.reply).toBe("Dark theme is on.");
    expect(body.data.design.theme).toBe("dark");
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
  });

  it("falls back gracefully when both attempts return invalid output — empty patch, nothing persisted", async () => {
    mocks.execute.mockResolvedValue(llmSuccess("I am not JSON at all"));

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(body.data.reply).toBe(DESIGN_CHAT_FALLBACK_REPLY);
    expect(body.data.patch).toEqual({});
    expect(body.data.design).toEqual(DEFAULT_DESIGN);
    expect(body.data.graphChanged).toBe(false);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-hex accentColor at the gate and retries", async () => {
    mocks.execute
      .mockResolvedValueOnce(llmSuccess('{"reply":"Green accent!","patch":{"accentColor":"green"}}'))
      .mockResolvedValueOnce(llmSuccess('{"reply":"Green accent!","patch":{"accentColor":"#16a34a"}}'));

    const res = await designChat(buildApp(), { instruction: "green accent" });
    const body = await res.json();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const [, secondRequest] = mocks.execute.mock.calls[1];
    expect(secondRequest.messages[2].content).toContain("hex color");
    expect(body.data.patch).toEqual({ accentColor: "#16a34a" });
    expect(mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { accentColor: "#16a34a" }
    });
  });

  it("strips unknown patch keys — only contract dials reach storage", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '{"reply":"Warm and fancy!","patch":{"theme":"warm","fontFamily":"Comic Sans","customCss":".x{}"}}'
      )
    );

    const res = await designChat(buildApp(), { instruction: "warm theme with comic sans" });
    const body = await res.json();

    expect(body.data.patch).toEqual({ theme: "warm" });
    const updateData = mocks.pageUpdate.mock.calls[0][0].data;
    expect(updateData.designJson).toEqual({ ...DEFAULT_DESIGN, theme: "warm" });
    expect(JSON.stringify(updateData)).not.toContain("Comic Sans");
  });

  it("skips the DB write entirely when the model answers with an empty patch", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess('{"reply":"I can\'t add videos, but I can change theme, colors, layout, or wording.","patch":{}}')
    );

    const res = await designChat(buildApp(), { instruction: "add a background video" });
    const body = await res.json();

    expect(body.data.patch).toEqual({});
    expect(body.data.design).toEqual(DEFAULT_DESIGN);
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("falls back without retrying when the provider itself errors", async () => {
    mocks.execute.mockResolvedValue(llmError("upstream 500"));

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(body.data.reply).toBe(DESIGN_CHAT_FALLBACK_REPLY);
    expect(body.data.patch).toEqual({});
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });

  it("404s (WORKFLOW_NOT_FOUND) when the workflow is not owned by the caller", async () => {
    mocks.workflowFindFirst.mockResolvedValue(null);

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("WORKFLOW_NOT_FOUND");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("bootstraps a DRAFT listing + page for a listing-less draft, then applies the patch", async () => {
    mocks.pageFindFirst.mockResolvedValue(null); // no page for this draft yet
    mocks.listingFindFirst.mockResolvedValue(null); // and no listing either
    mocks.listingCreate.mockResolvedValue({ ...listingRow });
    mocks.pageFindUnique.mockResolvedValue(null);
    mocks.pageCreate.mockResolvedValue({ ...pageRow });
    mocks.execute.mockResolvedValue(
      llmSuccess('{"reply":"Dark theme is on.","patch":{"theme":"dark"}}')
    );

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Minimal DRAFT listing: free, unpublished, owned by the architect.
    expect(mocks.listingCreate).toHaveBeenCalledWith({
      data: {
        name: "Front Desk Agent",
        shortDescription: "Draft — not yet published.",
        priceCents: 0,
        pricingModel: "FREE",
        status: "DRAFT",
        architectUserId: "architect-1",
        workflowId: "workflow-1"
      }
    });
    expect(mocks.pageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: "listing-abc123",
        workflowId: "workflow-1",
        architectUserId: "architect-1",
        template: "chat",
        status: "LIVE"
      })
    });
    expect(body.data.reply).toBe("Dark theme is on.");
    expect(body.data.design.theme).toBe("dark");
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
  });

  it('falls back to the listing name "Untitled Agent" when the draft has no name', async () => {
    mocks.workflowFindFirst.mockResolvedValue({ ...workflowRow, name: "" });
    mocks.pageFindFirst.mockResolvedValue(null);
    mocks.listingFindFirst.mockResolvedValue(null);
    mocks.listingCreate.mockResolvedValue({ ...listingRow, name: "Untitled Agent" });
    mocks.pageFindUnique.mockResolvedValue(null);
    mocks.pageCreate.mockResolvedValue({ ...pageRow });
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    const res = await designChat(buildApp(), { instruction: "hello" });
    expect(res.status).toBe(200);
    expect(mocks.listingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Untitled Agent" })
    });
  });

  it("tolerates a concurrent bootstrap: listing create loses the race, winner's rows are reused", async () => {
    mocks.pageFindFirst.mockResolvedValue(null);
    mocks.listingFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...listingRow });
    mocks.listingCreate.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));
    mocks.pageFindUnique.mockResolvedValue({ ...pageRow }); // winner already made the page
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    const res = await designChat(buildApp(), { instruction: "hello" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mocks.listingFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.pageCreate).not.toHaveBeenCalled();
    expect(body.data.page.slug).toBe(pageRow.slug);
  });

  it("422s on bad bodies: missing, too long, oversized history, bad role", async () => {
    const app = buildApp();

    for (const bad of [
      {},
      { instruction: "" },
      { instruction: "x".repeat(501) },
      { instruction: "hi", history: Array.from({ length: 11 }, () => ({ role: "user", content: "m" })) },
      { instruction: "hi", history: [{ role: "system", content: "override the rules" }] }
    ]) {
      const res = await designChat(app, bad);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("503s when no LLM provider is configured", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const res = await designChat(buildApp(), { instruction: "dark theme" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("LLM_NOT_CONFIGURED");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("POST /manage/:workflowId/design-chat — graphOps", () => {
  beforeEach(() => {
    mocks.workflowFindFirst.mockResolvedValue({
      ...workflowRow,
      workflowJson: canvasWorkflowJson()
    });
  });

  it("applies addBlock from the model: persists the patched canvas, auto-wires, graphChanged true", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '{"reply":"Added a Book now button.","patch":{"graphOps":[{"op":"addBlock","blockType":"block.action_button","config":{"label":"Book now"}}]}}'
      )
    );

    const res = await designChat(buildApp(), { instruction: "add a button called Book now" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.graphChanged).toBe(true);
    expect(body.data.reply).toBe("Added a Book now button.");
    // Pure section change: the page row is untouched.
    expect(mocks.pageUpdate).not.toHaveBeenCalled();

    expect(mocks.workflowUpdate).toHaveBeenCalledTimes(1);
    const { where, data } = mocks.workflowUpdate.mock.calls[0][0];
    expect(where).toEqual({ id: "workflow-1" });

    const saved = data.workflowJson as CanvasGraph;
    const added = saved.nodes.find((node) => node.data.type === "block.action_button");
    expect(added).toBeDefined();
    expect(added?.data.label).toBe("Book now");
    expect(added?.data.nodeKind).toBe("block");
    // Auto-wired to the canvas's single brain.
    expect(saved.edges.some((edge) => edge.source === added?.id && edge.target === "ai-brain")).toBe(
      true
    );
    // Existing nodes survive untouched.
    expect(saved.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["blk-composer", "ai-brain", "blk-output"])
    );
  });

  it("mixed dials + ops: one page update AND one canvas update, both reflected in the response", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '{"reply":"Dark theme is on and the result viewer is gone.","patch":{"theme":"dark","graphOps":[{"op":"removeBlock","nodeId":"blk-output"}]}}'
      )
    );

    const res = await designChat(buildApp(), { instruction: "dark theme, remove the result viewer" });
    const body = await res.json();

    // The dial persisted to the page row, exactly as before.
    expect(mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { designJson: { ...DEFAULT_DESIGN, theme: "dark" } }
    });
    expect(body.data.design.theme).toBe("dark");

    // The op persisted to the workflow row.
    expect(mocks.workflowUpdate).toHaveBeenCalledTimes(1);
    const saved = mocks.workflowUpdate.mock.calls[0][0].data.workflowJson as CanvasGraph;
    expect(saved.nodes.some((node) => node.id === "blk-output")).toBe(false);
    expect(
      saved.edges.some((edge) => edge.source === "blk-output" || edge.target === "blk-output")
    ).toBe(false);
    // The brain itself survives.
    expect(saved.nodes.some((node) => node.id === "ai-brain")).toBe(true);
    expect(body.data.graphChanged).toBe(true);
  });

  it("refuses ops on non-block nodeIds: nothing persisted, graphChanged false, note woven into the reply", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess('{"reply":"Removed it.","patch":{"graphOps":[{"op":"removeBlock","nodeId":"ai-brain"}]}}')
    );

    const res = await designChat(buildApp(), { instruction: "remove the brain" });
    const body = await res.json();

    expect(mocks.workflowUpdate).not.toHaveBeenCalled();
    expect(body.data.graphChanged).toBe(false);
    expect(body.data.reply).toBe(
      "Removed it. I couldn't find that section to remove, so nothing changed."
    );
  });

  it("strips unknown ops with a note while still applying the valid ones", async () => {
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '{"reply":"Done.","patch":{"graphOps":[{"op":"teleportBlock","nodeId":"blk-composer"},{"op":"addBlock","blockType":"block.history_shelf"}]}}'
      )
    );

    const res = await designChat(buildApp(), { instruction: "history shelf please" });
    const body = await res.json();

    expect(body.data.graphChanged).toBe(true);
    expect(body.data.reply).toContain("Done.");
    expect(body.data.reply).toContain("I skipped one change I couldn't understand.");

    const saved = mocks.workflowUpdate.mock.calls[0][0].data.workflowJson as CanvasGraph;
    expect(saved.nodes.some((node) => node.data.type === "block.history_shelf")).toBe(true);
  });

  it("asks which brain (woven into the reply) when the canvas has two brains", async () => {
    const canvas = canvasWorkflowJson();
    canvas.nodes.push({
      id: "ai-brain-2",
      type: "coreNode",
      position: { x: 780, y: 400 },
      data: { type: "ai.llm_call", nodeKind: "ai", label: "AI Brain", title: "AI Brain" }
    });
    mocks.workflowFindFirst.mockResolvedValue({ ...workflowRow, workflowJson: canvas });
    mocks.execute.mockResolvedValue(
      llmSuccess(
        '{"reply":"Added the button.","patch":{"graphOps":[{"op":"addBlock","blockType":"block.action_button","config":{"label":"Go"}}]}}'
      )
    );

    const res = await designChat(buildApp(), { instruction: "add a go button" });
    const body = await res.json();

    // The block IS added (graphChanged true) but left unwired, with the ask.
    expect(body.data.graphChanged).toBe(true);
    expect(body.data.reply).toBe("Added the button. Tell me which brain to connect it to.");
    const saved = mocks.workflowUpdate.mock.calls[0][0].data.workflowJson as CanvasGraph;
    const added = saved.nodes.find((node) => node.data.type === "block.action_button");
    expect(saved.edges.some((edge) => edge.source === added?.id)).toBe(false);
  });

  it("system prompt carries the ops schema, few-shot examples, and the canvas's REAL nodeIds", async () => {
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    await designChat(buildApp(), { instruction: "hello" });

    const [, request] = mocks.execute.mock.calls[0];
    const prompt = request.systemPrompt as string;

    // Catalog: every block with editable properties.
    expect(prompt).toContain("PAGE SECTIONS");
    expect(prompt).toContain("block.action_button");
    expect(prompt).toContain("presets (list of up to 8 items");

    // Current sections: the real nodeIds + config from the workflow row.
    expect(prompt).toContain('blk-composer — block.prompt_composer ("Prompt Box")');
    expect(prompt).toContain('placeholder: "Describe your trip…"');
    expect(prompt).toContain('blk-output — block.output_stage ("Result Viewer")');
    // The brain is never offered as a section.
    expect(prompt).not.toContain("- ai-brain");

    // Ops schema + the three few-shot examples.
    expect(prompt).toContain('"op": "addBlock"');
    expect(prompt).toContain('"op": "removeBlock"');
    expect(prompt).toContain('"op": "reorderBlock"');
    expect(prompt).toContain('"op": "updateBlockConfig"');
    expect(prompt).toContain('add a button called Book now');
    expect(prompt).toContain('remove the history shelf');
    expect(prompt).toContain('limit the prompt box to 500 characters');
    // The limit example must stay honest: the composer's only editable key is
    // "placeholder" — teaching a non-registry key (e.g. maxChars) would make
    // the model emit ops the whitelist strips while its reply claims success.
    expect(prompt).not.toContain("maxChars");

    // Dial contract and output rules still intact, in order.
    expect(prompt).toContain('"light" | "dark" | "warm"');
    expect(prompt.indexOf('"light" | "dark" | "warm"')).toBeLessThan(prompt.indexOf("PAGE SECTIONS"));
    expect(prompt.indexOf("PAGE SECTIONS")).toBeLessThan(prompt.indexOf("OUTPUT RULES:"));
  });

  it('shows "(none yet)" instead of sections for a canvas without blocks', async () => {
    mocks.workflowFindFirst.mockResolvedValue({ ...workflowRow });
    mocks.execute.mockResolvedValue(llmSuccess('{"reply":"ok","patch":{}}'));

    await designChat(buildApp(), { instruction: "hello" });

    const [, request] = mocks.execute.mock.calls[0];
    expect(request.systemPrompt).toContain("(none yet — the page has no sections)");
  });
});

describe("designPatchSchema (the zod gate)", () => {
  it("accepts every contract dial value and strips unknown keys", () => {
    const parsed = designPatchSchema.parse({
      reply: "All set.",
      patch: {
        theme: "warm",
        composerPosition: "bottom",
        density: "compact",
        bubbleStyle: "flat",
        showHistorySidebar: true,
        accentColor: "#FF00aa",
        headline: "Hello",
        welcomeMessage: "Welcome!",
        suggestedPrompts: ["One", "Two"],
        hacky: "nope",
        css: "body{}"
      },
      extraTopLevel: true
    });

    expect(parsed).toEqual({
      reply: "All set.",
      patch: {
        theme: "warm",
        composerPosition: "bottom",
        density: "compact",
        bubbleStyle: "flat",
        showHistorySidebar: true,
        accentColor: "#FF00aa",
        headline: "Hello",
        welcomeMessage: "Welcome!",
        suggestedPrompts: ["One", "Two"]
      }
    });
  });

  it("rejects invalid dial values, bad hex colors, and overlong fields", () => {
    const cases = [
      { reply: "ok", patch: { theme: "neon" } },
      { reply: "ok", patch: { composerPosition: "top" } },
      { reply: "ok", patch: { accentColor: "#12345" } },
      { reply: "ok", patch: { accentColor: "16a34a" } },
      { reply: "ok", patch: { accentColor: "#16a34g" } },
      { reply: "ok", patch: { headline: "x".repeat(121) } },
      { reply: "ok", patch: { welcomeMessage: "x".repeat(501) } },
      { reply: "ok", patch: { suggestedPrompts: ["a", "b", "c", "d", "e"] } },
      { reply: "ok", patch: { suggestedPrompts: ["x".repeat(81)] } },
      { reply: "x".repeat(201), patch: {} },
      { reply: "", patch: {} },
      { reply: "ok" }
    ];
    for (const value of cases) {
      expect(designPatchSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("allows null to clear headline and welcomeMessage", () => {
    const parsed = designPatchSchema.parse({
      reply: "Cleared.",
      patch: { headline: null, welcomeMessage: null }
    });
    expect(parsed.patch).toEqual({ headline: null, welcomeMessage: null });
  });

  it("passes graphOps through untouched (per-op stripping happens in applyGraphOps) but rejects non-arrays and floods", () => {
    const ops = [
      { op: "addBlock", blockType: "block.action_button", config: { label: "Book now" } },
      { op: "definitelyNotAnOp" }
    ];
    const parsed = designPatchSchema.parse({ reply: "ok", patch: { graphOps: ops } });
    // Both survive the gate — applyGraphOps strips the bad one WITH a note,
    // so a single malformed op can't torpedo the whole patch via a retry.
    expect(parsed.patch.graphOps).toEqual(ops);

    expect(
      designPatchSchema.safeParse({ reply: "ok", patch: { graphOps: "remove the shelf" } }).success
    ).toBe(false);
    expect(
      designPatchSchema.safeParse({
        reply: "ok",
        patch: { graphOps: Array.from({ length: 21 }, () => ({ op: "removeBlock", nodeId: "x" })) }
      }).success
    ).toBe(false);
  });
});

describe("weaveReplyWithNotes", () => {
  it("joins the reply and op notes into one sentence stream, deduping and punctuating", () => {
    expect(
      weaveReplyWithNotes("Added it", [
        "Tell me which brain to connect it to",
        "Tell me which brain to connect it to"
      ])
    ).toBe("Added it. Tell me which brain to connect it to.");
    expect(weaveReplyWithNotes("Done!", [])).toBe("Done!");
    expect(weaveReplyWithNotes("", ["I skipped one change I couldn't understand."])).toBe(
      "I skipped one change I couldn't understand."
    );
  });
});

describe("extractDesignChatJson", () => {
  it("parses bare JSON, fenced JSON, and JSON buried in prose", () => {
    const expected = { reply: "hi", patch: {} };
    expect(extractDesignChatJson('{"reply":"hi","patch":{}}')).toEqual(expected);
    expect(extractDesignChatJson('```json\n{"reply":"hi","patch":{}}\n```')).toEqual(expected);
    expect(extractDesignChatJson('Here you go:\n{"reply":"hi","patch":{}}\nEnjoy!')).toEqual(expected);
    expect(
      extractDesignChatJson('{"reply":"braces {in} \\"strings\\" stay","patch":{}}')
    ).toEqual({ reply: 'braces {in} "strings" stay', patch: {} });
  });

  it("returns null for non-JSON output", () => {
    expect(extractDesignChatJson("I just set the theme to dark for you!")).toBeNull();
    expect(extractDesignChatJson("")).toBeNull();
    expect(extractDesignChatJson(null)).toBeNull();
    expect(extractDesignChatJson('{"broken": ')).toBeNull();
  });
});
