/**
 * TURNING A CHECKED PLAN INTO A CANVAS.
 *
 * The plan says which steps and how they connect. This produces the actual
 * nodes and edges, laid out so an architect can read the flow the moment it
 * appears — because an orchestration that lands as a pile of overlapping boxes
 * is one an architect immediately distrusts, however correct it is.
 *
 * Presentation comes from the registry, exactly as it does when a node is
 * dragged from the sidebar. Nothing here decides what a step looks like; a node
 * the composer places and the same node placed by hand are the same node.
 */

import { getNodeDefinition } from "@coreai/shared";
import { getConnector } from "../../connectors/registry";
import type { ComposerPlan } from "./check-plan";

export type CanvasNode = {
  id: string;
  type: "builder";
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};

/** Roughly one card's height, and enough gap to see the wire between them. */
const ROW = 190;
const COLUMN = 340;

/**
 * Where each step sits.
 *
 * Laid out by DEPTH from the trigger — everything one hop in sits in the same
 * column — so the picture reads left to right in the order things happen. A
 * branch puts its two sides on separate rows, which is the only place the
 * layout has to be cleverer than a line.
 */
function positions(plan: ComposerPlan): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const edge of plan.edges ?? []) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const incoming = new Set((plan.edges ?? []).map((edge) => edge.to));
  const roots = plan.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);

  const queue = [...(roots.length ? roots : [plan.nodes[0]?.id].filter(Boolean))];
  for (const id of queue) depth.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      const candidate = (depth.get(id) ?? 0) + 1;
      if ((depth.get(next) ?? -1) < candidate) {
        depth.set(next, candidate);
        queue.push(next);
      }
    }
  }

  const perColumn = new Map<number, number>();
  const placed = new Map<string, { x: number; y: number }>();
  for (const node of plan.nodes) {
    const column = depth.get(node.id) ?? 0;
    const row = perColumn.get(column) ?? 0;
    perColumn.set(column, row + 1);
    placed.set(node.id, { x: 120 + column * COLUMN, y: 120 + row * ROW });
  }
  return placed;
}

/** A step's look, taken from wherever that step is normally described. */
function presentationFor(type: string): { label: string; description: string; nodeKind: string; connectorId?: string } {
  if (type.startsWith("connector.")) {
    const frame = getConnector(type.slice("connector.".length));
    if (frame) {
      return {
        label: frame.label,
        description: frame.description,
        nodeKind: frame.execution === "inbound" ? "trigger" : "connector",
        connectorId: frame.id
      };
    }
  }

  const definition = getNodeDefinition(type);
  return {
    label: definition?.label ?? type,
    description: definition?.description ?? "",
    nodeKind: definition?.runtime.nodeKind ?? "connector"
  };
}

export function planToCanvas(plan: ComposerPlan): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const placed = positions(plan);

  const nodes: CanvasNode[] = plan.nodes.map((node) => {
    const look = presentationFor(node.type);
    const realType = node.type.startsWith("connector.") ? node.type : node.type;

    return {
      id: node.id,
      type: "builder",
      position: placed.get(node.id) ?? { x: 120, y: 120 },
      data: {
        // The architect's own words for this step, falling back to the
        // registry's. Never the type name — nobody reads "action.send_sms".
        title: node.title?.trim() || look.label,
        label: node.title?.trim() || look.label,
        subtitle: look.description,
        type: realType,
        nodeKind: look.nodeKind,
        ...(look.connectorId ? { connectorId: look.connectorId } : {}),
        ...(node.config ?? {})
      }
    };
  });

  const edges: CanvasEdge[] = (plan.edges ?? []).map((edge, index) => ({
    id: `e${index}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    // A branch leaves by one of two handles; everything else has just the one.
    ...(edge.when ? { sourceHandle: edge.when } : {})
  }));

  return { nodes, edges };
}
