"use client";

import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";

const nodes: Node[] = [
  { id: "1", position: { x: 100, y: 100 }, data: { label: "Webhook Trigger" }, type: "input" },
  { id: "2", position: { x: 320, y: 100 }, data: { label: "LLM Node" } },
  { id: "3", position: { x: 540, y: 100 }, data: { label: "Slack Action" }, type: "output" },
];

const edges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", target: "3" },
];

export function WorkflowBuilder() {
  return (
    <div className="h-[70vh] rounded-2xl border border-orange-200 bg-white">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
