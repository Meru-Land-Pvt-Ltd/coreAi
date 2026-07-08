/** Safety checks for back-links — blocks circular loops and self-links. */
import { AppError } from "../../lib/app-error";

export function assertNoSelfLink(fromNodeRunId: string, toNodeRunId: string): void {
  if (fromNodeRunId === toNodeRunId) {
    throw new AppError("Node cannot back-link to itself", 422, "SELF_BACKLINK");
  }
}

export function assertNoCircularBacklinks(params: {
  startNodeRunId: string;
  links: Array<{ fromNodeRunId: string; toNodeRunId: string }>;
}): void {
  const { startNodeRunId, links } = params;
  const graph = new Map<string, string[]>();
  for (const link of links) {
    const list = graph.get(link.toNodeRunId) ?? [];
    list.push(link.fromNodeRunId);
    graph.set(link.toNodeRunId, list);
  }
  const visited = new Set<string>();
  const stack = [startNodeRunId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      throw new AppError("Circular back-link detected", 422, "CIRCULAR_BACKLINK");
    }
    visited.add(current);
    const parents = graph.get(current) ?? [];
    stack.push(...parents);
  }
}

export function dedupeMemories<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
