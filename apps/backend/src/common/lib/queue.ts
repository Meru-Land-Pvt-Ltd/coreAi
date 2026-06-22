import { Queue } from "bullmq";
import { env } from "./env.js";

let workflowQueue: Queue | null = null;

export const getWorkflowQueue = () => {
  if (!workflowQueue) {
    workflowQueue = new Queue("workflow-execution", {
      connection: {
        url: env.REDIS_URL,
      },
    });
  }

  return workflowQueue;
};
