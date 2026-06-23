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
  ArchitectEmptyState,
  ArchitectField,
  ArchitectTextarea
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
  icon: string;
}[] = [
  {
    nodeKind: "trigger",
    label: "Trigger",
    helper: "Start workflow",
    icon: "⚡"
  },
  {
    nodeKind: "ai",
    label: "AI Prompt",
    helper: "Use AI step",
    icon: "✨"
  },
  {
    nodeKind: "condition",
    label: "Condition",
    helper: "Add logic",
    icon: "◆"
  },
  {
    nodeKind: "connector",
    label: "Connector",
    helper: "External action",
    icon: "⌁"
  },
  {
    nodeKind: "approval",
    label: "Approval",
    helper: "Human check",
    icon: "✓"
  },
  {
    nodeKind: "output",
    label: "Output",
    helper: "Final result",
    icon: "↗"
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
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedNode = useMemo(() => {
    return nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const filteredNodes = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) return nodeLibrary;

    return nodeLibrary.filter((node) => {
      return (
        node.label.toLowerCase().includes(query) ||
        node.helper.toLowerCase().includes(query)
      );
    });
  }, [searchTerm]);

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
        x: 140 + nodes.length * 36,
        y: 140 + nodes.length * 28
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
      setMessage(result.error ?? "Could not save agent");
      setSaving(false);
      return;
    }

    setMessage("Agent saved successfully");
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-104px)] items-center justify-center">
        <div className="rounded-2xl border border-orange-100 bg-white px-5 py-3 text-sm font-black text-orange-700 shadow-sm">
          Loading builder...
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <ArchitectEmptyState
        title="Agent not found"
        text="This agent canvas may not exist or may not belong to this architect account."
        actionLabel="Back to Builder"
        actionHref="/architect/workflows"
      />
    );
  }

  return (
    <div className="-mx-5 -my-6 flex h-[calc(100vh-73px)] overflow-hidden bg-[#f2f3f7]">
      <aside className="flex w-[304px] shrink-0 flex-col border-r border-orange-100 bg-white">
        <div className="border-b border-orange-100 p-3">
          <div className="flex h-12 items-center gap-2 rounded-2xl border border-orange-100 bg-white px-3 shadow-sm">
            <span className="text-xl font-light text-orange-950">+</span>

            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search nodes"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-orange-950 outline-none placeholder:text-orange-950/40"
            />

            <span className="flex h-7 w-7 items-center justify-center rounded-full text-orange-700">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M18 11a6 6 0 0 1-12 0M12 17v4M9 21h6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-sm font-black text-orange-950 transition hover:bg-yellow-50"
            >
              ✨ Generate
            </button>

            <button
              type="button"
              className="rounded-xl bg-gradient-to-br from-orange-500 to-yellow-400 px-3 py-2.5 text-sm font-black text-white shadow-sm shadow-orange-200 transition hover:scale-[1.01]"
            >
              Search
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-orange-500">
            Nodes
          </p>

          <div className="grid grid-cols-2 gap-2">
            {filteredNodes.map((item) => (
              <button
                key={item.nodeKind}
                type="button"
                onClick={() => addBuilderNode(item.nodeKind)}
                className="group min-h-[112px] rounded-2xl border border-orange-100 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-50 text-sm font-black text-orange-700 group-hover:bg-orange-100">
                  {item.icon}
                </div>

                <p className="mt-3 text-sm font-black text-orange-950">
                  + {item.label}
                </p>

                <p className="mt-1 text-xs font-semibold leading-4 text-orange-900/55">
                  {item.helper}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-orange-100 p-3">
          <Link
            href="/architect/workflows"
            className="flex w-full items-center justify-center rounded-xl border border-orange-100 bg-white px-4 py-2.5 text-sm font-black text-orange-800 transition hover:bg-yellow-50"
          >
            Back
          </Link>
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute left-5 top-5 z-20 flex items-center gap-2">
          <div className="max-w-[360px] truncate rounded-xl border border-orange-100 bg-white px-4 py-2 text-sm font-black text-orange-950 shadow-sm">
            {workflow.name}
          </div>

          {message ? (
            <div className="rounded-xl border border-orange-100 bg-white px-4 py-2 text-xs font-black text-orange-700 shadow-sm">
              {message}
            </div>
          ) : null}
        </div>

        <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
          <Link
            href={`/architect/agents/publish?workflowId=${workflowId}` as Route}
            className="rounded-xl border border-orange-100 bg-white px-4 py-2 text-sm font-black text-orange-800 shadow-sm transition hover:bg-yellow-50"
          >
            Publish
          </Link>

          <button
            type="button"
            onClick={saveWorkflow}
            disabled={saving}
            className="rounded-xl bg-gradient-to-br from-orange-500 to-yellow-400 px-5 py-2 text-sm font-black text-white shadow-sm shadow-orange-200 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="h-full p-6 pt-20">
          <div className="h-full overflow-hidden rounded-sm border-2 border-orange-400 bg-white shadow-sm">
            <ReactFlow<BuilderNode, Edge>
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              proOptions={{
                hideAttribution: true
              }}
            >
              <Background color="#fed7aa" gap={22} />
              <Controls />
              <MiniMap />
            </ReactFlow>
          </div>
        </div>

        {selectedNode ? (
          <aside className="absolute bottom-5 right-5 top-20 z-30 w-[320px] overflow-y-auto rounded-2xl border border-orange-100 bg-white p-4 shadow-xl shadow-orange-950/10">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-500">
                  Settings
                </p>
                <h3 className="mt-1 text-lg font-black text-orange-950">
                  {selectedNode.data.label}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-yellow-50 text-sm font-black text-orange-700"
              >
                ×
              </button>
            </div>

            <div className="grid gap-4">
              <ArchitectField
                name="label"
                label="Label"
                defaultValue={selectedNode.data.label}
                key={`${selectedNode.id}-label`}
              />

              <label className="grid gap-2 text-sm font-bold text-orange-950">
                Label
                <input
                  value={selectedNode.data.label}
                  onChange={(event) =>
                    updateSelectedNodeData("label", event.target.value)
                  }
                  className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <ArchitectTextarea
                name="description-hidden"
                label="Description"
                defaultValue={String(selectedNode.data.description ?? "")}
                key={`${selectedNode.id}-description-hidden`}
              />

              <label className="grid gap-2 text-sm font-bold text-orange-950">
                Description
                <textarea
                  value={String(selectedNode.data.description ?? "")}
                  onChange={(event) =>
                    updateSelectedNodeData("description", event.target.value)
                  }
                  className="min-h-24 resize-y rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
              </label>

              {selectedNode.data.nodeKind === "ai" ? (
                <label className="grid gap-2 text-sm font-bold text-orange-950">
                  AI Prompt
                  <textarea
                    value={String(selectedNode.data.prompt ?? "")}
                    onChange={(event) =>
                      updateSelectedNodeData("prompt", event.target.value)
                    }
                    className="min-h-32 resize-y rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </label>
              ) : null}

              {selectedNode.data.nodeKind === "connector" ? (
                <label className="grid gap-2 text-sm font-bold text-orange-950">
                  Connector
                  <select
                    value={String(selectedNode.data.connector ?? "Gmail")}
                    onChange={(event) =>
                      updateSelectedNodeData("connector", event.target.value)
                    }
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
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
                <label className="grid gap-2 text-sm font-bold text-orange-950">
                  Condition
                  <input
                    value={String(selectedNode.data.condition ?? "")}
                    onChange={(event) =>
                      updateSelectedNodeData("condition", event.target.value)
                    }
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </label>
              ) : null}

              {selectedNode.data.nodeKind === "output" ? (
                <label className="grid gap-2 text-sm font-bold text-orange-950">
                  Output Key
                  <input
                    value={String(selectedNode.data.outputKey ?? "")}
                    onChange={(event) =>
                      updateSelectedNodeData("outputKey", event.target.value)
                    }
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </label>
              ) : null}

              <button
                type="button"
                onClick={deleteSelectedNode}
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-100"
              >
                Delete Node
              </button>
            </div>
          </aside>
        ) : null}
      </section>
    </div>
  );
}