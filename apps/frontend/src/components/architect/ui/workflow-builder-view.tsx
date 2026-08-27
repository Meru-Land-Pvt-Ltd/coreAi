"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  addEdge,
  ControlButton,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BUILDER_NODE_DRAG_TYPE } from "./workflow-builder/component-library";
import { AiBuilderPanel, type ComposedCanvas } from "./workflow-builder/ai-builder-panel";
import { AgentDoor } from "./workflow-builder/agent-door";
import { wayInFor } from "@coreai/shared";
import { useWiringCheck } from "./workflow-builder/use-wiring-check";
import { apiPost } from "@/lib/api";
import Link from "next/link";
import type { Route } from "next";
import {
  BROWSER_CALL_START_MESSAGE,
  GOOGLE_CALENDAR_DISCLOSURE,
  GOOGLE_DISCLOSURE_ACTION_AGREED,
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
  getAgentPageConfig,
  getLatestArchitectTestEvent,
  getWorkflowConfigure,
  previewRunArchitectWorkflow,
  runArchitectWorkflowTest,
  runArchitectConversationTest,
  startArchitectTestDeployment,
  startArchitectVapiBrowserTest,
  stopArchitectTestDeployment,
  submitWorkflowForReview,
  syncArchitectTelegramTestConnection,
  updateAgentPageConfig,
  updateArchitectWorkflow,
  useArchitectTemplate as instantiateArchitectTemplate
} from "@/components/architect/features/api";
import type { ArchitectTelegramTestConnection } from "@/components/architect/features/api";
import type {
  AgentPageManageData,
  ArchitectConversationMessage,
  ArchitectConversationToolCall,
  ArchitectTestCalendarEvent,
  ArchitectTestDeploymentStatus,
  ArchitectVapiBrowserTestSession,
  ArchitectWorkflow,
  WorkflowRunLog,
} from "@/components/architect/features/types";
import {
  AGENT_PAGE_DESIGN_DEFAULTS,
  type ContentWidth
} from "@/components/agent-page/types";

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
import { reconnectEdge } from "@xyflow/react";
import { createFlowEdge } from "./workflow-builder/edge-utils";
import { RemovableEdge } from "./workflow-builder/removable-edge";
import { BusinessMirror } from "./workflow-builder/business-mirror";
import { BuilderIcon } from "./workflow-builder/icons";
import { applyTidyPositions } from "./workflow-builder/layout-graph";
import { MobileSheet } from "./workflow-builder/mobile-sheet";
import { NodeInspector } from "./workflow-builder/node-inspector";
import { defaultAgentDescription, defaultAgentName, defaultNodeData } from "./workflow-builder/node-defaults";
import { parseEdges, parseNodes, toBuilderEdges, toBuilderNodes } from "./workflow-builder/parsers";
import {
  PreviewPanel,
  type PreviewChatResult,
  type PreviewDevice,
  type PreviewRunResult,
  type PreviewVoiceResult
} from "./workflow-builder/preview-panel";
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

const LIBRARY_WIDTH_KEY = "triven-builder-library-width";
const INSPECTOR_WIDTH_KEY = "triven-builder-inspector-width";
const LIBRARY_WIDTH_DEFAULT = 495;
const INSPECTOR_WIDTH_DEFAULT = 320;
const LIBRARY_WIDTH_MIN = 280;
const LIBRARY_WIDTH_MAX = 560;
const INSPECTOR_WIDTH_MIN = 280;
const INSPECTOR_WIDTH_MAX = 480;

function clampSidebarWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStoredSidebarWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const parsed = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return clampSidebarWidth(parsed, min, max);
}

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

/**
 * Keep the current selection only while its node still exists — the reload
 * contract for server-side graph changes (AI Builder rewires the canvas).
 */
export function nextSelectedNodeId(
  current: string | null,
  nodes: readonly { id: string }[]
): string | null {
  return current && nodes.some((node) => node.id === current) ? current : null;
}

/**
 * The four live Faces an empty canvas offers. Slugs match the sidebar
 * template cards (component-library) — clicking inserts through the exact
 * same template-import path (onUseTemplate) the sidebar cards use.
 */
const FACE_PICKER_CHOICES = [
  {
    slug: "chatbot",
    label: "Chatbot",
    icon: "message-circle",
    blurb: "A friendly chat that answers questions"
  },
  {
    slug: "voice-agent",
    label: "Voice Agent",
    icon: "phone-call",
    blurb: "Talks with callers and books appointments"
  },
  {
    slug: "image-studio",
    label: "Image Studio",
    icon: "image",
    blurb: "Turns written ideas into pictures"
  },
  {
    slug: "form-tool",
    label: "Form Tool",
    icon: "file",
    blurb: "Collects details and returns a finished result"
  }
] as const;

/**
 * Empty-canvas Face picker — a centered card over the canvas only (the
 * palette stays fully usable beside it). Renders nothing the moment any
 * piece exists. The fade-enter animation is reduced-motion-safe: the
 * builder's global prefers-reduced-motion rule collapses all animation.
 */
export function EmptyCanvasFacePicker({
  nodeCount,
  importingSlug,
  onPick,
  onComposed
}: {
  /** Live canvas piece count — the picker only exists while it is zero. */
  nodeCount: number;
  /** Template slug currently importing (disables the cards), or null. */
  importingSlug: string | null;
  /** Same insert path as the sidebar template cards (onUseTemplate). */
  onPick: (slug: string) => void;
  /** An orchestration the composer built, ready to land on the canvas. */
  onComposed: (canvas: ComposedCanvas) => void;
}) {
  // "Custom" celebrates the blank canvas: dismiss the picker and let the
  // architect build anything their way from the left panel.
  const [dismissed, setDismissed] = useState(false);
  // The composer takes over the whole card while it works — a progress list
  // beside four template buttons reads as clutter at exactly the moment the
  // architect is watching one thing.
  const [composing, setComposing] = useState(false);
  if (nodeCount > 0 || dismissed) return null;

  if (composing) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
        <div
          data-testid="canvas-picker-composer"
          className="fade-enter pointer-events-auto w-full max-w-xl rounded-3xl border border-gray-200 bg-white/95 p-6 shadow-xl backdrop-blur"
        >
          {/* The same one assistant as everywhere else — on a blank canvas its
              build hand is live, so "an AI receptionist for a dental clinic"
              composes the whole agent. */}
          <AiBuilderPanel workflowId={null} canvasHasSteps={false} onBuilt={onComposed} />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <div
        data-testid="canvas-picker"
        className="fade-enter pointer-events-auto w-full max-w-xl rounded-3xl border border-gray-200 bg-white/95 p-6 shadow-xl backdrop-blur"
      >
        <h2 className="text-center text-lg font-black tracking-tight text-slate-900" data-testid="canvas-picker-title">
          What are you building?
        </h2>

        <button
          type="button"
          data-testid="canvas-picker-compose"
          onClick={() => setComposing(true)}
          disabled={importingSlug !== null}
          className="group mt-5 flex w-full items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-left transition hover:border-amber-400 hover:bg-amber-50 hover:shadow-md disabled:cursor-wait disabled:opacity-60"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-200 text-amber-700 transition group-hover:bg-amber-300">
            <BuilderIcon name="wand" className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">Build with AI composer</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-500">
              Describe what you want in plain English. It picks the steps, wires them together and sets the
              conditions — using only pieces that already exist.
            </span>
          </span>
        </button>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FACE_PICKER_CHOICES.map((choice) => (
            <button
              key={choice.slug}
              type="button"
              data-testid={`canvas-picker-${choice.slug}`}
              onClick={() => onPick(choice.slug)}
              disabled={importingSlug !== null}
              className="group flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-amber-300 hover:bg-amber-50/60 hover:shadow-md disabled:cursor-wait disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-600 transition group-hover:bg-amber-200">
                <BuilderIcon name={choice.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900">{choice.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  {importingSlug === choice.slug ? "Setting things up..." : choice.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          data-testid="canvas-picker-custom"
          onClick={() => setDismissed(true)}
          disabled={importingSlug !== null}
          className="group mt-3 flex w-full items-start gap-3 rounded-2xl border border-dashed border-rose-300 bg-rose-50/40 p-4 text-left transition hover:border-rose-400 hover:bg-rose-50 hover:shadow-md disabled:cursor-wait disabled:opacity-60"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 transition group-hover:bg-rose-200">
            <BuilderIcon name="edit" className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">Custom — build anything</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-500">
              A blank canvas and every piece in the left panel. Your idea, your way — unlimited.
            </span>
          </span>
        </button>

        <p
          className="mt-5 text-center text-xs font-medium text-slate-400"
          data-testid="canvas-picker-drag-hint"
        >
          or drag pieces from the left panel
        </p>
      </div>
    </div>
  );
}


export function ArchitectWorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const [workflow, setWorkflow] = useState<ArchitectWorkflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BuilderTab>("build");
  // Test tab view: the customer-facing preview by default; "advanced" reveals
  // the full developer test console. Reset on every Test tab entry.
  const [testView, setTestView] = useState<"preview" | "advanced">("preview");
  // Which device the Test preview shows. Lives here — not in the panel — so
  // the compact switcher in the main header drives the preview stage.
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  // Arrange mode: drag the preview page's sections anywhere (desktop only).
  // Owned here so the header pill and the preview stage stay one truth.
  const [arrangeMode, setArrangeMode] = useState(false);
  // Saved customer-page design for the Test preview (null until fetched or
  // when the workflow has never been configured/published).
  const [previewPageData, setPreviewPageData] = useState<AgentPageManageData | null>(null);
  /**
   * False until the saved page/product has been fetched at least once for this
   * agent. Without it the preview paints the built-in chat Face for a few
   * hundred milliseconds and then swaps to the architect's real product — a
   * flash of a page they never designed.
   */
  const [previewConfigLoaded, setPreviewConfigLoaded] = useState(false);

  // Arrange mode only exists on the Preview step's desktop view — leaving
  // either always turns it off, so it can never linger invisibly.
  useEffect(() => {
    if (activeTab !== "test" || previewDevice !== "desktop") setArrangeMode(false);
  }, [activeTab, previewDevice]);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [flowGateNotice, setFlowGateNotice] = useState<{
    title: string;
    message: string;
    issue: string | null;
    kind: "graph" | "configure";
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [libraryWidth, setLibraryWidth] = useState(LIBRARY_WIDTH_DEFAULT);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_WIDTH_DEFAULT);
  const [isResizingLibrary, setIsResizingLibrary] = useState(false);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
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
  const [calendlyMeetingName, setCalendlyMeetingName] = useState("One-off meeting");
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
  const [calendlyLocationKind, setCalendlyLocationKind] = useState("ask_invitee");
  const [calendlyLocation, setCalendlyLocation] = useState("");
  const [calendlyContactEmail, setCalendlyContactEmail] = useState("");
  const [calendlyContactUuid, setCalendlyContactUuid] = useState("");
  const [calendlyContactName, setCalendlyContactName] = useState("");
  const [calendlyCancelReason, setCalendlyCancelReason] = useState("");
  const [calendlyMeetingRecapUuid, setCalendlyMeetingRecapUuid] = useState("");
  const [calendlyUserSearch, setCalendlyUserSearch] = useState("");
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
  /* The AI Builder on the Build tab — the founder's call: one assistant, every
     screen, never hunt for it. */
  const [aiBuilderOpen, setAiBuilderOpenState] = useState(false);
  /* Remembered per browser: an employee who vanished on every visit would
     read as a toy. Read after mount (SSR has no storage). */
  useEffect(() => {
    try {
      if (window.localStorage.getItem("triven.aiBuilderOpen") === "1") setAiBuilderOpenState(true);
    } catch {
      /* storage blocked — the default closed state stands */
    }
  }, []);
  const setAiBuilderOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setAiBuilderOpenState((open) => {
      const value = typeof next === "function" ? next(open) : next;
      try {
        window.localStorage.setItem("triven.aiBuilderOpen", value ? "1" : "0");
      } catch {
        /* storage blocked — memory-only is fine */
      }
      return value;
    });
  }, []);
  /* DECLARED purpose only — what the architect told the AI Builder. Never the
     description: that is a marketing tagline many old agents already carry,
     and tallying against one produced confident nonsense. */
  const [agentPurpose, setAgentPurpose] = useState("");
  /* Seeded "149" and never set anywhere — the publish screen printed it as a
     real price. Empty means "we do not know yet", which is the truth. */
  const [price, setPrice] = useState("");
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
  const triggerAttachmentsRef = useRef<AIAttachment[]>([]);
  const [testDeployment, setTestDeployment] = useState<ArchitectTestDeploymentStatus | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [stoppingLive, setStoppingLive] = useState(false);
  const [loading, setLoading] = useState(true);
  // Context-specific loader text so users can tell which action is running.
  const [loadingLabel, setLoadingLabel] = useState("Loading Builder...");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  /* THE PREVIEW LAW, Rule 2: Run belongs where you are. The log opens in a
     drawer on Build instead of throwing the architect onto another tab. */
  const [dryRunConfigureHints, setDryRunConfigureHints] = useState<string[]>([]);
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

  useEffect(() => {
    setLibraryWidth(readStoredSidebarWidth(LIBRARY_WIDTH_KEY, LIBRARY_WIDTH_DEFAULT, LIBRARY_WIDTH_MIN, LIBRARY_WIDTH_MAX));
    setInspectorWidth(readStoredSidebarWidth(INSPECTOR_WIDTH_KEY, INSPECTOR_WIDTH_DEFAULT, INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX));
  }, []);

  useEffect(() => {
    if (!isResizingLibrary && !isResizingInspector) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingLibrary, isResizingInspector]);

  const startLibraryResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = libraryWidth;
    setIsResizingLibrary(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      setLibraryWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX), LIBRARY_WIDTH_MIN, LIBRARY_WIDTH_MAX));
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + (upEvent.clientX - startX), LIBRARY_WIDTH_MIN, LIBRARY_WIDTH_MAX);
      setLibraryWidth(nextWidth);
      setIsResizingLibrary(false);
      window.localStorage.setItem(LIBRARY_WIDTH_KEY, String(nextWidth));
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [libraryWidth]);

  const startInspectorResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    setIsResizingInspector(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      setInspectorWidth(clampSidebarWidth(startWidth + (startX - moveEvent.clientX), INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX));
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + (startX - upEvent.clientX), INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX);
      setInspectorWidth(nextWidth);
      setIsResizingInspector(false);
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(nextWidth));
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [inspectorWidth]);

  const flowInstanceRef = useRef<ReactFlowInstance<BuilderNode, Edge> | null>(null);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({ coreNode: CoreNode as unknown as ComponentType<NodeProps> }),
    []
  );

  /* Every wire carries a cross when you point at it — see removable-edge.tsx. */
  const edgeTypes = useMemo<EdgeTypes>(() => ({ removable: RemovableEdge }), []);

  /*
   * THE CANVAS CHECKS ITSELF.
   *
   * Runs after every change an architect makes — a step added, a wire moved, a
   * value typed — and paints the answer onto the steps themselves. There is no
   * button, because a check somebody has to remember to press is a check that
   * catches things after the customer does.
   */
  const wiring = useWiringCheck(
    nodes as unknown as Array<{ id: string; data?: Record<string, unknown> }>,
    edges as unknown as Array<{ source: string; target: string }>
  );

  const [repairing, setRepairing] = useState(false);
  const [repairNote, setRepairNote] = useState<string | null>(null);

  /**
   * Fix it for me.
   *
   * Sends the canvas as it stands and puts back what comes home. Nothing is
   * saved by this — the change lands on their screen like any other edit, so
   * undo works and they can look before they keep it.
   */
  const repairCanvasNow = useCallback(async () => {
    setRepairing(true);
    setRepairNote(null);

    const result = await apiPost<{
      fixed: boolean;
      message?: string;
      summary?: string;
      nodes?: BuilderNode[];
      edges?: Edge[];
      fixedProblems?: string[];
      remaining?: Array<{ message: string }>;
    }>("/architect/compose/repair", {
      nodes: nodes.map((node) => ({ id: node.id, position: node.position, data: node.data })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
    });

    setRepairing(false);

    if (!result.success || !result.data) {
      setRepairNote("That could not be fixed just now. Nothing was changed.");
      return;
    }
    if (!result.data.fixed) {
      setRepairNote(result.data.message ?? "Nothing was changed.");
      return;
    }

    if (result.data.nodes) setNodes(toBuilderNodes(result.data.nodes));
    if (result.data.edges) setEdges(toBuilderEdges(result.data.edges));
    setRepairNote(result.data.summary ?? "Fixed.");
  }, [nodes, edges, setNodes, setEdges]);

  /* The steps as the canvas draws them, each carrying its own verdict. */
  const checkedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const problems = wiring.byNode[node.id];
        return {
          ...node,
          data: {
            ...node.data,
            ...(problems ? { wiringProblems: problems } : {}),
            wiringChecked: wiring.known
          }
        };
      }),
    [nodes, wiring.byNode, wiring.known]
  ) as typeof nodes;

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  /* THE PREVIEW LAW, Rule 1: the canvas decides who is in the mirror.
     No Face nodes and no way for a customer to speak to it → nobody ever
     types at this agent, and the person in front of the mirror is the
     BUSINESS. The generic chat face for such an agent was a face for a person
     who does not exist. */
  /* THE DOOR'S JUDGEMENT (the founder's ruling, 2026-08-27). The old logic
     branded Telegram "conversational" and dressed it as a website. wayInFor
     is deterministic and exam-guarded in shared — the same judgement every
     time, for every surface. */
  const wayIn = useMemo(
    () => wayInFor({ nodes: nodes.map((node) => ({ data: { type: String(node.data.type ?? "") } })) }),
    [nodes]
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

  /**
   * COPY THE STEP I AM LOOKING AT — ⌘D, or Ctrl+D.
   *
   * A brain briefed over ten minutes, a Condition with six roads named by hand:
   * building the second one meant doing the whole thing again from a blank node.
   * The copy lands slightly below and to the right, unwired and selected, so the
   * next thing an architect does is drag it where they want it.
   *
   * Nothing is copied while somebody is typing — ⌘D inside a prompt box would
   * take the words they are writing and put a node on the canvas instead.
   */
  /* Read inside the shortcut so the listener is bound once and still sees the
     canvas as it is now, rather than as it was when the key handler was made. */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  const duplicateSelected = useCallback(() => {
    if (isUnderReview) return;
    const original = nodesRef.current.find((node) => node.id === selectedNodeIdRef.current);
    if (!original) return;

    const id = `${String(original.data.nodeKind ?? "node")}-${Date.now()}`;
    setNodes((current) => [
      ...current,
      {
        ...original,
        id,
        selected: false,
        position: { x: original.position.x + 48, y: original.position.y + 64 },
        // A deep-enough copy that editing the copy never edits the original.
        data: JSON.parse(JSON.stringify(original.data)) as BuilderNodeData
      }
    ]);
    setSelectedNodeId(id);
    setMessage("Unsaved changes");
  }, [isUnderReview, setNodes]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "d" && event.key !== "D") return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (typing) return;

      // The browser's own ⌘D is "bookmark this page", which is never what an
      // architect means with a step selected on a canvas.
      event.preventDefault();
      duplicateSelected();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [duplicateSelected]);
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

  // Preview Face auto-pick flags, straight from the canvas node types.
  // Voice: an AI voice conversation node. Media: an image/video GENERATION
  // node ("generation" required so e.g. send_whatsapp_video doesn't count).
  const hasVoiceNode = useMemo(
    () =>
      nodes.some((node) =>
        String(node.data?.type ?? node.type ?? "").toLowerCase().includes("voice_conversation")
      ),
    [nodes]
  );
  const hasMediaNode = useMemo(
    () =>
      nodes.some((node) => {
        const type = String(node.data?.type ?? node.type ?? "").toLowerCase();
        return type.includes("image_generation") || type.includes("video_generation");
      }),
    [nodes]
  );

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

  // Every entry to the Test tab opens on the customer preview; "Advanced
  // testing" is a per-visit choice, never sticky.
  useEffect(() => {
    if (activeTab === "test") setTestView("preview");
  }, [activeTab]);

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

  // The saved customer-page design (template, accent, headline, welcome,
  // suggested prompts) PLUS the product blueprint derived from the graph, so
  // the preview shows exactly what the customer will see. Refetched on every
  // Test entry to pick up Publish-tab and canvas edits; a miss simply leaves
  // the preview on its built-in defaults.
  //
  // ORDERING GUARANTEE: the manage endpoint derives the blueprint from the
  // SAVED workflow, so pending canvas edits are flushed first (awaited) and
  // the fetch starts only after that save settles — the architect's
  // just-placed blocks are always in the preview they open. A failed or
  // empty save still fetches: the preview then shows the last saved state.
  // (This effect lives below the autosave hook because it awaits `saveNow`.)
  useEffect(() => {
    if (activeTab !== "test" || !currentWorkflowId) return;

    let cancelled = false;
    void (async () => {
      if (!isUnderReview) {
        // Same review-lock rule as the run engines: never write while locked.
        try {
          await saveNow();
        } catch {
          // Fetch proceeds on the last saved state.
        }
      }
      if (cancelled) return;

      try {
        const result = await getAgentPageConfig(currentWorkflowId);
        if (!cancelled && result.success && result.data) setPreviewPageData(result.data);
      } catch {
        // Preview still works without the saved design.
      } finally {
        // Loaded either way: a failed fetch must not leave the stage blank
        // forever — the built-in Face is the honest fallback at that point.
        if (!cancelled) setPreviewConfigLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentWorkflowId, isUnderReview, saveNow]);

  /**
   * Lightweight refetch of the saved page + design for the Test preview —
   * the AI Builder chat calls this right after a patch lands so the
   * preview iframe restyles without leaving the Build tab. Reads the id
   * from the ref so the callback stays stable across renders.
   */
  const refreshAgentPageConfig = useCallback(() => {
    const id = currentWorkflowIdRef.current;
    if (!id) return;

    void (async () => {
      try {
        const result = await getAgentPageConfig(id);
        if (result.success && result.data) setPreviewPageData(result.data);
      } catch {
        // Preview keeps its last data; the Test-entry fetch will catch up.
      }
    })();
  }, []);

  /**
   * Graph reload contract: refetch the saved workflow row and replace the
   * canvas nodes/edges with the server's copy — used when the AI Builder
   * (or any server-side helper) changed the saved graph behind the canvas.
   * The selection survives only if its node still exists; a failed fetch
   * leaves the canvas untouched.
   */
  const reloadWorkflowFromServer = useCallback(async () => {
    const id = currentWorkflowIdRef.current;
    if (!id) return;

    try {
      const result = await getArchitectWorkflow(id);
      if (!result.success || !result.data) return;

      const loadedWorkflow = result.data.workflow;
      const parsedNodes = parseNodes(loadedWorkflow);
      const parsedEdges = parseEdges(loadedWorkflow);

      setWorkflow(loadedWorkflow);
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setSelectedNodeId((current) => nextSelectedNodeId(current, parsedNodes));
    } catch {
      // Network hiccup — the canvas keeps its current state.
    }
  }, [setEdges, setNodes]);

  /**
   * AI Builder result router: a pure styling change only refetches the
   * page design; a graph change reloads the canvas from the server first,
   * then refetches the design (the blueprint derives from the saved graph).
   */
  const handleDesignApplied = useCallback(
    (result?: { graphChanged?: boolean }) => {
      if (result?.graphChanged) {
        void (async () => {
          await reloadWorkflowFromServer();
          refreshAgentPageConfig();
        })();
        return;
      }
      refreshAgentPageConfig();
    },
    [refreshAgentPageConfig, reloadWorkflowFromServer]
  );

  /**
   * The Preview toolbar's width control: how wide the product runs on big
   * screens. The preview flips immediately (the architect sees the answer
   * before the network does), the dial is saved through the same manage PATCH
   * the Arrange Editor uses, and the refetch afterwards makes the server's
   * copy the truth — so a failed save honestly snaps back. Review-locked
   * agents never write, same rule as every other builder surface.
   */
  const handlePreviewWidthChange = useCallback(
    (contentWidth: ContentWidth) => {
      if (isUnderReview) return;
      const id = currentWorkflowIdRef.current;
      if (!id) return;

      setPreviewPageData((current) =>
        current
          ? { ...current, design: { ...AGENT_PAGE_DESIGN_DEFAULTS, ...current.design, contentWidth } }
          : current
      );

      void (async () => {
        try {
          await updateAgentPageConfig(id, { design: { contentWidth } });
        } catch {
          // The refetch below restores the saved width.
        }
        refreshAgentPageConfig();
      })();
    },
    [isUnderReview, refreshAgentPageConfig]
  );

  /* ---- "Clean up" — tidy the canvas into the layered Face→Brain→Hands→Face grid ---- */

  const [tidiedToastVisible, setTidiedToastVisible] = useState(false);
  const tidiedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAfterTidyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tidiedToastTimerRef.current) clearTimeout(tidiedToastTimerRef.current);
      if (saveAfterTidyTimerRef.current) clearTimeout(saveAfterTidyTimerRef.current);
    };
  }, []);

  function tidyCanvas() {
    if (blockIfUnderReview()) return;
    if (nodes.length === 0) return;

    const tidied = applyTidyPositions(nodes, edges);
    if (tidied.moved) {
      setNodes(tidied.nodes);
      // Persist through the exact same path a manual drag uses: give the
      // history hook one commit debounce to adopt the moved pieces, then
      // save that snapshot (autosave would also catch it moments later).
      if (saveAfterTidyTimerRef.current) clearTimeout(saveAfterTidyTimerRef.current);
      saveAfterTidyTimerRef.current = setTimeout(() => {
        void saveAgent(false);
      }, 700);
    }

    // Frame the tidied layout after the new positions have rendered.
    requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({ padding: 0.2 });
    });

    setTidiedToastVisible(true);
    if (tidiedToastTimerRef.current) clearTimeout(tidiedToastTimerRef.current);
    tidiedToastTimerRef.current = setTimeout(() => setTidiedToastVisible(false), 1600);
  }

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
      setAgentPurpose(loadedWorkflow.purpose ?? "");
      setNodes(parsedNodes);
      setEdges(parsedEdges);
      setSelectedNodeId(parsedNodes[0]?.id ?? null);

      const triggerNode = parsedNodes.find(isManualTriggerNode);
      if (triggerNode) {
        if (typeof triggerNode.data.input === "string" && triggerNode.data.input) {
          setTriggerMessage(triggerNode.data.input);
        }
        if (Array.isArray(triggerNode.data.attachments) && triggerNode.data.attachments.length > 0) {
          const loadedAtts = triggerNode.data.attachments as AIAttachment[];
          triggerAttachmentsRef.current = loadedAtts;
          setTriggerAttachments(loadedAtts);
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
    position?: { x: number; y: number },
    /** Dropped onto this wire: cut it and join the new step into the gap. */
    onEdgeId?: string | null
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

    if (onEdgeId) {
      setEdges((currentEdges) => {
        const cut = currentEdges.find((edge) => edge.id === onEdgeId);
        if (!cut) return currentEdges;
        return [
          ...currentEdges.filter((edge) => edge.id !== onEdgeId),
          /* The first half keeps the original wire's handle, so a road out of a
             Condition still leaves by the road the architect chose. */
          createFlowEdge({
            id: `${cut.source}-${id}-${Date.now()}`,
            source: cut.source,
            target: id,
            ...(cut.sourceHandle ? { sourceHandle: cut.sourceHandle } : {}),
            ...(typeof cut.label === "string" ? { label: cut.label } : {})
          }),
          createFlowEdge({ id: `${id}-${cut.target}-${Date.now() + 1}`, source: id, target: cut.target })
        ];
      });
    }

    setSelectedNodeId(id);
    setMobilePanel(null);
    setMessage("Unsaved changes");
  }

  /**
   * The wire under the pointer, if there is one.
   *
   * React Flow draws a wide invisible path on every edge for pointing at, and
   * that path is what the browser reports here — so this is the same wire the
   * architect saw light up, rather than a guess from coordinates and distances.
   */
  function edgeUnderPointer(clientX: number, clientY: number): string | null {
    if (typeof document === "undefined") return null;
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const edge = element.closest?.(".react-flow__edge");
      const id = edge?.getAttribute("data-id");
      if (id) return id;
    }
    return null;
  }

  async function importTemplate(slug: string) {
    if (nodes.length > 0 && !window.confirm("Replace the current canvas with this template?")) return;

    setImportingSlug(slug);
    setPreviewSlug(null);
    setMessage("Importing template...");

    const result = await instantiateArchitectTemplate(slug, { workflowId: currentWorkflowIdRef.current || undefined });

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
            const nextAtts = (value as AIAttachment[]) ?? [];
            triggerAttachmentsRef.current = nextAtts;
            setTriggerAttachments(nextAtts);
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
  async function startVapiBrowserTest(
    fallbackBusinessName?: string
  ): Promise<ArchitectVapiBrowserTestSession | { error: string }> {
    if (blockIfUnderReview()) return { error: REVIEW_LOCK_MESSAGE };

    // Single-flight: one click → one save → one browser-test start request.
    if (vapiBrowserTestStartRef.current) {
      return { error: "A browser call test is already starting." };
    }

    vapiBrowserTestStartRef.current = true;

    try {
      return await startVapiBrowserTestInner(fallbackBusinessName);
    } finally {
      vapiBrowserTestStartRef.current = false;
    }
  }

  async function startVapiBrowserTestInner(
    fallbackBusinessName?: string
  ): Promise<ArchitectVapiBrowserTestSession | { error: string }> {
    setMessage("Starting Vapi browser call...");

    // Flush pending edits so the browser test deploys the latest workflow
    // state (voice preset, model, prompts) — the backend reads from the DB.
    const saved = await saveAgent(false);

    if (!saved || !currentWorkflowIdRef.current) {
      return { error: "Save the agent before testing." };
    }

    const result = await startArchitectVapiBrowserTest(currentWorkflowIdRef.current, {
      testContext: {
        businessName: businessName.trim() || fallbackBusinessName || "Sample Business",
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

  /* ---- Preview Test view: engine bridges for the customer-facing Face ---- */

  /**
   * Chat engine for the preview Face — the same save-then-conversation-test
   * flow as the advanced console, mapped to the AgentPageRuntime result shape.
   * The Face owns its own transcript; the developer console's transcript,
   * logs and status panels are intentionally left untouched.
   */
  async function sendPreviewChat(
    messageText: string,
    history: { role: "user" | "assistant"; content: string }[],
    sessionId?: string
  ): Promise<PreviewChatResult> {
    if (blockIfUnderReview()) return { error: REVIEW_LOCK_MESSAGE };

    const cleanMessage = messageText.trim();
    if (!cleanMessage) return { error: "Please type a message." };

    try {
      // Flush pending edits first — the engine reads the agent from the DB.
      const saved = await saveAgent(false);
      if (!saved || !currentWorkflowIdRef.current) {
        return { error: "We couldn't save your latest changes. Please try again." };
      }

      // Thread one session id across the whole preview conversation so its
      // records group exactly like the advanced console's test does.
      const previewSessionId = sessionId || testSessionIdRef.current;
      const serviceName = appointmentService.trim();

      const result = await runArchitectConversationTest(currentWorkflowIdRef.current, {
        message: cleanMessage,
        history: history.slice(-30),
        testSessionId: previewSessionId,
        useTestCalendar,
        // After-hours simulation ("current" = no override, real behavior).
        simulateBusinessHoursState: testAfterHoursState,
        testContext: {
          // The preview must sound like the architect's product, not a demo:
          // fall back to the agent's name before the generic sample business.
          businessName: businessName.trim() || agentName.trim() || "Sample Business",
          businessType: businessType.trim() || "Service Business",
          callerName: callerName.trim() || "Test caller",
          callerPhone: callerNumber.trim() || "+15555550100",
          calendarId: calendarId.trim() || "primary",
          timeZone: timeZone.trim() || browserTimeZone(),
          appointmentService: serviceName || undefined,
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
        return {
          error: result.error ?? "This agent had trouble replying. Please try again.",
          ...(result.code ? { code: result.code } : {})
        };
      }

      return { reply: result.data.conversation.reply, sessionId: previewSessionId };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "This agent had trouble replying. Please try again."
      };
    }
  }

  /**
   * Voice engine for the preview Face — the exact advanced-console start flow
   * (review lock, single-flight, save-first), mapped to the runtime session.
   */
  async function startPreviewVoice(): Promise<PreviewVoiceResult> {
    const result = await startVapiBrowserTest(agentName.trim() || undefined);
    if ("error" in result) return { error: result.error };
    return {
      session: {
        publicKey: result.publicKey,
        assistantId: result.assistantId,
        // The exact metadata the advanced console sends on start — backend
        // webhook auth recognizes these browser-test calls by it, so preview
        // calls must carry it too or their webhooks are treated differently.
        assistantOverrides: {
          metadata: { businessId: result.businessId, purpose: "ARCHITECT_TEST" }
        }
      }
    };
  }

  /** One-shot engine for the media/form Faces — sandboxed architect preview run. */
  async function runPreviewOnce(
    prompt: string,
    sessionId?: string,
    attachments?: Array<{ name: string; mimeType: string; data: string }>
  ): Promise<PreviewRunResult> {
    if (blockIfUnderReview()) return { error: REVIEW_LOCK_MESSAGE };

    try {
      // Save first so the one-shot run always exercises the latest canvas.
      const saved = await saveAgent(false);
      if (!saved || !currentWorkflowIdRef.current) {
        return { error: "We couldn't save your latest changes. Please try again." };
      }

      const result = await previewRunArchitectWorkflow(currentWorkflowIdRef.current, {
        prompt,
        ...(sessionId ? { sessionId } : {}),
        ...(attachments?.length ? { attachments } : {})
      });

      if (!result.success || !result.data) {
        return {
          error: result.error ?? "This agent had trouble responding. Please try again.",
          ...(result.code ? { code: result.code } : {})
        };
      }

      return { output: result.data.output };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "This agent had trouble responding. Please try again."
      };
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

  const isAudioAttachment = useCallback((att: AIAttachment): boolean => {
    const mime = typeof att.mimeType === "string" ? att.mimeType.toLowerCase() : "";
    const name = typeof att.name === "string" ? att.name.toLowerCase() : "";
    return mime.startsWith("audio/") || /\.(wav|mp3|m4a|ogg|webm|flac)$/.test(name);
  }, []);

  const handleTriggerAttachmentsChange = useCallback((newAtts: AIAttachment[]) => {
    triggerAttachmentsRef.current = newAtts;
    setTriggerAttachments(newAtts);
    if (newAtts.some(isAudioAttachment)) {
      setDryRunConfigureHints((prev) =>
        prev.filter((hint) => !/microphone|audio for the dry test|Audio saved/i.test(hint))
      );
    }
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
  }, [isAudioAttachment, setNodes]);

  async function runAgent({ stayHere = false }: { stayHere?: boolean } = {}) {
    if (blockIfUnderReview()) return;

    const normalizedCallerNumber = callerNumber.trim();
    const normalizedBusinessName = businessName.trim();
    const hints: string[] = [];

    if (hasSmsFlow && !isManualTriggerWorkflow) {
      if (!normalizedCallerNumber) hints.push("Enter a caller phone number in Trigger.");
      if (!normalizedBusinessName) hints.push("Enter your business name in Trigger.");
    }

    if (hasGmailFlow && !gmailConnected) {
      hints.push("Connect Google in Connections.");
    }

    if (needsCalendlyConnection && !calendlyConnected) {
      hints.push("Connect Calendly in Connections.");
    }

    if (capabilities.calendlyActions.some((action) => action.toLowerCase() === "book_meeting_for_invitee")) {
      if (!calendlyEventTypeUri.trim()) hints.push("Select a Calendly event type.");
      if (!calendlyStartTime.trim()) hints.push("Select a Calendly start time.");
      if (!calendlyInviteeName.trim()) hints.push("Enter an invitee name.");
      if (!calendlyInviteeEmail.trim()) hints.push("Enter an invitee email.");
    }

    if (
      capabilities.calendlyActions.some((action) => action.toLowerCase() === "create_one_off_meeting_link")
    ) {
      if (!calendlyOneOffStartDate.trim() || !calendlyOneOffEndDate.trim()) {
        hints.push("Select a window start and length for the one-off meeting link.");
      }
      if (!calendlyDurationMinutes.trim()) {
        hints.push("Select a meeting length for the one-off meeting link.");
      }
    }

    if (needsWhatsAppConnection && !whatsappConnected) {
      hints.push("Connect WhatsApp in Connections.");
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
      hints.push("Select a WhatsApp connection on the WhatsApp node.");
    }

    if (hasWhatsAppTrigger) {
      if (!normalizedCallerNumber) hints.push("Enter a sender phone number in Trigger.");
      if (!triggerMessage.trim()) hints.push("Enter a WhatsApp message in Trigger.");
    }

    if (capabilities.hasDeepgramStt) {
      const triggerNodeForAudio = nodes.find(isManualTriggerNode);
      const nodeAttachmentsForAudio =
        (triggerNodeForAudio?.data.attachments as AIAttachment[] | undefined) ?? [];
      const pendingAttachments =
        triggerAttachmentsRef.current.length > 0
          ? triggerAttachmentsRef.current
          : triggerAttachments.length > 0
            ? triggerAttachments
            : nodeAttachmentsForAudio;
      const hasAudioAttachment = pendingAttachments.some(isAudioAttachment);
      if (!hasAudioAttachment) {
        hints.push(
          "In Try transcription: Start microphone → speak → Stop. Wait until you see “Audio saved - ready for dry test”, then run again."
        );
      }
    }

    if (hints.length > 0) {
      setActiveTab("test");
      setDryRunConfigureHints(hints);
      setMessage(hints[0] ?? "Complete the required setup before running the dry test");
      return;
    }

    setDryRunConfigureHints([]);
    setRunning(true);
    setMessage("Running dry test...");
    setRunLogs([]);
    setRunContext({});

    try {
      const saved = await saveAgent(false);

      if (!saved || !currentWorkflowIdRef.current) {
        setMessage("Could not save agent before running test.");
        setDryRunConfigureHints(["Save the workflow, then run the dry test again."]);
        return;
      }

      const triggerNode = nodes.find(isManualTriggerNode);
      const nodeInput = typeof triggerNode?.data.input === "string" ? triggerNode.data.input.trim() : "";
      const nodeAttachments = (triggerNode?.data.attachments as AIAttachment[] | undefined) ?? [];

      const effectiveTriggerMessage =
        triggerMessage.trim() ||
        nodeInput ||
        (isManualTriggerWorkflow ? "Hello, I would like to know more about your services." : undefined);

      const latestAttachments =
        triggerAttachmentsRef.current.length > 0
          ? triggerAttachmentsRef.current
          : triggerAttachments;
      const effectiveAttachments =
        latestAttachments.length > 0
          ? latestAttachments
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
              calendlyMeetingName: calendlyMeetingName.trim() || "One-off meeting",
              calendlyEventTypeUri: calendlyEventTypeUri.trim() || undefined,
              calendlyEventUuid: calendlyEventUuid.trim() || undefined,
              calendlyInviteeUuid: calendlyInviteeUuid.trim() || undefined,
              calendlyStartTime: calendlyStartTime.trim() || undefined,
              calendlyEndTime: calendlyEndTime.trim() || undefined,
              calendlyDurationMinutes: calendlyDurationMinutes.trim() || "30",
              calendlyOneOffStartDate: calendlyOneOffStartDate.trim() || undefined,
              calendlyOneOffEndDate: calendlyOneOffEndDate.trim() || undefined,
              calendlyTimezone: calendlyTimezone.trim() || timeZone.trim() || undefined,
              calendlyLocationKind: calendlyLocationKind.trim() || "ask_invitee",
              calendlyLocation: calendlyLocation.trim() || undefined,
              calendlyContactEmail: calendlyContactEmail.trim() || undefined,
              calendlyContactUuid: calendlyContactUuid.trim() || undefined,
              calendlyContactName: calendlyContactName.trim() || undefined,
              calendlyCancelReason: calendlyCancelReason.trim() || undefined,
              calendlyMeetingRecapUuid: calendlyMeetingRecapUuid.trim() || undefined,
              calendlyUserSearch: calendlyUserSearch.trim() || undefined
            }
          : {}),
        attachments: effectiveAttachments
      }
    };

      const result = await runArchitectWorkflowTest(currentWorkflowIdRef.current, payload);

      if (!result.success || !result.data) {
        setMessage(result.error ?? "Could not run test");
        setDryRunConfigureHints([result.error ?? "Could not run the dry test. Check your setup and try again."]);
        return;
      }

      setRunLogs(result.data.run.logs);
      setRunContext(result.data.run.context);
      setMessage("Dry run complete");
      setDryRunConfigureHints([]);
      if (!stayHere) setActiveTab("test");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not run test";
      setMessage(errorMessage);
      setDryRunConfigureHints([errorMessage]);
    } finally {
      setRunning(false);
    }
  }

  /* The steps wired INTO the selected one, by the names an architect gave them.
     A panel saying "the step before" leaves somebody to work out which one.

     ABOVE the early returns, deliberately. It sat below them for one deploy and
     took the whole builder down with React #310: the loading render returned
     before this hook ran, the loaded render ran it, and a component that calls a
     different number of hooks between renders is not a component React can keep. */
  const incomingNodeNames = useMemo(() => {
    if (!selectedNode) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return edges
      .filter((edge) => edge.target === selectedNode.id)
      .map((edge) => {
        const source = byId.get(edge.source);
        return String(source?.data?.title ?? source?.data?.label ?? "").trim();
      })
      .filter((name) => name.length > 0);
  }, [selectedNode, nodes, edges]);

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
      incomingNodeNames={incomingNodeNames}
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
        previewDevice={previewDevice}
        onPreviewDeviceChange={setPreviewDevice}
        previewWidth={previewPageData?.design?.contentWidth ?? "standard"}
        onPreviewWidthChange={handlePreviewWidthChange}
        showPreviewControls={activeTab === "test"}
        arrangeMode={arrangeMode}
        onArrangeModeChange={setArrangeMode}
        onOpenAdvanced={() => setTestView("advanced")}
        onUndo={undo}
        onRedo={redo}
        onAgentNameChange={setAgentName}
        onTabChange={requestTabChange}
        onRunTest={() => {
          /* The one door (2026-08-27): Preview opens the surface judged by
             the trigger. Looking never runs anything — the door's own Run
             button does that, deliberately. */
          requestTabChange("test");
        }}
        onSave={() => void saveAgent()}
      />

      {/* NEITHER STATE FLOATS OVER THE PRODUCT ANY MORE.
          "Agent is live" and "Agent is under review" were both `fixed` boxes
          parked in the middle of the screen — over the canvas an architect was
          editing, and over the preview they were trying to look at. Neither
          could be dismissed, and neither said anything the header was not
          already saying: the pill beside the agent name reads Draft, In Review
          or Live, all the time, without covering anything.
          A state is worn, not announced. */}

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
        {/* ONE EMPLOYEE, EVERYWHERE (the founder's ruling, 2026-08-27).
            The AI Builder used to live twice — once on Build, once inside
            Preview under another name — and each copy forgot separately on
            every tab switch. One dock now, mounted above every tab, its
            open state remembered across visits. */}
        <button
          type="button"
          onClick={() => setAiBuilderOpen((open) => !open)}
          data-testid="build-ai-builder-toggle"
          className="absolute bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-600"
        >
          <BuilderIcon name="sparkles" className="h-4 w-4" />
          AI Builder
        </button>
        {aiBuilderOpen ? (
          <div
            data-testid="build-ai-builder-dock"
            className="absolute bottom-20 right-6 z-40 flex h-[min(34rem,70vh)] w-[min(24rem,90vw)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">AI Builder</p>
              <button
                type="button"
                onClick={() => setAiBuilderOpen(false)}
                aria-label="Minimize AI Builder"
                data-testid="build-ai-builder-close"
                className="rounded-lg p-1 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
              >
                &#8211;
              </button>
            </div>
            <AiBuilderPanel
              workflowId={currentWorkflowId}
              canvasHasSteps={nodes.length > 0}
              getGraphPlan={() => ({
                nodes: nodes.map((node) => ({
                  id: node.id,
                  type: String(node.data.type ?? ""),
                  title: String(node.data.title ?? node.data.label ?? ""),
                  config: Object.fromEntries(
                    Object.entries(node.data).filter(
                      ([key, value]) =>
                        !["type", "nodeKind", "kind", "icon", "accent"].includes(key) &&
                        (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
                    )
                  )
                })),
                edges: edges.map((edge) => ({
                  id: edge.id,
                  from: edge.source,
                  to: edge.target
                })) as never
              })}
              purpose={agentPurpose}
              onPurposeSaved={setAgentPurpose}
              hasComposedSpec={Boolean(previewPageData?.product) || Boolean(previewPageData?.blueprint)}
              onApplied={handleDesignApplied}
              onBuilt={(canvas) => {
                /* An EDIT keeps the room arranged as the architect left it:
                   steps whose ids survive keep their positions; only new
                   steps take fresh seats (the seventh organ, 2026-08-27). */
                const seats = new Map(nodes.map((node) => [node.id, node.position]));
                const nextNodes = toBuilderNodes(canvas.nodes).map((node) =>
                  seats.has(node.id) ? { ...node, position: seats.get(node.id)! } : node
                );
                setNodes(nextNodes);
                setEdges(toBuilderEdges(canvas.edges));
              }}
            />
          </div>
        ) : null}

        {activeTab === "build" ? (
          <section className="builder-view fade-enter flex min-w-0">
            <aside
              className="relative hidden h-full shrink-0 overflow-hidden border-r border-gray-100 bg-white xl:block"
              style={{ width: libraryWidth }}
              data-testid="builder-library-sidebar"
            >
              <div className="h-full overflow-hidden">
                {library}
              </div>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize components sidebar"
                data-testid="builder-library-resize-handle"
                title="Drag to resize"
                onPointerDown={startLibraryResize}
                className="group/resize absolute inset-y-0 right-0 z-30 flex w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
              >
                <span
                  className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
                    isResizingLibrary ? "bg-amber-400" : "bg-transparent group-hover/resize:bg-slate-300"
                  }`}
                  aria-hidden="true"
                />
                <span
                  data-testid="builder-library-resize-button"
                  className={`pointer-events-none relative z-10 flex h-8 w-3.5 flex-col items-center justify-center gap-[3px] rounded-md border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition ${
                    isResizingLibrary
                      ? "border-amber-400 text-amber-500"
                      : "border-slate-200/90 text-slate-400 opacity-70 group-hover/resize:border-slate-300 group-hover/resize:opacity-100"
                  }`}
                >
                  <span className="h-3 w-px rounded-full bg-current" aria-hidden="true" />
                  <span className="h-3 w-px rounded-full bg-current" aria-hidden="true" />
                </span>
              </div>
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
                nodes={checkedNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
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
                    /* Dropped ON a wire? Then the architect is putting a step in
                       the middle of something that already works, and that is
                       what they mean — not a loose step floating on top of a
                       line. The wire is cut and the new step is joined into the
                       gap it left. */
                    addNodeFromLibrary(
                      payload.nodeKind,
                      payload.overrides,
                      position,
                      edgeUnderPointer(event.clientX, event.clientY)
                    );
                  } catch {
                    // Not our payload — ignore.
                  }
                }}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                /*
                 * A WIRE'S END CAN BE PICKED UP AND MOVED.
                 *
                 * The founder's words: dragging the arrow to point it somewhere
                 * is a better idea than clicking things. Grab either end of a
                 * wire and drop it on another step to re-point it — or drop it
                 * on empty canvas to disconnect, the same motion in reverse of
                 * how the wire was made. The ✕ on hover stays for people who
                 * find that first; two honest ways beat one clever one.
                 */
                edgesReconnectable={!isUnderReview}
                onReconnect={(oldEdge, connection) => {
                  setEdges((current) => reconnectEdge(oldEdge, connection, current));
                  setMessage("Unsaved changes");
                }}
                onReconnectEnd={(_, edge, __, connectionState) => {
                  /* Dropped on nothing: the architect pulled the wire off and
                     let go. That is a disconnect, said with the hand. */
                  if (!connectionState.isValid) {
                    setEdges((current) => current.filter((e) => e.id !== edge.id));
                    setMessage("Unsaved changes");
                  }
                }}
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
                <Controls showInteractive={false}>
                  <ControlButton
                    onClick={tidyCanvas}
                    disabled={nodes.length === 0}
                    title="Tidy my canvas"
                    aria-label="Tidy my canvas"
                    data-testid="canvas-cleanup"
                  >
                    {/* Wand sweep — one click tidies the whole canvas. */}
                    <BuilderIcon name="wand" className="h-3 w-3" />
                  </ControlButton>
                </Controls>
              </ReactFlow>


              {wiring.known && wiring.problems.length > 0 ? (
                <div
                  className="pointer-events-auto absolute bottom-6 left-1/2 z-20 w-[min(30rem,90vw)] -translate-x-1/2 rounded-2xl border border-red-200 bg-white/95 p-3 shadow-xl backdrop-blur"
                  data-testid="wiring-banner"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-500 text-[12px] font-bold text-white">
                      !
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800">
                        {wiring.problems.length === 1
                          ? "One step will not get what it needs"
                          : `${wiring.problems.length} steps will not get what they need`}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-slate-600">
                        {wiring.problems[0].nodeLabel} — {wiring.problems[0].message}
                      </p>
                      {repairNote ? (
                        <p className="mt-1.5 text-[12px] font-medium text-emerald-700" data-testid="repair-note">
                          {repairNote}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void repairCanvasNow()}
                      disabled={repairing}
                      data-testid="wiring-repair"
                      className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-[13px] font-bold text-white transition hover:bg-amber-600 disabled:opacity-60"
                    >
                      {repairing ? "Fixing…" : "Fix it for me"}
                    </button>
                  </div>
                </div>
              ) : null}

              <EmptyCanvasFacePicker
                nodeCount={nodes.length}
                importingSlug={importingSlug}
                onPick={(slug) => void importTemplate(slug)}
                onComposed={(canvas) => {
                  // Through the same door as everything else. The cast that used
                  // to be here is why composed agents drew as grey stock boxes.
                  setNodes(toBuilderNodes(canvas.nodes));
                  setEdges(toBuilderEdges(canvas.edges));
                }}
              />

              {tidiedToastVisible ? (
                <div
                  data-testid="canvas-cleanup-toast"
                  role="status"
                  aria-live="polite"
                  className="fade-enter pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg"
                >
                  Tidied.
                </div>
              ) : null}

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

            <aside
              className="relative hidden h-full shrink-0 overflow-hidden border-l border-gray-100 bg-white xl:block"
              style={{ width: inspectorWidth }}
              data-testid="builder-inspector-sidebar"
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector sidebar"
                data-testid="builder-inspector-resize-handle"
                title="Drag to resize"
                onPointerDown={startInspectorResize}
                className="group/resize absolute inset-y-0 left-0 z-30 flex w-2 translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
              >
                <span
                  className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
                    isResizingInspector ? "bg-amber-400" : "bg-transparent group-hover/resize:bg-slate-300"
                  }`}
                  aria-hidden="true"
                />
                <span
                  data-testid="builder-inspector-resize-button"
                  className={`pointer-events-none relative z-10 flex h-8 w-3.5 flex-col items-center justify-center gap-[3px] rounded-md border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition ${
                    isResizingInspector
                      ? "border-amber-400 text-amber-500"
                      : "border-slate-200/90 text-slate-400 opacity-70 group-hover/resize:border-slate-300 group-hover/resize:opacity-100"
                  }`}
                >
                  <span className="h-3 w-px rounded-full bg-current" aria-hidden="true" />
                  <span className="h-3 w-px rounded-full bg-current" aria-hidden="true" />
                </span>
              </div>
              <div className="h-full overflow-hidden">
                {inspector}
              </div>
            </aside>
          </section>
        ) : null}

        {activeTab === "test" && testView === "preview" && (wayIn.kind === "clock" || wayIn.kind === "webhook") ? (
          <BusinessMirror
            agentName={agentName}
            logs={runLogs}
            running={running}
            onRun={() => void runAgent({ stayHere: true })}
          />
        ) : null}

        {activeTab === "test" &&
        testView === "preview" &&
        ["telegram", "email", "whatsapp", "calendly", "empty"].includes(wayIn.kind) ? (
          <AgentDoor
            way={wayIn}
            agentName={agentName}
            telegram={telegramTestConnection}
            onConnectTelegram={(botToken) => void connectTelegramTest(botToken)}
            onDisconnectTelegram={() => void disconnectTelegramTest()}
            telegramBusy={connectingTelegramTest}
            logs={runLogs}
            running={running}
            onRun={() => void runAgent({ stayHere: true })}
            testEmail={testEmail}
            onTestEmailChange={setTestEmail}
          />
        ) : null}

        {activeTab === "test" && testView === "preview" && wayIn.kind === "page" ? (
          <PreviewPanel
            workflowId={currentWorkflowId}
            workflowName={agentName}
            hasVoiceNode={hasVoiceNode}
            hasMediaNode={hasMediaNode}
            device={previewDevice}
            page={previewPageData?.page ?? null}
            defaultTemplate={previewPageData?.defaultTemplate}
            blueprint={previewPageData?.blueprint ?? null}
            product={previewPageData?.product ?? null}
            configLoading={!previewConfigLoaded}
            design={previewPageData?.design ?? null}
            architectName={architectName}
            underReview={isUnderReview}
            arrangeMode={arrangeMode}
            onArrangeExit={() => setArrangeMode(false)}
            onSendChat={sendPreviewChat}
            onStartVoice={startPreviewVoice}
            onRunOnce={runPreviewOnce}
            purpose={agentPurpose}
            onPurposeSaved={setAgentPurpose}
            onOpenAdvanced={() => setTestView("advanced")}
            onDesignApplied={handleDesignApplied}
          />
        ) : null}

        {activeTab === "test" && testView === "advanced" ? (
          <div className="absolute inset-0 flex flex-col">
            <div className="flex flex-none items-center border-b border-gray-100 bg-white px-4 py-1.5">
              <button
                type="button"
                onClick={() => setTestView("preview")}
                data-testid="preview-panel-back-to-preview"
                className="text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-slate-900 hover:underline"
              >
                &larr; Simple preview
              </button>
            </div>
            {/* Positioned so the TestPanel's absolute-inset root fills exactly
                the space under the back bar — its own markup is untouched. */}
            <div className="relative min-h-0 flex-1">
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
            calendlyContactEmail={calendlyContactEmail}
            calendlyContactUuid={calendlyContactUuid}
            calendlyContactName={calendlyContactName}
            calendlyCancelReason={calendlyCancelReason}
            calendlyMeetingRecapUuid={calendlyMeetingRecapUuid}
            calendlyUserSearch={calendlyUserSearch}
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
            hasDeepgram={capabilities.hasDeepgram}
            hasDeepgramStt={capabilities.hasDeepgramStt}
            hasDeepgramTts={capabilities.hasDeepgramTts}
            workflowNodes={nodes}
            dryRunConfigureHints={dryRunConfigureHints}
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
            onCalendlyContactEmailChange={setCalendlyContactEmail}
            onCalendlyContactUuidChange={setCalendlyContactUuid}
            onCalendlyContactNameChange={setCalendlyContactName}
            onCalendlyCancelReasonChange={setCalendlyCancelReason}
            onCalendlyMeetingRecapUuidChange={setCalendlyMeetingRecapUuid}
            onCalendlyUserSearchChange={setCalendlyUserSearch}
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
            </div>
          </div>
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
        /* A failed save fell into "last edited just now" here too. */
        editedLabel={
          message.startsWith("Save failed")
            ? message
            : message === "Unsaved changes"
              ? "unsaved changes"
              : "last edited just now"
        }
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
