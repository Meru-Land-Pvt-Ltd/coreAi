import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /architect/workflows/:workflowId/preview-run — the builder Test tab's
 * one-shot engine. Architect-authed with ownership (404 WORKFLOW_NOT_FOUND for
 * non-owned workflows, same idiom as conversation-test), zod 422s before any
 * engine run, happy path runs the sandboxed runner with mode "test" and
 * returns the SAME { text, mediaUrls, structured } extraction as the public
 * agent-page /run endpoint, and engine failures surface a human 500 PREVIEW_RUN_FAILED
 * with no stack detail. Prisma, auth, and the runner are mocked — pure
 * route-contract tests, same style as agent-pages/manage-routes.test.ts.
 */

const { workflowFindFirstMock, runWorkflowTestMock } = vi.hoisted(() => ({
  workflowFindFirstMock: vi.fn(),
  runWorkflowTestMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    workflowDefinition: { findFirst: workflowFindFirstMock }
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

// Only runWorkflowTest is replaced — the rest of the runner module stays real
// because other modules in the architect route graph import its helpers.
vi.mock("./workflow-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workflow-runner")>()),
  runWorkflowTest: runWorkflowTestMock
}));

import { architectRoutes } from "./routes";

const WORKFLOW_ID = "workflow-1";

const workflowRow = {
  id: WORKFLOW_ID,
  name: "Trip Planner",
  architectUserId: "architect-1",
  workflowJson: { nodes: [{ data: { type: "ai.reply" } }], edges: [] }
};

function buildApp() {
  const app = new Hono();
  app.route("/architect", architectRoutes);
  return app;
}

function postPreviewRun(body: unknown, workflowId = WORKFLOW_ID) {
  return buildApp().request(`/architect/workflows/${workflowId}/preview-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  workflowFindFirstMock.mockResolvedValue(workflowRow);
  runWorkflowTestMock.mockResolvedValue({ workflowId: WORKFLOW_ID, logs: [], context: {} });
});

describe("POST /architect/workflows/:workflowId/preview-run", () => {
  it("404s with WORKFLOW_NOT_FOUND when the workflow is not owned by the caller", async () => {
    workflowFindFirstMock.mockResolvedValue(null);

    const response = await postPreviewRun({ prompt: "Draw a sunny logo" });

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("WORKFLOW_NOT_FOUND");
    expect(workflowFindFirstMock).toHaveBeenCalledWith({
      where: { id: WORKFLOW_ID, architectUserId: "architect-1" }
    });
    expect(runWorkflowTestMock).not.toHaveBeenCalled();
  });

  it("runs the sandboxed one-shot engine and returns extracted text", async () => {
    runWorkflowTestMock.mockResolvedValue({
      workflowId: WORKFLOW_ID,
      logs: [],
      context: { ai: { output: "Here is your draft reply." } }
    });

    const response = await postPreviewRun({ prompt: "Write a welcome message" });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { output: { text: string | null; mediaUrls: string[]; structured: unknown } };
    };
    // A plain reply carries no visual payload — structured is null, same as /run.
    expect(json.data.output).toEqual({
      text: "Here is your draft reply.",
      mediaUrls: [],
      structured: null
    });

    expect(runWorkflowTestMock).toHaveBeenCalledTimes(1);
    expect(runWorkflowTestMock).toHaveBeenCalledWith({
      userId: "architect-1",
      workflowId: WORKFLOW_ID,
      workflowJson: workflowRow.workflowJson,
      // Dry-runs have no installed business — the workflow's own name stands
      // in so {{business.name}} resolves to the agent's name, never a token.
      input: { message: "Write a welcome message", businessName: "Trip Planner" },
      mode: "test"
    });
  });

  it("extracts media urls from context.image_url, imagePipeline, and log outputs — same as the public /run", async () => {
    runWorkflowTestMock.mockResolvedValue({
      workflowId: WORKFLOW_ID,
      context: {
        ai: { output: "Generated your image!" },
        image_url: "data:image/png;base64,AAA",
        imagePipeline: { "node-2": { imageUrl: "https://cdn.example.com/pic.png" } }
      },
      logs: [
        { nodeId: "node-3", output: { videoUrl: "https://cdn.example.com/clip.mp4" } },
        // Generic "url" keys must never surface as media.
        { nodeId: "node-4", output: { url: "https://calendly.com/booking" } }
      ]
    });

    const response = await postPreviewRun({ prompt: "Make me a picture" });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { output: { text: string | null; mediaUrls: string[]; structured: unknown } };
    };
    expect(json.data.output.text).toBe("Generated your image!");
    expect(json.data.output.mediaUrls).toEqual([
      "data:image/png;base64,AAA",
      "https://cdn.example.com/pic.png",
      "https://cdn.example.com/clip.mp4"
    ]);
  });

  it("422s with VALIDATION_ERROR before touching the DB or engine when the prompt is missing", async () => {
    const response = await postPreviewRun({});

    expect(response.status).toBe(422);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(workflowFindFirstMock).not.toHaveBeenCalled();
    expect(runWorkflowTestMock).not.toHaveBeenCalled();
  });

  it("422s when the prompt exceeds 4000 characters", async () => {
    const response = await postPreviewRun({ prompt: "x".repeat(4001) });

    expect(response.status).toBe(422);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(runWorkflowTestMock).not.toHaveBeenCalled();
  });

  it("500s with PREVIEW_RUN_FAILED and a human message when the engine throws — no stack leak", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runWorkflowTestMock.mockRejectedValue(new Error("ECONNREFUSED at /internal/engine.ts:42"));

    const response = await postPreviewRun({ prompt: "Hello" });

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string; error: string };
    expect(json.code).toBe("PREVIEW_RUN_FAILED");
    expect(json.error).toBe("This agent had trouble responding. Please try again.");
    expect(json.error).not.toContain("ECONNREFUSED");

    consoleError.mockRestore();
  });
});
