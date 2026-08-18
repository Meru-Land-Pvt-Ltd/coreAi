import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Architect manage API for published agent pages: ownership 404s, lazy page
 * creation on GET, and PATCH validation/updates. Prisma and auth are mocked —
 * these are pure route-contract tests, no DB.
 */

const {
  workflowFindFirstMock,
  listingFindFirstMock,
  listingCreateMock,
  pageFindUniqueMock,
  pageFindFirstMock,
  pageCreateMock,
  pageUpdateMock
} = vi.hoisted(() => ({
  workflowFindFirstMock: vi.fn(),
  listingFindFirstMock: vi.fn(),
  listingCreateMock: vi.fn(),
  pageFindUniqueMock: vi.fn(),
  pageFindFirstMock: vi.fn(),
  pageCreateMock: vi.fn(),
  pageUpdateMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workflowDefinition: { findFirst: workflowFindFirstMock },
    agentListing: { findFirst: listingFindFirstMock, create: listingCreateMock },
    publishedAgentPage: {
      findUnique: pageFindUniqueMock,
      findFirst: pageFindFirstMock,
      create: pageCreateMock,
      update: pageUpdateMock
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

import { env } from "../../config/env";
import { registerAgentPageManageRoutes } from "./manage-routes";

const originalFrontendUrl = env.FRONTEND_URL;

const workflowRow = {
  id: "workflow-1",
  architectUserId: "architect-1",
  name: "Front Desk Agent",
  workflowJson: { nodes: [{ data: { type: "ai.reply" } }] }
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
  suggestedPrompts: [],
  accentColor: null,
  designJson: null as unknown,
  status: "LIVE",
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
  updatedAt: new Date("2026-08-15T00:00:00.000Z")
};

/** The contract's default DesignConfig — what a null designJson resolves to. */
const DEFAULT_DESIGN = {
  theme: "light",
  composerPosition: "center",
  density: "cozy",
  bubbleStyle: "bubbles",
  contentWidth: "standard",
  showHistorySidebar: false,
  layout: {}
};

function buildApp() {
  const app = new Hono();
  registerAgentPageManageRoutes(app);
  return app;
}

function patchPage(app: Hono, workflowId: string, body: unknown) {
  return app.request(`/manage/${workflowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  env.FRONTEND_URL = "https://triven.ai";
  workflowFindFirstMock.mockResolvedValue(workflowRow);
  listingFindFirstMock.mockResolvedValue(listingRow);
  pageFindUniqueMock.mockResolvedValue(pageRow);
  pageFindFirstMock.mockResolvedValue(pageRow);
  pageCreateMock.mockResolvedValue(pageRow);
  pageUpdateMock.mockResolvedValue(pageRow);
});

afterAll(() => {
  env.FRONTEND_URL = originalFrontendUrl;
});

describe("GET /manage/:workflowId", () => {
  it("404s with WORKFLOW_NOT_FOUND when the workflow is not owned by the caller", async () => {
    workflowFindFirstMock.mockResolvedValue(null);
    const response = await buildApp().request("/manage/workflow-1");

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("WORKFLOW_NOT_FOUND");
    expect(workflowFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "workflow-1", architectUserId: "architect-1" }
      })
    );
  });

  it("bootstraps a DRAFT listing + page when the workflow has no listing yet", async () => {
    workflowFindFirstMock.mockResolvedValue({
      ...workflowRow,
      workflowJson: { nodes: [{ data: { type: "ai.voice_conversation" } }] }
    });
    listingFindFirstMock.mockResolvedValue(null);
    listingCreateMock.mockResolvedValue({ ...listingRow });
    pageFindUniqueMock.mockResolvedValue(null);
    pageCreateMock.mockResolvedValue({ ...pageRow, template: "voice" });

    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { page: { slug: string; template: string }; url: string; defaultTemplate: string };
    };

    // Minimal DRAFT listing: free, unpublished, owned by the architect.
    expect(listingCreateMock).toHaveBeenCalledWith({
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
    expect(pageCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: "listing-abc123",
        workflowId: "workflow-1",
        architectUserId: "architect-1",
        template: "voice",
        status: "LIVE"
      })
    });
    expect(json.data.page.slug).toBe("front-desk-agent-abc123");
    expect(json.data.url).toBe("https://triven.ai/a/front-desk-agent-abc123");
    expect(json.data.defaultTemplate).toBe("voice");
  });

  it("tolerates a concurrent listing bootstrap: unique violation re-fetches the winner", async () => {
    listingFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...listingRow });
    listingCreateMock.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));

    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { page: { slug: string } } };

    expect(listingFindFirstMock).toHaveBeenCalledTimes(2);
    expect(pageCreateMock).not.toHaveBeenCalled(); // winner's page already exists
    expect(json.data.page.slug).toBe("front-desk-agent-abc123");
  });

  it("returns the full default design when designJson is null", async () => {
    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { design: unknown } };
    expect(json.data.design).toEqual(DEFAULT_DESIGN);
  });

  it("resolves stored designJson over the defaults", async () => {
    pageFindUniqueMock.mockResolvedValue({
      ...pageRow,
      designJson: { theme: "warm", showHistorySidebar: true }
    });

    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { design: unknown } };
    expect(json.data.design).toEqual({
      ...DEFAULT_DESIGN,
      theme: "warm",
      showHistorySidebar: true
    });
  });

  it("returns blueprint null when the graph has no product blocks", async () => {
    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { blueprint: unknown } };
    expect(json.data.blueprint).toBeNull();
  });

  it("derives the blueprint from block nodes in the workflow graph", async () => {
    workflowFindFirstMock.mockResolvedValue({
      ...workflowRow,
      workflowJson: {
        nodes: [
          {
            id: "prompt-1",
            type: "coreNode",
            position: { x: 0, y: 0 },
            data: { type: "block.prompt_composer", nodeKind: "block", placeholder: "Type here…" }
          },
          {
            id: "out-1",
            type: "coreNode",
            position: { x: 0, y: 200 },
            data: { type: "block.output_stage", nodeKind: "block", kind: "video" }
          }
        ],
        edges: []
      }
    });

    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { blueprint: { blocks: Array<{ type: string; config: Record<string, unknown> }> } };
    };
    expect(json.data.blueprint.blocks).toEqual([
      { nodeId: "prompt-1", type: "block.prompt_composer", config: { placeholder: "Type here…" } },
      { nodeId: "out-1", type: "block.output_stage", config: { kind: "video" } }
    ]);
  });

  it("auto-creates the page on first GET when the listing exists and no page does", async () => {
    pageFindUniqueMock.mockResolvedValue(null); // no page yet -> ensure creates one

    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        page: { slug: string; template: string; status: string; suggestedPrompts: string[] };
        url: string;
        defaultTemplate: string;
      };
    };

    expect(pageCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: "front-desk-agent-abc123",
        listingId: "listing-abc123",
        workflowId: "workflow-1",
        architectUserId: "architect-1",
        template: "chat",
        status: "LIVE"
      })
    });
    expect(json.data.page).toEqual({
      slug: "front-desk-agent-abc123",
      template: "chat",
      headline: null,
      welcomeMessage: null,
      suggestedPrompts: [],
      accentColor: null,
      status: "LIVE"
    });
    expect(json.data.url).toBe("https://triven.ai/a/front-desk-agent-abc123");
    expect(json.data.defaultTemplate).toBe("chat");
  });

  it("returns the existing page without creating another row", async () => {
    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { page: { slug: string }; url: string } };
    expect(json.data.page.slug).toBe("front-desk-agent-abc123");
    expect(json.data.url).toBe("https://triven.ai/a/front-desk-agent-abc123");
    expect(pageCreateMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /manage/:workflowId", () => {
  it("404s with WORKFLOW_NOT_FOUND for a workflow the caller does not own", async () => {
    workflowFindFirstMock.mockResolvedValue(null);
    const response = await patchPage(buildApp(), "workflow-1", { headline: "Hi" });

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("WORKFLOW_NOT_FOUND");
    expect(pageUpdateMock).not.toHaveBeenCalled();
  });

  it("422s with VALIDATION_ERROR on invalid input without updating", async () => {
    const app = buildApp();

    const badCases = [
      { headline: "x".repeat(121) },
      { welcomeMessage: "x".repeat(501) },
      { suggestedPrompts: ["a", "b", "c", "d", "e"] },
      { suggestedPrompts: ["x".repeat(81)] },
      { accentColor: "amber" },
      { template: "kiosk" }
    ];
    for (const body of badCases) {
      const response = await patchPage(app, "workflow-1", body);
      expect(response.status).toBe(422);
      const json = (await response.json()) as { code: string };
      expect(json.code).toBe("VALIDATION_ERROR");
    }
    expect(pageUpdateMock).not.toHaveBeenCalled();
  });

  it("404s with AGENT_PAGE_NOT_FOUND when no page exists yet", async () => {
    pageFindFirstMock.mockResolvedValue(null);
    const response = await patchPage(buildApp(), "workflow-1", { headline: "Hi" });

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("AGENT_PAGE_NOT_FOUND");
    expect(pageUpdateMock).not.toHaveBeenCalled();
  });

  it("updates the provided fields and returns the page + url", async () => {
    const updatedRow = {
      ...pageRow,
      template: "form",
      headline: "Book faster",
      welcomeMessage: "Hi! Ask me anything.",
      suggestedPrompts: ["What can you do?", "Book a cleaning"],
      accentColor: "#F59E0B"
    };
    pageUpdateMock.mockResolvedValue(updatedRow);

    const response = await patchPage(buildApp(), "workflow-1", {
      template: "form",
      headline: "Book faster",
      welcomeMessage: "Hi! Ask me anything.",
      suggestedPrompts: ["What can you do?", "Book a cleaning"],
      accentColor: "#F59E0B"
    });

    expect(response.status).toBe(200);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        template: "form",
        headline: "Book faster",
        welcomeMessage: "Hi! Ask me anything.",
        suggestedPrompts: ["What can you do?", "Book a cleaning"],
        accentColor: "#F59E0B"
      }
    });
    const json = (await response.json()) as {
      data: {
        page: { template: string; headline: string; accentColor: string };
        url: string;
        design: unknown;
      };
    };
    expect(json.data.page.template).toBe("form");
    expect(json.data.page.headline).toBe("Book faster");
    expect(json.data.page.accentColor).toBe("#F59E0B");
    expect(json.data.url).toBe("https://triven.ai/a/front-desk-agent-abc123");
    // The design rides along on PATCH so callers never lose the dials.
    expect(json.data.design).toEqual(DEFAULT_DESIGN);
  });

  it("does not touch designJson when the PATCH carries no design field", async () => {
    await patchPage(buildApp(), "workflow-1", { headline: "Hi" });
    expect(pageUpdateMock).toHaveBeenCalledTimes(1);
    expect(pageUpdateMock.mock.calls[0][0].data).not.toHaveProperty("designJson");
  });

  it("does not touch designJson for design: {} (design present, no layout)", async () => {
    await patchPage(buildApp(), "workflow-1", { headline: "Hi", design: {} });
    expect(pageUpdateMock).toHaveBeenCalledTimes(1);
    expect(pageUpdateMock.mock.calls[0][0].data).not.toHaveProperty("designJson");
  });
});

describe("PATCH /manage/:workflowId — design.layout (Arrange mode)", () => {
  const storedDesignJson = {
    theme: "warm",
    density: "compact",
    layout: { "blk-old": { x: 8, y: 8 } }
  };

  beforeEach(() => {
    pageFindFirstMock.mockResolvedValue({ ...pageRow, designJson: storedDesignJson });
    // The updated row mirrors whatever the route persists.
    pageUpdateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...pageRow,
      designJson: storedDesignJson,
      ...data
    }));
  });

  it("replaces the arrangement wholesale and preserves every other stored design key", async () => {
    const layout = { "blk-composer": { x: 16, y: 24, w: 480 }, "blk-output": { x: 8, y: 400 } };
    const response = await patchPage(buildApp(), "workflow-1", { design: { layout } });

    expect(response.status).toBe(200);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({
        designJson: { theme: "warm", density: "compact", layout }
      })
    });

    // The response's resolved design carries the new arrangement.
    const json = (await response.json()) as { data: { design: { layout: unknown } } };
    expect(json.data.design).toEqual({
      ...DEFAULT_DESIGN,
      theme: "warm",
      density: "compact",
      layout
    });
  });

  it("clears the arrangement with layout: {} (Reset arrangement)", async () => {
    const response = await patchPage(buildApp(), "workflow-1", { design: { layout: {} } });

    expect(response.status).toBe(200);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({
        designJson: { theme: "warm", density: "compact", layout: {} }
      })
    });
  });

  it("drops invalid layout entries individually instead of rejecting the request", async () => {
    const response = await patchPage(buildApp(), "workflow-1", {
      design: {
        layout: {
          keep: { x: 16, y: 0 },
          offGrid: { x: -8, y: 0 },
          fractional: { x: 3.7, y: 0 },
          tooWide: { x: 0, y: 0, w: 9000 },
          decorated: { x: 8, y: 8, zIndex: 40 }
        }
      }
    });

    expect(response.status).toBe(200);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({
        designJson: {
          theme: "warm",
          density: "compact",
          layout: { keep: { x: 16, y: 0 }, decorated: { x: 8, y: 8 } }
        }
      })
    });
  });

  it("bootstraps designJson from scratch when nothing was stored yet", async () => {
    pageFindFirstMock.mockResolvedValue({ ...pageRow, designJson: null });
    const layout = { "blk-1": { x: 0, y: 0 } };

    const response = await patchPage(buildApp(), "workflow-1", { design: { layout } });

    expect(response.status).toBe(200);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({ designJson: { layout } })
    });
  });

  it("saves the width dial without touching any other stored design key", async () => {
    const response = await patchPage(buildApp(), "workflow-1", {
      design: { contentWidth: "wide" }
    });

    expect(response.status).toBe(200);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({
        // The stored arrangement rides along untouched — a width change is
        // not a reason to lose where the architect put their blocks.
        designJson: {
          theme: "warm",
          density: "compact",
          layout: { "blk-old": { x: 8, y: 8 } },
          contentWidth: "wide"
        }
      })
    });

    const json = (await response.json()) as { data: { design: unknown } };
    expect(json.data.design).toEqual({
      ...DEFAULT_DESIGN,
      theme: "warm",
      density: "compact",
      layout: { "blk-old": { x: 8, y: 8 } },
      contentWidth: "wide"
    });
  });

  it("accepts every width the dial allows and rejects anything else", async () => {
    for (const contentWidth of ["compact", "standard", "wide", "full"]) {
      pageUpdateMock.mockClear();
      const ok = await patchPage(buildApp(), "workflow-1", { design: { contentWidth } });
      expect(ok.status).toBe(200);
      expect(pageUpdateMock).toHaveBeenCalledWith({
        where: { id: "page-1" },
        data: expect.objectContaining({
          designJson: expect.objectContaining({ contentWidth })
        })
      });
    }

    pageUpdateMock.mockClear();
    const rejected = await patchPage(buildApp(), "workflow-1", {
      design: { contentWidth: "max-w-7xl" }
    });
    expect(rejected.status).toBe(422);
    expect(pageUpdateMock).not.toHaveBeenCalled();
  });

  it("saves the width dial and an arrangement together in one update", async () => {
    const layout = { "blk-1": { x: 0, y: 0 } };
    await patchPage(buildApp(), "workflow-1", {
      design: { layout, contentWidth: "full" }
    });

    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({
        designJson: { theme: "warm", density: "compact", layout, contentWidth: "full" }
      })
    });
  });

  it("leaves designJson alone when the patch carries no design dial", async () => {
    await patchPage(buildApp(), "workflow-1", { headline: "Book faster" });

    const call = pageUpdateMock.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty("designJson");
  });

  it("saves layout and content fields together in one update", async () => {
    const layout = { "blk-1": { x: 24, y: 48 } };
    await patchPage(buildApp(), "workflow-1", { headline: "Book faster", design: { layout } });

    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: expect.objectContaining({
        headline: "Book faster",
        designJson: { theme: "warm", density: "compact", layout }
      })
    });
  });
});
