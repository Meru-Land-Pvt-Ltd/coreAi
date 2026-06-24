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
    value === "output"
  );
}

export function isBuilderNode(value: unknown): value is BuilderNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<BuilderNode>;
  return typeof node.id === "string" && typeof node.data === "object" && node.data !== null;
}

export function normalizeNode(node: BuilderNode): BuilderNode {
  const nodeKind = isNodeKind(node.data.nodeKind) ? node.data.nodeKind : "connector";

  return {
    ...node,
    type: "coreNode",
    data: {
      ...defaultNodeData(nodeKind),
      ...node.data,
      nodeKind,
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

export function parseNodes(workflow: ArchitectWorkflow | null): BuilderNode[] {
  const rawNodes = workflow?.workflowJson?.nodes;
  return Array.isArray(rawNodes) ? rawNodes.filter(isBuilderNode).map(normalizeNode) : [];
}

export function parseEdges(workflow: ArchitectWorkflow | null): Edge[] {
  const rawEdges = workflow?.workflowJson?.edges;
  return Array.isArray(rawEdges) ? rawEdges.filter(isEdge) : [];
}
