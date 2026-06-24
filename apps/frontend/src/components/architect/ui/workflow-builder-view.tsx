"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
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
import { ArchitectEmptyState } from "@/components/architect/ui/architect-ui";
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

type NodeAttachment = {
  name: string;
};

type BuilderNodeData = {
  [key: string]: unknown;
  label: string;
  nodeKind: NodeKind;
  description?: string;
  prompt?: string;
  connector?: string;
  condition?: string;
  outputKey?: string;
  attachments?: NodeAttachment[];
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

// Brand-colored inline SVG icons (no extra npm dependency required).
function GmailIcon() {
  return (
    <img
      src="/connectors/gmail.png"
      alt="Gmail"
      className="h-6 w-6 object-contain"
    />
  );
}

function GoogleSheetsIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
      <path
        fill="#0f9d58"
        d="M30 4H12a3 3 0 0 0-3 3v34a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V13L30 4z"
      />
      <path fill="#0c8043" d="M30 4l9 9h-9V4z" />
      <path
        fill="#fff"
        d="M16 21h16v15H16V21zm2 2v3h5v-3h-5zm7 0v3h5v-3h-5zm-7 5v3h5v-3h-5zm7 0v3h5v-3h-5z"
      />
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
      <path fill="#36c5f0" d="M19 6a3 3 0 1 0-3 3h3V6z" />
      <path fill="#36c5f0" d="M16 13a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h8a3 3 0 1 0 0-6h-8z" opacity="0" />
      <path fill="#2eb67d" d="M42 19a3 3 0 1 0-3-3v3h3z" />
      <path fill="#ecb22e" d="M29 42a3 3 0 1 0 3-3h-3v3z" />
      <path fill="#e01e5a" d="M6 29a3 3 0 1 0 3 3v-3H6z" />
      <path fill="#36c5f0" d="M22 16a3 3 0 1 0-6 0v6a3 3 0 1 0 6 0v-6z" />
      <path fill="#2eb67d" d="M32 22a3 3 0 1 0 0-6h-6a3 3 0 1 0 0 6h6z" />
      <path fill="#ecb22e" d="M26 32a3 3 0 1 0 6 0v-6a3 3 0 1 0-6 0v6z" />
      <path fill="#e01e5a" d="M16 26a3 3 0 1 0 0 6h6a3 3 0 1 0 0-6h-6z" />
    </svg>
  );
}

function GoogleDriveIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
      <path fill="#1e88e5" d="M16 6L4 28l6 10 12-22L16 6z" opacity="0" />
      <path fill="#ffc107" d="M17 6h14l13 22H30L17 6z" />
      <path fill="#1976d2" d="M44 28l-7 12H11l7-12h26z" />
      <path fill="#4caf50" d="M18 6L4 30l7 10 14-24L18 6z" />
    </svg>
  );
}

function GoogleCalendarIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
      <rect x="9" y="10" width="30" height="30" rx="3" fill="#fff" stroke="#e0e0e0" />
      <path fill="#4285f4" d="M9 13a3 3 0 0 1 3-3h24a3 3 0 0 1 3 3v4H9v-4z" />
      <path fill="#1967d2" d="M9 35h30v2a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3v-2z" opacity="0" />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill="#4285f4"
      >
        31
      </text>
    </svg>
  );
}

function NotionIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
      <rect x="7" y="6" width="34" height="36" rx="4" fill="#fff" stroke="#111" />
      <path
        fill="#111"
        d="M16 16l8 .6L24 32h-3l-.1-9.5L17 32h-1V16zm14 0h3v16h-3l-7-10v10h-3V16h3l7 10V16z"
        opacity="0"
      />
      <path
        fill="#111"
        d="M17 16l8 11V16h3v16h-3l-8-11v11h-3V16h3z"
      />
    </svg>
  );
}

function WebhookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path
        fill="#c73a63"
        d="M10 4a5 5 0 0 0-2 9.58V16h2v-4.3l-.8-.36A3 3 0 1 1 13 8h2A5 5 0 0 0 10 4z"
      />
      <path
        fill="#4b4b4b"
        d="M14.5 9.5l-3.6 6.2 1.7 1 3.6-6.2a3 3 0 1 1 1.8 1.3l-.9 1.7 1.8.9.9-1.7A5 5 0 1 0 14.5 9.5z"
      />
      <path
        fill="#4b4b4b"
        d="M15 16h-3.8a3 3 0 1 1-.6-2.9l1-1.7-1.7-1-1 1.7A5 5 0 1 0 11.2 18H15v-2z"
      />
    </svg>
  );
}

function HttpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="#2563eb" strokeWidth="1.8" />
      <path
        d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"
        fill="none"
        stroke="#2563eb"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const connectorLibrary: {
  id: string;
  label: string;
  helper: string;
  icon: ReactNode;
}[] = [
  { id: "Gmail", label: "Gmail", helper: "Send & read email", icon: <GmailIcon /> },
  {
    id: "Google Sheets",
    label: "Google Sheets",
    helper: "Rows & cells",
    icon: <GoogleSheetsIcon />
  },
  { id: "Slack", label: "Slack", helper: "Post messages", icon: <SlackIcon /> },
  {
    id: "Google Drive",
    label: "Google Drive",
    helper: "Files & folders",
    icon: <GoogleDriveIcon />
  },
  {
    id: "Google Calendar",
    label: "Google Calendar",
    helper: "Events & invites",
    icon: <GoogleCalendarIcon />
  },
  { id: "Notion", label: "Notion", helper: "Pages & databases", icon: <NotionIcon /> },
  { id: "Webhook", label: "Webhook", helper: "Event callback", icon: <WebhookIcon /> },
  { id: "HTTP", label: "HTTP", helper: "Custom request", icon: <HttpIcon /> }
];

function getConnectorIcon(connectorId: string | undefined) {
  return connectorLibrary.find((item) => item.id === connectorId)?.icon ?? null;
}

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
    outputKey: nodeKind === "output" ? "result" : undefined,
    attachments: nodeKind === "ai" ? [] : undefined
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

function normalizeAttachments(value: unknown): NodeAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .map((item) => {
      if (typeof item === "object" && item !== null && "name" in item) {
        const name = (item as { name?: unknown }).name;
        return typeof name === "string" ? { name } : null;
      }

      return null;
    })
    .filter((item): item is NodeAttachment => item !== null);
}

function normalizeNode(node: BuilderNode): BuilderNode {
  const nodeKind = isNodeKind(node.data.nodeKind) ? node.data.nodeKind : "ai";
  const attachments =
    nodeKind === "ai"
      ? normalizeAttachments(node.data.attachments) ?? []
      : undefined;

  return {
    ...node,
    type: node.type ?? getNodeType(nodeKind),
    data: {
      ...getNodeDefaultData(nodeKind),
      ...node.data,
      nodeKind,
      label: String(node.data.label ?? getNodeDefaultData(nodeKind).label),
      attachments
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

type PanelView = "nodes" | "connectors";

export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const [workflow, setWorkflow] = useState<ArchitectWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(emptyNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(emptyEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [connectorSearch, setConnectorSearch] = useState("");
  const [panelView, setPanelView] = useState<PanelView>("nodes");
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

  const filteredConnectors = useMemo(() => {
    const query = connectorSearch.trim().toLowerCase();

    if (!query) return connectorLibrary;

    return connectorLibrary.filter((connector) => {
      return (
        connector.label.toLowerCase().includes(query) ||
        connector.helper.toLowerCase().includes(query)
      );
    });
  }, [connectorSearch]);

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

  function addBuilderNode(nodeKind: NodeKind, overrides?: Partial<BuilderNodeData>) {
    const id = `${nodeKind}-${Date.now()}`;

    const newNode: BuilderNode = {
      id,
      type: getNodeType(nodeKind),
      position: {
        x: 140 + nodes.length * 36,
        y: 140 + nodes.length * 28
      },
      data: {
        ...getNodeDefaultData(nodeKind),
        ...overrides
      }
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(id);
  }

  function handleNodeLibraryClick(nodeKind: NodeKind) {
    // Connector drills into a sub-list instead of adding immediately.
    if (nodeKind === "connector") {
      setConnectorSearch("");
      setPanelView("connectors");
      return;
    }

    addBuilderNode(nodeKind);
  }

  function addConnectorNode(connectorId: string) {
    addBuilderNode("connector", {
      connector: connectorId,
      label: connectorId,
      description: `${connectorId} connector`
    });
  }

  function updateSelectedNodeData(
    field: keyof BuilderNodeData,
    value: BuilderNodeData[keyof BuilderNodeData]
  ) {
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

  function addSelectedNodeAttachments(files: FileList | null) {
    if (!files || files.length === 0) return;

    const incoming = Array.from(files).map((file) => ({ name: file.name }));
    const current = selectedNode?.data.attachments ?? [];

    updateSelectedNodeData("attachments", [...current, ...incoming]);
  }

  function removeSelectedNodeAttachment(index: number) {
    const current = selectedNode?.data.attachments ?? [];

    updateSelectedNodeData(
      "attachments",
      current.filter((_, itemIndex) => itemIndex !== index)
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
        {panelView === "nodes" ? (
          <>
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
                    onClick={() => handleNodeLibraryClick(item.nodeKind)}
                    className="group min-h-[112px] rounded-2xl border border-orange-100 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-50 text-sm font-black text-orange-700 group-hover:bg-orange-100">
                      {item.icon}
                    </div>

                    <p className="mt-3 flex items-center gap-1 text-sm font-black text-orange-950">
                      {item.nodeKind === "connector" ? item.label : `+ ${item.label}`}
                      {item.nodeKind === "connector" ? (
                        <span className="text-orange-400">›</span>
                      ) : null}
                    </p>

                    <p className="mt-1 text-xs font-semibold leading-4 text-orange-900/55">
                      {item.helper}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-orange-100 p-3">
              <button
                type="button"
                onClick={() => setPanelView("nodes")}
                className="mb-3 flex items-center gap-2 text-sm font-black text-orange-950 transition hover:text-orange-600"
              >
                <span className="text-lg leading-none">←</span>
                Connectors
              </button>

              <div className="flex h-12 items-center gap-2 rounded-2xl border border-orange-100 bg-white px-3 shadow-sm">
                <span className="flex h-5 w-5 items-center justify-center text-orange-400">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="m20 20-3-3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>

                <input
                  value={connectorSearch}
                  onChange={(event) => setConnectorSearch(event.target.value)}
                  placeholder="Search connectors"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-orange-950 outline-none placeholder:text-orange-950/40"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-orange-500">
                Choose a connector
              </p>

              <div className="grid grid-cols-2 gap-2">
                {filteredConnectors.map((connector) => (
                  <button
                    key={connector.id}
                    type="button"
                    onClick={() => addConnectorNode(connector.id)}
                    className="group min-h-[112px] rounded-2xl border border-orange-100 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-50 group-hover:bg-orange-100">
                      {connector.icon}
                    </div>

                    <p className="mt-3 text-sm font-black text-orange-950">
                      {connector.label}
                    </p>

                    <p className="mt-1 text-xs font-semibold leading-4 text-orange-900/55">
                      {connector.helper}
                    </p>
                  </button>
                ))}

                {filteredConnectors.length === 0 ? (
                  <p className="col-span-2 rounded-xl border border-dashed border-orange-200 bg-orange-50/60 px-3 py-4 text-center text-xs font-semibold text-orange-900/60">
                    No connectors match your search.
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}

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

        <div className="min-h-0 flex-1 p-6 pt-20">
          <div
            className="h-full w-full overflow-hidden rounded-sm border-2 border-orange-400 bg-white shadow-sm"
            style={{ height: "100%", width: "100%" }}
          >
            <ReactFlow<BuilderNode, Edge>
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              style={{ height: "100%", width: "100%" }}
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
                <>
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

                  <div className="grid gap-2 text-sm font-bold text-orange-950">
                    Attachments

                    {(selectedNode.data.attachments ?? []).length > 0 ? (
                      <ul className="grid gap-1.5">
                        {(selectedNode.data.attachments ?? []).map((attachment, index) => (
                          <li
                            key={`${attachment.name}-${index}`}
                            className="flex items-center justify-between gap-2 rounded-xl border border-orange-100 bg-yellow-50/60 px-3 py-2 text-xs font-semibold text-orange-900"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="text-orange-500">📎</span>
                              <span className="truncate">{attachment.name}</span>
                            </span>

                            <button
                              type="button"
                              onClick={() => removeSelectedNodeAttachment(index)}
                              className="shrink-0 rounded-lg px-1.5 text-sm font-black text-orange-500 transition hover:text-red-500"
                              aria-label={`Remove ${attachment.name}`}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl border border-dashed border-orange-200 bg-orange-50/50 px-3 py-2 text-xs font-semibold text-orange-900/55">
                        No attachments yet.
                      </p>
                    )}

                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-xs font-black text-orange-700 transition hover:bg-yellow-50">
                      + Add attachment
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          addSelectedNodeAttachments(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {selectedNode.data.nodeKind === "connector" ? (
                <label className="grid gap-2 text-sm font-bold text-orange-950">
                  Connector
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-50">
                      {getConnectorIcon(String(selectedNode.data.connector ?? "Gmail"))}
                    </span>

                    <select
                      value={String(selectedNode.data.connector ?? "Gmail")}
                      onChange={(event) =>
                        updateSelectedNodeData("connector", event.target.value)
                      }
                      className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    >
                      {connectorLibrary.map((connector) => (
                        <option key={connector.id} value={connector.id}>
                          {connector.label}
                        </option>
                      ))}
                    </select>
                  </div>
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
