import type { Edge } from "@xyflow/react";
import { defaultNodeData } from "./node-defaults";
import type { BuilderNode, NodeKind } from "./types";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

export function isNodeKind(value: unknown): value is NodeKind {
  return (
    value === "trigger" ||
    value === "ai" ||
    value === "condition" ||
    value === "connector" ||
    value === "output" ||
    value === "block"
  );
}

export function isBuilderNode(value: unknown): value is BuilderNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<BuilderNode>;
  return typeof node.id === "string" && typeof node.data === "object" && node.data !== null;
}

export function normalizeNode(node: BuilderNode): BuilderNode {
  const nodeKind = isNodeKind(node.data.nodeKind) ? node.data.nodeKind : "connector";
  const isTelegramTrigger = node.data.type === "trigger.telegram_message";

  return {
    ...node,
    type: "coreNode",
    data: {
      ...defaultNodeData(nodeKind),
      ...node.data,
      nodeKind,
      ...(isTelegramTrigger ? { accent: "blue" as const, icon: "telegram" } : {}),
      label: String(node.data.label ?? node.data.title ?? defaultNodeData(nodeKind).label),
      title: String(node.data.title ?? node.data.label ?? defaultNodeData(nodeKind).title)
    }
  };
}

export function isEdge(value: unknown): value is Edge {
  if (typeof value !== "object" || value === null) return false;
  const edge = value as Partial<Edge>;
  return typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string";
}

/**
 * THE ONLY WAY NODES GET ONTO THE CANVAS.
 *
 * Everything that puts nodes on the canvas comes through here — loading a saved
 * agent, the AI composer, "Fix it for me", importing a template. It has to,
 * because `normalizeNode` is what gives a node the type React Flow draws
 * (`coreNode`) and the colour and icon that go with its kind.
 *
 * The composer used to skip it, with a cast that hid the mistake from the type
 * checker: `setNodes(canvas.nodes as unknown as BuilderNode[])`. React Flow does
 * not know the type the composer emits, so it fell back to its own stock grey
 * box — and every agent the composer built came out as plain black-and-white
 * rectangles next to the coloured cards a person dragged in. Reloading the page
 * fixed them, because reloading goes through here. That is the whole bug.
 */
export function toBuilderNodes(raw: unknown): BuilderNode[] {
  return Array.isArray(raw) ? raw.filter(isBuilderNode).map(normalizeNode) : [];
}

export function toBuilderEdges(raw: unknown): Edge[] {
  return Array.isArray(raw) ? raw.filter(isEdge) : [];
}

export function parseNodes(workflow: ArchitectWorkflow | null): BuilderNode[] {
  return toBuilderNodes(workflow?.workflowJson?.nodes);
}

export function parseEdges(workflow: ArchitectWorkflow | null): Edge[] {
  return toBuilderEdges(workflow?.workflowJson?.edges);
}
