import { workflowHasTriggerNode, type CapabilityNode } from "./workflow-capabilities";

export type GraphEdge = {
  source?: string | null;
  target?: string | null;
};

export type WorkflowGraphIssue =
  | "missing_trigger"
  | "multiple_triggers"
  | "disconnected_nodes";

export type WorkflowGraphValidation = {
  ok: boolean;
  issue: WorkflowGraphIssue | null;
  title: string;
  message: string;
  orphanNodeIds: string[];
  triggerNodeIds: string[];
};

type GraphNode = CapabilityNode & { id?: string };

function nodeId(node: GraphNode, index: number): string {
  return String(node.id ?? `node-${index}`);
}

function isTriggerCapabilityNode(node: CapabilityNode): boolean {
  return workflowHasTriggerNode([node]);
}

function reachableFrom(roots: string[], adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/**
 * MVP rule: one trigger, one connected workflow.
 * Every non-trigger node must be reachable from that trigger via directed edges.
 */
export function analyzeWorkflowGraph(
  nodes: GraphNode[],
  edges: GraphEdge[]
): WorkflowGraphValidation {
  if (nodes.length === 0) {
    return {
      ok: true,
      issue: null,
      title: "",
      message: "",
      orphanNodeIds: [],
      triggerNodeIds: []
    };
  }

  const triggerNodeIds = nodes
    .map((node, index) => ({ node, id: nodeId(node, index) }))
    .filter(({ node }) => isTriggerCapabilityNode(node))
    .map(({ id }) => id);

  if (triggerNodeIds.length === 0) {
    return {
      ok: false,
      issue: "missing_trigger",
      title: "Add a trigger",
      message:
        "Every agent needs one starting trigger. Add a trigger from the library, then connect your steps to it.",
      orphanNodeIds: nodes.map((node, index) => nodeId(node, index)),
      triggerNodeIds: []
    };
  }

  if (triggerNodeIds.length > 1) {
    return {
      ok: false,
      issue: "multiple_triggers",
      title: "One workflow only",
      message:
        "Keep a single trigger for now. Remove extra triggers so all steps belong to one connected flow.",
      orphanNodeIds: [],
      triggerNodeIds
    };
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const source = edge.source ? String(edge.source) : "";
    const target = edge.target ? String(edge.target) : "";
    if (!source || !target) continue;
    const list = adjacency.get(source) ?? [];
    list.push(target);
    adjacency.set(source, list);
  }

  const reachable = reachableFrom(triggerNodeIds, adjacency);
  const orphanNodeIds = nodes
    .map((node, index) => nodeId(node, index))
    .filter((id) => !reachable.has(id));

  if (orphanNodeIds.length > 0) {
    return {
      ok: false,
      issue: "disconnected_nodes",
      title: "Connect your workflow",
      message:
        "Some nodes are not linked to your trigger. Connect them into one flow, or remove unused nodes before continuing.",
      orphanNodeIds,
      triggerNodeIds
    };
  }

  return {
    ok: true,
    issue: null,
    title: "",
    message: "",
    orphanNodeIds: [],
    triggerNodeIds
  };
}
