/** Request validation for Brain Memory API routes. */
import { z } from "zod";

export const saveNodeMemorySchema = z.object({
  workflowRunId: z.string().min(1),
  nodeId: z.string().min(1),
  nodeType: z.string().min(1),
  nodeLabel: z.string().optional(),
  status: z.enum(["pending", "running", "success", "waiting", "error", "skipped"]),
  executionOrder: z.number().int().optional(),
  threadId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  summary: z.string().optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  files: z.array(z.object({
    name: z.string(),
    url: z.string(),
    mimeType: z.string().optional(),
  })).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  costCents: z.number().int().optional(),
  tokenInput: z.number().int().optional(),
  tokenOutput: z.number().int().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationMs: z.number().int().optional(),
  errorMessage: z.string().optional(),
});

export const buildContextBundleSchema = z.object({
  workflowRunId: z.string().min(1),
  nodeId: z.string().min(1),
  threadId: z.string().optional(),
  originalPrompt: z.string().optional(),
  backlinkNodeIds: z.array(z.string()).optional(),
  workflowMetadata: z.record(z.string(), z.unknown()).optional(),
});
