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
  pageFindUniqueMock,
  pageFindFirstMock,
  pageCreateMock,
  pageUpdateMock
} = vi.hoisted(() => ({
  workflowFindFirstMock: vi.fn(),
  listingFindFirstMock: vi.fn(),
  pageFindUniqueMock: vi.fn(),
  pageFindFirstMock: vi.fn(),
  pageCreateMock: vi.fn(),
  pageUpdateMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workflowDefinition: { findFirst: workflowFindFirstMock },
    agentListing: { findFirst: listingFindFirstMock },
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
  status: "LIVE",
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
  updatedAt: new Date("2026-08-15T00:00:00.000Z")
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

  it("returns page null with an inferred defaultTemplate when the workflow has no listing", async () => {
    workflowFindFirstMock.mockResolvedValue({
      ...workflowRow,
      workflowJson: { nodes: [{ data: { type: "ai.voice_conversation" } }] }
    });
    listingFindFirstMock.mockResolvedValue(null);

    const response = await buildApp().request("/manage/workflow-1");
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { page: null; url: null; defaultTemplate: string };
    };
    expect(json.data).toEqual({ page: null, url: null, defaultTemplate: "voice" });
    expect(pageCreateMock).not.toHaveBeenCalled();
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
      data: { page: { template: string; headline: string; accentColor: string }; url: string };
    };
    expect(json.data.page.template).toBe("form");
    expect(json.data.page.headline).toBe("Book faster");
    expect(json.data.page.accentColor).toBe("#F59E0B");
    expect(json.data.url).toBe("https://triven.ai/a/front-desk-agent-abc123");
  });
});
