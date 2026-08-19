/**
 * Brain Memory HTTP API.
 *
 * Mounted at /memory in app.ts. These routes are thin — they validate input,
 * call memoryBroker, and shape the response. Business logic lives in the broker.
 *
 * Auth: ARCHITECT or ADMIN only (workflow-runner will call the broker directly later).
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { successResponse, errorResponse } from "../../lib/api-response";
import { AppError } from "../../lib/app-error";
import { requireAuth, requireRole } from "../../middleware/auth";
import { memoryBroker } from "./memory-broker";
import { buildContextBundleSchema, saveNodeMemorySchema } from "./schemas";
import { prisma } from "../../lib/prisma";
import { mapNodeRunToRecord } from "./mappers";
import { runMemorySelfTest } from "./test-memory";

export const memoryRoutes = new Hono();

// Every route below needs a valid JWT. requireAuth sets c.get("authUser").
memoryRoutes.use("*", requireAuth);
memoryRoutes.use("*", requireRole(["ARCHITECT", "ADMIN"]));

/**
 * MAY THIS PERSON SEE THIS RUN?
 *
 * Every route below is behind a valid login, which is why this looked safe —
 * but a login is not ownership. Any architect could pass any run id and read
 * another tenant's full step-by-step output: prompts, customer messages,
 * results. Runs are addressed by cuid, so this is not a brute-force problem;
 * a run id appears in logs, screenshots and support threads.
 *
 * An admin sees everything. An architect sees runs of workflows they wrote, or
 * runs they triggered themselves.
 */
async function runVisibleTo(
  runId: string,
  user: { id: string; role?: string | null }
): Promise<boolean> {
  if (!runId) return false;
  if (user.role === "ADMIN") return true;

  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: {
      triggeredByUserId: true,
      workflow: { select: { architectUserId: true } },
      business: { select: { ownerId: true } }
    }
  });
  if (!run) return false;

  return (
    run.workflow?.architectUserId === user.id ||
    run.triggeredByUserId === user.id ||
    run.business?.ownerId === user.id
  );
}

/** The same question for a single node row, answered through its parent run. */
async function nodeRunVisibleTo(
  nodeRunId: string,
  user: { id: string; role?: string | null }
): Promise<boolean> {
  if (!nodeRunId) return false;
  if (user.role === "ADMIN") return true;

  const node = await prisma.nodeRun.findUnique({
    where: { id: nodeRunId },
    select: { workflowRunId: true }
  });
  if (!node?.workflowRunId) return false;
  return runVisibleTo(node.workflowRunId, user);
}

/**
 * GET /memory/test
 * One-click smoke test — creates a temp workflow run, saves nodes, links them,
 * and returns every broker result. Use this in Postman before testing individual routes.
 */
memoryRoutes.get("/test", async (c) => {
  try {
    const authUser = c.get("authUser");
    const result = await runMemorySelfTest({ architectUserId: authUser.id });
    return successResponse(c, result, "Memory self-test completed");
  } catch (error) {
    return handleMemoryRouteError(c, error, "Memory self-test failed", "MEMORY_TEST_FAILED");
  }
});

/** Maps Zod / AppError / unknown errors into our standard API error shape. */
function handleMemoryRouteError(
  c: Context,
  error: unknown,
  fallbackMessage: string,
  fallbackCode: string
) {
  if (error instanceof z.ZodError) {
    return errorResponse(
      c,
      error.issues[0]?.message ?? "Invalid input",
      422,
      "VALIDATION_ERROR"
    );
  }
  if (error instanceof AppError) {
    return errorResponse(c, error.message, error.statusCode, error.code);
  }
  return errorResponse(c, fallbackMessage, 500, fallbackCode);
}

/**
 * POST /memory/node
 * Called after a workflow node finishes. Persists input, output, summary, cost, etc.
 *
 * Common mistake: workflowRunId must be a WorkflowRun.id, NOT WorkflowDefinition.id.
 */
memoryRoutes.post("/node", async (c) => {
  try {
    const authUser = c.get("authUser");
    const body = saveNodeMemorySchema.parse(await c.req.json());
    // Writing into someone else's run is worse than reading it: it puts your
    // text inside their agent's memory, which their next AI step will read.
    if (!(await runVisibleTo(body.workflowRunId, authUser))) {
      return errorResponse(c, "Workflow run not found", 404, "NOT_FOUND");
    }
    const result = await memoryBroker.saveNodeMemory(body);
    return successResponse(c, result, "Node memory saved", 201);
  } catch (error) {
    return handleMemoryRouteError(c, error, "Could not save node memory", "MEMORY_SAVE_FAILED");
  }
});

/** GET /memory/node/:nodeRunId — load one saved node row by its database id. */
memoryRoutes.get("/node/:nodeRunId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const nodeRunId = c.req.param("nodeRunId");
    if (!(await nodeRunVisibleTo(nodeRunId, authUser))) {
      return errorResponse(c, "Node memory not found", 404, "NOT_FOUND");
    }
    const memory = await memoryBroker.loadNodeMemory(nodeRunId);
    if (!memory) {
      return errorResponse(c, "Node memory not found", 404, "NOT_FOUND");
    }
    return successResponse(c, memory);
  } catch (error) {
    return handleMemoryRouteError(c, error, "Could not load node memory", "MEMORY_LOAD_FAILED");
  }
});

/**
 * GET /memory/workflow/:workflowRunId
 * Full run snapshot — workflow metadata + all node runs + context links.
 */
memoryRoutes.get("/workflow/:workflowRunId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const runId = c.req.param("workflowRunId");
    // Deliberately 404, not 403: telling a stranger the run exists is itself
    // a leak.
    if (!(await runVisibleTo(runId, authUser))) {
      return errorResponse(c, "Workflow run not found", 404, "NOT_FOUND");
    }
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      include: {
        nodeRuns: { orderBy: { executionOrder: "asc" } },
        contextLinks: true,
      },
    });
    if (!run) {
      return errorResponse(c, "Workflow run not found", 404, "NOT_FOUND");
    }
    return successResponse(c, {
      ...run,
      nodeRuns: run.nodeRuns.map(mapNodeRunToRecord),
    });
  } catch (error) {
    return handleMemoryRouteError(
      c,
      error,
      "Could not load workflow memory",
      "WORKFLOW_MEMORY_LOAD_FAILED"
    );
  }
});

/** GET /memory/workflow/:workflowRunId/history — node runs only, ordered by execution. */
memoryRoutes.get("/workflow/:workflowRunId/history", async (c) => {
  try {
    const authUser = c.get("authUser");
    const runId = c.req.param("workflowRunId");
    if (!(await runVisibleTo(runId, authUser))) {
      return errorResponse(c, "Workflow run not found", 404, "NOT_FOUND");
    }
    const rows = await prisma.nodeRun.findMany({
      where: { workflowRunId: runId },
      orderBy: { executionOrder: "asc" },
    });
    return successResponse(c, rows.map(mapNodeRunToRecord));
  } catch (error) {
    return handleMemoryRouteError(c, error, "Could not load node history", "NODE_HISTORY_FAILED");
  }
});

/**
 * POST /memory/context/build
 * Main entry for AI Brain nodes — merges previous output, back-links, and metadata
 * into a ContextBundle with a ready-to-send compressedPrompt.
 */
memoryRoutes.post("/context/build", async (c) => {
  try {
    const authUser = c.get("authUser");
    const body = buildContextBundleSchema.parse(await c.req.json());
    if (!(await runVisibleTo(body.workflowRunId, authUser))) {
      return errorResponse(c, "Workflow run not found", 404, "NOT_FOUND");
    }
    const bundle = await memoryBroker.buildContextBundle(body);
    return successResponse(c, bundle);
  } catch (error) {
    return handleMemoryRouteError(c, error, "Could not build context bundle", "CONTEXT_BUILD_FAILED");
  }
});

/**
 * GET /memory/context/backlink/:workflowRunId/:nodeId
 * Back-linked memories only (read-only — never re-executes earlier nodes).
 * Optional filter: ?nodeIds=node_a,node_b for architect-selected back-links.
 */
memoryRoutes.get("/context/backlink/:workflowRunId/:nodeId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const nodeId = c.req.param("nodeId");
    const runId = c.req.param("workflowRunId");
    if (!(await runVisibleTo(runId, authUser))) {
      return errorResponse(c, "Workflow run not found", 404, "NOT_FOUND");
    }
    const selected = c.req.query("nodeIds")?.split(",").filter(Boolean);
    const memories = await memoryBroker.getBackLinkedMemory(
      runId,
      nodeId,
      selected
    );
    return successResponse(c, { nodeId, memories });
  } catch (error) {
    return handleMemoryRouteError(c, error, "Could not load back-linked memory", "BACKLINK_LOAD_FAILED");
  }
});
