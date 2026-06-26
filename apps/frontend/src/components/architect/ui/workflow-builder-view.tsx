"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  addEdge,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArchitectEmptyState } from "@/components/architect/ui/architect-ui";
import {
  createArchitectListing,
  getArchitectWorkflow,
  getGmailConnectorStatus,
  getGmailOAuthUrl,
  runArchitectWorkflowLive,
  runArchitectWorkflowTest,
  updateArchitectWorkflow
} from "@/components/architect/features/api";
import type { ArchitectWorkflow, WorkflowRunLog } from "@/components/architect/features/types";
import { BuilderHeader } from "./workflow-builder/builder-header";
import { BuilderStatusBar } from "./workflow-builder/builder-status-bar";
import { ComponentLibrary } from "./workflow-builder/component-library";
import { ConfigurePanel } from "./workflow-builder/configure-panel";
import { CoreNode } from "./workflow-builder/core-node";
import { createFlowEdge } from "./workflow-builder/edge-utils";
import { MobileSheet } from "./workflow-builder/mobile-sheet";
import { NodeInspector } from "./workflow-builder/node-inspector";
import { defaultAgentDescription, defaultAgentName, defaultNodeData } from "./workflow-builder/node-defaults";
import { parseEdges, parseNodes } from "./workflow-builder/parsers";
import { PreviewModal } from "./workflow-builder/preview-modal";
import { PublishPanel } from "./workflow-builder/publish-panel";
import { TestPanel } from "./workflow-builder/test-panel";
import { WorkflowBuilderStyles } from "./workflow-builder/builder-styles";
import type { BuilderNode, BuilderNodeData, BuilderTab, MobilePanel, NodeKind } from "./workflow-builder/types";
import { agentTemplates } from "./workflow-builder/library";

export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<ArchitectWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BuilderTab>("build");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [runLogs, setRunLogs] = useState<WorkflowRunLog[]>([]);
  const [runContext, setRunContext] = useState<Record<string, unknown>>({});
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [agentName, setAgentName] = useState(defaultAgentName);
  const [tagline, setTagline] = useState(defaultAgentDescription);
  const [price, setPrice] = useState("149");
  const [businessName, setBusinessName] = useState("");
  const [callerNumber, setCallerNumber] = useState("");
  const [callerName, setCallerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Unsaved changes");
  const [publishError, setPublishError] = useState("");

  const nodeTypes = useMemo<NodeTypes>(
    () => ({ coreNode: CoreNode as unknown as ComponentType<NodeProps> }),
    []
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const hasGmailFlow = useMemo(
    () => nodes.some((node) => String(node.data.connector ?? "").toLowerCase() === "gmail"),
    [nodes]
  );

  const hasSmsFlow = useMemo(
    () =>
      nodes.some((node) =>
        ["sms", "twilio"].includes(String(node.data.connector ?? "").toLowerCase())
      ),
    [nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      setEdges((currentEdges) =>
        addEdge(
          createFlowEdge({
            id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle ?? undefined,
            accent: "amber"
          }),
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
      setAgentName(loadedWorkflow.name || defaultAgentName);
      setTagline(loadedWorkflow.description || defaultAgentDescription);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setSelectedNodeId(parsedNodes[0]?.id ?? null);
      setMessage(parsedNodes.length ? "Saved just now" : "Empty canvas");
    }

    setLoading(false);
  }

  async function loadGmailStatus() {
    const result = await getGmailConnectorStatus();

    if (result.success && result.data) {
      setGmailConnected(result.data.connected);
      setGmailEmail(result.data.email);
    }
  }

  async function connectGmail() {
    setConnectingGmail(true);
    setMessage("Connecting Gmail...");

    const result = await getGmailOAuthUrl();

    if (result.success && result.data) {
      window.location.href = result.data.url;
      return;
    }

    setMessage(result.error ?? "Could not connect Gmail");
    setConnectingGmail(false);
  }

  useEffect(() => {
    void loadWorkflow();
    void loadGmailStatus();
  }, [workflowId]);

  function addNodeFromLibrary(nodeKind: NodeKind, overrides?: Partial<BuilderNodeData>) {
    const id = `${nodeKind}-${Date.now()}`;
    const newNode: BuilderNode = {
      id,
      type: "coreNode",
      position: {
        x: 150 + nodes.length * 48,
        y: 150 + nodes.length * 32
      },
      data: defaultNodeData(nodeKind, overrides)
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(id);
    setMobilePanel(null);
    setMessage("Unsaved changes");
  }

  function loadTemplate(templateId: "missed-call" | "gmail-reply") {
    const template = agentTemplates.find((item: (typeof agentTemplates)[number]) => item.id === templateId);
    if (!template) return;

    const confirmed =
      nodes.length === 0 ||
      window.confirm(`Replace the current canvas with ${template.title.replace("Build ", "the ")}?`);
    if (!confirmed) return;

    const flow = template.flow();
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNodeId(flow.nodes[0]?.id ?? null);
    setActiveTab("build");
    setRunLogs([]);
    setRunContext({});
    setMobilePanel(null);
    setMessage(`${template.title.replace("Build ", "")} loaded`);
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
            [field]: value,
            ...(field === "title" ? { label: String(value) } : {})
          }
        };
      })
    );
    setMessage("Unsaved changes");
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
    setMobilePanel(null);
    setMessage("Unsaved changes");
  }

  async function saveAgent(showMessage = true) {
    setSaving(true);
    const result = await updateArchitectWorkflow(workflowId, {
      name: agentName,
      description: tagline,
      workflowJson: { nodes, edges }
    });
    setSaving(false);

    if (!result.success) {
      setMessage(result.error ?? "Could not save agent");
      return false;
    }

    if (showMessage) setMessage("Saved just now");
    return true;
  }

  // Publish the current builder workflow as a marketplace AgentListing.
  // Saves the workflow first, then creates the listing (status PENDING_REVIEW
  // server-side) and routes to My Agents. Surfaces validation/API errors instead
  // of failing silently.
  async function publishAgent() {
    const name = agentName.trim();
    const shortDescription = tagline.trim();

    // Validation errors stay visible on the Publish tab (no silent tab switch).
    setPublishError("");

    if (!workflowId) {
      setPublishError("Save this workflow before publishing.");
      return;
    }

    if (name.length < 2 || shortDescription.length < 10) {
      setPublishError(
        "Please add an Agent name and a tagline (at least 10 characters) in Configure before publishing."
      );
      return;
    }

    setMessage("Submitting for review...");

    const saved = await saveAgent(false);
    if (!saved) {
      setPublishError("Could not save the workflow before publishing. Please try again.");
      return;
    }

    setSaving(true);
    const result = await createArchitectListing({
      workflowId,
      name,
      shortDescription,
      description: tagline,
      priceCents: Math.max(0, Math.round(Number(price) * 100) || 0),
      tags: [],
      requiredConnectors: [],
      supportedLlms: []
    });
    setSaving(false);

    if (!result.success) {
      setPublishError(result.error ?? "Could not publish agent. Please try again.");
      setMessage(result.error ?? "Could not publish agent");
      return;
    }

    setMessage("Submitted for review");
    router.push("/architect/agents" as Route);
  }

  async function runAgent(mode: "test" | "live") {
    const normalizedCallerNumber = callerNumber.trim();
    const normalizedBusinessName = businessName.trim();

    if (hasSmsFlow) {
      if (!normalizedCallerNumber) {
        setActiveTab("test");
        setMessage("Enter a caller phone number first");
        return;
      }

      if (!normalizedBusinessName) {
        setActiveTab("test");
        setMessage("Enter your business name first");
        return;
      }
    }

    if (hasGmailFlow && !gmailConnected) {
      setActiveTab("test");
      setMessage("Connect Gmail before running this agent");
      return;
    }

    setRunning(true);
    setMessage(
      hasGmailFlow
        ? "Running Gmail workflow..."
        : mode === "live"
          ? "Sending through Twilio..."
          : "Running dry test..."
    );
    setRunLogs([]);
    setRunContext({});

    const saved = await saveAgent(false);
    if (!saved) {
      setRunning(false);
      return;
    }

    const payload = hasSmsFlow
      ? {
          input: {
            callerNumber: normalizedCallerNumber,
            callerName: callerName.trim(),
            businessName: normalizedBusinessName,
            businessType: "Dental Clinic",
            businessPhoneNumber: "",
            calendarId: "primary",
            timeZone: "America/New_York",
            services: ["Dental cleaning", "Emergency tooth pain", "Whitening", "New patient exam"],
            faqs: [
              "Dental cleaning pricing depends on insurance and exam needs.",
              "For severe pain or swelling, the team should call the patient urgently."
            ],
            knowledge: [
              "The AI receptionist should offer booking first, answer basic service questions, and route emergencies to the team."
            ],
            bookingUrl: "https://example.com/book",
            teamPhone: "",
            callStatus: "no-answer",
            callTimestamp: new Date().toISOString(),
            missedCallReason: "No one picked up the customer call.",
            appointmentService: "Dental consultation"
          }
        }
      : {};

    const result =
      mode === "live" && hasSmsFlow
        ? await runArchitectWorkflowLive(workflowId, payload)
        : await runArchitectWorkflowTest(workflowId, payload);

    if (!result.success || !result.data) {
      setMessage(
        result.error ??
          (hasGmailFlow
            ? "Could not run Gmail workflow"
            : mode === "live"
              ? "Could not send Twilio SMS"
              : "Could not run test")
      );
      setRunning(false);
      return;
    }

    setRunLogs(result.data.run.logs);
    setRunContext(result.data.run.context);
    setMessage(
      hasGmailFlow
        ? "Gmail run complete"
        : mode === "live"
          ? "Twilio run complete"
          : "Dry run complete"
    );
    setActiveTab("test");
    setRunning(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-amber-100 bg-white px-5 py-3 text-sm font-black text-amber-700 shadow-sm">
          Loading Missed Call Text-Back builder...
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
        <ArchitectEmptyState
          title="Agent not found"
          text="This agent canvas may not exist or may not belong to this architect account."
          actionLabel="Back to Builder"
          actionHref="/architect/workflows"
        />
      </div>
    );
  }

  const library = (
    <ComponentLibrary
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      onLoadTemplate={loadTemplate}
      onAddNode={addNodeFromLibrary}
    />
  );

  const inspector = (
    <NodeInspector
      selectedNode={selectedNode}
      onClearSelection={() => setSelectedNodeId(null)}
      onUpdateNodeData={updateSelectedNodeData}
      onDeleteNode={deleteSelectedNode}
    />
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#f8fafc] text-slate-900">
      <WorkflowBuilderStyles />

      <BuilderHeader
        agentName={agentName}
        message={message}
        activeTab={activeTab}
        running={running}
        saving={saving}
        hasGmailFlow={hasGmailFlow}
        onAgentNameChange={setAgentName}
        onMobileLibrary={() => setMobilePanel("library")}
        onTabChange={setActiveTab}
        onRunTest={() => void runAgent("test")}
        onSave={() => void saveAgent()}
        onPreview={() => setPreviewOpen(true)}
      />

      <main className="fixed bottom-10 left-0 right-0 top-14 overflow-hidden">
        {activeTab === "build" ? (
          <section className="builder-view fade-enter flex">
            <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-100 bg-white scroll-thin">
              {library}
            </aside>

            <div className="canvas-grid relative flex-1 overflow-hidden">
              {nodes.length === 0 ? (
                <div className="absolute inset-x-4 top-4 z-10 rounded-2xl border border-dashed border-amber-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:left-6 sm:right-auto sm:max-w-md">
                  <p className="text-sm font-black text-slate-900">New agent canvas is empty</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Use the component library or load the first CORE agent: Missed Call Text-Back.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => loadTemplate("missed-call")}
                      data-testid="builder-load-template-missed-call"
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-amber-600"
                    >
                      Build Missed Call Text-Back
                    </button>
                    <button
                      type="button"
                      onClick={() => loadTemplate("gmail-reply")}
                      data-testid="builder-load-template-gmail-reply"
                      className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-black text-blue-700 shadow-sm transition hover:bg-blue-50"
                    >
                      Build Gmail Reply Flow
                    </button>
                  </div>
                </div>
              ) : null}

              <ReactFlow<BuilderNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  if (window.innerWidth < 1536) setMobilePanel("settings");
                }}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.25}
                maxZoom={2}
                className="bg-transparent"
                proOptions={{ hideAttribution: true }}
              >
                <Controls />
              </ReactFlow>

              <div className="absolute right-4 top-4 z-10 hidden items-center gap-3 rounded-xl border border-gray-200 bg-white/90 px-3 py-2 text-[11px] text-slate-500 shadow-sm backdrop-blur md:flex">
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">Scroll</kbd> zoom
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">Space</kbd> pan
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">Del</kbd> remove
                </span>
              </div>
            </div>

            <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-100 bg-white scroll-thin">
              {inspector}
            </aside>
          </section>
        ) : null}

        {activeTab === "test" ? (
          <TestPanel
            hasGmailFlow={hasGmailFlow}
            gmailConnected={gmailConnected}
            gmailEmail={gmailEmail}
            connectingGmail={connectingGmail}
            running={running}
            callerNumber={callerNumber}
            callerName={callerName}
            businessName={businessName}
            runLogs={runLogs}
            runContext={runContext}
            onConnectGmail={connectGmail}
            onRunTest={() => void runAgent("test")}
            onRunLive={() => void runAgent("live")}
            onCallerNumberChange={setCallerNumber}
            onCallerNameChange={setCallerName}
            onBusinessNameChange={setBusinessName}
          />
        ) : null}

        {activeTab === "configure" ? (
          <ConfigurePanel
            agentName={agentName}
            tagline={tagline}
            price={price}
            saving={saving}
            statusMessage={message}
            onAgentNameChange={setAgentName}
            onTaglineChange={setTagline}
            onPriceChange={setPrice}
            onSave={() => void saveAgent()}
          />
        ) : null}

        {activeTab === "publish" ? (
          <PublishPanel
            workflowId={workflowId}
            agentName={agentName}
            tagline={tagline}
            price={price}
            saving={saving}
            statusMessage={message}
            errorMessage={publishError}
            onGoConfigure={() => setActiveTab("configure")}
            onSave={() => void publishAgent()}
          />
        ) : null}
      </main>

      <BuilderStatusBar
        nodesCount={nodes.length}
        edgesCount={edges.length}
        editedLabel={message === "Unsaved changes" ? "unsaved changes" : "last edited just now"}
      />

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        businessName={businessName.trim() || "Mitchell Dental"}
      />

      <MobileSheet panel={mobilePanel} onClose={() => setMobilePanel(null)}>
        {mobilePanel === "library" ? library : inspector}
      </MobileSheet>
    </div>
  );
}
