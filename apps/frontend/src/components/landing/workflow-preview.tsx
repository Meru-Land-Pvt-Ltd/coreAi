"use client";

import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type ProOptions,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodes: Node[] = [
  {
    id: "trigger",
    position: { x: 20, y: 90 },
    data: { label: "Webhook Trigger" },
    style: {
      borderRadius: 14,
      border: "1px solid #fdba74",
      background: "#fff7ed",
      color: "#7c2d12",
      fontWeight: 600,
    },
  },
  {
    id: "router",
    position: { x: 260, y: 90 },
    data: { label: "Condition Router" },
    style: {
      borderRadius: 14,
      border: "1px solid #fdba74",
      background: "#fff7ed",
      color: "#7c2d12",
      fontWeight: 600,
    },
  },
  {
    id: "llm",
    position: { x: 500, y: 20 },
    data: { label: "LLM Node" },
    style: {
      borderRadius: 14,
      border: "1px solid #fdba74",
      background: "#fff7ed",
      color: "#7c2d12",
      fontWeight: 600,
    },
  },
  {
    id: "approval",
    position: { x: 500, y: 170 },
    data: { label: "Human Approval" },
    style: {
      borderRadius: 14,
      border: "1px solid #fdba74",
      background: "#fff7ed",
      color: "#7c2d12",
      fontWeight: 600,
    },
  },
  {
    id: "connector",
    position: { x: 760, y: 90 },
    data: { label: "Connector Action" },
    style: {
      borderRadius: 14,
      border: "1px solid #fdba74",
      background: "#fff7ed",
      color: "#7c2d12",
      fontWeight: 600,
    },
  },
];

const edges: Edge[] = [
  {
    id: "e1",
    source: "trigger",
    target: "router",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316" },
    animated: true,
    style: { stroke: "#f97316", strokeWidth: 2.2 },
  },
  {
    id: "e2",
    source: "router",
    target: "llm",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316" },
    label: "auto path",
    labelStyle: { fill: "#9a3412", fontSize: 11 },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
  {
    id: "e3",
    source: "router",
    target: "approval",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316" },
    label: "risky path",
    labelStyle: { fill: "#9a3412", fontSize: 11 },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
  {
    id: "e4",
    source: "llm",
    target: "connector",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316" },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
  {
    id: "e5",
    source: "approval",
    target: "connector",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316" },
    style: { stroke: "#f97316", strokeWidth: 2 },
  },
];

const fitViewOptions: FitViewOptions = { padding: 0.2, minZoom: 0.4, maxZoom: 1.2 };
const proOptions: ProOptions = { hideAttribution: true };

export function LandingWorkflowPreview() {
  return (
    <div className="h-[380px] w-full overflow-hidden rounded-2xl border border-orange-300 bg-gradient-to-br from-orange-50 to-amber-100">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={fitViewOptions}
        proOptions={proOptions}
        defaultEdgeOptions={{ type: "smoothstep", style: { stroke: "#f97316", strokeWidth: 2 } }}
        connectionLineType={ConnectionLineType.SmoothStep}
        colorMode="light"
        attributionPosition="bottom-left"
        minZoom={0.35}
        maxZoom={1.6}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnDrag
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        snapToGrid
        snapGrid={[16, 16]}
        defaultViewport={{ x: 0, y: 0, zoom: 0.72 }}
      >
        <MiniMap
          nodeColor={() => "#f97316"}
          maskColor="rgba(255,240,220,0.45)"
          pannable
          zoomable
          position="bottom-right"
          nodeStrokeWidth={3}
          style={{ background: "#ffedd5", border: "1px solid #fdba74" }}
        />
        <Controls showInteractive={false} position="top-right" />
        <Panel position="top-left" className="rounded-full border border-orange-300 bg-white/80 px-3 py-1 text-xs text-orange-900">
          Engine Graph Preview
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#fdba74" />
      </ReactFlow>
    </div>
  );
}
