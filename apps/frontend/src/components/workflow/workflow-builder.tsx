"use client";

import { useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodes: Node[] = [
  {
    id: "1",
    position: { x: 80, y: 100 },
    data: { label: "Manual Trigger" },
    type: "input"
  },
  {
    id: "2",
    position: { x: 320, y: 100 },
    data: { label: "AI Prompt Node" }
  },
  {
    id: "3",
    position: { x: 560, y: 100 },
    data: { label: "Human Approval" }
  },
  {
    id: "4",
    position: { x: 800, y: 100 },
    data: { label: "Connector Action" },
    type: "output"
  }
];

const edges: Edge[] = [
  {
    id: "e1-2",
    source: "1",
    target: "2"
  },
  {
    id: "e2-3",
    source: "2",
    target: "3"
  },
  {
    id: "e3-4",
    source: "3",
    target: "4"
  }
];

const runLogs = [
  "Manual Trigger started",
  "AI Prompt Node generated a prototype response",
  "Human Approval auto-approved for demo",
  "Connector Action completed",
  "Workflow completed successfully"
];

export function WorkflowBuilder() {
  const [logs, setLogs] = useState<string[]>([]);

  const runPrototype = () => {
    setLogs([]);

    runLogs.forEach((log, index) => {
      window.setTimeout(() => {
        setLogs((current) => [...current, log]);
      }, index * 450);
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={runPrototype}
          className="rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white"
        >
          Run Prototype Workflow
        </button>
      </div>

      <div className="h-[62vh] rounded-3xl border border-orange-200 bg-white">
        <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <div className="rounded-3xl soft-card p-4">
        <h3 className="font-semibold text-orange-950">Execution Logs</h3>

        <div className="mt-3 space-y-2 text-sm text-orange-800">
          {logs.length ? (
            logs.map((log) => (
              <div key={log} className="rounded-xl bg-orange-50 px-3 py-2">
                {log}
              </div>
            ))
          ) : (
            <p className="text-orange-700/70">Run the workflow to see step-by-step logs.</p>
          )}
        </div>
      </div>
    </div>
  );
}