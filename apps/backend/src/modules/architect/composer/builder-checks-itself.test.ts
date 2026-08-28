import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE BUILDER MUST NOT HAND OVER WORK IT HAS NEVER WATCHED RUN.
 *
 * The founder's law for mostdo2, and the half that was missing. The Builder
 * has always looked at the customer PAGE it designs — opens it in a real
 * browser, reads the picture, fixes, looks again. The AGENT it built was
 * handed over blind: composed, wired, and never run once. The first eyes on
 * a built agent were always the architect's.
 *
 * Three answers are allowed and never a fourth: it ran and it worked · it
 * ran and this did not · it could not run it and says so. A silent pass is
 * exactly the lie this loop exists to prevent.
 */

const { composeMock, checkMock, hiddenMock } = vi.hoisted(() => ({
  composeMock: vi.fn(),
  checkMock: vi.fn(),
  hiddenMock: vi.fn()
}));

vi.mock("./compose", () => ({ composeOrchestration: composeMock }));
vi.mock("../agent-check", () => ({ checkAgentGraph: checkMock }));
vi.mock("../../admin/node-controls", () => ({
  hiddenNodeTypes: hiddenMock,
  pausedNodeTypes: vi.fn(async () => []),
  pausedMessageFor: vi.fn(() => null)
}));

import { composerRoutes } from "./routes";
import { Hono } from "hono";

const PLAN = {
  summary: "Answers questions from your price list",
  nodes: [{ id: "ear", type: "trigger.telegram_message" }, { id: "brain", type: "ai.llm_call" }],
  edges: [{ from: "ear", to: "brain" }]
};

function app() {
  const hono = new Hono();
  hono.use("*", async (c, next) => {
    c.set("authUser", { id: "architect-1", role: "ARCHITECT" });
    await next();
  });
  hono.route("/compose", composerRoutes);
  return hono;
}

async function post(body: unknown) {
  return app().request("/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

/** The SSE stream, as one string. */
async function streamText(response: Response): Promise<string> {
  return await response.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  hiddenMock.mockResolvedValue([]);
  composeMock.mockResolvedValue({ ok: true, plan: PLAN, menu: [], attempts: 1 });
});

describe("the Builder runs what it built", () => {
  it("runs the agent it just composed and reports what it found", async () => {
    checkMock.mockResolvedValue({
      lines: [{ kind: "ok", text: "Every step gets the data it needs." }],
      passed: 3,
      failed: 0
    });

    const body = await streamText(
      await post({ want: "answer questions from my price list", workflowId: "wf-1" })
    );

    /* It ran the thing it built — not a saved copy, the graph in its hand. */
    expect(checkMock).toHaveBeenCalledTimes(1);
    const call = checkMock.mock.calls[0][0];
    expect(call.workflowId).toBe("wf-1");
    expect(call.purpose).toBe("answer questions from my price list");
    expect(call.workflowJson.nodes).toHaveLength(2);

    expect(body).toContain('"passed":3');
    expect(body).toContain('"couldNotCheck":null');
  });

  it("says out loud when it could not run it, and never passes in silence", async () => {
    /* No canvas to run it in. The old behaviour was to say nothing at all
       and hand over the agent as though it were proven. */
    const body = await streamText(await post({ want: "answer questions from my price list" }));

    expect(checkMock).not.toHaveBeenCalled();
    expect(body).toContain("could not run it");
    expect(body).toContain('"checked":null');
  });

  it("a failing check does not throw away the work — the plan still arrives", async () => {
    checkMock.mockResolvedValue({
      lines: [{ kind: "problem", text: "The Brain has nothing feeding it." }],
      passed: 0,
      failed: 1
    });

    const body = await streamText(await post({ want: "answer my customers", workflowId: "wf-1" }));

    expect(body).toContain('"failed":1');
    expect(body).toContain("The Brain has nothing feeding it.");
    /* The architect still gets the canvas — told honestly what is wrong with
       it. Throwing the work away would be a worse answer than an honest one. */
    expect(body).toContain('"nodes"');
  });

  it("a check that throws never takes the build down with it", async () => {
    checkMock.mockRejectedValue(new Error("engine unreachable"));

    const body = await streamText(await post({ want: "answer my customers", workflowId: "wf-1" }));

    expect(body).toContain("could not run it");
    expect(body).toContain('"nodes"');
  });
});
