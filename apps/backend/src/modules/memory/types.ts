/**
 * Brain Memory types — shared contracts for save, load, and context building.
 * These mirror WorkflowRun, NodeRun, and ContextLink in Prisma.
 */

export type NodeRunStatusValue =
  | "pending"
  | "running"
  | "success"
  | "waiting"
  | "error"
  | "skipped";

export type MemoryFileRef = {
  name: string;
  url: string;
  mimeType?: string;
};

/** Input for saveNodeMemory() — one node just finished executing. */
export type NodeMemoryPayload = {
  /**
   * Values read for the honesty verdict and never written to the database.
   *
   * Several steps park their result in the run context rather than returning
   * it, so judging them needs the run — but storing the whole run against every
   * step would be enormous and would duplicate it once per node.
   */
  checkVariables?: Record<string, unknown>;
  workflowRunId: string;
  nodeId: string;
  nodeType: string;
  nodeLabel?: string;
  status: NodeRunStatusValue;
  executionOrder?: number;
  threadId?: string;
  input?: unknown;
  output?: unknown;
  summary?: string;
  variables?: Record<string, unknown>;
  files?: MemoryFileRef[];
  provider?: string;
  model?: string;
  costCents?: number;
  tokenInput?: number;
  tokenOutput?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorMessage?: string;
};

/** Saved NodeRun row returned from the database. */
export type NodeMemoryRecord = NodeMemoryPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Back-link between two node runs.
 * fromNodeRun = source memory, toNodeRun = node that reads it.
 */
export type ContextLinkRecord = {
  id: string;
  workflowRunId: string;
  fromNodeRunId: string;
  toNodeRunId: string;
  linkType: "backlink" | "reference" | "summary_source";
  reason?: string;
  createdAt: string;
};

export type WorkflowMemoryContext = {
  workflowRunId: string;
  nodeId: string;
  threadId?: string;
  nodeMemories: NodeMemoryRecord[];
  contextLinks: ContextLinkRecord[];
};

/** Merged memory from previous and back-linked nodes. */
export type MergedWorkflowMemory = {
  originalPrompt?: string;
  summaries: string[];
  variables: Record<string, unknown>;
  outputs: Array<{ nodeId: string; nodeType: string; output: unknown }>;
  files: MemoryFileRef[];
  metadata?: Record<string, unknown>;
  totalTokens: number;
  totalCostCents: number;
};

/** Full AI-ready context for one node, including compressedPrompt. */
export type ContextBundle = {
  workflowRunId: string;
  nodeId: string;
  threadId?: string;
  nodeMemories: NodeMemoryRecord[];
  backLinkedMemories: NodeMemoryRecord[];
  previousMemory: NodeMemoryRecord | null;
  contextLinks: ContextLinkRecord[];
  merged: MergedWorkflowMemory;
  compressedPrompt: string;
};

export type SaveNodeMemoryInput = NodeMemoryPayload;

export type BuildContextBundleInput = {
  workflowRunId: string;
  nodeId: string;
  threadId?: string;
  originalPrompt?: string;
  /** Current node order in this run — used to resolve forward-chain memory before NodeRun exists. */
  executionOrder?: number;
  /** Node ids the architect picked for back-linking in the workflow builder. */
  backlinkNodeIds?: string[];
  workflowMetadata?: Record<string, unknown>;
};
