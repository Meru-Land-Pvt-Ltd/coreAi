import { BLOCK_NODE_TYPES, DESIGN_BRAIN_NODE_TYPE, isBlockNodeType } from "@coreai/shared";

/**
 * "Clean up" layout for the builder canvas — a deterministic, layered
 * left-to-right arrangement that mirrors how an agent actually works:
 *
 *   column 0  Face input blocks (prompt box, style cards, model picker,
 *             buttons, file upload) — what the customer touches first,
 *             stacked in their current top-to-bottom order.
 *   column 1  Brains + logic (AI thinking, decisions, incoming events),
 *             ordered by how far from the inputs each one sits (BFS depth),
 *             so upstream pieces land above downstream ones.
 *   column 2  Hands / actions (connectors, saved results, messages out),
 *             same depth-then-position ordering.
 *   column 3  Face output blocks (result stage, history shelf) — what the
 *             customer sees at the end, stacked in current order.
 *
 * The AI Builder is a canvas companion, not a step in the flow — it parks
 * bottom-left, under column 0, out of the reading path.
 *
 * Everything here is pure and deterministic: the same nodes + edges always
 * produce the same positions (ties broken by current position, then id), and
 * the fixed column/row grid guarantees zero overlaps for canvases well past
 * 30 pieces.
 */

export type TidyPoint = { x: number; y: number };

/** The minimal node shape the layout needs — a subset of BuilderNode. */
export type TidyNode = {
  id: string;
  position: TidyPoint;
  data?: { type?: unknown; nodeKind?: unknown } & Record<string, unknown>;
};

/** The minimal edge shape the layout needs — a subset of React Flow's Edge. */
export type TidyEdge = { source: string; target: string };

/* Grid geometry. Canvas nodes render 224px wide (`w-56`) and up to ~170px
 * tall, so 340 x 190 keeps generous air between every piece. */
export const TIDY_COLUMN_X_START = 80;
export const TIDY_COLUMN_SPACING = 340;
export const TIDY_ROW_Y_START = 80;
export const TIDY_ROW_SPACING = 190;
/** Extra air between the last column row and the parked AI Builder. */
export const TIDY_PARK_GAP = 70;

/** Face blocks the customer fills in — they feed the brain. */
const INPUT_BLOCK_TYPES = new Set<string>([
  BLOCK_NODE_TYPES.promptComposer,
  BLOCK_NODE_TYPES.presetGallery,
  BLOCK_NODE_TYPES.modelPicker,
  BLOCK_NODE_TYPES.actionButton,
  "block.file_upload"
]);

type TidyColumn = 0 | 1 | 2 | 3;
type TidyLane = TidyColumn | "parked";

function nodeType(node: TidyNode): string {
  return String(node.data?.type ?? "");
}

function nodeKind(node: TidyNode): string {
  return String(node.data?.nodeKind ?? "");
}

/** Which lane a node belongs to (column 0–3, or parked for the AI Builder). */
export function tidyLaneFor(node: TidyNode): TidyLane {
  const type = nodeType(node);

  if (type === DESIGN_BRAIN_NODE_TYPE) return "parked";

  if (isBlockNodeType(type)) {
    // Input blocks lead the page; every other block (result stage, history
    // shelf, continue chain, future blocks) shows the outcome.
    return INPUT_BLOCK_TYPES.has(type) ? 0 : 3;
  }

  // Hands: pieces that act on the world or hand off the result.
  const kind = nodeKind(node);
  if (kind === "connector" || kind === "output") return 2;

  // Brains + logic: AI thinking, decisions, and incoming events — plus any
  // unknown piece, so nothing is ever dropped from the layout.
  return 1;
}

/**
 * BFS depth of every node measured from the layout's "inputs": column-0 Face
 * blocks plus any non-parked node nothing points at. Unreachable nodes get
 * Infinity and simply sort after reachable ones.
 */
function bfsDepthsFromInputs(nodes: TidyNode[], edges: TidyEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of ids) {
    outgoing.set(id, []);
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const depths = new Map<string, number>();
  const queue: string[] = [];

  for (const node of nodes) {
    const lane = tidyLaneFor(node);
    if (lane === "parked") continue;
    if (lane === 0 || (inDegree.get(node.id) ?? 0) === 0) {
      depths.set(node.id, 0);
      queue.push(node.id);
    }
  }

  // Plain FIFO BFS — first (shortest) discovery wins, which is exactly the
  // "how many hops from the inputs" number the columns sort by.
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    const depth = depths.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if (depths.has(next)) continue;
      depths.set(next, depth + 1);
      queue.push(next);
    }
  }

  return depths;
}

/** Deterministic comparator: current y, then x, then id. */
function byCanvasPosition(a: TidyNode, b: TidyNode): number {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  if (a.position.x !== b.position.x) return a.position.x - b.position.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compute the tidied position for every node. Pure and deterministic; the
 * caller applies the result through its normal node-position update + save.
 */
export function computeTidyPositions(
  nodes: TidyNode[],
  edges: TidyEdge[]
): Map<string, TidyPoint> {
  const positions = new Map<string, TidyPoint>();
  if (nodes.length === 0) return positions;

  const depths = bfsDepthsFromInputs(nodes, edges);
  const columns: TidyNode[][] = [[], [], [], []];
  const parked: TidyNode[] = [];

  for (const node of nodes) {
    const lane = tidyLaneFor(node);
    if (lane === "parked") parked.push(node);
    else columns[lane].push(node);
  }

  // Face columns keep their current top-to-bottom order; the middle columns
  // order by BFS depth from the inputs first, so flow reads downward.
  columns[0].sort(byCanvasPosition);
  columns[3].sort(byCanvasPosition);
  for (const column of [columns[1], columns[2]]) {
    column.sort((a, b) => {
      const depthA = depths.get(a.id) ?? Number.POSITIVE_INFINITY;
      const depthB = depths.get(b.id) ?? Number.POSITIVE_INFINITY;
      if (depthA !== depthB) return depthA - depthB;
      return byCanvasPosition(a, b);
    });
  }
  parked.sort(byCanvasPosition);

  let tallestColumn = 0;
  columns.forEach((column, columnIndex) => {
    const x = TIDY_COLUMN_X_START + columnIndex * TIDY_COLUMN_SPACING;
    column.forEach((node, rowIndex) => {
      positions.set(node.id, { x, y: TIDY_ROW_Y_START + rowIndex * TIDY_ROW_SPACING });
    });
    tallestColumn = Math.max(tallestColumn, column.length);
  });

  // Park the AI Builder bottom-left, clear of every column row.
  const parkedYStart =
    TIDY_ROW_Y_START + Math.max(tallestColumn, 1) * TIDY_ROW_SPACING + TIDY_PARK_GAP;
  parked.forEach((node, rowIndex) => {
    positions.set(node.id, {
      x: TIDY_COLUMN_X_START,
      y: parkedYStart + rowIndex * TIDY_ROW_SPACING
    });
  });

  return positions;
}

/**
 * Convenience for the canvas: returns the same node objects with tidied
 * positions (unchanged nodes are returned as-is) plus whether anything moved.
 */
export function applyTidyPositions<T extends TidyNode>(
  nodes: T[],
  edges: TidyEdge[]
): { nodes: T[]; moved: boolean } {
  const positions = computeTidyPositions(nodes, edges);
  let moved = false;

  const next = nodes.map((node) => {
    const target = positions.get(node.id);
    if (!target || (target.x === node.position.x && target.y === node.position.y)) return node;
    moved = true;
    return { ...node, position: target };
  });

  return { nodes: moved ? next : nodes, moved };
}
