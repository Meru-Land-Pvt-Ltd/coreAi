/**
 * Workflow graph rules — one implementation, two readers.
 *
 * The builder canvas shows this as the live "Add a trigger" / "Connect your
 * steps" banner, and the shipped template seeds are checked against the exact
 * same rule: a template an architect imports with one tap must be at least as
 * correct as one they wired by hand. Keeping the rule here means the canvas
 * and the seeds can never drift apart.
 *
 * Pure data in, pure data out — no React, no runtime, no I/O.
 */

import { BLOCK_NODE_TYPES, isBlockNodeType, nodeDoorsEnabled } from "./node-registry";

/** Minimal node shape: whatever carries a type and (maybe) an id. */
export type WorkflowGraphNode = {
  id?: unknown;
  type?: unknown;
  data?: {
    type?: unknown;
    nodeKind?: unknown;
    [key: string]: unknown;
  };
};

export type WorkflowGraphEdge = {
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

function graphNodeType(node: WorkflowGraphNode): string {
  return String(node.data?.type ?? node.type ?? "").toLowerCase();
}

function graphNodeId(node: WorkflowGraphNode, index: number): string {
  return String(node.id ?? `node-${index}`);
}

/**
 * True when the canvas has at least one workflow trigger (manual, phone, SMS,
 * missed-call, telegram, whatsapp, or nodeKind=trigger).
 */
export function workflowGraphHasTrigger(nodes: WorkflowGraphNode[]): boolean {
  return nodes.some((node) => {
    const type = graphNodeType(node);
    const kind = String(node.data?.nodeKind ?? "").toLowerCase();
    if (kind === "trigger") return true;
    if (type.startsWith("trigger.")) return true;
    if (type === "manual_trigger" || type === "manual") return true;
    if (type === "phone_call" || type === "twilio_missed_call" || type === "twilio_inbound_sms") {
      return true;
    }
    return false;
  });
}

/** Product blocks — sections of the customer page, not engine steps. */
function isProductBlockNode(node: WorkflowGraphNode): boolean {
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
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[]
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
      .map((node, index) => ({ node, id: graphNodeId(node, index) }))
      .filter(({ node }) => isProductBlockNode(node))
      .map(({ id }) => id)
  );
  const hasProductBlocks = blockNodeIds.size > 0;

  const triggerNodeIds = nodes
    .map((node, index) => ({ node, id: graphNodeId(node, index) }))
    .filter(({ node }) => workflowGraphHasTrigger([node]))
    .map(({ id }) => id);

  if (triggerNodeIds.length === 0 && !hasProductBlocks) {
    return {
      ok: false,
      issue: "missing_trigger",
      title: "Add a trigger",
      message:
        "Every agent needs one starting trigger. Add a trigger from the library, then connect your steps to it.",
      orphanNodeIds: nodes.map((node, index) => graphNodeId(node, index)),
      triggerNodeIds: []
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

  // MORE THAN ONE WAY IN IS ALLOWED — as long as they lead to the same agent.
  //
  // This used to reject any second trigger outright, which contradicted the
  // product: a webhook ("someone asked us to call") and a call list ("work
  // through these people") are two doors into ONE salesperson, and the runtime
  // has always supported both. The real defect is not two doors; it is two
  // unrelated flows sharing a canvas and pretending to be one agent.
  //
  // So the test is convergence, not count: every trigger must eventually reach
  // something another trigger also reaches.
  if (triggerNodeIds.length > 1) {
    const reach = new Map(triggerNodeIds.map((id) => [id, reachableFrom([id], adjacency)]));
    const stranded = triggerNodeIds.filter((id) => {
      const mine = reach.get(id);
      if (!mine) return true;
      return !triggerNodeIds.some((other) => {
        if (other === id) return false;
        const theirs = reach.get(other);
        if (!theirs) return false;
        for (const node of mine) {
          if (node !== id && node !== other && theirs.has(node)) return true;
        }
        return false;
      });
    });

    if (stranded.length > 0) {
      return {
        ok: false,
        issue: "multiple_triggers",
        title: "These don't lead anywhere together",
        message:
          "You can have more than one way in — a form, a timer, a list — but they must all feed the same agent. Connect them to a shared step, or move the extra one to its own agent.",
        orphanNodeIds: [],
        triggerNodeIds: stranded
      };
    }
  }

  // Blocks join the trigger as reachability roots: anything your product
  // sections feed into belongs to the product.
  const reachable = reachableFrom([...triggerNodeIds, ...blockNodeIds], adjacency);
  const orphanNodeIds = nodes
    .map((node, index) => graphNodeId(node, index))
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

/**
 * Is the Face-out door on for this graph?
 *
 * The presentation door is the Result Viewer's entry door, and the architect
 * switches it with the same quiet "Smart input & output" toggle every other
 * door has. But that door does not run inside a node the way the others do —
 * it runs where the result is rendered, after the engine has already returned —
 * so the only way it can honour the switch is for the surface doing the
 * rendering to read the flag off the graph. That is this function.
 *
 * On when nothing says otherwise: a graph with no Result Viewer, an unreadable
 * graph, or a Result Viewer the architect never touched all mean "on", because
 * doors are on by default and a missing answer must never be read as "off".
 */
export function presentationDoorEnabled(workflowJson: unknown): boolean {
  const nodes = (workflowJson as { nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return true;

  return nodes.every((node) => {
    if (typeof node !== "object" || node === null) return true;
    const data = (node as WorkflowGraphNode).data;
    const type = String(data?.type ?? (node as WorkflowGraphNode).type ?? "");
    if (type !== BLOCK_NODE_TYPES.outputStage) return true;
    return nodeDoorsEnabled(data);
  });
}
