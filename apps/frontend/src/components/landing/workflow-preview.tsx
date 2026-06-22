"use client";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type MarketplaceNodeData = {
  title: string;
  subtitle: string;
};

function MarketplaceNode({ data }: NodeProps<Node<MarketplaceNodeData>>) {
  return (
    <div className="min-w-[180px] rounded-xl border border-orange-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-sm font-semibold text-orange-900">{data.title}</div>
      <div className="text-xs text-orange-700">{data.subtitle}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = {
  marketplace: MarketplaceNode,
};

const nodes: Node<MarketplaceNodeData>[] = [
  {
    id: "1",
    position: { x: 20, y: 90 },
    data: { title: "Business Need", subtitle: "Post project or install agent" },
    type: "marketplace",
  },
  {
    id: "2",
    position: { x: 300, y: 20 },
    data: { title: "AI Architect", subtitle: "Build workflow in builder" },
    type: "marketplace",
  },
  {
    id: "3",
    position: { x: 300, y: 170 },
    data: { title: "Marketplace Agent", subtitle: "Install ready template" },
    type: "marketplace",
  },
  {
    id: "4",
    position: { x: 600, y: 90 },
    data: { title: "Custom Engine", subtitle: "Execute with logs + approvals" },
    type: "marketplace",
  },
];

const edges: Edge[] = [
  {
    id: "e1-2",
    source: "1",
    target: "2",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
  {
    id: "e1-3",
    source: "1",
    target: "3",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
  {
    id: "e2-4",
    source: "2",
    target: "4",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
  {
    id: "e3-4",
    source: "3",
    target: "4",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
];

export function LandingWorkflowPreview() {
  return (
    <div className="h-[320px] w-full rounded-2xl border border-orange-200 bg-orange-50/40">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#fed7aa" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
