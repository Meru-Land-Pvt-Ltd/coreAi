import { Worker } from "bullmq";
import { env } from "../../../common/lib/env.js";

export const workflowWorker = new Worker(
  "workflow-execution",
  async (job) => {
    // Placeholder for loading workflow from Postgres and executing node graph.
    console.log("Executing workflow job", job.id, job.data);
  },
  {
    connection: {
      url: env.REDIS_URL,
    },
  },
);
