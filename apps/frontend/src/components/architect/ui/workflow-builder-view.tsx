"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArchitectEmptyState } from "@/components/architect/ui/architect-ui";
import {
  getArchitectWorkflow,
  runArchitectWorkflowTest,
  updateArchitectWorkflow
} from "@/components/architect/features/api";
import type {
  ArchitectWorkflow,
  WorkflowRunLog
} from "@/components/architect/features/types";

type BuilderTab = "build" | "test" | "configure" | "publish";

type NodeKind = "trigger" | "ai" | "condition" | "connector" | "output";

type NodeAccent =
  | "amber"
  | "violet"
  | "orange"
  | "green"
  | "blue"
  | "slate";

type MissedCallNodeData = Record<string, unknown> & {
  label: string;
  title: string;
  subtitle?: string;
  footer?: string;
  nodeKind: NodeKind;
  kind: string;
  accent: NodeAccent;
  icon: string;
  prompt?: string;
  condition?: string;
  connector?: string;
  connectorAction?: string;
  smsTo?: string;
  smsBody?: string;
  sendAt?: string;
  outputKey?: string;
};

type MissedCallNode = Node<MissedCallNodeData>;

const accentStyles: Record<
  NodeAccent,
  {
    ring: string;
    icon: string;
    chip: string;
    handle: string;
  }
> = {
  amber: {
    ring: "border-amber-200 bg-amber-50 text-amber-700",
    icon: "bg-amber-500 text-white",
    chip: "bg-amber-50 text-amber-700 border-amber-100",
    handle: "#f59e0b"
  },
  violet: {
    ring: "border-violet-200 bg-violet-50 text-violet-700",
    icon: "bg-violet-500 text-white",
    chip: "bg-violet-50 text-violet-700 border-violet-100",
    handle: "#8b5cf6"
  },
  orange: {
    ring: "border-orange-200 bg-orange-50 text-orange-700",
    icon: "bg-orange-500 text-white",
    chip: "bg-orange-50 text-orange-700 border-orange-100",
    handle: "#f97316"
  },
  green: {
    ring: "border-green-200 bg-green-50 text-green-700",
    icon: "bg-green-500 text-white",
    chip: "bg-green-50 text-green-700 border-green-100",
    handle: "#22c55e"
  },
  blue: {
    ring: "border-blue-200 bg-blue-50 text-blue-700",
    icon: "bg-blue-500 text-white",
    chip: "bg-blue-50 text-blue-700 border-blue-100",
    handle: "#3b82f6"
  },
  slate: {
    ring: "border-slate-200 bg-slate-50 text-slate-700",
    icon: "bg-slate-500 text-white",
    chip: "bg-slate-50 text-slate-700 border-slate-100",
    handle: "#64748b"
  }
};

const libraryGroups: {
  title: string;
  items: {
    nodeKind: NodeKind;
    label: string;
    helper: string;
    icon: string;
    accent: NodeAccent;
    overrides?: Partial<MissedCallNodeData>;
  }[];
}[] = [
  {
    title: "Triggers",
    items: [
      {
        nodeKind: "trigger",
        label: "Missed Call",
        helper: "When a call is not answered",
        icon: "phone",
        accent: "amber",
        overrides: {
          title: "Missed Call Detected",
          subtitle: "caller_number · timestamp",
          footer: "Trigger"
        }
      }
    ]
  },
  {
    title: "AI",
    items: [
      {
        nodeKind: "ai",
        label: "AI Text Reply",
        helper: "Generate personalized SMS",
        icon: "sparkles",
        accent: "violet",
        overrides: {
          title: "Generate Personalized SMS",
          subtitle: "Uses business tone + caller context"
        }
      }
    ]
  },
  {
    title: "Logic",
    items: [
      {
        nodeKind: "condition",
        label: "Business Hours",
        helper: "Route yes/no paths",
        icon: "diamond",
        accent: "orange",
        overrides: {
          title: "Is Business Hours?",
          subtitle: "Check: 8AM–6PM, Mon–Fri",
          condition: "8AM–6PM, Monday–Friday"
        }
      }
    ]
  },
  {
    title: "Actions",
    items: [
      {
        nodeKind: "connector",
        label: "Send SMS Now",
        helper: "Text caller immediately",
        icon: "message",
        accent: "green",
        overrides: {
          title: "Send SMS Now",
          subtitle: "To: {{caller_number}}",
          connector: "SMS",
          connectorAction: "send_sms",
          smsTo: "{{caller_number}}",
          smsBody:
            "Hi! We noticed we missed your call at {{business.name}}. Sorry about that! Would you like to schedule an appointment? Reply YES and we’ll get you booked."
        }
      },
      {
        nodeKind: "connector",
        label: "Queue SMS",
        helper: "Send next morning",
        icon: "clock",
        accent: "blue",
        overrides: {
          title: "Queue for Morning",
          subtitle: "Send at: 8:00 AM next day",
          connector: "SMS",
          connectorAction: "queue_sms",
          smsTo: "{{caller_number}}",
          smsBody:
            "Hi! We noticed we missed your call at {{business.name}}. We’ll text you first thing in the morning to help you schedule.",
          sendAt: "8:00 AM next business day"
        }
      }
    ]
  }
];

function Icon({ name, className }: { name: string; className?: string }) {
  const common = "h-4 w-4";

  if (name === "phone") {
    return (
      <svg className={className ?? common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }

  if (name === "sparkles") {
    return (
      <svg className={className ?? common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
        <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
      </svg>
    );
  }

  if (name === "diamond") {
    return (
      <svg className={className ?? common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l9 9-9 9-9-9 9-9z" />
      </svg>
    );
  }

  if (name === "message") {
    return (
      <svg className={className ?? common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg className={className ?? common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  return (
    <svg className={className ?? common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function CoreNode({ data, selected }: NodeProps<MissedCallNode>) {
  const styles = accentStyles[data.accent] ?? accentStyles.slate;
  const isCondition = data.nodeKind === "condition";
  const hasInput = data.nodeKind !== "trigger";

  return (
    <div className={`group relative w-[256px] outline-none ${selected ? "scale-[1.01]" : ""}`}>
      {hasInput ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3.5 !w-3.5 !border-[3px] !border-white"
          style={{ background: styles.handle }}
        />
      ) : null}

      <div
        className={`rounded-2xl border bg-white shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-xl ${
          selected
            ? "border-amber-300 shadow-[0_0_0_3px_rgba(251,191,36,.35),0_18px_36px_-18px_rgba(15,23,42,.35)]"
            : "border-gray-100"
        }`}
      >
        <div className="flex items-start gap-3 p-4">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${styles.icon}`}>
            <Icon name={data.icon} className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${styles.chip}`}>
                {data.kind}
              </span>
            </div>

            <p className="mt-2 truncate text-sm font-black text-slate-900">
              {data.title}
            </p>

            {data.subtitle ? (
              <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-slate-500">
                {data.subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {data.footer ? (
          <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 px-4 py-2">
            <span className="font-mono text-[11px] text-slate-400">
              {data.footer}
            </span>
          </div>
        ) : null}
      </div>

      {isCondition ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            className="!h-3.5 !w-3.5 !border-[3px] !border-white"
            style={{ left: "30%", background: "#22c55e" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            className="!h-3.5 !w-3.5 !border-[3px] !border-white"
            style={{ left: "70%", background: "#ef4444" }}
          />
          <span className="absolute -bottom-7 left-[30%] -translate-x-1/2 text-[10px] font-black text-green-600">
            Yes
          </span>
          <span className="absolute -bottom-7 left-[70%] -translate-x-1/2 text-[10px] font-black text-red-500">
            No
          </span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3.5 !w-3.5 !border-[3px] !border-white"
          style={{ background: styles.handle }}
        />
      )}
    </div>
  );
}

function defaultNodeData(
  nodeKind: NodeKind,
  overrides?: Partial<MissedCallNodeData>
): MissedCallNodeData {
  const base: MissedCallNodeData = {
    label: "Node",
    title: "Node",
    nodeKind,
    kind: nodeKind.toUpperCase(),
    accent: "slate",
    icon: "message",
    subtitle: "",
    footer: ""
  };

  if (nodeKind === "trigger") {
    return {
      ...base,
      label: "Missed Call Detected",
      title: "Missed Call Detected",
      kind: "TRIGGER",
      icon: "phone",
      accent: "amber",
      subtitle: "caller_number · timestamp",
      footer: "Incoming call not answered",
      ...overrides
    };
  }

  if (nodeKind === "ai") {
    return {
      ...base,
      label: "Generate Personalized SMS",
      title: "Generate Personalized SMS",
      kind: "AI PROCESS",
      icon: "sparkles",
      accent: "violet",
      subtitle: "Uses business tone + caller context",
      prompt:
        "Write a friendly SMS reply for a missed caller. Mention the business name, apologize briefly, and ask if they want help booking an appointment.",
      ...overrides
    };
  }

  if (nodeKind === "condition") {
    return {
      ...base,
      label: "Is Business Hours?",
      title: "Is Business Hours?",
      kind: "CONDITION",
      icon: "diamond",
      accent: "orange",
      subtitle: "Check: 8AM–6PM, Mon–Fri",
      condition: "8AM–6PM, Monday–Friday",
      ...overrides
    };
  }

  if (nodeKind === "connector") {
    return {
      ...base,
      label: "Send SMS Now",
      title: "Send SMS Now",
      kind: "ACTION",
      icon: "message",
      accent: "green",
      subtitle: "To: {{caller_number}}",
      connector: "SMS",
      connectorAction: "send_sms",
      smsTo: "{{caller_number}}",
      smsBody:
        "Hi! We noticed we missed your call at {{business.name}}. Sorry about that! Would you like to schedule an appointment? Reply YES and we’ll get you booked.",
      ...overrides
    };
  }

  return {
    ...base,
    label: "Output",
    title: "Output",
    kind: "OUTPUT",
    icon: "message",
    accent: "slate",
    outputKey: "missedCallTextBackResult",
    ...overrides
  };
}

function createMissedCallTextBackFlow() {
  const nodes: MissedCallNode[] = [
    {
      id: "trigger",
      type: "coreNode",
      position: { x: 120, y: 260 },
      data: defaultNodeData("trigger")
    },
    {
      id: "ai",
      type: "coreNode",
      position: { x: 430, y: 260 },
      data: defaultNodeData("ai")
    },
    {
      id: "condition",
      type: "coreNode",
      position: { x: 740, y: 260 },
      data: defaultNodeData("condition")
    },
    {
      id: "actionYes",
      type: "coreNode",
      position: { x: 1050, y: 160 },
      data: defaultNodeData("connector", {
        label: "Send SMS Now",
        title: "Send SMS Now",
        kind: "ACTION",
        icon: "message",
        accent: "green",
        subtitle: "To: {{caller_number}}",
        connector: "SMS",
        connectorAction: "send_sms",
        smsTo: "{{caller_number}}",
        smsBody:
          "Hi! We noticed we missed your call at Mitchell Dental. Sorry about that! Would you like to schedule an appointment? Reply YES and we’ll get you booked. 😊"
      })
    },
    {
      id: "actionNo",
      type: "coreNode",
      position: { x: 1050, y: 420 },
      data: defaultNodeData("connector", {
        label: "Queue for Morning",
        title: "Queue for Morning",
        kind: "ACTION",
        icon: "clock",
        accent: "blue",
        subtitle: "Send at: 8:00 AM next day",
        connector: "SMS",
        connectorAction: "queue_sms",
        smsTo: "{{caller_number}}",
        smsBody:
          "Hi! We noticed we missed your call at Mitchell Dental. We’ll text you first thing in the morning to help you schedule.",
        sendAt: "8:00 AM next business day"
      })
    }
  ];

  const edges: Edge[] = [
    {
      id: "c1",
      source: "trigger",
      target: "ai",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#f59e0b", strokeWidth: 2.5 }
    },
    {
      id: "c2",
      source: "ai",
      target: "condition",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#8b5cf6", strokeWidth: 2.5 }
    },
    {
      id: "c3",
      source: "condition",
      sourceHandle: "yes",
      target: "actionYes",
      label: "Yes",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#22c55e", strokeWidth: 2.5 }
    },
    {
      id: "c4",
      source: "condition",
      sourceHandle: "no",
      target: "actionNo",
      label: "No",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#ef4444", strokeWidth: 2.5 }
    }
  ];

  return { nodes, edges };
}

function isMissedCallNode(value: unknown): value is MissedCallNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<MissedCallNode>;
  return typeof node.id === "string" && typeof node.data === "object";
}

function normalizeNode(node: MissedCallNode): MissedCallNode {
  const nodeKind =
    node.data.nodeKind === "trigger" ||
    node.data.nodeKind === "ai" ||
    node.data.nodeKind === "condition" ||
    node.data.nodeKind === "connector" ||
    node.data.nodeKind === "output"
      ? node.data.nodeKind
      : "connector";

  return {
    ...node,
    type: "coreNode",
    data: {
      ...defaultNodeData(nodeKind),
      ...node.data,
      nodeKind
    }
  };
}

function isEdge(value: unknown): value is Edge {
  if (typeof value !== "object" || value === null) return false;
  const edge = value as Partial<Edge>;
  return typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string";
}

function parseNodes(workflow: ArchitectWorkflow | null): MissedCallNode[] {
  const rawNodes = workflow?.workflowJson?.nodes;

  if (Array.isArray(rawNodes) && rawNodes.length > 0) {
    return rawNodes.filter(isMissedCallNode).map(normalizeNode);
  }

  return createMissedCallTextBackFlow().nodes;
}

function parseEdges(workflow: ArchitectWorkflow | null): Edge[] {
  const rawEdges = workflow?.workflowJson?.edges;

  if (Array.isArray(rawEdges) && rawEdges.length > 0) {
    return rawEdges.filter(isEdge);
  }

  return createMissedCallTextBackFlow().edges;
}

function formatRunLogColor(status: WorkflowRunLog["status"]) {
  if (status === "error") return "text-red-300";
  if (status === "waiting") return "text-amber-300";
  return "text-green-300";
}

export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const [workflow, setWorkflow] = useState<ArchitectWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<MissedCallNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BuilderTab>("build");
  const [searchTerm, setSearchTerm] = useState("");
  const [runLogs, setRunLogs] = useState<WorkflowRunLog[]>([]);
  const [agentName, setAgentName] = useState("Missed Call Text-Back");
  const [tagline, setTagline] = useState("Never lose a patient to a missed call again.");
  const [price, setPrice] = useState("149");
  const [businessName, setBusinessName] = useState("Mitchell Dental");
  const [callerNumber, setCallerNumber] = useState("+1 (415) 555-0132");
  const [callerName, setCallerName] = useState("Jordan Lee");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Saved just now");

  const nodeTypes = useMemo(() => ({ coreNode: CoreNode }), []);

  const selectedNode = useMemo(() => {
    return nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const filteredLibraryGroups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) return libraryGroups;

    return libraryGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          return (
            item.label.toLowerCase().includes(query) ||
            item.helper.toLowerCase().includes(query)
          );
        })
      }))
      .filter((group) => group.items.length > 0);
  }, [searchTerm]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#f59e0b", strokeWidth: 2.5 }
          },
          currentEdges
        )
      );
    },
    [setEdges]
  );

  async function loadWorkflow() {
    setLoading(true);

    const result = await getArchitectWorkflow(workflowId);

    if (result.success && result.data) {
      const loadedWorkflow = result.data.workflow;
      const parsedNodes = parseNodes(loadedWorkflow);
      const parsedEdges = parseEdges(loadedWorkflow);

      setWorkflow(loadedWorkflow);
      setAgentName(loadedWorkflow.name || "Missed Call Text-Back");
      setTagline(loadedWorkflow.description || "Never lose a patient to a missed call again.");
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setSelectedNodeId(parsedNodes[0]?.id ?? null);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadWorkflow();
  }, [workflowId]);

  function addNodeFromLibrary(
    nodeKind: NodeKind,
    overrides?: Partial<MissedCallNodeData>
  ) {
    const id = `${nodeKind}-${Date.now()}`;
    const newNode: MissedCallNode = {
      id,
      type: "coreNode",
      position: {
        x: 160 + nodes.length * 52,
        y: 160 + nodes.length * 36
      },
      data: defaultNodeData(nodeKind, overrides)
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(id);
  }

  function resetToMissedCallFlow() {
    const confirmed =
      nodes.length === 0 ||
      window.confirm("Replace the current canvas with the Missed Call Text-Back flow?");

    if (!confirmed) return;

    const flow = createMissedCallTextBackFlow();
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNodeId("trigger");
    setActiveTab("build");
    setRunLogs([]);
    setMessage("Missed Call Text-Back flow loaded");
  }

  function updateSelectedNodeData(
    field: keyof MissedCallNodeData,
    value: MissedCallNodeData[keyof MissedCallNodeData]
  ) {
    if (!selectedNodeId) return;

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== selectedNodeId) return node;

        return {
          ...node,
          data: {
            ...node.data,
            [field]: value,
            ...(field === "title" ? { label: String(value) } : {})
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

  async function saveAgent(showMessage = true) {
    setSaving(true);

    const result = await updateArchitectWorkflow(workflowId, {
      name: agentName,
      description: tagline,
      workflowJson: {
        nodes,
        edges
      }
    });

    setSaving(false);

    if (!result.success) {
      setMessage(result.error ?? "Could not save agent");
      return false;
    }

    if (showMessage) setMessage("Saved just now");
    return true;
  }

  async function runTest() {
    setRunning(true);
    setMessage("Running test...");
    setRunLogs([]);

    const saved = await saveAgent(false);

    if (!saved) {
      setRunning(false);
      return;
    }

    const result = await runArchitectWorkflowTest(workflowId);

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Could not run test");
      setRunning(false);
      return;
    }

    setRunLogs(result.data.run.logs);
    setMessage("Test complete");
    setActiveTab("test");
    setRunning(false);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-104px)] items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-amber-100 bg-white px-5 py-3 text-sm font-black text-amber-700 shadow-sm">
          Loading Missed Call Text-Back builder...
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
    <div className="-mx-5 -my-6 h-[calc(100vh-73px)] overflow-hidden bg-slate-50 text-slate-900">
      <header className="flex h-14 items-stretch border-b border-gray-200 bg-white px-3">
        <div className="flex items-center gap-2.5 pr-1">
          <Link
            href="/architect/workflows"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
            aria-label="Back to dashboard"
          >
            <Icon name="phone" className="h-[18px] w-[18px] rotate-[-135deg]" />
          </Link>

          <div className="h-6 w-px bg-gray-200" />

          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-amber-500 text-[11px] font-extrabold text-white shadow-sm">
            C
          </div>

          <input
            value={agentName}
            onChange={(event) => setAgentName(event.target.value)}
            className="w-[220px] rounded-sm border-b border-transparent bg-transparent px-0.5 text-[15px] font-semibold text-slate-900 outline-none transition hover:border-amber-300 focus:border-amber-400"
          />

          <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
            Draft
          </span>

          <span className="ml-1 flex items-center gap-1.5 text-xs text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {message}
          </span>
        </div>

        <div className="ml-5 flex items-stretch">
          {(["build", "test", "configure", "publish"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center border-b-2 px-4 text-sm capitalize transition ${
                activeTab === tab
                  ? "border-amber-500 font-semibold text-amber-600"
                  : "border-transparent font-medium text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab("test")}
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-3.5 py-2 text-sm text-slate-600 transition hover:border-amber-300 hover:text-slate-800"
          >
            <Icon name="message" className="h-4 w-4" />
            Preview
          </button>

          <button
            type="button"
            onClick={runTest}
            disabled={running}
            className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
          >
            ▶ {running ? "Running..." : "Test Run"}
          </button>

          <Link
            href={`/architect/agents/publish?workflowId=${workflowId}` as Route}
            className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
          >
            Publish to Marketplace
          </Link>

          <div className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700 shadow-sm ring-2 ring-white">
            MT
          </div>
        </div>
      </header>

      <main className="relative h-[calc(100%-56px)] overflow-hidden">
        {activeTab === "build" ? (
          <section className="absolute inset-0 flex">
            <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-100 bg-white">
              <div className="px-4 pt-4">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                  </span>

                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search components..."
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-400/50"
                  />
                </div>

                <button
                  type="button"
                  onClick={resetToMissedCallFlow}
                  className="mt-4 w-full rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 px-4 py-3 text-left text-sm font-black text-white shadow-sm shadow-amber-500/25 transition hover:-translate-y-0.5"
                >
                  Missed Call Text-Back
                  <span className="mt-1 block text-xs font-semibold text-white/80">
                    Trigger → AI → Hours → SMS
                  </span>
                </button>
              </div>

              <div className="px-4 py-4">
                {filteredLibraryGroups.map((group) => (
                  <div key={group.title} className="mb-5">
                    <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
                      {group.title}
                    </p>

                    <div className="space-y-2">
                      {group.items.map((item) => {
                        const styles = accentStyles[item.accent];

                        return (
                          <button
                            key={`${group.title}-${item.label}`}
                            type="button"
                            onClick={() =>
                              addNodeFromLibrary(item.nodeKind, {
                                ...item.overrides,
                                accent: item.accent,
                                icon: item.icon
                              })
                            }
                            className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md"
                          >
                            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${styles.icon}`}>
                              <Icon name={item.icon} className="h-5 w-5" />
                            </span>

                            <span className="min-w-0">
                              <span className="block text-sm font-black text-slate-900">
                                {item.label}
                              </span>
                              <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                {item.helper}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-gray-100 px-4 py-4">
                <p className="flex items-center gap-1.5 text-xs italic text-slate-400">
                  Drag or click components onto the canvas →
                </p>
              </div>
            </aside>

            <div className="relative flex-1 overflow-hidden bg-[#f7f8fa]">
              <div className="absolute right-4 top-4 z-10 hidden items-center gap-3 rounded-xl border border-gray-200 bg-white/90 px-3 py-2 text-[11px] text-slate-500 shadow-sm backdrop-blur md:flex">
                <span>
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">
                    Scroll
                  </kbd>{" "}
                  zoom
                </span>
                <span>
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">
                    Space
                  </kbd>{" "}
                  pan
                </span>
              </div>

              <ReactFlow<MissedCallNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#cbd5e1" gap={22} size={1} />
                <Controls />
                <MiniMap />
              </ReactFlow>
            </div>

            <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-100 bg-white">
              {selectedNode ? (
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                        Properties
                      </p>
                      <h3 className="mt-1 text-lg font-black text-slate-900">
                        {selectedNode.data.title}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedNodeId(null)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-5 space-y-4">
                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Name
                      </span>
                      <input
                        value={selectedNode.data.title}
                        onChange={(event) =>
                          updateSelectedNodeData("title", event.target.value)
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Subtitle
                      </span>
                      <input
                        value={selectedNode.data.subtitle ?? ""}
                        onChange={(event) =>
                          updateSelectedNodeData("subtitle", event.target.value)
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                      />
                    </label>

                    {selectedNode.data.nodeKind === "ai" ? (
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Prompt
                        </span>
                        <textarea
                          value={selectedNode.data.prompt ?? ""}
                          onChange={(event) =>
                            updateSelectedNodeData("prompt", event.target.value)
                          }
                          className="min-h-36 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                        />
                      </label>
                    ) : null}

                    {selectedNode.data.nodeKind === "condition" ? (
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Condition
                        </span>
                        <input
                          value={selectedNode.data.condition ?? ""}
                          onChange={(event) =>
                            updateSelectedNodeData("condition", event.target.value)
                          }
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                        />
                      </label>
                    ) : null}

                    {selectedNode.data.nodeKind === "connector" ? (
                      <div className="space-y-4 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                        <label className="block">
                          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            SMS Action
                          </span>
                          <select
                            value={selectedNode.data.connectorAction ?? "send_sms"}
                            onChange={(event) =>
                              updateSelectedNodeData("connectorAction", event.target.value)
                            }
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                          >
                            <option value="send_sms">Send SMS Now</option>
                            <option value="queue_sms">Queue SMS</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            To
                          </span>
                          <input
                            value={selectedNode.data.smsTo ?? ""}
                            onChange={(event) =>
                              updateSelectedNodeData("smsTo", event.target.value)
                            }
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            Message
                          </span>
                          <textarea
                            value={selectedNode.data.smsBody ?? ""}
                            onChange={(event) =>
                              updateSelectedNodeData("smsBody", event.target.value)
                            }
                            className="min-h-32 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                          />
                        </label>

                        {selectedNode.data.connectorAction === "queue_sms" ? (
                          <label className="block">
                            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                              Send At
                            </span>
                            <input
                              value={selectedNode.data.sendAt ?? ""}
                              onChange={(event) =>
                                updateSelectedNodeData("sendAt", event.target.value)
                              }
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                            />
                          </label>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={deleteSelectedNode}
                      className="w-full rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-100"
                    >
                      Delete Node
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center">
                  <div>
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
                      <Icon name="message" className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 text-sm font-black text-slate-900">
                      Select a node
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Click any canvas card to edit its settings.
                    </p>
                  </div>
                </div>
              )}
            </aside>
          </section>
        ) : null}

        {activeTab === "test" ? (
          <section className="absolute inset-0 overflow-y-auto bg-gray-50">
            <div className="mx-auto max-w-3xl px-6 py-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Test console</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Simulate a missed call and watch the agent run through each step.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={runTest}
                  disabled={running}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
                >
                  ▶ {running ? "Running..." : "Run test"}
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Simulate a missed call
                </h3>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Caller number
                    </span>
                    <input
                      value={callerNumber}
                      onChange={(event) => setCallerNumber(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                    />
                  </label>

                  <label>
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Caller name
                    </span>
                    <input
                      value={callerName}
                      onChange={(event) => setCallerName(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                    />
                  </label>

                  <label>
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Time of call
                    </span>
                    <input
                      value="Today · 2:14 PM"
                      readOnly
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800 outline-none"
                    />
                  </label>

                  <label>
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Business
                    </span>
                    <input
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-green-400" />
                  <span className="ml-2 font-mono text-xs text-slate-400">
                    coreai test-run
                  </span>
                </div>

                <div className="min-h-[230px] space-y-2 p-4 font-mono text-xs">
                  {runLogs.length > 0 ? (
                    runLogs.map((log, index) => (
                      <p key={`${log.nodeId}-${index}`} className={formatRunLogColor(log.status)}>
                        ▶ {log.label} · {log.message}
                      </p>
                    ))
                  ) : (
                    <>
                      <p className="text-slate-500">$ run workflow --agent agt_mctb_001</p>
                      <p className="text-amber-300">▶ Trigger · Missed Call Detected</p>
                      <p className="text-slate-500">caller_number={callerNumber} timestamp=14:14</p>
                      <p className="text-violet-300">▶ AI Process · Generate Personalized SMS</p>
                      <p className="text-orange-300">▶ Condition · Is Business Hours? → TRUE</p>
                      <p className="text-green-300">▶ Action · Send SMS Now → delivered</p>
                      <p className="text-slate-400">✓ run complete · 1 message sent · est. cost $0.15</p>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Message the patient receives
                </h3>

                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600">
                    <Icon name="message" className="h-5 w-5" />
                  </div>

                  <div className="flex-1">
                    <div className="inline-block max-w-md rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
                      Hi! We noticed we missed your call at {businessName}. Sorry about that! Would you like to schedule an appointment? Reply YES and we’ll get you booked. 😊
                    </div>
                    <p className="mt-2 font-mono text-xs text-slate-400">
                      Delivered · 142 characters · est. cost $0.15
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "configure" ? (
          <section className="absolute inset-0 overflow-y-auto bg-gray-50">
            <div className="mx-auto max-w-3xl px-6 py-8">
              <h2 className="text-xl font-bold text-slate-900">Configure agent</h2>
              <p className="mt-1 text-sm text-slate-500">
                These details shape how your agent appears and behaves in the marketplace.
              </p>

              <div className="mt-6 divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white shadow-sm">
                <div className="p-5">
                  <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Marketplace details
                  </h3>

                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Agent name
                      </span>
                      <input
                        value={agentName}
                        onChange={(event) => setAgentName(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Tagline
                      </span>
                      <input
                        value={tagline}
                        onChange={(event) => setTagline(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                      />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Category
                        </span>
                        <input
                          value="Communication"
                          readOnly
                          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Price / month
                        </span>
                        <input
                          value={price}
                          onChange={(event) => setPrice(event.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Business hours logic
                  </h3>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      value="Monday–Friday"
                      readOnly
                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800"
                    />
                    <input
                      value="8:00 AM – 6:00 PM"
                      readOnly
                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "publish" ? (
          <section className="absolute inset-0 overflow-y-auto bg-gray-50">
            <div className="mx-auto max-w-3xl px-6 py-8">
              <h2 className="text-xl font-bold text-slate-900">Publish to Marketplace</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review the Missed Call Text-Back listing before submitting it.
              </p>

              <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-500 text-slate-950">
                    <Icon name="phone" className="h-7 w-7" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl font-black text-slate-900">{agentName}</h3>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                        Communication
                      </span>
                    </div>

                    <p className="mt-2 max-w-xl text-slate-600">{tagline}</p>

                    <div className="mt-4 flex flex-wrap items-center gap-4">
                      <span className="text-3xl font-black text-slate-900">${price}</span>
                      <span className="text-sm text-slate-500">/month after trial</span>
                      <span className="text-sm font-semibold text-amber-600">4.9 · 47 reviews</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  {[
                    "Missed call trigger configured",
                    "AI personalized SMS step ready",
                    "Business-hours condition added",
                    "Send now / queue morning paths connected"
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3 rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
                      ✓ {item}
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void saveAgent()}
                    disabled={saving}
                    className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save Draft"}
                  </button>

                  <Link
                    href={`/architect/agents/publish?workflowId=${workflowId}` as Route}
                    className="inline-flex flex-1 items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-white shadow-sm shadow-amber-500/25 transition hover:bg-amber-600"
                  >
                    Submit for Review
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}