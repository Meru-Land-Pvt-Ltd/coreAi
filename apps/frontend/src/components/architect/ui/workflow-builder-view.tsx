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
  type NodeTypes,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BUILDER_NODE_DRAG_TYPE } from "./workflow-builder/component-library";
import Link from "next/link";
import type { Route } from "next";
import {
  BROWSER_CALL_START_MESSAGE,
  GOOGLE_CALENDAR_DISCLOSURE,
  GOOGLE_DISCLOSURE_ACTION_AGREED,
  VOICE_NODE_TYPES,
  normalizeTimeZone,
  validateConfigureForSubmit
} from "@coreai/shared";
import { GoogleDisclosureModal } from "@/components/common/google-disclosure-modal";
import { ArchitectEmptyState } from "@/components/architect/ui/architect-ui";
import {
  createArchitectWorkflow,
  connectArchitectTelegramTestConnection,
  deleteArchitectTestEvent,
  disconnectArchitectTelegramTestConnection,
  disconnectGmailConnector,
  disconnectCalendlyConnector,
  getArchitectTestDeployment,
  getArchitectWorkflow,
  getArchitectTelegramTestConnection,
  getGmailConnectorStatus,
  getCalendlyConnectorStatus,
  getGmailOAuthUrl,
  getCalendlyOAuthUrl,
  listWhatsAppConnections,
  postGmailDisclosureConsent,
  getLatestArchitectTestEvent,
  getWorkflowConfigure,
  runArchitectWorkflowTest,
  runArchitectConversationTest,
  startArchitectTestDeployment,
  startArchitectVapiBrowserTest,
  stopArchitectTestDeployment,
  submitWorkflowForReview,
  syncArchitectTelegramTestConnection,
  updateArchitectWorkflow,
  useArchitectTemplate
} from "@/components/architect/features/api";
import type { ArchitectTelegramTestConnection } from "@/components/architect/features/api";
import type {
  ArchitectConversationMessage,
  ArchitectConversationToolCall,
  ArchitectTestCalendarEvent,
  ArchitectTestDeploymentStatus,
  ArchitectVapiBrowserTestSession,
  ArchitectWorkflow,
  WorkflowRunLog,
} from "@/components/architect/features/types";

/** The architect's browser IANA zone (canonicalized) — the default test timezone. */
function browserTimeZone(): string {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  } catch {
    return "America/New_York";
  }
}
import { getAuthUser } from "@/lib/auth";
import { WhatsAppConnectModal } from "@/components/architect/features/whatsapp/WhatsAppConnectModal";
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
import {
  TestPanel,
  type TelegramCommandField,
  type TelegramCustomCommand,
  type TelegramTestCommandSettings
} from "./workflow-builder/test-panel";
import { isMeaningfulWorkflow, useBuilderAutosaveHistory } from "./workflow-builder/use-builder-autosave-history";
import { WorkflowBuilderStyles } from "./workflow-builder/builder-styles";
import { deriveWorkflowCapabilities } from "./workflow-builder/workflow-capabilities";
import { analyzeWorkflowGraph } from "./workflow-builder/workflow-graph-validation";
import type { BuilderNode, BuilderNodeData, BuilderTab, MobilePanel, NodeKind, AIAttachment } from "./workflow-builder/types";

const REVIEW_LOCK_MESSAGE = "Agent is under review";
const LIVE_PUBLISH_LOCK_MESSAGE = "Agent is live — publishing is locked";

const BUILDER_TABS: readonly BuilderTab[] = ["build", "test", "configure", "publish"];
/** Tabs that require a single connected trigger workflow. */
const TABS_REQUIRING_CONNECTED_FLOW: readonly BuilderTab[] = ["test", "configure", "publish"];

function isBuilderTab(value: string | null): value is BuilderTab {
  return Boolean(value) && (BUILDER_TABS as readonly string[]).includes(value as string);
}

function tabRequiresConnectedFlow(tab: BuilderTab): boolean {
  return (TABS_REQUIRING_CONNECTED_FLOW as readonly string[]).includes(tab);
}

export function isManualTriggerNode(node: { data?: Record<string, unknown>; type?: unknown }): boolean {
  const dataType = String(node.data?.type ?? node.type ?? "").toLowerCase();
  return dataType === "trigger.manual" || dataType === "manual_trigger" || dataType === "manual";
}

function testInputsStashKey(workflowId: string): string {
  return `triven-builder-test-inputs:${workflowId || "draft"}`;
}

function builderFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function telegramTestServices(value: string): string[] {
  return Array.from(
    new Set(value.split(/\r?\n|,/).map((service) => service.trim()).filter(Boolean))
  ).slice(0, 30);
}

export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const [workflow, setWorkflow] = useState<ArchitectWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BuilderTab>("build");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [flowGateNotice, setFlowGateNotice] = useState<{
    title: string;
    message: string;
    issue: string | null;
    kind: "graph" | "configure";
  } | null>(null);
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
  const [calendlyConnected, setCalendlyConnected] = useState(false);
  const [calendlyEmail, setCalendlyEmail] = useState<string | null>(null);
  const [calendlyName, setCalendlyName] = useState<string | null>(null);
  const [connectingCalendly, setConnectingCalendly] = useState(false);
  const [calendlyEventTypeUri, setCalendlyEventTypeUri] = useState("");
  const [calendlyEventUuid, setCalendlyEventUuid] = useState("");
  const [calendlyInviteeUuid, setCalendlyInviteeUuid] = useState("");
  const [calendlyStartTime, setCalendlyStartTime] = useState("");
  const [calendlyEndTime, setCalendlyEndTime] = useState("");
  const [calendlyInviteeName, setCalendlyInviteeName] = useState("");
  const [calendlyInviteeEmail, setCalendlyInviteeEmail] = useState("");
  const [calendlyMeetingName, setCalendlyMeetingName] = useState("");
  const [calendlyTriggerEvent, setCalendlyTriggerEvent] = useState("meeting_booked");
  const [calendlyDurationMinutes, setCalendlyDurationMinutes] = useState("30");
  const [calendlyOneOffStartDate, setCalendlyOneOffStartDate] = useState(() => {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const offset = start.getTimezoneOffset();
    const local = new Date(start.getTime() - offset * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [calendlyOneOffEndDate, setCalendlyOneOffEndDate] = useState(() => {
    const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    end.setHours(17, 0, 0, 0);
    const offset = end.getTimezoneOffset();
    const local = new Date(end.getTime() - offset * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [calendlyTimezone, setCalendlyTimezone] = useState("America/New_York");
  const [calendlyLocationKind, setCalendlyLocationKind] = useState("google_conference");
  const [calendlyLocation, setCalendlyLocation] = useState("");
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [whatsappConnected, setWhatsAppConnected] = useState(false);
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);
  const [telegramTestConnection, setTelegramTestConnection] = useState<ArchitectTelegramTestConnection | null>(null);
  const [connectingTelegramTest, setConnectingTelegramTest] = useState(false);
  const [syncingTelegramTest, setSyncingTelegramTest] = useState(false);
  const [whatsappConnectOpen, setWhatsAppConnectOpen] = useState(false);
  const [googleDisclosureOpen, setGoogleDisclosureOpen] = useState(false);
  const [agentName, setAgentName] = useState(defaultAgentName);
  const [tagline, setTagline] = useState(defaultAgentDescription);
  const [price, setPrice] = useState("149");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [appointmentService, setAppointmentService] = useState("");
  const [testDate, setTestDate] = useState("");
  const [testTime, setTestTime] = useState("");
  // After-hours simulation for chat + browser voice tests ("current" = no override).
  const [testAfterHoursState, setTestAfterHoursState] = useState<"current" | "open" | "closed">("current");
  const [useTestCalendar, setUseTestCalendar] = useState(false);
  const [conversationCalendarEvent, setConversationCalendarEvent] = useState<ArchitectTestCalendarEvent | null>(null);
  const [conversationConfigError, setConversationConfigError] = useState<{ code: string; message: string; remediation: string } | null>(null);
  const [deletingTestEvent, setDeletingTestEvent] = useState(false);
  // One session id per builder visit groups this dry run's test records.
  const testSessionIdRef = useRef<string>(`ts_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`);
  const [testEmail, setTestEmail] = useState("");
  const [callerNumber, setCallerNumber] = useState("");
  const [callerName, setCallerName] = useState("");
  const [triggerMessage, setTriggerMessage] = useState("");
  const [triggerAttachments, setTriggerAttachments] = useState<AIAttachment[]>([]);
  const [testDeployment, setTestDeployment] = useState<ArchitectTestDeploymentStatus | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [stoppingLive, setStoppingLive] = useState(false);
  const [loading, setLoading] = useState(true);
  // Context-specific loader text so users can tell which action is running.
  const [loadingLabel, setLoadingLabel] = useState("Loading Builder...");
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

  const flowInstanceRef = useRef<ReactFlowInstance<BuilderNode, Edge> | null>(null);

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

  // Live canvas → Test / Configure capability flags (recomputes when nodes change).
  const capabilities = useMemo(() => deriveWorkflowCapabilities(nodes), [nodes]);
  const graphValidation = useMemo(() => analyzeWorkflowGraph(nodes, edges), [nodes, edges]);
  const isConnectedWorkflowReady = graphValidation.ok;
  const hasGmailFlow = capabilities.hasGmail;
  const hasSmsFlow = capabilities.hasSmsSendOrTwilioConnector;
  const isVoiceWorkflow = capabilities.hasVoice;
  const isTelegramWorkflow = capabilities.hasTelegram;
  const telegramCommandSettings = useMemo<TelegramTestCommandSettings>(() => {
    const data = nodes.find((node) => node.data.type === "trigger.telegram_message")?.data;
    return {
      telegramBookingMode: builderFlag(data?.telegramBookingMode, false),
      telegramServicesCommand: builderFlag(data?.telegramServicesCommand, false),
      telegramBookCommand: builderFlag(data?.telegramBookCommand, false),
      telegramMyBookingsCommand: builderFlag(data?.telegramMyBookingsCommand, false),
      telegramRescheduleCommand: builderFlag(data?.telegramRescheduleCommand, false),
      telegramCancelCommand: builderFlag(data?.telegramCancelCommand, false),
      telegramHelpCommand: builderFlag(data?.telegramHelpCommand, true)
    };
  }, [nodes]);
  const telegramCustomCommands = useMemo<TelegramCustomCommand[]>(() => {
    const value = nodes.find((node) => node.data.type === "trigger.telegram_message")?.data.telegramCustomCommands;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is TelegramCustomCommand => Boolean(
        item &&
        typeof item.id === "string" &&
        typeof item.command === "string" &&
        typeof item.description === "string" &&
        typeof item.action === "string" &&
        typeof item.response === "string"
      ))
      .slice(0, 20);
  }, [nodes]);
  const needsCalendarConnection = capabilities.hasCalendar;
  const needsCalendlyConnection = capabilities.hasCalendly;
  const isMissedCallWorkflow = capabilities.hasMissedCall;
  const isSmsWorkflow = capabilities.hasInboundSms;
  const isManualTriggerWorkflow = capabilities.hasManualTrigger;
  const hasEmailNode = capabilities.hasEmailSend;
  const hasWhatsAppTrigger = capabilities.hasWhatsAppTrigger;

  const needsGoogleConnection = hasGmailFlow || needsCalendarConnection;
  // Twilio/Vapi cards are for live sandbox only — browser call test does not need them.
  const liveSandboxActive =
    testDeployment?.status === "READY" || Boolean(testDeployment?.assignedPhoneNumber);
  const needsTwilioConnection = liveSandboxActive && (isVoiceWorkflow || hasSmsFlow);
  const needsVapiConnection = liveSandboxActive && isVoiceWorkflow;
  const needsWhatsAppConnection = capabilities.hasWhatsApp;
  const needsAnyTestConnection =
    needsGoogleConnection ||
    needsCalendarConnection ||
    needsCalendlyConnection ||
    needsTwilioConnection ||
    needsVapiConnection ||
    isTelegramWorkflow ||
    needsWhatsAppConnection;

  const requestTabChange = useCallback(
    async (tab: BuilderTab) => {
      if (tabRequiresConnectedFlow(tab) && !isConnectedWorkflowReady) {
        setActiveTab("build");
        setFlowGateNotice({
          kind: "graph",
          title: graphValidation.title,
          message: graphValidation.message || "Connect your workflow before continuing.",
          issue: graphValidation.issue
        });
        return;
      }

      if (tab === "publish") {
        const workflowIdForConfigure = currentWorkflowIdRef.current;
        if (!workflowIdForConfigure) {
          setActiveTab("configure");
          setFlowGateNotice({
            kind: "configure",
            title: "Finish Configure first",
            message: "Complete the required Configure steps before you can open Publish.",
            issue: "configure_incomplete"
          });
          return;
        }

        const configureResult = await getWorkflowConfigure(workflowIdForConfigure);
        if (!configureResult.success || !configureResult.data?.configure) {
          setActiveTab("configure");
          setFlowGateNotice({
            kind: "configure",
            title: "Finish Configure first",
            message:
              configureResult.error ??
              "Complete the required Configure steps before you can open Publish.",
            issue: "configure_incomplete"
          });
          return;
        }

        const issues = validateConfigureForSubmit(configureResult.data.configure);
        if (issues.length > 0) {
          setActiveTab("configure");
          setFlowGateNotice({
            kind: "configure",
            title: "Finish Configure first",
            message:
              issues[0]?.message ??
              "Complete all required Configure fields before you can open Publish.",
            issue: "configure_incomplete"
          });
          return;
        }
      }

      setFlowGateNotice(null);
      setActiveTab(tab);
    },
    [graphValidation.issue, graphValidation.message, graphValidation.title, isConnectedWorkflowReady]
  );

  useEffect(() => {
    if (loading) return;
    if (tabRequiresConnectedFlow(activeTab) && !isConnectedWorkflowReady) {
      setActiveTab("build");
      setFlowGateNotice({
        kind: "graph",
        title: graphValidation.title,
        message: graphValidation.message || "Connect your workflow before continuing.",
        issue: graphValidation.issue
      });
    }
  }, [activeTab, graphValidation.issue, graphValidation.message, graphValidation.title, isConnectedWorkflowReady, loading]);

  useEffect(() => {
    if (loading || activeTab !== "publish") return;

    let cancelled = false;
    const workflowIdForConfigure = currentWorkflowIdRef.current;

    void (async () => {
      if (!workflowIdForConfigure) {
        if (cancelled) return;
        setActiveTab("configure");
        setFlowGateNotice({
          kind: "configure",
          title: "Finish Configure first",
          message: "Complete the required Configure steps before you can open Publish.",
          issue: "configure_incomplete"
        });
        return;
      }

      const configureResult = await getWorkflowConfigure(workflowIdForConfigure);
      if (cancelled) return;

      if (!configureResult.success || !configureResult.data?.configure) {
        setActiveTab("configure");
        setFlowGateNotice({
          kind: "configure",
          title: "Finish Configure first",
          message:
            configureResult.error ??
            "Complete the required Configure steps before you can open Publish.",
          issue: "configure_incomplete"
        });
        return;
      }

      const issues = validateConfigureForSubmit(configureResult.data.configure);
      if (issues.length > 0) {
        setActiveTab("configure");
        setFlowGateNotice({
          kind: "configure",
          title: "Finish Configure first",
          message:
            issues[0]?.message ??
            "Complete all required Configure fields before you can open Publish.",
          issue: "configure_incomplete"
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, loading]);

  useEffect(() => {
    if (isConnectedWorkflowReady && flowGateNotice?.kind === "graph") {
      setFlowGateNotice(null);
    }
  }, [flowGateNotice, isConnectedWorkflowReady]);

  const isDentalWorkflow = useMemo(() => {
    const name = `${agentName} ${workflow?.name ?? ""}`.toLowerCase();
    return isVoiceWorkflow && name.includes("dental");
  }, [agentName, workflow?.name, isVoiceWorkflow]);

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

  // Test-tab form fields stay empty until the architect types them.
  // Placeholders guide input; run/call handlers still apply safe fallbacks if blank.

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

        if (!res.success || !res.data) {
          if (res.error) setMessage(`Save failed: ${res.error}`);
          return false;
        }

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

      if (!res.success && res.error) {
        setMessage(`Save failed: ${res.error}`);
      }

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

      const sourceNode = nodes.find((node) => node.id === connection.source);
      const edgeAccent = sourceNode?.data.icon === "telegram" ? "blue" : "amber";

      setEdges((currentEdges) =>
        addEdge(
          createFlowEdge({
            id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle ?? undefined,
            accent: edgeAccent
          }),
          currentEdges
        )
      );
    },
    [nodes, setEdges, blockIfUnderReview]
  );

  async function loadWorkflow(label = "Loading Builder...") {
    setLoadingLabel(label);
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

      const triggerNode = parsedNodes.find(isManualTriggerNode);
      if (triggerNode) {
        if (typeof triggerNode.data.input === "string" && triggerNode.data.input) {
          setTriggerMessage(triggerNode.data.input);
        }
        if (Array.isArray(triggerNode.data.attachments) && triggerNode.data.attachments.length > 0) {
          setTriggerAttachments(triggerNode.data.attachments as AIAttachment[]);
        }
      }

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

  async function loadCalendlyStatus() {
    const result = await getCalendlyConnectorStatus();
    if (result.success && result.data) {
      setCalendlyConnected(result.data.connected);
      setCalendlyEmail(result.data.email);
      setCalendlyName(result.data.name);
      if (result.data.timezone?.trim()) {
        setCalendlyTimezone(result.data.timezone.trim());
      }
    }
  }

  async function loadWhatsAppStatus() {
    const result = await listWhatsAppConnections();
    if (!result.success) return;

    const connections = result.data?.connections ?? [];
    setWhatsAppConnected(connections.some((c) => c.status === "CONNECTED"));
  }

  async function loadTestDeployment() {
    const id = currentWorkflowIdRef.current;
    if (!id) return;

    const result = await getArchitectTestDeployment(id);
    if (result.success && result.data) {
      setTestDeployment(result.data.testDeployment);
    }
  }

  async function loadTelegramTestStatus() {
    const id = currentWorkflowIdRef.current;
    if (!id) return;
    const result = await getArchitectTelegramTestConnection(id);
    if (result.success && result.data) {
      setTelegramTestConnection(result.data.connection);
      if (result.data.connection?.services?.length) {
        setAppointmentService((current) => current.trim() || result.data!.connection!.services.join("\n"));
      }
    }
  }

  function updateTelegramCommand(field: TelegramCommandField, value: boolean) {
    if (blockIfUnderReview()) return;
    setNodes((current) => current.map((node) => {
      if (node.data.type !== "trigger.telegram_message") return node;
      const clearedBookingCommands = field === "telegramBookingMode" && !value
        ? {
            telegramBookCommand: "false",
            telegramMyBookingsCommand: "false",
            telegramRescheduleCommand: "false",
            telegramCancelCommand: "false"
          }
        : {};
      return {
        ...node,
        data: {
          ...node.data,
          ...clearedBookingCommands,
          [field]: String(value)
        }
      };
    }));
  }

  function updateTelegramCustomCommands(commands: TelegramCustomCommand[]) {
    if (blockIfUnderReview()) return;
    setNodes((current) => current.map((node) => node.data.type === "trigger.telegram_message"
      ? { ...node, data: { ...node.data, telegramCustomCommands: commands.slice(0, 20) } }
      : node));
  }

  function telegramTestContext() {
    const services = telegramTestServices(appointmentService);
    return {
      businessName: businessName.trim() || agentName.trim() || undefined,
      businessType: businessType.trim() || undefined,
      appointmentService: services[0],
      services,
      timeZone: timeZone.trim() || undefined
    };
  }

  async function connectTelegramTest(botToken: string) {
    if (blockIfUnderReview()) return;
    setConnectingTelegramTest(true);
    setMessage("Connecting Telegram test bot...");
    try {
      const saved = await saveAgent(false);
      const id = currentWorkflowIdRef.current;
      if (!saved || !id) {
        setMessage("Save the workflow before connecting a Telegram test bot.");
        return;
      }
      const result = await connectArchitectTelegramTestConnection(id, {
        botToken,
        ...telegramTestContext()
      });
      if (!result.success || !result.data) {
        setMessage(result.error ?? "Could not connect the Telegram test bot.");
        return;
      }
      setTelegramTestConnection(result.data.connection);
      setMessage("Telegram test bot connected. Open it and send a real message.");
    } finally {
      setConnectingTelegramTest(false);
    }
  }

  async function syncTelegramTest() {
    if (blockIfUnderReview()) return;
    const id = currentWorkflowIdRef.current;
    if (!id || !telegramTestConnection?.connected) return;
    setSyncingTelegramTest(true);
    setMessage("Saving and syncing Telegram test setup...");
    try {
      const saved = await saveAgent(false);
      if (!saved) {
        setMessage("Could not save the workflow before syncing Telegram.");
        return;
      }
      const result = await syncArchitectTelegramTestConnection(id, telegramTestContext());
      if (!result.success || !result.data) {
        setMessage(result.error ?? "Could not sync Telegram test settings.");
        return;
      }
      setTelegramTestConnection(result.data.connection);
      setMessage("Test business name, commands, and services synced. Open the bot on your phone to test them.");
    } finally {
      setSyncingTelegramTest(false);
    }
  }

  async function disconnectTelegramTest() {
    const id = currentWorkflowIdRef.current;
    if (!id) return;
    setConnectingTelegramTest(true);
    try {
      const result = await disconnectArchitectTelegramTestConnection(id);
      if (!result.success) {
        setMessage(result.error ?? "Could not disconnect the Telegram test bot.");
        return;
      }
      setTelegramTestConnection(null);
      setMessage("Telegram test bot disconnected.");
    } finally {
      setConnectingTelegramTest(false);
    }
  }

  /** Opens the mandatory pre-OAuth disclosure — OAuth starts only from its agree action. */
  function connectGmail() {
    setGoogleDisclosureOpen(true);
  }

  function connectWhatsApp() {
    setWhatsAppConnectOpen(true);
  }

  async function connectCalendly() {
    setConnectingCalendly(true);
    setMessage("Connecting Calendly...");
    const returnTo = new URL(window.location.href);
    returnTo.searchParams.delete("calendly");
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
          testEmail,
          callerNumber,
          callerName,
          triggerMessage
        })
      );
    } catch {
      // Storage unavailable/full — the connection itself must still proceed.
    }

    const result = await getCalendlyOAuthUrl(`${returnTo.pathname}${returnTo.search}`);
    if (result.success && result.data) {
      window.location.href = result.data.url;
      return;
    }
    setConnectingCalendly(false);
    setMessage(result.error ?? "Could not connect Calendly");
  }

  async function handleGoogleDisclosureAgreed() {
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
          testEmail,
          callerNumber,
          callerName,
          triggerMessage
        })
      );
    } catch {
      // Storage unavailable/full — the connection itself must still proceed.
    }

    try {
      const consent = await postGmailDisclosureConsent({
        disclosureVersion: GOOGLE_CALENDAR_DISCLOSURE.version,
        action: GOOGLE_DISCLOSURE_ACTION_AGREED
      });
      if (!consent.success) {
        throw new Error(consent.error ?? "Could not record your agreement.");
      }

      const result = await getGmailOAuthUrl(`${returnTo.pathname}${returnTo.search}`);

      if (result.success && result.data) {
        window.location.href = result.data.url;
        return;
      }

      throw new Error(result.error ?? "Could not connect Google");
    } catch (connectError) {
      setConnectingGmail(false);
      const failure =
        connectError instanceof Error ? connectError : new Error("Could not connect Google");
      setMessage(failure.message);
      throw failure;
    }
  }

  async function disconnectGoogle() {
    const result = await disconnectGmailConnector();
    setMessage(result.success ? "Google disconnected" : result.error ?? "Could not disconnect Google");
    await loadGmailStatus();
    await loadTestDeployment();
  }

  async function disconnectCalendly() {
    const result = await disconnectCalendlyConnector();
    setMessage(result.success ? "Calendly disconnected" : result.error ?? "Could not disconnect Calendly");
    await loadCalendlyStatus();
  }

  async function refreshConnections() {
    setMessage("Refreshing connection status...");
    await Promise.all([loadGmailStatus(), loadCalendlyStatus(), loadWhatsAppStatus(), loadTelegramTestStatus(), loadTestDeployment()]);
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
    void loadCalendlyStatus();
    void loadWhatsAppStatus();
    void loadTestDeployment();
  }, [workflowId]);

  useEffect(() => {
    if (!isTelegramWorkflow || activeTab !== "test") return;
    // The bot webhook runs independently. Load status once on entry; the Test
    // panel's Refresh status button is the explicit way to fetch newer logs.
    void loadTelegramTestStatus();
  }, [activeTab, isTelegramWorkflow, currentWorkflowId]);

  // On mobile, open the Components drawer automatically when entering Build.
  useEffect(() => {
    if (loading) return;

    if (activeTab !== "build") {
      setMobilePanel((prev) => (prev === "library" ? null : prev));
      return;
    }

    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setMobilePanel("library");
    }
  }, [activeTab, loading]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const tabParam = url.searchParams.get("tab");
    const gmailParam = url.searchParams.get("gmail");
    const calendlyParam = url.searchParams.get("calendly");

    if (isBuilderTab(tabParam)) setActiveTab(tabParam);
    if (gmailParam === "connected") setMessage("Google connected");
    else if (gmailParam === "failed") setMessage("Google connection failed — please try again");
    if (calendlyParam === "connected") setMessage("Calendly connected");
    else if (calendlyParam === "failed") setMessage("Calendly connection failed — please try again");
    else if (calendlyParam === "denied") setMessage("Calendly connection was cancelled");

    if (tabParam !== null || gmailParam !== null || calendlyParam !== null) {
      url.searchParams.delete("tab");
      url.searchParams.delete("gmail");
      url.searchParams.delete("calendly");
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
        const savedTestEmail = str(saved.testEmail);
        const savedCallerNumber = str(saved.callerNumber);
        const savedCallerName = str(saved.callerName);
        const savedTriggerMessage = str(saved.triggerMessage);

        if (savedBusinessName) setBusinessName(savedBusinessName);
        if (savedBusinessType) setBusinessType(savedBusinessType);
        if (savedCalendarId) setCalendarId(savedCalendarId);
        if (savedTimeZone) setTimeZone(savedTimeZone);
        if (savedService) setAppointmentService(savedService);
        if (savedTestEmail) setTestEmail(savedTestEmail);
        if (savedCallerNumber) setCallerNumber(savedCallerNumber);
        if (savedCallerName) setCallerName(savedCallerName);
        if (savedTriggerMessage) setTriggerMessage(savedTriggerMessage);
      }
    } catch {
      // Corrupted/blocked storage — the page still works, just without restore.
    }
  }, [workflowId]);

  function addNodeFromLibrary(
    nodeKind: NodeKind,
    overrides?: Partial<BuilderNodeData>,
    position?: { x: number; y: number }
  ) {
    if (blockIfUnderReview()) return;

    const id = `${nodeKind}-${Date.now()}`;

    const newNode: BuilderNode = {
      id,
      type: "coreNode",
      position: position ?? {
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

        const isTriggerNode = isManualTriggerNode(node);

        if (isTriggerNode) {
          if (field === "input") {
            setTriggerMessage(String(value ?? ""));
          } else if (field === "attachments") {
            setTriggerAttachments((value as AIAttachment[]) ?? []);
          }
        }

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
    void loadWorkflow("Publishing your agent...");
  }

  function setConversationTranscript(next: ArchitectConversationMessage[]) {
    conversationMessagesRef.current = next;
    setConversationMessages(next);
  }

  function resetConversationTest() {
    setConversationTranscript([]);
    setConversationLogs([]);
    setConversationToolCalls([]);
    setConversationCalendarEvent(null);
    setConversationConfigError(null);
    setMessage("Browser call reset");
  }

  // After a Vapi voice call ends, surface the test event booked during the
  // call (real or simulated) in the panel's event card with its delete action.
  async function refreshLatestTestEvent() {
    const result = await getLatestArchitectTestEvent(testSessionIdRef.current);

    if (result.success && result.data?.event) {
      setConversationCalendarEvent(result.data.event);
      setMessage(
        result.data.event.status === "CREATED"
          ? "Test calendar event created during the call"
          : "Simulated test booking recorded during the call"
      );
    }
  }

  async function deleteTestEvent(testEventId: string) {
    setDeletingTestEvent(true);
    const result = await deleteArchitectTestEvent(testEventId);
    setDeletingTestEvent(false);

    if (result.success) {
      setConversationCalendarEvent(null);
      // The dry-run result panel reads from runContext — mark its event deleted too.
      setRunContext((previous) => {
        const appointment = previous.calendarAppointment as Record<string, unknown> | undefined;
        if (appointment && appointment.testEventId === testEventId) {
          return { ...previous, calendarAppointment: { ...appointment, status: "DELETED", htmlLink: null, testEventId: null } };
        }
        return previous;
      });
      setMessage("Test calendar event deleted");
    } else {
      setMessage(result.error ?? "Could not delete the test event.");
    }
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
        timeZone: timeZone.trim() || browserTimeZone(),
        appointmentService: appointmentService.trim() || "Consultation",
        // Voice-call bookings honor the same test-calendar toggle as the chat test.
        useTestCalendar,
        testSessionId: testSessionIdRef.current,
        // After-hours simulation ("current" = no override, real behavior).
        simulateBusinessHoursState: testAfterHoursState
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

    try {
      const saved = await saveAgent(false);

      if (!saved || !currentWorkflowIdRef.current) {
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

      const serviceName = appointmentService.trim();
      const result = await runArchitectConversationTest(currentWorkflowIdRef.current, {
        message: cleanMessage,
        history: previousMessages,
        testSessionId: testSessionIdRef.current,
        useTestCalendar,
        // After-hours simulation ("current" = no override, real behavior).
        simulateBusinessHoursState: testAfterHoursState,
        testContext: {
          businessName: businessName.trim() || "Sample Business",
          businessType: businessType.trim() || "Service Business",
          callerName: callerName.trim() || "Test caller",
          callerPhone: callerNumber.trim() || "+15555550100",
          calendarId: calendarId.trim() || "primary",
          timeZone: timeZone.trim() || browserTimeZone(),
          // The exact service the architect typed — the backend only falls back
          // when nothing was supplied.
          appointmentService: serviceName || undefined,
          // Test-form date/time seed the booking; chat statements still win.
          requestedDate: testDate || undefined,
          requestedTime: testTime || undefined,
          services: serviceName
            ? [serviceName, "General inquiry"]
            : ["Consultation", "Appointment booking", "General inquiry"],
          faqs: [
            "Pricing depends on the selected service.",
            "Urgent requests should be escalated to the team."
          ]
        }
      });

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
      if (result.data.conversation.calendarEvent) {
        setConversationCalendarEvent(result.data.conversation.calendarEvent);
      }
      // Config errors (timezone) and booking failures (calendar disconnected,
      // event-create failure) share the actionable error panel.
      setConversationConfigError(
        result.data.conversation.configError ?? result.data.conversation.calendarError ?? null
      );
      setMessage("Browser call test complete");
      setActiveTab("test");

      return result.data.conversation.reply;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not run browser call test.";
      setMessage(errorMessage);
      return errorMessage;
    } finally {
      setChatting(false);
    }
  }

  const handleTriggerMessageChange = useCallback((newMsg: string) => {
    setTriggerMessage(newMsg);
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const isTriggerNode = isManualTriggerNode(node);
        if (isTriggerNode) {
          return {
            ...node,
            data: {
              ...node.data,
              input: newMsg
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  const handleTriggerAttachmentsChange = useCallback((newAtts: AIAttachment[]) => {
    setTriggerAttachments(newAtts);
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const isTriggerNode = isManualTriggerNode(node);
        if (isTriggerNode) {
          return {
            ...node,
            data: {
              ...node.data,
              attachments: newAtts
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

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
      setMessage("Connect Google before running this agent");
      return;
    }

    if (needsCalendlyConnection && !calendlyConnected) {
      setActiveTab("test");
      setMessage("Connect Calendly before running this agent");
      return;
    }

    if (capabilities.calendlyActions.some((action) => action.toLowerCase() === "book_meeting_for_invitee")) {
      if (!calendlyEventTypeUri.trim()) {
        setActiveTab("test");
        setMessage("Select a Calendly event type before booking a meeting");
        return;
      }
      if (!calendlyStartTime.trim()) {
        setActiveTab("test");
        setMessage("Select a Calendly start time before booking a meeting");
        return;
      }
      if (!calendlyInviteeName.trim()) {
        setActiveTab("test");
        setMessage("Enter an invitee name before booking a meeting");
        return;
      }
      if (!calendlyInviteeEmail.trim()) {
        setActiveTab("test");
        setMessage("Enter an invitee email before booking a meeting");
        return;
      }
    }

    if (
      capabilities.calendlyActions.some((action) => action.toLowerCase() === "create_one_off_meeting_link")
    ) {
      if (!calendlyMeetingName.trim()) {
        setActiveTab("test");
        setMessage("Enter a meeting name for the one-off meeting link");
        return;
      }
      if (!calendlyOneOffStartDate.trim() || !calendlyOneOffEndDate.trim()) {
        setActiveTab("test");
        setMessage("Select start and end dates for the one-off meeting link");
        return;
      }
      if (!calendlyDurationMinutes.trim()) {
        setActiveTab("test");
        setMessage("Select a duration for the one-off meeting link");
        return;
      }
    }

    if (needsWhatsAppConnection && !whatsappConnected) {
      setActiveTab("test");
      setMessage("Connect WhatsApp before running this agent");
      return;
    }

    const whatsappTriggerNode = nodes.find((node) => {
      const type = String(node.data.type ?? "").toLowerCase();
      return type === "trigger.whatsapp_message_received" || type.startsWith("trigger.whatsapp");
    });
    const whatsappSendNode = nodes.find((node) => {
      const type = String(node.data.type ?? "").toLowerCase();
      const connector = String(node.data.connector ?? "").toLowerCase();
      return type.includes("whatsapp") || connector === "whatsapp";
    });
    const whatsappConnectionId = String(
      whatsappTriggerNode?.data.connectionId ?? whatsappSendNode?.data.connectionId ?? ""
    ).trim();

    if (needsWhatsAppConnection && !whatsappConnectionId) {
      setActiveTab("test");
      setMessage("Select a WhatsApp connection on the WhatsApp node before testing");
      return;
    }

    if (hasWhatsAppTrigger) {
      if (!normalizedCallerNumber) {
        setActiveTab("test");
        setMessage("Enter a sender phone number first");
        return;
      }
      if (!triggerMessage.trim()) {
        setActiveTab("test");
        setMessage("Enter a WhatsApp message to simulate first");
        return;
      }
    }

    setRunning(true);
    setMessage("Running dry test...");
    setRunLogs([]);
    setRunContext({});

    try {
      const saved = await saveAgent(false);

      if (!saved || !currentWorkflowIdRef.current) {
        setMessage("Could not save agent before running test.");
        return;
      }

      const triggerNode = nodes.find(isManualTriggerNode);
      const nodeInput = typeof triggerNode?.data.input === "string" ? triggerNode.data.input.trim() : "";
      const nodeAttachments = (triggerNode?.data.attachments as AIAttachment[] | undefined) ?? [];

      const effectiveTriggerMessage =
        triggerMessage.trim() ||
        nodeInput ||
        (isManualTriggerWorkflow ? "Hello, I would like to know more about your services." : undefined);

      const effectiveAttachments = isManualTriggerWorkflow
        ? undefined
        : triggerAttachments.length > 0
          ? triggerAttachments
          : nodeAttachments.length > 0
            ? nodeAttachments
            : undefined;

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
        ...(!needsCalendlyConnection ||
        isMissedCallWorkflow ||
        isVoiceWorkflow ||
        isSmsWorkflow ||
        hasWhatsAppTrigger
          ? {
              callStatus: "no-answer",
              callTimestamp: new Date().toISOString(),
              missedCallReason: "No one picked up the customer call."
            }
          : {}),
        appointmentService: appointmentService.trim() || "General Consultation",
        ...(testDate
          ? {
              appointmentStartAt: `${testDate}T${(testTime || "09:00").padStart(5, "0")}:00`,
              appointmentEndAt: undefined
            }
          : {}),
        useTestCalendar,
        testSessionId: testSessionIdRef.current,
        testEmail: testEmail.trim() || undefined,
        inboundSmsBody: effectiveTriggerMessage,
        latestMessage: effectiveTriggerMessage,
        ...(isTelegramWorkflow
          ? {
              telegramChatId: "architect-dry-run-chat",
              telegramUserId: "architect-dry-run-user",
              telegramUsername: "test_customer",
              telegramMessageId: "1",
              telegramUpdateId: `dry-run-${Date.now()}`,
              telegramChatType: "private",
              telegramPhoneNumber: normalizedCallerNumber || "+15555550100"
            }
          : {}),
        ...(hasWhatsAppTrigger && whatsappConnectionId
          ? {
              triggerType: "trigger.whatsapp_message_received",
              whatsapp: {
                type: "WHATSAPP_MESSAGE" as const,
                connectionId: whatsappConnectionId,
                contact: {
                  name: callerName.trim() || null,
                  phone: normalizedCallerNumber || "+15555550100"
                },
                customer: {
                  name: callerName.trim() || null,
                  phone: normalizedCallerNumber || "+15555550100"
                },
                message: {
                  id: `dry-run-${Date.now()}`,
                  type: "text",
                  text: effectiveTriggerMessage || "Hello",
                  mediaUrl: null
                },
                timestamp: new Date().toISOString()
              }
            }
          : {}),
        ...(needsCalendlyConnection
          ? {
              triggerType: "trigger.calendly",
              calendlyTriggerEvent: calendlyTriggerEvent.trim() || "meeting_booked",
              calendlyInviteeName: calendlyInviteeName.trim() || undefined,
              calendlyInviteeEmail: calendlyInviteeEmail.trim() || undefined,
              calendlyMeetingName: calendlyMeetingName.trim() || undefined,
              calendlyEventTypeUri: calendlyEventTypeUri.trim() || undefined,
              calendlyEventUuid: calendlyEventUuid.trim() || undefined,
              calendlyInviteeUuid: calendlyInviteeUuid.trim() || undefined,
              calendlyStartTime: calendlyStartTime.trim() || undefined,
              calendlyEndTime: calendlyEndTime.trim() || undefined,
              calendlyDurationMinutes: calendlyDurationMinutes.trim() || undefined,
              calendlyOneOffStartDate: calendlyOneOffStartDate.trim() || undefined,
              calendlyOneOffEndDate: calendlyOneOffEndDate.trim() || undefined,
              calendlyTimezone: calendlyTimezone.trim() || timeZone.trim() || undefined,
              calendlyLocationKind: calendlyLocationKind.trim() || undefined,
              calendlyLocation: calendlyLocation.trim() || undefined
            }
          : {}),
        attachments: effectiveAttachments
      }
    };

      const result = await runArchitectWorkflowTest(currentWorkflowIdRef.current, payload);

      if (!result.success || !result.data) {
        setMessage(result.error ?? "Could not run test");
        return;
      }

      setRunLogs(result.data.run.logs);
      setRunContext(result.data.run.context);
      setMessage("Dry run complete");
      setActiveTab("test");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not run test");
    } finally {
      setRunning(false);
    }
  }

  const nodeTypeOf = (node: BuilderNode): string => {
    const data = node.data as Record<string, unknown>;
    return String(data.type ?? data.kind ?? "");
  };
  const previewDisplayName = businessName.trim() || agentName.trim() || "Your business";
  const previewVoiceData = (
    nodes.find((node) => nodeTypeOf(node) === VOICE_NODE_TYPES.voiceConversation)?.data ?? {}
  ) as Record<string, unknown>;
  const previewAssistantName =
    typeof previewVoiceData.assistantName === "string" ? previewVoiceData.assistantName.trim() : "";
  const previewGreetingRaw =
    typeof previewVoiceData.firstMessage === "string" ? previewVoiceData.firstMessage : "";
  const previewGreeting = previewGreetingRaw
    .replace(/\{\{\s*assistantName\s*\}\}/gi, previewAssistantName || "our assistant")
    .replace(/\{\{\s*business[_]?name\s*\}\}/gi, previewDisplayName)
    .replace(/\{\{\s*business\.name\s*\}\}/gi, previewDisplayName)
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const previewCanBook = nodes.some((node) => {
    const type = nodeTypeOf(node);
    return type === VOICE_NODE_TYPES.bookAppointment || type.includes("book_appointment");
  });
  const previewCanText = nodes.some((node) => {
    const type = nodeTypeOf(node);
    return (
      type === VOICE_NODE_TYPES.sendSms ||
      type === "action.send_sms" ||
      type === "trigger.twilio_inbound_sms" ||
      type === "trigger.twilio_missed_call" ||
      type.includes("send_sms")
    );
  });
  const previewSmsData = (
    nodes.find((node) => {
      const type = nodeTypeOf(node);
      return type === VOICE_NODE_TYPES.sendSms || type === "action.send_sms" || type.includes("send_sms");
    })?.data ?? {}
  ) as Record<string, unknown>;
  const previewSmsBodyRaw =
    typeof previewSmsData.smsBody === "string"
      ? previewSmsData.smsBody
      : typeof previewSmsData.message === "string"
        ? previewSmsData.message
        : "";
  const previewSmsBody = previewSmsBodyRaw
    .replace(/\{\{\s*assistantName\s*\}\}/gi, previewAssistantName || "our assistant")
    .replace(/\{\{\s*business[_]?name\s*\}\}/gi, previewDisplayName)
    .replace(/\{\{\s*business\.name\s*\}\}/gi, previewDisplayName)
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, "there")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const previewBookingSlots = (() => {
    const availability = runContext.calendarAvailability as { slots?: unknown } | undefined;
    if (!availability || !Array.isArray(availability.slots)) return [];
    return availability.slots
      .map((slot) => (typeof slot === "string" ? slot.trim() : ""))
      .filter(Boolean)
      .slice(0, 2);
  })();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-amber-100 bg-white px-5 py-3 text-sm font-black text-amber-700 shadow-sm" data-testid="builder-loading-label">
          {loadingLabel}
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

      <GoogleDisclosureModal
        open={googleDisclosureOpen}
        onAgree={handleGoogleDisclosureAgreed}
        onCancel={() => setGoogleDisclosureOpen(false)}
      />

      <WhatsAppConnectModal
        open={whatsappConnectOpen}
        onClose={() => {
          setWhatsAppConnectOpen(false);
          setConnectingWhatsApp(false);
        }}
        onConnected={() => {
          void loadWhatsAppStatus();
        }}
      />

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
        onTabChange={requestTabChange}
        onRunTest={() => requestTabChange("test")}
        onSave={() => void saveAgent()}
        onPreview={() => setPreviewOpen(true)}
      />

      {isLive && !isUnderReview ? (
        <div
          data-testid="builder-live-lock-banner"
          className="fixed left-1/2 top-[7.25rem] z-40 flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 shadow-lg md:top-20"
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
          className="fixed left-1/2 top-[7.25rem] z-40 flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-lg md:top-20"
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

      {flowGateNotice ? (
        <div
          data-testid="builder-workflow-connect-banner"
          className="fixed left-1/2 top-[7.25rem] z-40 flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg md:top-20"
          role="status"
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-slate-900" data-testid="builder-workflow-connect-title">
              {flowGateNotice.title}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600" data-testid="builder-workflow-connect-text">
              {flowGateNotice.message}
            </p>

          </div>
          <button
            type="button"
            data-testid="builder-workflow-connect-dismiss"
            onClick={() => setFlowGateNotice(null)}
            className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      ) : null}

      <main className="fixed bottom-10 left-0 right-0 top-[6.5rem] overflow-hidden md:top-14">
        {activeTab === "build" ? (
          <section className="builder-view fade-enter flex min-w-0">
            <aside className="hidden w-[22rem] shrink-0 overflow-y-auto border-r border-gray-100 bg-white scroll-thin xl:block">
              {library}
            </aside>

            <div
              className="canvas-grid relative min-w-0 flex-1 overflow-hidden"
              onTouchStart={(event) => {
                if (mobilePanel || window.innerWidth >= 1280) return;
                const touch = event.touches[0];
                if (!touch || touch.clientX > 28) return;
                (event.currentTarget as HTMLElement).dataset.edgeSwipeX = String(touch.clientX);
              }}
              onTouchEnd={(event) => {
                const startRaw = (event.currentTarget as HTMLElement).dataset.edgeSwipeX;
                delete (event.currentTarget as HTMLElement).dataset.edgeSwipeX;
                if (!startRaw || mobilePanel || window.innerWidth >= 1280) return;
                const touch = event.changedTouches[0];
                if (!touch) return;
                const startX = Number(startRaw);
                if (touch.clientX - startX > 48) setMobilePanel("library");
              }}
            >
              {/* Premium left-edge handle — opens swipeable Components drawer on mobile */}
              {mobilePanel !== "library" ? (
                <button
                  type="button"
                  onClick={() => setMobilePanel("library")}
                  data-testid="builder-mobile-library"
                  aria-label="Open components"
                  title="Open components"
                  className="absolute left-0 top-1/2 z-20 flex h-16 w-7 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-amber-200 bg-white text-amber-600 shadow-[2px_0_12px_-4px_rgba(15,23,42,0.18)] transition hover:w-8 hover:bg-amber-50 hover:text-amber-700 active:scale-[0.98] xl:hidden"
                >
                  <span className="flex flex-col items-center gap-1">
                    <span className="h-5 w-0.5 rounded-full bg-amber-300" aria-hidden="true" />
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    <span className="h-5 w-0.5 rounded-full bg-amber-300" aria-hidden="true" />
                  </span>
                </button>
              ) : null}

              <ReactFlow<BuilderNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onInit={(instance) => {
                  flowInstanceRef.current = instance;
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(BUILDER_NODE_DRAG_TYPE)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  const raw = event.dataTransfer.getData(BUILDER_NODE_DRAG_TYPE);
                  if (!raw) return;
                  event.preventDefault();

                  try {
                    const payload = JSON.parse(raw) as {
                      nodeKind: NodeKind;
                      overrides?: Partial<BuilderNodeData>;
                    };
                    /* Drop where the pointer actually is, not the stagger slot. */
                    const position = flowInstanceRef.current?.screenToFlowPosition({
                      x: event.clientX,
                      y: event.clientY
                    });
                    addNodeFromLibrary(payload.nodeKind, payload.overrides, position);
                  } catch {
                    // Not our payload — ignore.
                  }
                }}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  if (window.innerWidth < 1280) setMobilePanel("settings");
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
                <Controls showInteractive={false} />
              </ReactFlow>

              <div className="absolute right-2 top-2 z-10 hidden max-w-[calc(100%-1rem)] items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-500 shadow-sm backdrop-blur md:right-4 md:top-4 md:flex md:gap-3 md:px-3 md:py-2">
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

            <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-gray-100 bg-white scroll-thin xl:block">
              {inspector}
            </aside>
          </section>
        ) : null}

        {activeTab === "test" ? (
          <TestPanel
            hasGmailFlow={hasGmailFlow}
            hasEmailNode={hasEmailNode}
            isVoiceWorkflow={isVoiceWorkflow}
            isDentalWorkflow={isDentalWorkflow}
            needsAnyTestConnection={needsAnyTestConnection}
            needsGoogleConnection={needsGoogleConnection}
            needsCalendarConnection={needsCalendarConnection}
            needsTwilioConnection={needsTwilioConnection}
            needsVapiConnection={needsVapiConnection}
            needsWhatsAppConnection={needsWhatsAppConnection}
            hasWhatsAppTrigger={hasWhatsAppTrigger}
            needsCalendlyConnection={needsCalendlyConnection}
            calendlyActions={capabilities.calendlyActions}
            hasCalendlyTrigger={capabilities.hasCalendlyTrigger}
            gmailConnected={gmailConnected}
            gmailEmail={gmailEmail}
            calendarConnected={calendarConnected}
            connectingGmail={connectingGmail}
            calendlyConnected={calendlyConnected}
            calendlyEmail={calendlyEmail}
            calendlyName={calendlyName}
            connectingCalendly={connectingCalendly}
            calendlyEventTypeUri={calendlyEventTypeUri}
            calendlyEventUuid={calendlyEventUuid}
            calendlyInviteeUuid={calendlyInviteeUuid}
            calendlyStartTime={calendlyStartTime}
            calendlyEndTime={calendlyEndTime}
            calendlyInviteeName={calendlyInviteeName}
            calendlyInviteeEmail={calendlyInviteeEmail}
            calendlyMeetingName={calendlyMeetingName}
            calendlyTriggerEvent={calendlyTriggerEvent}
            calendlyDurationMinutes={calendlyDurationMinutes}
            calendlyOneOffStartDate={calendlyOneOffStartDate}
            calendlyOneOffEndDate={calendlyOneOffEndDate}
            calendlyTimezone={calendlyTimezone}
            calendlyLocationKind={calendlyLocationKind}
            calendlyLocation={calendlyLocation}
            whatsappConnected={whatsappConnected}
            connectingWhatsApp={connectingWhatsApp}
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
            testDate={testDate}
            testTime={testTime}
            testAfterHoursState={testAfterHoursState}
            useTestCalendar={useTestCalendar}
            conversationCalendarEvent={conversationCalendarEvent}
            conversationConfigError={conversationConfigError}
            deletingTestEvent={deletingTestEvent}
            testEmail={testEmail}
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
            isMissedCallWorkflow={isMissedCallWorkflow}
            isSmsWorkflow={isSmsWorkflow}
            isTelegramWorkflow={isTelegramWorkflow}
            telegramTestConnection={telegramTestConnection}
            connectingTelegramTest={connectingTelegramTest}
            syncingTelegramTest={syncingTelegramTest}
            telegramCommandSettings={telegramCommandSettings}
            telegramCustomCommands={telegramCustomCommands}
            onConnectGmail={connectGmail}
            onDisconnectGoogle={() => void disconnectGoogle()}
            onConnectCalendly={() => void connectCalendly()}
            onDisconnectCalendly={() => void disconnectCalendly()}
            onCalendlyEventTypeUriChange={setCalendlyEventTypeUri}
            onCalendlyEventUuidChange={setCalendlyEventUuid}
            onCalendlyInviteeUuidChange={setCalendlyInviteeUuid}
            onCalendlyStartTimeChange={setCalendlyStartTime}
            onCalendlyEndTimeChange={setCalendlyEndTime}
            onCalendlyInviteeNameChange={setCalendlyInviteeName}
            onCalendlyInviteeEmailChange={setCalendlyInviteeEmail}
            onCalendlyMeetingNameChange={setCalendlyMeetingName}
            onCalendlyTriggerEventChange={setCalendlyTriggerEvent}
            onCalendlyDurationMinutesChange={setCalendlyDurationMinutes}
            onCalendlyOneOffStartDateChange={setCalendlyOneOffStartDate}
            onCalendlyOneOffEndDateChange={setCalendlyOneOffEndDate}
            onCalendlyTimezoneChange={setCalendlyTimezone}
            onCalendlyLocationKindChange={setCalendlyLocationKind}
            onCalendlyLocationChange={setCalendlyLocation}
            onRefreshConnections={() => void refreshConnections()}
            onRunTest={() => void runAgent()}
            onStartLiveTest={() => void startLiveTest()}
            onStopLiveTest={() => void stopLiveTest()}
            onStartVapiCall={startVapiBrowserTest}
            onSendConversationMessage={sendConversationMessage}
            onResetConversationTest={resetConversationTest}
            onBrowserCallEnded={() => void refreshLatestTestEvent()}
            onCallerNumberChange={setCallerNumber}
            onCallerNameChange={setCallerName}
            onBusinessNameChange={setBusinessName}
            onBusinessTypeChange={setBusinessType}
            onCalendarIdChange={setCalendarId}
            onTimeZoneChange={setTimeZone}
            onAppointmentServiceChange={setAppointmentService}
            onTestDateChange={setTestDate}
            onTestTimeChange={setTestTime}
            onTestAfterHoursStateChange={setTestAfterHoursState}
            onUseTestCalendarChange={setUseTestCalendar}
            onDeleteTestEvent={(id) => void deleteTestEvent(id)}
            onTestEmailChange={setTestEmail}
            onTriggerMessageChange={handleTriggerMessageChange}
            onTriggerAttachmentsChange={handleTriggerAttachmentsChange}
            onConnectWhatsApp={connectWhatsApp}
            onConnectTelegramTest={(token) => connectTelegramTest(token)}
            onSyncTelegramTest={() => void syncTelegramTest()}
            onDisconnectTelegramTest={() => void disconnectTelegramTest()}
            onTelegramCommandChange={updateTelegramCommand}
            onTelegramCustomCommandsChange={updateTelegramCustomCommands}
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
              void loadWorkflow("Applying configuration...");
            }}
            onGoPublish={() => void requestTabChange("publish")}
            onGoBuild={() => setActiveTab("build")}
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
            onGoConfigure={() => {
              setFlowGateNotice(null);
              setActiveTab("configure");
            }}
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
        workflowId={currentWorkflowId}
        businessName={previewDisplayName}
        assistantName={previewAssistantName}
        greeting={previewGreeting}
        smsBody={previewSmsBody}
        agentPurpose={tagline.trim()}
        canBook={previewCanBook}
        canText={previewCanText}
        bookingSlots={previewBookingSlots}
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
