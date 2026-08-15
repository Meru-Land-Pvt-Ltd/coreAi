import { isBlockNodeType } from "@coreai/shared";
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

/** Product blocks — sections of the customer page, not engine steps. */
function isProductBlockNode(node: GraphNode): boolean {
  return (
    isBlockNodeType(String(node.data?.type ?? node.type ?? "")) ||
    String(node.data?.nodeKind ?? "") === "block"
  );
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
 *
 * Product blocks (block.*) relax this for the flagship story — "drag a Prompt
 * Box, a brain, and a Result Viewer, connect them, press Test":
 * - Blocks are page sections, not engine steps. They are never orphans (their
 *   canvas position alone decides the customer page) and they count as extra
 *   starting points for connectivity, so a brain wired only to a Prompt Box
 *   is a connected product, not a stray step.
 * - A graph that has product sections needs no trigger at all — the customer
 *   page itself is what starts the agent.
 * Graphs without blocks keep the exact rules and copy they had before.
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

  const blockNodeIds = new Set(
    nodes
      .map((node, index) => ({ node, id: nodeId(node, index) }))
      .filter(({ node }) => isProductBlockNode(node))
      .map(({ id }) => id)
  );
  const hasProductBlocks = blockNodeIds.size > 0;

  const triggerNodeIds = nodes
    .map((node, index) => ({ node, id: nodeId(node, index) }))
    .filter(({ node }) => isTriggerCapabilityNode(node))
    .map(({ id }) => id);

  if (triggerNodeIds.length === 0 && !hasProductBlocks) {
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
      title: hasProductBlocks ? "One starting point only" : "One workflow only",
      message: hasProductBlocks
        ? "Keep a single trigger for now. Remove the extra ones so your agent has one clear starting point."
        : "Keep a single trigger for now. Remove extra triggers so all steps belong to one connected flow.",
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

  // Blocks join the trigger as reachability roots: anything your product
  // sections feed into belongs to the product.
  const reachable = reachableFrom([...triggerNodeIds, ...blockNodeIds], adjacency);
  const orphanNodeIds = nodes
    .map((node, index) => nodeId(node, index))
    // Blocks are placed, not wired — position on the canvas is their meaning.
    .filter((id) => !reachable.has(id) && !blockNodeIds.has(id));

  if (orphanNodeIds.length > 0) {
    return {
      ok: false,
      issue: "disconnected_nodes",
      title: hasProductBlocks ? "Connect your steps" : "Connect your workflow",
      message: hasProductBlocks
        ? "Some steps aren't linked in yet. Connect each one into your flow, or remove the ones you aren't using."
        : "Some nodes are not linked to your trigger. Connect them into one flow, or remove unused nodes before continuing.",
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
