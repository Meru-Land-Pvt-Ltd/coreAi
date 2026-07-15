"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
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
import Link from "next/link";
import type { Route } from "next";
import { BROWSER_CALL_START_MESSAGE, VOICE_NODE_TYPES } from "@coreai/shared";
import { ArchitectEmptyState } from "@/components/architect/ui/architect-ui";
import {
  createArchitectWorkflow,
  disconnectGmailConnector,
  getArchitectTestDeployment,
  getArchitectWorkflow,
  getGmailConnectorStatus,
  getGmailOAuthUrl,
  getWorkflowConfigure,
  runArchitectWorkflowTest,
  runArchitectConversationTest,
  startArchitectTestDeployment,
  startArchitectVapiBrowserTest,
  stopArchitectTestDeployment,
  submitWorkflowForReview,
  updateArchitectWorkflow,
  useArchitectTemplate
} from "@/components/architect/features/api";
import type {
  ArchitectConversationMessage,
  ArchitectConversationToolCall,
  ArchitectTestDeploymentStatus,
  ArchitectVapiBrowserTestSession,
  ArchitectWorkflow,
  WorkflowRunLog,
} from "@/components/architect/features/types";
import { getAuthUser } from "@/lib/auth";
import { BuilderHeader } from "./workflow-builder/builder-header";
import { BuilderStatusBar } from "./workflow-builder/builder-status-bar";
import { ComponentLibrary } from "./workflow-builder/component-library";
import { ConfigurePanel } from "./workflow-builder/configure-panel";
import { CoreNode } from "./workflow-builder/core-node";
import { createFlowEdge } from "./workflow-builder/edge-utils";
import { BuilderIcon } from "./workflow-builder/icons";
import { MobileSheet } from "./workflow-builder/mobile-sheet";
import { NodeInspector } from "./workflow-builder/node-inspector";
import { defaultAgentDescription, defaultAgentName, defaultNodeData } from "./workflow-builder/node-defaults";
import { parseEdges, parseNodes } from "./workflow-builder/parsers";
import { PreviewModal } from "./workflow-builder/preview-modal";
import { PublishPanel } from "./workflow-builder/publish-panel";
import { TestPanel } from "./workflow-builder/test-panel";
import { isMeaningfulWorkflow, useBuilderAutosaveHistory } from "./workflow-builder/use-builder-autosave-history";
import { WorkflowBuilderStyles } from "./workflow-builder/builder-styles";
import type { BuilderNode, BuilderNodeData, BuilderTab, MobilePanel, NodeKind, AIAttachment } from "./workflow-builder/types";

const REVIEW_LOCK_MESSAGE = "Agent is under review";
const LIVE_PUBLISH_LOCK_MESSAGE = "Agent is live — publishing is locked";

const BUILDER_TABS: readonly BuilderTab[] = ["build", "test", "configure", "publish"];

function isBuilderTab(value: string | null): value is BuilderTab {
  return Boolean(value) && (BUILDER_TABS as readonly string[]).includes(value as string);
}

function testInputsStashKey(workflowId: string): string {
  return `triven-builder-test-inputs:${workflowId || "draft"}`;
}

export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
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
  const [conversationMessages, setConversationMessages] = useState<ArchitectConversationMessage[]>([]);
  // Mirror of conversationMessages so sendConversationMessage always reads the
  // latest transcript, even when called right after a reset in the same tick.
  const conversationMessagesRef = useRef<ArchitectConversationMessage[]>([]);
  const [conversationLogs, setConversationLogs] = useState<WorkflowRunLog[]>([]);
  const [conversationToolCalls, setConversationToolCalls] = useState<ArchitectConversationToolCall[]>([]);
  const [chatting, setChatting] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [agentName, setAgentName] = useState(defaultAgentName);
  const [tagline, setTagline] = useState(defaultAgentDescription);
  const [price, setPrice] = useState("149");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [appointmentService, setAppointmentService] = useState("");
  const [callerNumber, setCallerNumber] = useState("");
  const [callerName, setCallerName] = useState("");
  const [triggerMessage, setTriggerMessage] = useState("");
  const [triggerAttachments, setTriggerAttachments] = useState<AIAttachment[]>([]);
  const [testDeployment, setTestDeployment] = useState<ArchitectTestDeploymentStatus | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [stoppingLive, setStoppingLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Unsaved changes");
  const [publishError, setPublishError] = useState("");
  const [publishSuccessName, setPublishSuccessName] = useState<string | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [importingSlug, setImportingSlug] = useState<string | null>(null);
  const architectName = useMemo(() => {
    const user = getAuthUser();
    return user?.fullName?.trim() || user?.email || "Architect";
  }, []);

  const [currentWorkflowId, setCurrentWorkflowId] = useState(workflowId);
  const currentWorkflowIdRef = useRef(workflowId);
  const vapiBrowserTestStartRef = useRef(false);
  const creatingDraftRef = useRef(false);

  useEffect(() => {
    currentWorkflowIdRef.current = currentWorkflowId;
  }, [currentWorkflowId]);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({ coreNode: CoreNode as unknown as ComponentType<NodeProps> }),
    []
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  // Node ids + labels whitelist {{node.prop}}-style tokens in the unknown-
  // variable warnings shown while writing prompts/first messages.
  const variableNodePrefixes = useMemo(
    () =>
      nodes.flatMap((node) =>
        [node.id, String(node.data.title ?? node.data.label ?? "")].filter(Boolean)
      ),
    [nodes]
  );

  const listingStatus = workflow?.listings?.[0]?.status;
  const isUnderReview = listingStatus === "PENDING_REVIEW";
  const isLive = listingStatus === "APPROVED";
  const isPublishLocked = isUnderReview || isLive;

  const blockIfUnderReview = useCallback(() => {
    if (isUnderReview) {
      setMessage(REVIEW_LOCK_MESSAGE);
      return true;
    }

    return false;
  }, [isUnderReview]);

  const blockIfPublishLocked = useCallback(() => {
    if (isLive) {
      setPublishError("This agent is already live. You can test changes in the builder, but you can't publish again.");
      setMessage(LIVE_PUBLISH_LOCK_MESSAGE);
      return true;
    }

    if (isUnderReview) {
      setPublishError("This agent is under review. Publishing is locked until the review completes.");
      setMessage(REVIEW_LOCK_MESSAGE);
      return true;
    }

    return false;
  }, [isLive, isUnderReview]);

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

  // Voice workflow = uses the generic voice-booking nodes (phone trigger / AI
  // voice conversation). The Dental AI Receptionist template is one of these.
  const isVoiceWorkflow = useMemo(() => {
    const voiceTypes = new Set<string>([
      VOICE_NODE_TYPES.phoneCallTrigger,
      VOICE_NODE_TYPES.voiceConversation
    ]);
    return nodes.some((node) => voiceTypes.has(String(node.data.type ?? "")));
  }, [nodes]);

  const needsCalendarConnection = useMemo(
    () =>
      nodes.some((node) => {
        const type = String(node.data.type ?? "").toLowerCase();
        const connector = String(node.data.connector ?? "").toLowerCase();
        return (
          type === VOICE_NODE_TYPES.calendarAvailability ||
          type === VOICE_NODE_TYPES.bookAppointment ||
          type.includes("calendar") ||
          connector.includes("calendar")
        );
      }),
    [nodes]
  );

  const needsGoogleConnection = hasGmailFlow || needsCalendarConnection;
  // Twilio/Vapi cards are for live sandbox only — browser call test does not need them.
  const liveSandboxActive =
    testDeployment?.status === "READY" || Boolean(testDeployment?.assignedPhoneNumber);
  const needsTwilioConnection = liveSandboxActive && (isVoiceWorkflow || hasSmsFlow);
  const needsVapiConnection = liveSandboxActive && isVoiceWorkflow;
  const needsAnyTestConnection =
    needsGoogleConnection || needsCalendarConnection || needsTwilioConnection || needsVapiConnection;

  const isDentalWorkflow = useMemo(() => {
    const name = `${agentName} ${workflow?.name ?? ""}`.toLowerCase();
    return isVoiceWorkflow && name.includes("dental");
  }, [agentName, workflow?.name, isVoiceWorkflow]);

  const isManualTriggerWorkflow = useMemo(() => {
    return nodes.some((node) => ["trigger.manual", "manual_trigger"].includes(String(node.data.type ?? "")));
  }, [nodes]);

  const testRunStatus = useMemo(() => {
    const totalNodes = nodes.length;
    const activeLogs =
      conversationLogs.length > 0 ? conversationLogs : runLogs.length > 0 ? runLogs : [];
    const passedNodes = new Set(
      activeLogs.filter((log) => log.status === "success").map((log) => log.nodeId)
    ).size;
    const hasErrors = activeLogs.some((log) => log.status === "error" || log.status === "waiting");
    const dryOrBrowserPassed =
      totalNodes > 0 && activeLogs.length > 0 && passedNodes === totalNodes && !hasErrors;
    const liveSandboxReady = testDeployment?.status === "READY";
    const completed = dryOrBrowserPassed || liveSandboxReady;

    let summary = "";
    if (liveSandboxReady && !dryOrBrowserPassed) {
      summary = testDeployment?.assignedPhoneNumber
        ? `Live sandbox ready — ${testDeployment.assignedPhoneNumber}`
        : "Live sandbox ready";
    } else if (activeLogs.length > 0 || totalNodes > 0) {
      summary = `${passedNodes}/${totalNodes} nodes passed`;
    }

    return { completed, summary };
  }, [nodes.length, runLogs, conversationLogs, testDeployment]);

  // Generic test-tab-only defaults. These never change the workflow nodes themselves.
  useEffect(() => {
    if (!isVoiceWorkflow) return;
    setBusinessName((value) => value || "Sample Business");
    setBusinessType((value) => value || "Service Business");
    setCallerName((value) => value || "Test Customer");
    setCalendarId((value) => value || "primary");
    setTimeZone((value) => value || "America/Los_Angeles");
    setAppointmentService((value) => value || "General Consultation");
  }, [isVoiceWorkflow]);

  const meaningfulForSave = useCallback(
    (snap: { nodes: BuilderNode[]; agentName: string }) =>
      Boolean(currentWorkflowIdRef.current) || isMeaningfulWorkflow(snap),
    []
  );

  const saveDraft = useCallback(
    async (snap: { nodes: BuilderNode[]; edges: Edge[]; agentName: string; tagline: string }): Promise<boolean> => {
      const id = currentWorkflowIdRef.current;

      if (!id) {
        if (creatingDraftRef.current) return false;

        creatingDraftRef.current = true;

        const res = await createArchitectWorkflow({
          name: snap.agentName,
          description: snap.tagline,
          isTemplate: false,
          workflowJson: { nodes: snap.nodes, edges: snap.edges }
        });

        creatingDraftRef.current = false;

        if (!res.success || !res.data) return false;

        const newId = res.data.workflow.id;

        currentWorkflowIdRef.current = newId;
        setCurrentWorkflowId(newId);

        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `/architect/workflows/${newId}/builder`);
        }

        return true;
      }

      const res = await updateArchitectWorkflow(id, {
        name: snap.agentName,
        description: snap.tagline,
        workflowJson: { nodes: snap.nodes, edges: snap.edges }
      });

      return res.success;
    },
    []
  );

  const { canUndo, canRedo, undo, redo, saveNow } = useBuilderAutosaveHistory({
    loading,
    enabled: !isUnderReview,
    resetKey: currentWorkflowId,
    nodes,
    edges,
    agentName,
    tagline,
    setNodes,
    setEdges,
    setAgentName,
    setTagline,
    setStatus: setMessage,
    save: saveDraft,
    isMeaningful: meaningfulForSave
  });

  const onConnect = useCallback(
    (connection: Connection) => {
      if (blockIfUnderReview()) return;
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
    [setEdges, blockIfUnderReview]
  );

  async function loadWorkflow() {
    if (!currentWorkflowIdRef.current) {
      setWorkflow({
        id: "",
        name: defaultAgentName,
        description: defaultAgentDescription,
        workflowJson: { nodes: [], edges: [] },
        isTemplate: false,
        createdAt: ""
      });

      setSelectedNodeId(null);
      setMessage("New agent");
      setLoading(false);
      return;
    }

    setLoading(true);

    const result = await getArchitectWorkflow(currentWorkflowIdRef.current);

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
      setCalendarConnected(Boolean(result.data.calendarConnected));
    }
  }

  async function loadTestDeployment() {
    const id = currentWorkflowIdRef.current;
    if (!id) return;

    const result = await getArchitectTestDeployment(id);
    if (result.success && result.data) {
      setTestDeployment(result.data.testDeployment);
    }
  }

  async function connectGmail() {
    setConnectingGmail(true);
    setMessage("Connecting Google...");
    const returnTo = new URL(window.location.href);
    returnTo.searchParams.delete("gmail");
    returnTo.searchParams.set("tab", activeTab);
    try {
      window.sessionStorage.setItem(
        testInputsStashKey(currentWorkflowIdRef.current),
        JSON.stringify({
          businessName,
          businessType,
          calendarId,
          timeZone,
          appointmentService,
          callerNumber,
          callerName,
          triggerMessage
        })
      );
    } catch {
      // Storage unavailable/full — the connection itself must still proceed.
    }

    const result = await getGmailOAuthUrl(`${returnTo.pathname}${returnTo.search}`);

    if (result.success && result.data) {
      window.location.href = result.data.url;
      return;
    }

    setMessage(result.error ?? "Could not connect Google");
    setConnectingGmail(false);
  }

  async function disconnectGoogle() {
    const result = await disconnectGmailConnector();
    setMessage(result.success ? "Google disconnected" : result.error ?? "Could not disconnect Google");
    await loadGmailStatus();
    await loadTestDeployment();
  }

  async function refreshConnections() {
    setMessage("Refreshing connection status...");
    await Promise.all([loadGmailStatus(), loadTestDeployment()]);
    setMessage("Connection status refreshed");
  }

  async function startLiveTest() {
    if (blockIfUnderReview()) return;

    const confirmed = window.confirm(
      "Start a live sandbox test? This creates/updates a Vapi assistant, reserves a Triven test phone number, and live calls will book real events in YOUR connected Google Calendar. It does not publish the agent or touch buyer installs."
    );
    if (!confirmed) return;

    setStartingLive(true);
    setMessage("Starting live sandbox...");

    const saved = await saveAgent(false);
    if (!saved || !currentWorkflowIdRef.current) {
      setStartingLive(false);
      setMessage("Save the agent before starting a live sandbox test.");
      return;
    }

    const result = await startArchitectTestDeployment(currentWorkflowIdRef.current, {
      businessName: businessName.trim() || undefined,
      businessType: businessType.trim() || undefined,
      calendarId: calendarId.trim() || undefined,
      timeZone: timeZone.trim() || undefined
    });

    setStartingLive(false);

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Could not start the live sandbox test");
      return;
    }

    setTestDeployment(result.data.testDeployment);
    setActiveTab("test");
    setMessage(
      result.data.testDeployment.assignedPhoneNumber
        ? `Live sandbox ready — call ${result.data.testDeployment.assignedPhoneNumber}`
        : "Live sandbox ready"
    );
  }

  async function stopLiveTest() {
    if (!currentWorkflowIdRef.current) return;

    setStoppingLive(true);
    setMessage("Stopping sandbox test...");

    const result = await stopArchitectTestDeployment(currentWorkflowIdRef.current);

    setStoppingLive(false);

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Could not stop the sandbox test");
      return;
    }

    setTestDeployment(result.data.testDeployment);
    setMessage("Sandbox test stopped — test number released");
  }

  useEffect(() => {
    void loadWorkflow();
    void loadGmailStatus();
    void loadTestDeployment();
  }, [workflowId]);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const tabParam = url.searchParams.get("tab");
    const gmailParam = url.searchParams.get("gmail");

    if (isBuilderTab(tabParam)) setActiveTab(tabParam);
    if (gmailParam === "connected") setMessage("Google connected");
    else if (gmailParam === "failed") setMessage("Google connection failed — please try again");

    if (tabParam !== null || gmailParam !== null) {
      url.searchParams.delete("tab");
      url.searchParams.delete("gmail");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    try {
      const key = testInputsStashKey(workflowId);
      const raw = window.sessionStorage.getItem(key) ?? window.sessionStorage.getItem(testInputsStashKey(""));
      if (raw) {
        window.sessionStorage.removeItem(key);
        window.sessionStorage.removeItem(testInputsStashKey(""));
        const saved = JSON.parse(raw) as Record<string, unknown>;
        const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

        const savedBusinessName = str(saved.businessName);
        const savedBusinessType = str(saved.businessType);
        const savedCalendarId = str(saved.calendarId);
        const savedTimeZone = str(saved.timeZone);
        const savedService = str(saved.appointmentService);
        const savedCallerNumber = str(saved.callerNumber);
        const savedCallerName = str(saved.callerName);
        const savedTriggerMessage = str(saved.triggerMessage);

        if (savedBusinessName) setBusinessName(savedBusinessName);
        if (savedBusinessType) setBusinessType(savedBusinessType);
        if (savedCalendarId) setCalendarId(savedCalendarId);
        if (savedTimeZone) setTimeZone(savedTimeZone);
        if (savedService) setAppointmentService(savedService);
        if (savedCallerNumber) setCallerNumber(savedCallerNumber);
        if (savedCallerName) setCallerName(savedCallerName);
        if (savedTriggerMessage) setTriggerMessage(savedTriggerMessage);
      }
    } catch {
      // Corrupted/blocked storage — the page still works, just without restore.
    }
  }, [workflowId]);

  function addNodeFromLibrary(nodeKind: NodeKind, overrides?: Partial<BuilderNodeData>) {
    if (blockIfUnderReview()) return;

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

  async function importTemplate(slug: string) {
    if (nodes.length > 0 && !window.confirm("Replace the current canvas with this template?")) return;

    setImportingSlug(slug);
    setPreviewSlug(null);
    setMessage("Importing template...");

    const result = await useArchitectTemplate(slug, { workflowId: currentWorkflowIdRef.current || undefined });

    setImportingSlug(null);

    if (!result.success || !result.data) {
      setMessage(result.error ?? "Could not import template");
      return;
    }

    const imported = result.data;

    if (imported.workflowId && imported.workflowId !== currentWorkflowIdRef.current) {
      currentWorkflowIdRef.current = imported.workflowId;
      setCurrentWorkflowId(imported.workflowId);

      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/architect/workflows/${imported.workflowId}/builder`);
      }
    }

    const importedWorkflow: ArchitectWorkflow = {
      id: imported.workflowId,
      name: imported.name,
      description: imported.description,
      workflowJson: imported.workflowJson,
      isTemplate: false,
      createdAt: workflow?.createdAt ?? ""
    };

    const parsedNodes = parseNodes(importedWorkflow);
    const parsedEdges = parseEdges(importedWorkflow);

    setWorkflow(importedWorkflow);
    setAgentName(imported.name || defaultAgentName);
    setTagline(imported.description || defaultAgentDescription);
    setNodes(parsedNodes);
    setEdges(parsedEdges);
    setSelectedNodeId(parsedNodes[0]?.id ?? null);
    setActiveTab("build");
    setRunLogs([]);
    setRunContext({});
    setConversationMessages([]);
    setConversationLogs([]);
    setConversationToolCalls([]);
    setMobilePanel(null);
    setMessage("Template imported");
  }

  function updateSelectedNodeData(
    field: keyof BuilderNodeData,
    value: BuilderNodeData[keyof BuilderNodeData]
  ) {
    if (blockIfUnderReview()) return;
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
    if (blockIfUnderReview()) return;
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
    if (blockIfUnderReview()) return false;

    setSaving(true);
    const result = await saveNow();
    setSaving(false);

    if (result === "empty") {
      setMessage("Add a node before saving this draft.");
      return false;
    }

    if (result === "failed") {
      setMessage("Could not save agent");
      return false;
    }

    if (showMessage) setMessage("Saved just now");

    return true;
  }

  async function publishAgent() {
    if (blockIfPublishLocked()) return;

    const name = agentName.trim();
    const shortDescription = tagline.trim();

    setPublishError("");

    if (name.length < 2 || shortDescription.length < 10) {
      setPublishError(
        "Please add an Agent name and a tagline at least 10 characters in Configure before publishing."
      );
      return;
    }

    setMessage("Submitting for review...");

    const saved = await saveAgent(false);

    if (!saved) {
      setPublishError("Add a node and save this agent before publishing.");
      return;
    }

    const publishId = currentWorkflowIdRef.current;

    if (!publishId) {
      setPublishError("Could not save the workflow before publishing. Please try again.");
      return;
    }

    setSaving(true);

    const configureResult = await getWorkflowConfigure(publishId);
    if (!configureResult.success || !configureResult.data?.configure) {
      setSaving(false);
      setPublishError(configureResult.error ?? "Could not load Configure data. Finish Configure first.");
      setMessage(configureResult.error ?? "Could not load configure");
      return;
    }

    const result = await submitWorkflowForReview(publishId, configureResult.data.configure);

    setSaving(false);

    if (!result.success) {
      setPublishError(result.error ?? "Could not publish agent. Please try again.");
      setMessage(result.error ?? "Could not publish agent");
      return;
    }

    const submittedName =
      configureResult.data.configure.basics.agentName.trim() || name || "Your agent";
    setPublishSuccessName(submittedName);
    setMessage("Submitted for review");
    void loadWorkflow();
  }

  function setConversationTranscript(next: ArchitectConversationMessage[]) {
    conversationMessagesRef.current = next;
    setConversationMessages(next);
  }

  function resetConversationTest() {
    setConversationTranscript([]);
    setConversationLogs([]);
    setConversationToolCalls([]);
    setMessage("Browser call reset");
  }

  /**
   * Prepare a Vapi-powered browser call for the current workflow. Returns the
   * frontend-safe session, or an error reason so the card can fall back to
   * the local simulation with a clear label.
   */
  async function startVapiBrowserTest(): Promise<ArchitectVapiBrowserTestSession | { error: string }> {
    if (blockIfUnderReview()) return { error: REVIEW_LOCK_MESSAGE };

    // Single-flight: one click → one save → one browser-test start request.
    if (vapiBrowserTestStartRef.current) {
      return { error: "A browser call test is already starting." };
    }

    vapiBrowserTestStartRef.current = true;

    try {
      return await startVapiBrowserTestInner();
    } finally {
      vapiBrowserTestStartRef.current = false;
    }
  }

  async function startVapiBrowserTestInner(): Promise<ArchitectVapiBrowserTestSession | { error: string }> {
    setMessage("Starting Vapi browser call...");

    // Flush pending edits so the browser test deploys the latest workflow
    // state (voice preset, model, prompts) — the backend reads from the DB.
    const saved = await saveAgent(false);

    if (!saved || !currentWorkflowIdRef.current) {
      return { error: "Save the agent before testing." };
    }

    const result = await startArchitectVapiBrowserTest(currentWorkflowIdRef.current, {
      testContext: {
        businessName: businessName.trim() || "Sample Business",
        businessType: businessType.trim() || "Service Business",
        callerName: callerName.trim() || "Test caller",
        callerPhone: callerNumber.trim() || "+15555550100",
        calendarId: calendarId.trim() || "primary",
        timeZone: timeZone.trim() || "America/Los_Angeles",
        appointmentService: appointmentService.trim() || "Consultation"
      }
    });

    if (!result.success || !result.data) {
      const reason = result.error ?? "Vapi browser call unavailable";
      setMessage(`${reason} — using fallback simulation`);
      return { error: reason };
    }

    setMessage("Vapi browser call ready");
    return result.data.session;
  }

  async function sendConversationMessage(messageText: string): Promise<string | null> {
    if (blockIfUnderReview()) return null;

    const cleanMessage = messageText.trim();

    if (!cleanMessage) return null;

    const isCallStart = cleanMessage === BROWSER_CALL_START_MESSAGE;

    setChatting(true);
    setMessage("Running browser call test...");

    const saved = await saveAgent(false);

    if (!saved || !currentWorkflowIdRef.current) {
      setChatting(false);
      setMessage("Save the agent before testing browser call.");
      return null;
    }

    const previousMessages = conversationMessagesRef.current.slice(-30);

    const pendingMessages = isCallStart
      ? previousMessages
      : [
        ...previousMessages,
        {
          role: "user" as const,
          content: cleanMessage,
          createdAt: new Date().toISOString()
        }
      ];

    setConversationTranscript(pendingMessages);

    const result = await runArchitectConversationTest(currentWorkflowIdRef.current, {
      message: cleanMessage,
      history: previousMessages,
      testContext: {
        businessName: businessName.trim() || "Sample Business",
        businessType: businessType.trim() || "Service Business",
        callerName: callerName.trim() || "Test caller",
        callerPhone: callerNumber.trim() || "+15555550100",
        calendarId: calendarId.trim() || "primary",
        timeZone: timeZone.trim() || "America/Los_Angeles",
        appointmentService: appointmentService.trim() || "Consultation",
        services: ["Consultation", "Appointment booking", "General inquiry"],
        faqs: [
          "Pricing depends on the selected service.",
          "Urgent requests should be escalated to the team."
        ]
      }
    });

    setChatting(false);

    if (!result.success || !result.data) {
      const errorMessage = result.error ?? "Could not run browser call test.";

      const assistantError: ArchitectConversationMessage = {
        role: "assistant",
        content: errorMessage,
        createdAt: new Date().toISOString()
      };

      setConversationTranscript([...pendingMessages, assistantError]);
      setMessage(errorMessage);
      setActiveTab("test");

      return errorMessage;
    }

    setConversationTranscript(result.data.conversation.transcript);
    setConversationLogs(result.data.conversation.executedNodes);
    setConversationToolCalls(result.data.conversation.toolCalls);
    setMessage("Browser call test complete");
    setActiveTab("test");

    return result.data.conversation.reply;
  }

  async function runAgent() {
    if (blockIfUnderReview()) return;

    const normalizedCallerNumber = callerNumber.trim();
    const normalizedBusinessName = businessName.trim();

    if (hasSmsFlow && !isManualTriggerWorkflow) {
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
    setMessage(hasGmailFlow ? "Running Gmail workflow..." : "Running dry test...");
    setRunLogs([]);
    setRunContext({});

    const saved = await saveAgent(false);

    if (!saved) {
      setRunning(false);
      return;
    }

    // For manual trigger workflows, auto-inject a dummy message when the user
    // hasn't typed anything, so downstream AI nodes have non-empty context.
    const effectiveTriggerMessage =
      triggerMessage.trim() ||
      (isManualTriggerWorkflow ? "Hello, I would like to know more about your services." : undefined);

    const payload = {
      input: {
        callerNumber: normalizedCallerNumber || (isManualTriggerWorkflow ? "test-user" : ""),
        callerName: callerName.trim() || (isManualTriggerWorkflow ? "Test User" : ""),
        businessName: normalizedBusinessName || "Sample Business",
        businessType: businessType.trim() || "Service Business",
        businessPhoneNumber: "",
        calendarId: calendarId.trim() || "primary",
        timeZone: timeZone.trim() || "America/Los_Angeles",
        services: ["Consultation", "Appointment booking", "Urgent request", "General inquiry"],
        faqs: [
          "Pricing depends on the service and business policy.",
          "Urgent calls should be escalated to the team."
        ],
        knowledge: [
          "The AI agent should offer booking first, answer basic questions, and route urgent requests to the team."
        ],
        bookingUrl: "https://example.com/book",
        teamPhone: "",
        callStatus: "no-answer",
        callTimestamp: new Date().toISOString(),
        missedCallReason: "No one picked up the customer call.",
        appointmentService: appointmentService.trim() || "General Consultation",
        inboundSmsBody: effectiveTriggerMessage,
        latestMessage: effectiveTriggerMessage,
        attachments: triggerAttachments.length > 0 ? triggerAttachments : undefined
      }
    };

    const result = await runArchitectWorkflowTest(currentWorkflowIdRef.current, payload);

    if (!result.success || !result.data) {
      setMessage(result.error ?? (hasGmailFlow ? "Could not run Gmail workflow" : "Could not run test"));
      setRunning(false);
      return;
    }

    setRunLogs(result.data.run.logs);
    setRunContext(result.data.run.context);
    setMessage(hasGmailFlow ? "Gmail run complete" : "Dry run complete");
    setActiveTab("test");
    setRunning(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-amber-100 bg-white px-5 py-3 text-sm font-black text-amber-700 shadow-sm">
          Loading Builder...
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
      onUseTemplate={importTemplate}
      onAddNode={addNodeFromLibrary}
    />
  );

  const inspector = (
    <NodeInspector
      selectedNode={selectedNode}
      onClearSelection={() => setSelectedNodeId(null)}
      onUpdateNodeData={updateSelectedNodeData}
      onDeleteNode={deleteSelectedNode}
      connectorOwnership="architect"
      variableNodePrefixes={variableNodePrefixes}
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
        locked={isUnderReview}
        isLive={isLive}
        publishLocked={isPublishLocked}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAgentNameChange={setAgentName}
        onMobileLibrary={() => setMobilePanel("library")}
        onTabChange={setActiveTab}
        onRunTest={() => void runAgent()}
        onSave={() => void saveAgent()}
        onPreview={() => setPreviewOpen(true)}
      />

      {isLive && !isUnderReview ? (
        <div
          data-testid="builder-live-lock-banner"
          className="fixed left-1/2 top-20 z-40 flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 shadow-lg"
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-green-100 text-green-600">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>

          <div>
            <p className="text-sm font-black text-green-800" data-testid="builder-live-lock-title">
              Agent is live
            </p>

            <p className="mt-1 text-sm leading-6 text-green-700" data-testid="builder-live-lock-text">
              This agent is published on the marketplace.
            </p>
          </div>
        </div>
      ) : null}

      {isUnderReview ? (
        <div
          data-testid="builder-review-lock-banner"
          className="fixed left-1/2 top-20 z-40 flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-lg"
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>

          <div>
            <p className="text-sm font-black text-amber-800" data-testid="builder-review-lock-title">
              Agent is under review
            </p>

            <p className="mt-1 text-sm leading-6 text-amber-700" data-testid="builder-review-lock-text">
              Editing is locked while this agent is in review. It will be live in 24-48 hrs after review.
            </p>
          </div>
        </div>
      ) : null}

      <main className="fixed bottom-10 left-0 right-0 top-12 overflow-hidden">
        {activeTab === "build" ? (
          <section className="builder-view fade-enter flex">
            <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-100 bg-white scroll-thin">
              {library}
            </aside>

            <div className="canvas-grid relative flex-1 overflow-hidden">
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
                nodesDraggable={!isUnderReview}
                nodesConnectable={!isUnderReview}
                deleteKeyCode={isUnderReview ? null : undefined}
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
                <span className="flex items-center gap-1" data-testid="architect-ui-workflow-builder-view-scroll-zoom-text">
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">Scroll</kbd> zoom
                </span>

                <span className="flex items-center gap-1" data-testid="architect-ui-workflow-builder-view-space-pan-text">
                  <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-slate-600">Space</kbd> pan
                </span>

                <span className="flex items-center gap-1" data-testid="architect-ui-workflow-builder-view-del-remove-text">
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
            isVoiceWorkflow={isVoiceWorkflow}
            isDentalWorkflow={isDentalWorkflow}
            needsAnyTestConnection={needsAnyTestConnection}
            needsGoogleConnection={needsGoogleConnection}
            needsCalendarConnection={needsCalendarConnection}
            needsTwilioConnection={needsTwilioConnection}
            needsVapiConnection={needsVapiConnection}
            gmailConnected={gmailConnected}
            gmailEmail={gmailEmail}
            calendarConnected={calendarConnected}
            connectingGmail={connectingGmail}
            running={running}
            startingLive={startingLive}
            stoppingLive={stoppingLive}
            callerNumber={callerNumber}
            callerName={callerName}
            businessName={businessName}
            businessType={businessType}
            calendarId={calendarId}
            timeZone={timeZone}
            appointmentService={appointmentService}
            testDeployment={testDeployment}
            runLogs={runLogs}
            runContext={runContext}
            conversationMessages={conversationMessages}
            conversationLogs={conversationLogs}
            conversationToolCalls={conversationToolCalls}
            chatting={chatting}
            triggerMessage={triggerMessage}
            triggerAttachments={triggerAttachments}
            isManualTriggerWorkflow={isManualTriggerWorkflow}
            onConnectGmail={connectGmail}
            onDisconnectGoogle={() => void disconnectGoogle()}
            onRefreshConnections={() => void refreshConnections()}
            onRunTest={() => void runAgent()}
            onStartLiveTest={() => void startLiveTest()}
            onStopLiveTest={() => void stopLiveTest()}
            onStartVapiCall={startVapiBrowserTest}
            onSendConversationMessage={sendConversationMessage}
            onResetConversationTest={resetConversationTest}
            onCallerNumberChange={setCallerNumber}
            onCallerNameChange={setCallerName}
            onBusinessNameChange={setBusinessName}
            onBusinessTypeChange={setBusinessType}
            onCalendarIdChange={setCalendarId}
            onTimeZoneChange={setTimeZone}
            onAppointmentServiceChange={setAppointmentService}
            onTriggerMessageChange={setTriggerMessage}
            onTriggerAttachmentsChange={setTriggerAttachments}
          />
        ) : null}

        {activeTab === "configure" ? (
          <ConfigurePanel
            workflowId={currentWorkflowId}
            architectName={architectName}
            agentName={agentName}
            tagline={tagline}
            price={price}
            workflowFlow={{ nodes, edges }}
            saving={saving}
            statusMessage={message}
            locked={isPublishLocked}
            lockedMessage={
              isLive
                ? "This agent is live on the marketplace. Configuration is locked."
                : isUnderReview
                  ? "This agent is under review. Configuration is locked until the review completes."
                  : ""
            }
            onAgentNameChange={setAgentName}
            onTaglineChange={setTagline}
            onPriceChange={setPrice}
            ensureWorkflowId={async () => {
              const saved = await saveAgent(false);
              return saved ? currentWorkflowIdRef.current : null;
            }}
            onSubmitted={() => {
              setMessage("Submitted for review");
              void loadWorkflow();
            }}
            onGoPublish={() => setActiveTab("publish")}
            onSave={() => void saveAgent()}
          />
        ) : null}

        {activeTab === "publish" ? (
          <PublishPanel
            workflowId={currentWorkflowId}
            agentName={agentName}
            tagline={tagline}
            price={price}
            authorName={architectName}
            workflowFlow={{ nodes, edges }}
            testRunCompleted={testRunStatus.completed}
            testRunSummary={testRunStatus.summary}
            saving={saving}
            statusMessage={message}
            errorMessage={publishError}
            publishLocked={isPublishLocked}
            publishLockedMessage={
              isLive
                ? "This agent is already live on the marketplace. You can test workflow changes, but you can't submit a new publish."
                : isUnderReview
                  ? "Publishing is locked while this agent is under review."
                  : ""
            }
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
        businessName={businessName.trim() || "Your business"}
      />

      {typeof document !== "undefined" && publishSuccessName
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
              data-testid="configure-success-modal"
            >
              <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg">
                  <BuilderIcon name="send" className="h-10 w-10 text-white" />
                </div>
                <h3 className="text-2xl font-extrabold tracking-tight text-slate-900">You&apos;re in review! 🎉</h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-slate-600">
                  {publishSuccessName} has been submitted to the Triven Marketplace. We&apos;ll email you within 24–48 hours.
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    data-testid="configure-success-stay"
                    onClick={() => setPublishSuccessName(null)}
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
                  >
                    Stay in builder
                  </button>
                  <Link
                    href={"/architect/agents" as Route}
                    data-testid="configure-success-view-agents"
                    onClick={() => setPublishSuccessName(null)}
                    className="flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg"
                  >
                    View My Agents
                  </Link>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <MobileSheet panel={mobilePanel} onClose={() => setMobilePanel(null)}>
        {mobilePanel === "library" ? library : inspector}
      </MobileSheet>
    </div>
  );
}