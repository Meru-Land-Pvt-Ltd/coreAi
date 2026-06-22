import { Queue } from "bullmq";
import { env } from "./env.js";

export const workflowQueue = new Queue("workflow-execution", {
  connection: {
    url: env.REDIS_URL,
  },
});
