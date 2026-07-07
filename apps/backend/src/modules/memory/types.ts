//Runtime status of a single node execution (maps to NodeRun.status in DB). 
export type NodeRunStatusValue =
  | "pending"
  | "running"
  | "success"
  | "waiting"
  | "error"
  | "skipped";

// A file produced or referenced during a node run (e.g. PDF, image, export)
export type MemoryFileRef = {
  name: string;
  url: string;
  mimeType?: string;
};

// What we pass into saveMemory() after a node runs.
export type NodeMemoryPayload = {
    workflowRunId: string;
    nodeId: string;
    nodeType: string;
    nodeLabel?: string;
    status: NodeRunStatusValue;
    executionOrder?: number;
    //Groups related runs in one conversation (e.g. same caller thread).
    threadId?: string;
    //Raw input the node received.
    input?: unknown;
    //Raw output the node produced.
    output?: unknown;
    //Short AI-friendly summary for later nodes (optional).
    summary?: string;
    //Snapshot of workflow variables after this node.
    variables?: Record<string, unknown>;
    files?: MemoryFileRef[];
    //Who ran the work — e.g. openai, twilio, vapi.
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


  //A saved node memory row — same as payload plus DB fields.
  //Returned by loadMemory().
export type NodeMemoryRecord = NodeMemoryPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

//A back-link: "toNode" should remember "fromNode".
export type ContextLinkRecord = {
  id: string;
  workflowRunId: string;
  fromNodeRunId: string;
  toNodeRunId: string;
  linkType: "backlink" | "reference" | "summary_source";
  reason?: string;
  createdAt: string;
};

//Everything a node needs to "remember" before it runs.
export type WorkflowMemoryContext = {
  workflowRunId: string;
  nodeId: string;
  threadId?: string;
  nodeMemories: NodeMemoryRecord[];
  contextLinks: ContextLinkRecord[];
};