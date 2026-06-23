"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader
} from "@/components/architect/ui/architect-ui";
import {
  getArchitectWorkflow,
  updateArchitectWorkflow
} from "@/components/architect/features/api";
import type { ArchitectWorkflow } from "@/components/architect/features/types";

type NodeKind =
  | "trigger"
  | "ai"
  | "condition"
  | "connector"
  | "approval"
  | "output";

type BuilderNodeData = {
  [key: string]: unknown;
  label: string;
  nodeKind: NodeKind;
  description?: string;
  prompt?: string;
  connector?: string;
  condition?: string;
  outputKey?: string;
};

type BuilderNode = Node<BuilderNodeData>;

const emptyNodes: BuilderNode[] = [];
const emptyEdges: Edge[] = [];

const nodeLibrary: {
  nodeKind: NodeKind;
  label: string;
  helper: string;
}[] = [
  {
    nodeKind: "trigger",
    label: "Trigger",
    helper: "Start workflow"
  },
  {
    nodeKind: "ai",
    label: "AI Prompt",
    helper: "Use AI step"
  },
  {
    nodeKind: "condition",
    label: "Condition",
    helper: "Add logic"
  },
  {
    nodeKind: "connector",
    label: "Connector",
    helper: "External action"
  },
  {
    nodeKind: "approval",
    label: "Approval",
    helper: "Human check"
  },
  {
    nodeKind: "output",
    label: "Output",
    helper: "Final result"
  }
];

function getNodeType(nodeKind: NodeKind) {
  if (nodeKind === "trigger") return "input";
  if (nodeKind === "output") return "output";
  return undefined;
}

function getNodeDefaultData(nodeKind: NodeKind): BuilderNodeData {
  const item = nodeLibrary.find((node) => node.nodeKind === nodeKind);

  return {
    label: item?.label ?? "Node",
    nodeKind,
    description: item?.helper ?? "",
    prompt: nodeKind === "ai" ? "" : undefined,
    connector: nodeKind === "connector" ? "Gmail" : undefined,
    condition: nodeKind === "condition" ? "" : undefined,
    outputKey: nodeKind === "output" ? "result" : undefined
  };
}

function isNodeKind(value: unknown): value is NodeKind {
  return (
    value === "trigger" ||
    value === "ai" ||
    value === "condition" ||
    value === "connector" ||
    value === "approval" ||
    value === "output"
  );
}

function isBuilderNode(value: unknown): value is BuilderNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const node = value as Partial<BuilderNode>;

  return (
    typeof node.id === "string" &&
    typeof node.position === "object" &&
    node.position !== null &&
    typeof node.data === "object" &&
    node.data !== null
  );
}

function normalizeNode(node: BuilderNode): BuilderNode {
  const nodeKind = isNodeKind(node.data.nodeKind) ? node.data.nodeKind : "ai";

  return {
    ...node,
    type: node.type ?? getNodeType(nodeKind),
    data: {
      ...getNodeDefaultData(nodeKind),
      ...node.data,
      nodeKind,
      label: String(node.data.label ?? getNodeDefaultData(nodeKind).label)
    }
  };
}

function isBuilderEdge(value: unknown): value is Edge {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const edge = value as Partial<Edge>;

  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string"
  );
}

function parseWorkflowNodes(workflow: ArchitectWorkflow | null): BuilderNode[] {
  const nodes = workflow?.workflowJson?.nodes;

  if (Array.isArray(nodes)) {
    return nodes.filter(isBuilderNode).map(normalizeNode);
  }

  return emptyNodes;
}

function parseWorkflowEdges(workflow: ArchitectWorkflow | null): Edge[] {
  const edges = workflow?.workflowJson?.edges;

  if (Array.isArray(edges)) {
    return edges.filter(isBuilderEdge);
  }

  return emptyEdges;
}

export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const [workflow, setWorkflow] = useState<ArchitectWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(emptyNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(emptyEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedNode = useMemo(() => {
    return nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const summary = useMemo(() => {
    return {
      nodes: nodes.length,
      edges: edges.length
    };
  }, [nodes.length, edges.length]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) => addEdge(connection, currentEdges));
    },
    [setEdges]
  );

  async function loadWorkflow() {
    setLoading(true);

    const result = await getArchitectWorkflow(workflowId);

    if (result.success && result.data) {
      const parsedNodes = parseWorkflowNodes(result.data.workflow);
      const parsedEdges = parseWorkflowEdges(result.data.workflow);

      setWorkflow(result.data.workflow);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setSelectedNodeId(parsedNodes[0]?.id ?? null);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadWorkflow();
  }, [workflowId]);

  function addBuilderNode(nodeKind: NodeKind) {
    const id = `${nodeKind}-${Date.now()}`;

    const newNode: BuilderNode = {
      id,
      type: getNodeType(nodeKind),
      position: {
        x: 120 + nodes.length * 40,
        y: 120 + nodes.length * 30
      },
      data: getNodeDefaultData(nodeKind)
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(id);
  }

  function updateSelectedNodeData(field: keyof BuilderNodeData, value: string) {
    if (!selectedNodeId) return;

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== selectedNodeId) return node;

        return {
          ...node,
          data: {
            ...node.data,
            [field]: value
          }
        };
      })
    );
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
  }

  async function saveWorkflow() {
    setSaving(true);
    setMessage("");

    const result = await updateArchitectWorkflow(workflowId, {
      workflowJson: {
        nodes,
        edges
      }
    });

    if (!result.success) {
      setMessage(result.error ?? "Could not save workflow");
      setSaving(false);
      return;
    }

    setMessage("Workflow saved successfully");
    setSaving(false);
  }

  if (loading) {
    return <ArchitectCard>Loading builder...</ArchitectCard>;
  }

  if (!workflow) {
    return (
      <ArchitectEmptyState
        title="Workflow not found"
        text="This workflow may not exist or may not belong to this architect account."
        actionLabel="Back to Workflows"
        actionHref="/architect/workflows"
      />
    );
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Workflow Builder"
        title={workflow.name}
        description="Start with an empty canvas. Add nodes, connect them, configure steps, and save the workflow."
      />

      {message ? (
        <div className="mb-5 rounded-[24px] border border-orange-100 bg-white px-5 py-4 text-sm font-black text-orange-700">
          {message}
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-orange-100 bg-white p-4 shadow-sm">
        <div>
          <p className="text-sm font-black text-orange-950">
            {summary.nodes} nodes · {summary.edges} connections
          </p>
          <p className="mt-1 text-xs font-semibold text-orange-700/70">
            Add nodes from the left and connect them on the canvas.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/architect/workflows"
            className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800"
          >
            Back
          </Link>

          <Link
            href={"/architect/listings/new" as Route}
            className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800"
          >
            Publish Agent
          </Link>

          <button
            type="button"
            onClick={saveWorkflow}
            disabled={saving}
            className="rounded-full bg-orange-500 px-5 py-2 text-sm font-black text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Workflow"}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[220px_1fr_300px]">
        <ArchitectCard title="Nodes">
          <div className="grid gap-2">
            {nodeLibrary.map((item) => (
              <button
                key={item.nodeKind}
                type="button"
                onClick={() => addBuilderNode(item.nodeKind)}
                className="rounded-xl border border-orange-100 bg-white px-3 py-3 text-left transition hover:border-orange-300 hover:bg-orange-50"
              >
                <p className="text-sm font-black text-orange-950">+ {item.label}</p>
                <p className="mt-1 text-xs font-semibold text-orange-800/60">
                  {item.helper}
                </p>
              </button>
            ))}
          </div>
        </ArchitectCard>

        <div className="h-[72vh] overflow-hidden rounded-[24px] border border-orange-100 bg-white shadow-sm">
          <ReactFlow<BuilderNode, Edge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            proOptions={{
              hideAttribution: true
            }}
          >
            <Background color="#fed7aa" gap={20} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <ArchitectCard title="Settings">
          {selectedNode ? (
            <div className="grid gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-orange-600">
                  Selected
                </p>
                <h3 className="mt-1 text-lg font-black text-orange-950">
                  {selectedNode.data.label}
                </h3>
              </div>

              <label className="grid gap-2 text-sm font-black text-orange-950">
                Label
                <input
                  value={selectedNode.data.label}
                  onChange={(event) =>
                    updateSelectedNodeData("label", event.target.value)
                  }
                  className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
              </label>

              <label className="grid gap-2 text-sm font-black text-orange-950">
                Description
                <textarea
                  value={String(selectedNode.data.description ?? "")}
                  onChange={(event) =>
                    updateSelectedNodeData("description", event.target.value)
                  }
                  className="min-h-20 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
              </label>

              {selectedNode.data.nodeKind === "ai" ? (
                <label className="grid gap-2 text-sm font-black text-orange-950">
                  AI Prompt
                  <textarea
                    value={String(selectedNode.data.prompt ?? "")}
                    onChange={(event) =>
                      updateSelectedNodeData("prompt", event.target.value)
                    }
                    className="min-h-28 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                </label>
              ) : null}

              {selectedNode.data.nodeKind === "connector" ? (
                <label className="grid gap-2 text-sm font-black text-orange-950">
                  Connector
                  <select
                    value={String(selectedNode.data.connector ?? "Gmail")}
                    onChange={(event) =>
                      updateSelectedNodeData("connector", event.target.value)
                    }
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                  >
                    <option value="Gmail">Gmail</option>
                    <option value="Google Sheets">Google Sheets</option>
                    <option value="Slack">Slack</option>
                    <option value="CRM">CRM</option>
                    <option value="Webhook">Webhook</option>
                  </select>
                </label>
              ) : null}

              {selectedNode.data.nodeKind === "condition" ? (
                <label className="grid gap-2 text-sm font-black text-orange-950">
                  Condition
                  <input
                    value={String(selectedNode.data.condition ?? "")}
                    onChange={(event) =>
                      updateSelectedNodeData("condition", event.target.value)
                    }
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                </label>
              ) : null}

              {selectedNode.data.nodeKind === "output" ? (
                <label className="grid gap-2 text-sm font-black text-orange-950">
                  Output Key
                  <input
                    value={String(selectedNode.data.outputKey ?? "")}
                    onChange={(event) =>
                      updateSelectedNodeData("outputKey", event.target.value)
                    }
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                </label>
              ) : null}

              <button
                type="button"
                onClick={deleteSelectedNode}
                className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700"
              >
                Delete Node
              </button>
            </div>
          ) : (
            <p className="text-sm font-semibold leading-6 text-orange-900/70">
              Select a node to edit settings.
            </p>
          )}
        </ArchitectCard>
      </div>
    </div>
  );
}