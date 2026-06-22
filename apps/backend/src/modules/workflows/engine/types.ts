export type WorkflowTriggerType = "manual" | "webhook" | "schedule" | "event";

export type WorkflowNodeType =
  | "llm"
  | "connector_action"
  | "condition"
  | "transform"
  | "approval"
  | "delay"
  | "webhook_reply";

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  version: number;
  trigger: WorkflowTriggerType;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  settings: {
    maxRetries: number;
    timeoutMs: number;
    requiresApprovalForRiskyActions: boolean;
  };
}

export interface WorkflowExecutionContext {
  runId: string;
  workflowId: string;
  workspaceId: string;
  actorId: string;
  input: Record<string, unknown>;
}
