import { Hono } from "hono";
import { workflowQueue } from "../../common/lib/queue.js";

export const workflowRoutes = new Hono()
  .post("/publish", (c) => c.json({ message: "workflow published" }))
  .post("/:id/execute", async (c) => {
    const workflowId = c.req.param("id");
    const job = await workflowQueue.add("execute", { workflowId, input: {} });
    return c.json({ jobId: job.id, status: "queued" });
  })
  .get("/:id/runs", (c) => c.json({ workflowId: c.req.param("id"), runs: [] }));
