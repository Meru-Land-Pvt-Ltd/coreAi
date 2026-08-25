import {
  API_CALL_NODE_TYPE,
  API_CALL_DEFAULT_OUTPUT_KEY,
  API_CALL_YOUTUBE_PRESET,
  BLOCK_NODE_TYPES,
  CALENDLY_ACTION_OPTIONS,
  CALENDLY_NODE_TYPES,
  CALENDLY_TRIGGER_EVENTS,
  calendlyActionPaidPlanNote,
  DEEPGRAM_NODE_TYPES,
  DESIGN_BRAIN_NODE_TYPE,
  EMAIL_TEMPLATE_VARIABLES,
  LLM_PROVIDERS,
  NODE_DOORS_DISABLED_KEY,
  SCRIPT_NODE_TYPE,
  NODE_FRAME_NODE_TYPE,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_TYPES,
  isBlockNodeType,
  defaultLlmModelForProvider,
  findUnknownPromptVariables,
  getCalendlyActionIo,
  getCalendlyVariableGuide,
  getLlmModelsForProvider,
  getNodeDefinition,
  hasNodeDoors,
  nodeDoorsEnabled,
  resolveLlmSelection,
  resolveSalesTuning,
  SALES_TUNING_CONTROLS,
  type SalesTuningControl,
  OUTBOUND_CALL_NODE_TYPE,
  SCHEDULE_NODE_TYPE,
  WEBHOOK_NODE_TYPE,
  nodeSettingChoices
} from "@coreai/shared";
import { useState, useEffect, type ReactNode } from "react";
import { useNodeLimits } from "./use-node-limits";
import { VoicePicker } from "@/components/common/voice-picker";
import {
  disconnectCalendlyConnector,
  getCalendlyConnectorStatus,
  getCalendlyOAuthUrl,
  listArchitectSecrets,
  listWhatsAppConnections,
  type WhatsAppConnection
} from "@/components/architect/features/api";
import { WhatsAppConnectModal } from "@/components/architect/features/whatsapp/WhatsAppConnectModal";
import { WhatsAppIcon } from "@/components/architect/features/whatsapp/WhatsAppIcon";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData, AIAttachment, BlockPreset, BlockModelOption } from "./types";
import { LlmNodeInspector } from "./llm-node-inspector";
import { DeepgramNodeInspector } from "./deepgram-node-inspector";
import { DeepgramTtsNodeInspector } from "./deepgram-tts-node-inspector";
import { ScriptNodeInspector } from "./script-node-inspector";
import { NodeFrameInspector } from "./node-frame-inspector";
import { isProviderDisabled, useLlmAvailability } from "./use-llm-availability";
import {
  useCalendlyAvailableTimeOptions,
  useCalendlyContactOptions,
  useCalendlyEventOptions,
  useCalendlyEventTypeOptions,
  useCalendlyInviteeOptions,
  useCalendlyMeetingRecapOptions
} from "./use-calendly-pickers";
import type { CalendlyPickerOption } from "@/components/architect/features/types";
import {
  CalendlyAvailableSlotButtons,
  CalendlyTeamsRangePicker,
  CalendlyTimezoneSelect
} from "./calendly-time-controls";

export type ConnectorOwnership = "architect" | "buyer";

const PLATFORM_DEFAULT_VOICE_ID = "triven-default";
const TRIVEN_VOICE_NAME = "Triven Voice";
const DEFAULT_VOICE_PROVIDER = "11labs";

type CalendarConnection = {
  connected: boolean;
  email: string | null;
  connecting: boolean;
  onConnect?: () => void;
};

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
  /** Node ids/labels from the graph — whitelists {{node.prop}}-style tokens. */
  variableNodePrefixes?: string[];
};

function UnknownVariablesNote({
  text,
  nodePrefixes,
  testId
}: {
  text: string;
  nodePrefixes?: string[];
  testId: string;
}) {
  const unknown = findUnknownPromptVariables(text, { nodePrefixes });

  if (!unknown.length) return null;

  return (
    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800" data-testid={testId}>
      Unknown {unknown.length === 1 ? "variable" : "variables"}:{" "}
      {unknown.map((name) => `{{${name}}}`).join(", ")} — not recognized, so {unknown.length === 1 ? "it" : "they"} will
      be removed at test/deploy time. Check the spelling (e.g. {"{{business.name}}"}, {"{{customer.name}}"}).
    </p>
  );
}

type CalendarPanel = NodePropsPanel & { calendar: CalendarConnection; ownership: ConnectorOwnership };



export function NodeInspector({
  selectedNode,
  onClearSelection,
  onUpdateNodeData,
  onDeleteNode,
  connectorOwnership = "architect",
  calendarConnected = false,
  calendarEmail = null,
  connectingCalendar = false,
  onConnectCalendar,
  variableNodePrefixes,
  incomingNodeNames
}: {
  selectedNode: BuilderNode | null;
  onClearSelection: () => void;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
  onDeleteNode: () => void;
  /** Architect design shows requirement badges; buyer install shows real connect. */
  connectorOwnership?: ConnectorOwnership;
  calendarConnected?: boolean;
  calendarEmail?: string | null;
  connectingCalendar?: boolean;
  onConnectCalendar?: () => void;
  /** Node ids/labels from the graph — whitelists {{node.prop}}-style tokens in warnings. */
  variableNodePrefixes?: string[];
  /** Names of the steps wired INTO the selected node. */
  incomingNodeNames?: string[];
}) {
  if (!selectedNode) return <EmptyProperties />;

  const calendar: CalendarConnection = {
    connected: calendarConnected,
    email: calendarEmail,
    connecting: connectingCalendar,
    onConnect: onConnectCalendar
  };

  const ownership = connectorOwnership;
  const type = String(selectedNode.data.type ?? "");
  // Product blocks live in the customer's world: the frame drops builder
  // jargon ("Node properties", "Delete Node") and the variable-mapping drawer
  // — an architect fills in words and choices here, nothing more technical.
  /** The AI Brain owns its whole panel — see llm-node-inspector.tsx. */
  const isLlmBrain = type === "ai.llm_call";

  const isProductBlock =
    isBlockNodeType(type) || String(selectedNode.data.nodeKind ?? "") === "block";
  // Old canvases can still carry a design.brain node — it gets the plain
  // block-style frame now; its chat was retired for the Smart Designer.
  const isDesignBrain = type === DESIGN_BRAIN_NODE_TYPE;
  const base: NodePropsPanel = { selectedNode, onUpdateNodeData, variableNodePrefixes };

  let panel: ReactNode;

  if (type === "ai.image_generation") panel = <ImageGenNodeProps {...base} />;
  else if (type === DEEPGRAM_NODE_TYPES.stt || (type === DEEPGRAM_NODE_TYPES.speech && String(selectedNode.data.mode ?? "stt") !== "tts")) {
    panel = <DeepgramNodeInspector {...base} />;
  } else if (type === DEEPGRAM_NODE_TYPES.tts || (type === DEEPGRAM_NODE_TYPES.speech && String(selectedNode.data.mode ?? "") === "tts")) {
    panel = <DeepgramTtsNodeInspector {...base} />;
  }
  else if (type === SCRIPT_NODE_TYPE) panel = <ScriptNodeInspector {...base} />;
  else if (type === NODE_FRAME_NODE_TYPE) panel = <NodeFrameInspector {...base} />;
  else if (type === "ai.llm_call") panel = <LlmNodeInspector {...base} incomingNodeNames={incomingNodeNames} />;
  else if (type === "ai.memory") panel = <MemoryNodeProps {...base} />;
  else if (type === TELEGRAM_NODE_TYPES.trigger) panel = <TelegramTriggerProps {...base} />;
  else if (Object.values(TELEGRAM_NODE_TYPES).includes(type as (typeof TELEGRAM_NODE_TYPES)[keyof typeof TELEGRAM_NODE_TYPES])) {
    panel = <TelegramActionProps {...base} />;
  }
  else if (type === VOICE_NODE_TYPES.phoneCallTrigger) panel = <PhoneCallTriggerProps {...base} />;
  else if (type === VOICE_NODE_TYPES.voiceConversation) panel = <AiVoiceConversationProps {...base} />;
  else if (type === VOICE_NODE_TYPES.calendarAvailability) {
    panel = <CalendarAvailabilityProps {...base} calendar={calendar} ownership={ownership} />;
  } else if (type === VOICE_NODE_TYPES.bookAppointment) {
    panel = <BookCalendarAppointmentProps {...base} calendar={calendar} ownership={ownership} />;
  } else if (type === VOICE_NODE_TYPES.sendEmail) panel = <SendEmailProps {...base} />;
  else if (type === VOICE_NODE_TYPES.sendSms) panel = <SendSmsProps {...base} />;
  else if (type === "trigger.whatsapp_message_received") panel = <WhatsAppTriggerProps {...base} />;
  else if (type === OUTBOUND_CALL_NODE_TYPE) panel = <OutboundCallProps {...base} />;
  else if (type === SCHEDULE_NODE_TYPE) panel = <ScheduleTriggerProps {...base} />;
  else if (type === WEBHOOK_NODE_TYPE) panel = <WebhookTriggerProps {...base} />;
  else if (type === CALENDLY_NODE_TYPES.trigger || type.startsWith("trigger.calendly_")) {
    panel = <CalendlyTriggerProps {...base} />;
  }
  else if (type === CALENDLY_NODE_TYPES.action || type.startsWith("action.calendly_")) {
    panel = <ConnectorProps {...base} calendar={calendar} ownership={ownership} />;
  }
  else if (type === "action.send_whatsapp" || type === "communication.send_whatsapp") {
    panel = <WhatsAppSendProps {...base} />;
  } else if (type === API_CALL_NODE_TYPE) panel = <ApiCallProps {...base} />;
  else if (type === VOICE_NODE_TYPES.endFlow) panel = <EndFlowProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.promptComposer) panel = <PromptBoxBlockProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.presetGallery) panel = <StylesGalleryBlockProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.modelPicker) panel = <ModelPickerBlockProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.actionButton) panel = <ActionButtonBlockProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.outputStage) panel = <ResultViewerBlockProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.continueChain) panel = <ContinueButtonBlockProps {...base} />;
  else if (type === BLOCK_NODE_TYPES.historyShelf) panel = <HistoryShelfBlockProps {...base} />;
  else if (selectedNode.data.nodeKind === "trigger") panel = <TriggerProps {...base} />;
  else if (selectedNode.data.nodeKind === "ai") panel = <AiProps {...base} />;
  else if (selectedNode.data.nodeKind === "condition") panel = <ConditionProps {...base} />;
  else if (selectedNode.data.nodeKind === "connector") {
    panel = <ConnectorProps {...base} calendar={calendar} ownership={ownership} />;
  } else {
    panel = <GenericProps {...base} />;
  }

  return (
    <div className="builder-sidebar-scroll h-full overflow-y-auto overflow-x-hidden bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <BuilderIcon name={selectedNode.data.icon} className="h-4 w-4 text-amber-600" />
          <span
            className="font-bold text-slate-900"
            data-testid="architect-ui-workflow-builder-node-inspector-node-properties-text"
          >
            {/* The node's own name. "Product section" told an architect nothing:
                every Face node wore it, so the panel never said which one was
                open. */}
            {isDesignBrain
              ? "Design Brain"
              : getNodeDefinition(String(selectedNode.data.type ?? ""))?.label ??
                String(selectedNode.data.title ?? "") ??
                "Node properties"}
          </span>
        </div>

        <button
          type="button"
          onClick={onClearSelection}
          data-testid="node-inspector-clear"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          aria-label={isProductBlock ? "Close" : "Deselect node"}
        >
          <BuilderIcon name="x" className="h-4 w-4" />
        </button>
      </div>

      {panel}

      {/* The AI Brain says all of this itself, in words a person understands.
          Bolting the generic drawers on underneath it produced three spellings
          of one output, a section announcing it was empty, and the node's raw
          id — on the screen where somebody is building a receptionist. */}
      {isLlmBrain ? null : (
        <>
          {/* The Design Brain explains itself in chat — no step overview card. */}
          {isDesignBrain ? null : <NodeOverviewPanel node={selectedNode} />}

          {/* The variable-mapping drawer is engine territory — never for blocks.
              A product section that carries doors still gets the one switch. */}
          {isProductBlock ? (
            hasNodeDoors(type) ? (
              <NodeAdvancedSettingsPanel node={selectedNode} onUpdateNodeData={onUpdateNodeData} doorsOnly />
            ) : null
          ) : (
            <NodeAdvancedSettingsPanel node={selectedNode} onUpdateNodeData={onUpdateNodeData} />
          )}
        </>
      )}

      <div className="border-t border-gray-100 p-5">
        <button
          type="button"
          onClick={onDeleteNode}
          data-testid="node-inspector-delete"
          className="w-full rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-100"
        >
          {isProductBlock ? "Remove section" : "Delete Node"}
        </button>
      </div>
    </div>
  );
}

function EmptyProperties() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <BuilderIcon name="message" className="h-6 w-6" />
        </div>

        <h3
          className="font-bold text-slate-900"
          data-testid="architect-ui-workflow-builder-node-inspector-select-a-node-heading"
        >
          Select a node
        </h3>

        <p
          className="mx-auto mt-1 max-w-[200px] text-xs text-slate-400"
          data-testid="architect-ui-workflow-builder-node-inspector-select-a-node-on-the-canvas-to-text"
        >
          Select a node on the canvas to edit it, or drag a new one from the left panel.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- UI ---------------------------------- */

export function Section({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={last ? "p-5" : "border-b border-gray-100 p-5"}>
      {title ? (
        <h3
          className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400"
          data-testid="architect-ui-workflow-builder-node-inspector-title-heading"
        >
          {title}
        </h3>
      ) : null}

      {children}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span
      data-testid="node-inspector-field-label"
      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500"
    >
      {children}
    </span>
  );
}

/**
 * One behaviour dial. The value shown under the track is the real setting, not
 * a percentage — an operator tuning a call needs to know she now waits 0.35s,
 * not that the slider is at 40%.
 */
export function TuningSlider({
  control,
  value,
  onChange
}: {
  control: SalesTuningControl;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mb-5" data-testid={`sales-tuning-${control.key}`}>
      <div className="flex items-baseline justify-between">
        <Label>{control.label}</Label>
        <span
          className="text-[11px] font-semibold tabular-nums text-violet-600"
          data-testid={`sales-tuning-${control.key}-value`}
        >
          {control.format(value)}
        </span>
      </div>

      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        data-testid={`sales-tuning-${control.key}-input`}
        className="mt-1 w-full accent-violet-500"
        aria-label={control.label}
      />

      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
        <span>{control.lowLabel}</span>
        <span>{control.highLabel}</span>
      </div>

      <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{control.help}</p>
      <p className="mt-1 text-[10px] leading-4 text-slate-400" data-testid={`sales-tuning-${control.key}-evidence`}>
        {control.evidence}
      </p>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono = false,
  maxLength,
  testId = "node-inspector-label-input"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  maxLength?: number;
  testId?: string;
}) {
  return (
    <input
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      spellCheck={false}
      className={`${mono ? "font-mono" : ""
        } w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:outline-none ring-0 focus:ring-0 focus:border-amber-400 transition-colors shadow-none`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  height = "h-20",
  mono = false,
  placeholder,
  maxLength,
  testId = "node-inspector-prompt-textarea"
}: {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  mono?: boolean;
  placeholder?: string;
  maxLength?: number;
  testId?: string;
}) {
  return (
    <textarea
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      spellCheck={false}
      className={`${height} ${mono ? "font-mono text-xs leading-relaxed" : ""
        } w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:outline-none ring-0 focus:ring-0 focus:border-amber-400 transition-colors shadow-none`}
    />
  );
}

export type SelectBoxOption = string | { value: string; label: string; disabled?: boolean };

function calendlySelectBoxOptions(
  selected: string,
  options: CalendlyPickerOption[],
  emptyLabel: string
): SelectBoxOption[] {
  const mapped: SelectBoxOption[] = [
    { value: "", label: emptyLabel },
    ...options.map((option) => ({ value: option.value, label: option.label }))
  ];
  if (selected && !options.some((option) => option.value === selected)) {
    mapped.splice(1, 0, { value: selected, label: selected });
  }
  return mapped;
}

export function SelectBox({ value, onChange, options, testId = "node-inspector-model-select" }: { value: string; onChange: (value: string) => void; options: SelectBoxOption[]; testId?: string }) {
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
  const allOptions =
    normalized.some((option) => option.value === value) || !value
      ? normalized
      : [{ value, label: value }, ...normalized];

  return (
    <div className="relative">
      <select
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none focus:outline-none ring-0 focus:ring-0 focus:border-amber-400 transition-colors shadow-none cursor-pointer"
      >
        {allOptions.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>

      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        <BuilderIcon name="chevron" className="h-4 w-4" />
      </span>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  testId,
  min,
  max,
  step
}: {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <input
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:outline-none ring-0 focus:ring-0 focus:border-amber-400 transition-colors shadow-none"
    />
  );
}

function BoolField({ label, value, onChange }: { label: string; value: boolean; onChange: (value: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <SelectBox value={value ? "On" : "Off"} onChange={(v) => onChange(v === "On" ? "true" : "false")} options={["On", "Off"]} />
    </div>
  );
}

function ReadOnly({ value, testId }: { value: string; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-700">
      {value}
    </div>
  );
}

function RequirementNotice({
  title,
  children,
  testId
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-blue-700">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        {title}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-blue-700/90">{children}</p>
    </div>
  );
}

function WhatsAppRequirementNotice({
  children,
  testId
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
        <WhatsAppIcon className="h-3.5 w-3.5 text-emerald-600" />
        Architect WhatsApp setup
      </p>
      <p className="mt-1 text-[11px] leading-5 text-emerald-900/80">{children}</p>
    </div>
  );
}

function useCalendlyConnection() {
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getCalendlyConnectorStatus()
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setConnected(result.data.connected);
          setEmail(result.data.email);
          setName(result.data.name);
          setError("");
          return;
        }
        setConnected(false);
        setEmail(null);
        setName(null);
        setError(result.error ?? "Failed to load Calendly status");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setConnected(false);
        setEmail(null);
        setName(null);
        setError(err instanceof Error ? err.message : "Failed to load Calendly status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function connect() {
    setBusy(true);
    setError("");
    const returnTo = new URL(window.location.href);
    returnTo.searchParams.delete("calendly");
    const result = await getCalendlyOAuthUrl(`${returnTo.pathname}${returnTo.search}`);
    if (result.success && result.data) {
      window.location.href = result.data.url;
      return;
    }
    setBusy(false);
    setError(result.error ?? "Could not start Calendly connection");
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    const result = await disconnectCalendlyConnector();
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? "Could not disconnect Calendly");
      return;
    }
    setConnected(false);
    setEmail(null);
    setName(null);
    setReloadToken((value) => value + 1);
  }

  return {
    connected,
    email,
    name,
    loading,
    busy,
    error,
    connect,
    disconnect
  };
}

/** One-line Calendly connect / disconnect for node properties. */
function CalendlyConnectBlock({ testId }: { testId: string }) {
  const { connected, email, name, loading, busy, error, connect, disconnect } = useCalendlyConnection();
  const account = email || name;

  if (loading) {
    return (
      <p data-testid={testId} className="text-[11px] leading-5 text-slate-400">
        Checking Calendly…
      </p>
    );
  }

  return (
    <div data-testid={testId}>
      <p className="text-[11px] leading-5 text-slate-400">
        {connected ? (
          <>
            Connected{account ? ` as ${account}` : ""}.{" "}
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="inline font-semibold text-amber-700 hover:underline disabled:opacity-60"
              data-testid={`${testId}-disconnect`}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : (
          <>
            Not connected.{" "}
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy}
              className="inline font-semibold text-amber-700 hover:underline disabled:opacity-60"
              data-testid={`${testId}-connect`}
            >
              {busy ? "Connecting…" : "Connect Calendly"}
            </button>
          </>
        )}
      </p>
      {error ? <p className="mt-1 text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

function CalendarConnect({ calendar }: { calendar: CalendarConnection }) {
  if (calendar.connected) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5" data-testid="calendar-connected">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
          <span className="h-2 w-2 rounded-full bg-green-500" /> Google Calendar connected
        </p>

        {calendar.email ? <p className="mt-1 text-[11px] text-green-700/80">{calendar.email}</p> : null}

        <p className="mt-1 text-[11px] text-slate-500">Live availability and booking use this calendar.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5" data-testid="calendar-disconnected">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
        <span className="h-2 w-2 rounded-full bg-amber-500" /> Not connected
      </p>

      <p className="mt-1 text-[11px] text-amber-700/90">
        Live booking requires the buyer to connect Google Calendar during install.
      </p>

      <button
        type="button"
        onClick={calendar.onConnect}
        disabled={calendar.connecting || !calendar.onConnect}
        data-testid="connect-calendar"
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {calendar.connecting ? "Connecting…" : "Connect Google Calendar"}
      </button>
    </div>
  );
}

function ConnectorRequirements({ node }: { node: BuilderNode }) {
  const type = String(node.data.type ?? "");
  const requirements = getNodeDefinition(type)?.requiredConnectors ?? [];

  if (requirements.length === 0) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-slate-500"
        data-testid="connector-requirements-none"
      >
        No buyer connection required for this node.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="connector-requirements">
      {requirements.map((req) => {
        const buyerOwned = req.ownedBy === "buyer";

        return (
          <div
            key={`${req.connector}-${req.note}`}
            data-testid={`connector-requirement-${req.connector}`}
            className={`rounded-xl border px-3 py-2.5 ${buyerOwned ? "border-blue-100 bg-blue-50" : "border-violet-100 bg-violet-50"
              }`}
          >
            <p className={`flex items-center gap-1.5 text-xs font-semibold ${buyerOwned ? "text-blue-700" : "text-violet-700"}`}>
              <span className={`h-2 w-2 rounded-full ${buyerOwned ? "bg-blue-500" : "bg-violet-500"}`} />
              {req.label}
              {req.optional ? " (optional)" : ""}

              <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                {buyerOwned ? "Buyer connects" : "Platform"}
              </span>
            </p>

            <p className="mt-1 text-[11px] leading-5 text-slate-600">{req.note}</p>

            {req.scopes?.length ? (
              <p className="mt-1 break-words text-[10px] text-slate-400">Scopes: {req.scopes.join(", ")}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CalendarConnector({
  calendar,
  ownership,
  node
}: {
  calendar: CalendarConnection;
  ownership: ConnectorOwnership;
  node: BuilderNode;
}) {
  if (ownership === "buyer") return <CalendarConnect calendar={calendar} />;
  return <ConnectorRequirements node={node} />;
}

type StepOverview = {
  tone: "amber" | "violet" | "blue" | "green" | "orange" | "slate" | "rose";
  summary: string;
  needs: string[];
  creates: string[];
  setup: string[];
};

const TONE_CLASSNAMES: Record<StepOverview["tone"], {
  card: string;
  icon: string;
  title: string;
  chip: string;
}> = {
  amber: {
    card: "border-amber-100 bg-amber-50/70",
    icon: "bg-amber-600 text-white",
    title: "text-amber-800",
    chip: "border-amber-100 bg-white/80 text-amber-700"
  },
  violet: {
    card: "border-violet-100 bg-violet-50/70",
    icon: "bg-violet-600 text-white",
    title: "text-violet-800",
    chip: "border-violet-100 bg-white/80 text-violet-700"
  },
  blue: {
    card: "border-blue-100 bg-blue-50/70",
    icon: "bg-blue-600 text-white",
    title: "text-blue-800",
    chip: "border-blue-100 bg-white/80 text-blue-700"
  },
  green: {
    card: "border-green-100 bg-green-50/70",
    icon: "bg-green-600 text-white",
    title: "text-green-800",
    chip: "border-green-100 bg-white/80 text-green-700"
  },
  orange: {
    card: "border-orange-100 bg-orange-50/70",
    icon: "bg-orange-600 text-white",
    title: "text-orange-800",
    chip: "border-orange-100 bg-white/80 text-orange-700"
  },
  slate: {
    card: "border-slate-200 bg-slate-50/80",
    icon: "bg-slate-700 text-white",
    title: "text-slate-800",
    chip: "border-slate-200 bg-white text-slate-600"
  },
  rose: {
    card: "border-rose-100 bg-rose-50/70",
    icon: "bg-rose-600 text-white",
    title: "text-rose-800",
    chip: "border-rose-100 bg-white/80 text-rose-700"
  }
};

function titleFromType(value: string): string {
  return value
    .replace(/^[a-z]+\./, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeVariable(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .replace(/^[a-z]+\./, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function uniqueItems(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function nodeOverview(node: BuilderNode): StepOverview {
  const type = String(node.data.type ?? "");
  const connector = String(node.data.connector ?? "");
  const nodeKind = String(node.data.nodeKind ?? "");
  const definition = getNodeDefinition(type);
  const produced = uniqueItems(definition?.producedVariables?.map(humanizeVariable) ?? []);
  const required = uniqueItems(definition?.requiredVariables?.map(humanizeVariable) ?? []);

  if (type === VOICE_NODE_TYPES.phoneCallTrigger) {
    return {
      tone: "amber",
      summary: "Starts the agent when a customer calls the buyer's assigned phone number.",
      needs: ["Buyer phone number", "Call routing rule"],
      creates: ["Caller details", "Call start time"],
      setup: ["Buyer connects phone provider during install"]
    };
  }

  if (type === VOICE_NODE_TYPES.voiceConversation) {
    return {
      tone: "violet",
      summary: "Handles the live AI voice conversation and collects the details needed by later steps.",
      needs: ["Assistant prompt", "Voice", "Language"],
      creates: ["Customer details", "Requested service", "Preferred booking time"],
      setup: ["Buyer can override voice and business instructions before deploy"]
    };
  }

  if (type === VOICE_NODE_TYPES.calendarAvailability) {
    return {
      tone: "blue",
      summary: "Checks the buyer's connected calendar and returns appointment options.",
      needs: ["Requested date", "Service duration", "Calendar access"],
      creates: ["Available slots", "Calendar timezone"],
      setup: ["Buyer connects Google Calendar during install"]
    };
  }

  if (type === VOICE_NODE_TYPES.bookAppointment) {
    return {
      tone: "blue",
      summary: "Creates the final calendar event after the customer chooses a slot.",
      needs: ["Customer details", "Selected slot", "Calendar access"],
      creates: ["Booking status", "Confirmation ID", "Calendar event"],
      setup: ["Buyer calendar is used at deployment time"]
    };
  }

  if (type === VOICE_NODE_TYPES.sendSms) {
    return {
      tone: "green",
      summary: "Sends a confirmation or internal update using the buyer's SMS setup.",
      needs: ["Recipient phone", "Message template"],
      creates: ["SMS delivery status"],
      setup: ["Buyer phone provider sends the live message"]
    };
  }

  if (type === "trigger.whatsapp_message_received") {
    return {
      tone: "green",
      summary: "Starts when a WhatsApp message arrives on your connected Meta Cloud API number.",
      needs: ["WhatsApp connection", "Message filters"],
      creates: ["Contact name", "Contact phone", "Message text"],
      setup: ["Architect connects WhatsApp under Integrations → WhatsApp"]
    };
  }

  if (type === "action.send_whatsapp" || type === "communication.send_whatsapp") {
    return {
      tone: "green",
      summary: "Sends a WhatsApp text message through Meta Cloud API.",
      needs: ["WhatsApp connection", "Recipient", "Message body"],
      creates: ["WhatsApp delivery status", "Message id"],
      setup: ["Architect WhatsApp connection must be CONNECTED"]
    };
  }

  if (type === VOICE_NODE_TYPES.endFlow) {
    return {
      tone: "slate",
      summary: "Ends the workflow cleanly and decides what happens after the conversation.",
      needs: ["Closing message"],
      creates: ["Final flow status"],
      setup: ["No extra buyer setup required"]
    };
  }

  if (nodeKind === "trigger") {
    return {
      tone: "amber",
      summary: definition?.description ?? "Starts the workflow from an external event.",
      needs: [connector ? `${connector} event` : "Trigger event"],
      creates: produced.length ? produced : ["Trigger details"],
      setup: [connector ? `${connector} is configured by the buyer or platform` : "Setup depends on the trigger type"]
    };
  }

  if (nodeKind === "ai") {
    return {
      tone: "violet",
      summary: definition?.description ?? "Uses AI to understand, generate, or transform content for the workflow.",
      needs: required.length ? required : ["Prompt or instruction"],
      creates: produced.length ? produced : ["AI result"],
      setup: ["Model settings are template defaults and can be adjusted before deploy"]
    };
  }

  if (nodeKind === "condition") {
    return {
      tone: "orange",
      summary: definition?.description ?? "Routes the workflow based on a rule or business condition.",
      needs: required.length ? required : ["Condition rule"],
      creates: ["Routing decision"],
      setup: ["No external connection required"]
    };
  }

  if (nodeKind === "connector") {
    return {
      tone: connector === "SMS" ? "green" : connector === "Google Calendar" ? "blue" : "slate",
      summary: definition?.description ?? "Connects this workflow to another service or platform action.",
      needs: required.length ? required : [connector ? `${connector} configuration` : "Connector configuration"],
      creates: produced.length ? produced : ["Action result"],
      setup: [connector ? `${connector} access is resolved during buyer setup or deployment` : "Connection setup depends on this action"]
    };
  }

  if (nodeKind === "block" || type.startsWith("block.")) {
    return {
      tone: "rose",
      summary: definition?.description ?? "A pre-designed section of your customer's page.",
      needs: ["Your words and choices"],
      creates: ["A section your customer sees"],
      setup: ["Design is handled by Triven — you only fill in the content"]
    };
  }

  return {
    tone: "slate",
    summary: definition?.description ?? "A generic workflow step that can be connected to other nodes.",
    needs: required.length ? required : ["Previous step data"],
    creates: produced.length ? produced : [titleFromType(type || String(node.data.title ?? "Step"))],
    setup: ["Setup depends on how this step is used"]
  };
}

function PillList({ items, emptyText, className }: { items: string[]; emptyText: string; className: string }) {
  const visibleItems = items.length ? items : [emptyText];

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleItems.map((item) => (
        <span key={item} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * WHAT THIS STEP TAKES AND WHAT IT LEAVES.
 *
 * This was a coloured card holding a repeated title, a repeated description, a
 * row of red pills labelled NEEDS, another labelled CREATES, and a note in a
 * box inside the box. The founder's words: "I am not able to understand this."
 *
 * Two lines now. What goes in, what comes out — the two questions the SOP asks
 * of every node (docs/NODE-SOP.md, 3 and 4) and the only two an architect is
 * actually asking when they open a node. Everything the panel already says
 * above is not said twice.
 */
function NodeOverviewPanel({ node }: { node: BuilderNode }) {
  const overview = nodeOverview(node);

  const line = (label: string, items: string[], empty: string) => (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {items.length === 0 ? (
        <span className="text-[13px] text-slate-400">{empty}</span>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700"
            >
              {item}
            </span>
          ))}
        </span>
      )}
    </div>
  );

  return (
    <Section title="In and out">
      <div className="rounded-xl border border-gray-200 px-3.5 py-2" data-testid="node-step-overview">
        {line("Takes", overview.needs, "Nothing — this step starts on its own")}
        <div className="border-t border-gray-100" />
        {line("Gives", overview.creates, "Nothing it hands on")}
      </div>
    </Section>
  );
}

/* --------------------------- advanced settings --------------------------- */

/** {{variable}} tokens referenced anywhere in this node's string fields. */
function collectTemplateVariables(node: BuilderNode): string[] {
  const seen = new Set<string>();

  for (const value of Object.values(node.data)) {
    if (typeof value !== "string") continue;
    for (const match of value.match(/{{\s*[\w.-]+\s*}}/g) ?? []) {
      seen.add(match.replace(/[{}]/g, "").trim());
    }
  }

  return Array.from(seen);
}

function AdvancedVariableGroup({
  title,
  keys,
  emptyText,
  helper,
  testId,
  copiedKey,
  onCopy
}: {
  title: string;
  keys: string[];
  emptyText: string;
  helper?: string;
  testId: string;
  copiedKey: string | null;
  onCopy: (key: string) => void;
}) {
  return (
    <div data-testid={testId}>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>

      {helper && keys.length > 0 ? <p className="mb-2 text-[11px] leading-4 text-slate-400">{helper}</p> : null}

      {keys.length === 0 ? (
        <p
          data-testid={`${testId}-empty`}
          className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 text-[11px] text-slate-400"
        >
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {keys.map((key) => (
            <button
              type="button"
              key={key}
              data-testid={`${testId}-item-${key}`}
              onClick={() => onCopy(key)}
              title={`Click to copy {{${key}}}`}
              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 font-mono text-[10px] text-slate-500 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600"
            >
              {copiedKey === key ? "Copied!" : `{{${key}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Easy-to-read variable rows: plain name + tip + copyable token. */
function FriendlyVariableGroup({
  title,
  keys,
  emptyText,
  helper,
  testId,
  copiedKey,
  onCopy,
  guideFor
}: {
  title: string;
  keys: string[];
  emptyText: string;
  helper?: string;
  testId: string;
  copiedKey: string | null;
  onCopy: (key: string) => void;
  guideFor: (key: string) => { label: string; tip: string };
}) {
  return (
    <div data-testid={testId}>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      {helper && keys.length > 0 ? <p className="mb-2 text-[11px] leading-4 text-slate-400">{helper}</p> : null}
      {keys.length === 0 ? (
        <p
          data-testid={`${testId}-empty`}
          className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 text-[11px] text-slate-400"
        >
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => {
            const guide = guideFor(key);
            return (
              <button
                type="button"
                key={key}
                data-testid={`${testId}-item-${key}`}
                onClick={() => onCopy(key)}
                title={`Click to copy {{${key}}}`}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-gray-100 bg-white px-3 py-2 text-left transition hover:border-violet-200 hover:bg-violet-50/40"
              >
                <span className="text-[12px] font-semibold text-slate-700">{guide.label}</span>
                <span className="text-[11px] leading-4 text-slate-400">{guide.tip}</span>
                <span className="mt-0.5 font-mono text-[10px] text-violet-600">
                  {copiedKey === key ? "Copied!" : `{{${key}}}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The quiet switch for the doors built inside a step.
 *
 * Steps that carry doors read what arrives and tidy what they return without
 * anyone placing an AI node for it. That is on from the start and stays out of
 * sight — this switch exists only so an architect who wants the raw, literal
 * behaviour can have it. Off stores `doorsDisabled: "true"`, the one key the
 * runtime looks at.
 */
function NodeDoorsToggle({
  node,
  onUpdateNodeData
}: {
  node: BuilderNode;
  onUpdateNodeData: NodePropsPanel["onUpdateNodeData"];
}) {
  const enabled = nodeDoorsEnabled(node.data);

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-slate-700">Smart input &amp; output</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-400">
          Lets this step understand what arrives and tidy what it returns.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Smart input & output"
        data-testid="node-doors-toggle"
        onClick={() => onUpdateNodeData(NODE_DOORS_DISABLED_KEY, enabled ? "true" : "false")}
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          enabled ? "bg-amber-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </div>
  );
}

function NodeAdvancedSettingsPanel({
  node,
  onUpdateNodeData,
  doorsOnly = false
}: {
  node: BuilderNode;
  onUpdateNodeData: NodePropsPanel["onUpdateNodeData"];
  /** Product sections get the switch alone — never the variable-mapping drawer. */
  doorsOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const type = String(node.data.type ?? "");
  const definition = getNodeDefinition(type);
  const connector = String(node.data.connector ?? "");
  const connectorAction = String(node.data.connectorAction ?? "");
  const isCalendlyAction = type === CALENDLY_NODE_TYPES.action || type.startsWith("action.calendly_");
  const calendlyActionKey = (() => {
    if (!isCalendlyAction) return "";
    if (connectorAction) return connectorAction;
    if (type.startsWith("action.calendly_")) {
      const legacy = type.slice("action.calendly_".length);
      const aliases: Record<string, string> = {
        get_event_details: "get_event",
        get_invitee_details: "get_invitee"
      };
      return aliases[legacy] ?? legacy;
    }
    return "get_my_profile";
  })();
  const calendlyIo = isCalendlyAction ? getCalendlyActionIo(calendlyActionKey) : null;

  const inputKeys = calendlyIo?.requiredVariables ?? definition?.requiredVariables ?? [];
  let outputKeys = calendlyIo?.producedVariables ?? definition?.producedVariables ?? [];
  if (type === "ai.llm_call") {
    const nodeLabel = String(node.data.title ?? node.data.label ?? node.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/(^\.|\.$)/g, "");
    outputKeys = [
      node.data.llmOutputKey || "ai.output",
      `node.${node.id}.output`,
      `node.${nodeLabel}.output`
    ];
  }
  const usedKeys = collectTemplateVariables(node);

  function handleCopy(key: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(`{{${key}}}`).catch(() => undefined);
    }
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1200);
  }

  return (
    <div className="border-t border-gray-100 px-5 py-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        data-testid="node-advanced-settings-toggle"
        className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-left transition hover:border-gray-200"
      >
        <span className="text-xs font-bold text-slate-600">Advanced settings</span>
        <BuilderIcon
          name="chevron"
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-4" data-testid="node-advanced-settings">
          {hasNodeDoors(type) ? (
            <NodeDoorsToggle node={node} onUpdateNodeData={onUpdateNodeData} />
          ) : null}

          {doorsOnly ? null : isCalendlyAction ? (
            <>
              <FriendlyVariableGroup
                title="Input mapping"
                testId="node-advanced-input"
                emptyText="This step does not need any values from earlier steps."
                helper="What this Calendly action needs before it can run. Click to copy, then paste into a field."
                keys={inputKeys}
                copiedKey={copiedKey}
                onCopy={handleCopy}
                guideFor={getCalendlyVariableGuide}
              />
              <FriendlyVariableGroup
                title="Output mapping"
                testId="node-advanced-output"
                emptyText="This step does not publish variables."
                helper="What this action gives you after it runs. Paste these into later steps (SMS, AI, email, etc.)."
                keys={outputKeys}
                copiedKey={copiedKey}
                onCopy={handleCopy}
                guideFor={getCalendlyVariableGuide}
              />
            </>
          ) : (
            <>
              <AdvancedVariableGroup
                title="Input mapping"
                testId="node-advanced-input"
                emptyText="This step does not require mapped variables."
                keys={inputKeys}
                copiedKey={copiedKey}
                onCopy={handleCopy}
              />
              <AdvancedVariableGroup
                title="Output mapping"
                testId="node-advanced-output"
                emptyText="This step does not publish variables."
                helper="These values become available to the steps that run after this one."
                keys={outputKeys}
                copiedKey={copiedKey}
                onCopy={handleCopy}
              />
            </>
          )}

          {doorsOnly ? null : (
            <AdvancedVariableGroup
              title="Variables"
              testId="node-advanced-variables"
              emptyText="No variables are used in this step yet."
              helper="Variables referenced by this step's fields. Click one to copy it, then paste it into any text field."
              keys={usedKeys}
              copiedKey={copiedKey}
              onCopy={handleCopy}
            />
          )}

          {doorsOnly ? null : (
            <div data-testid="node-advanced-developer">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Developer options</p>
              <div className="space-y-1 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-[11px] leading-5 text-slate-500">
                <p>id: {node.id}</p>
                <p>type: {type || "—"}</p>
                <p>kind: {String(node.data.nodeKind ?? "—")}</p>
                {connector ? <p>connector: {connector}</p> : null}
                {connectorAction ? <p>action: {connectorAction}</p> : null}
                {definition?.capability ? <p>capability: {definition.capability}</p> : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ data helpers ------------------------------ */

function fields(selectedNode: BuilderNode, onUpdateNodeData: NodePropsPanel["onUpdateNodeData"]) {
  const str = (key: string, fallback = ""): string => {
    const value = selectedNode.data[key];
    return typeof value === "string" ? value : fallback;
  };

  const flag = (key: string, fallback: boolean): boolean => {
    const value = selectedNode.data[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "true";
    return fallback;
  };

  const set = (key: string) => (value: string) => onUpdateNodeData(key as keyof BuilderNodeData, value);

  return { str, flag, set };
}

/* --------------------- Generic capability node panels --------------------- */

/** Human-readable label for a stored call handling mode. Never show raw enum values. */
function friendlyAnswerMode(value: unknown): string {
  const mode = String(value ?? "").trim();

  const labels: Record<string, string> = {
    AI_ANSWERS: "AI answers every call",
    FORWARD_THEN_AI: "Try the business phone first, then AI",
    FORWARD_TO_HUMAN: "Forward to human",
    AI_AFTER_HOURS: "AI after business hours",
    FOLLOW_SCHEDULE: "Follow forwarding schedule"
  };

  return labels[mode] ?? "AI answers every call";
}

/** Select that stores raw mode values but only ever displays friendly labels. */
function AnswerModeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const baseOptions = [
    { value: "AI_ANSWERS", label: friendlyAnswerMode("AI_ANSWERS") },
    { value: "FORWARD_THEN_AI", label: friendlyAnswerMode("FORWARD_THEN_AI") }
  ];

  const allOptions =
    !value || baseOptions.some((option) => option.value === value)
      ? baseOptions
      : [{ value, label: friendlyAnswerMode(value) }, ...baseOptions];

  return (
    <div className="relative">
      <select
        data-testid="node-inspector-answer-mode-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none focus:outline-none ring-0 focus:ring-0 focus:border-amber-400 transition-colors shadow-none cursor-pointer"
      >
        {allOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        <BuilderIcon name="chevron" className="h-4 w-4" />
      </span>
    </div>
  );
}

function PhoneCallTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="Buyer requirement">
        <RequirementNotice title="Buyer phone setup" testId="phone-trigger-buyer-requirement">
          The buyer assigns the live phone number during install. This template only defines that the workflow starts from an inbound call.
        </RequirementNotice>
      </Section>

      <Section title="Call handling" last>
        <Label>Phone number</Label>
        <ReadOnly value="This number will be assigned when the agent is deployed." testId="phone-trigger-number" />

        <div className="mt-4">
          <Label>Answer mode</Label>
          <AnswerModeSelect value={str("callHandlingMode", "AI_ANSWERS")} onChange={set("callHandlingMode")} />
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Final phone number, routing, timezone, and forwarding are configured by the buyer.
        </p>
      </Section>
    </>
  );
}

function AiVoiceConversationProps({ selectedNode, onUpdateNodeData, variableNodePrefixes }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  // A node saved before these dials existed resolves to the researched
  // defaults, so the sliders always show the behaviour the call will have.
  const tuning = resolveSalesTuning(selectedNode.data as Record<string, unknown>);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />

        <div className="mt-4">
          <Label>Assistant name</Label>
          <TextInput
            value={str("assistantName")}
            onChange={set("assistantName")}
            placeholder="e.g. Sarah"
          />

        </div>
      </Section>

      <Section title="Voice">
        <VoicePicker
          accent="violet"
          selectedVoice={str("voice", PLATFORM_DEFAULT_VOICE_ID)}
          customVoiceId={str("voiceId")}
          testIdPrefix="architect-voice-picker"
          subtitle=""
          onSelectDefault={() => {
            onUpdateNodeData("voice", PLATFORM_DEFAULT_VOICE_ID);
            onUpdateNodeData("voiceName", TRIVEN_VOICE_NAME);
            onUpdateNodeData("voiceProvider", DEFAULT_VOICE_PROVIDER);
            onUpdateNodeData("voiceId", "");
          }}
          onSelectPreset={(preset) => {
            onUpdateNodeData("voice", preset.id || PLATFORM_DEFAULT_VOICE_ID);
            onUpdateNodeData("voiceName", preset.name || TRIVEN_VOICE_NAME);
            onUpdateNodeData("voiceProvider", DEFAULT_VOICE_PROVIDER);
            onUpdateNodeData("voiceId", "");
          }}
          onCustomVoiceIdChange={(value) => {
            const cleanValue = value.trim();

            onUpdateNodeData("voice", cleanValue ? "custom" : PLATFORM_DEFAULT_VOICE_ID);
            onUpdateNodeData("voiceName", cleanValue ? "Custom ElevenLabs Voice" : TRIVEN_VOICE_NAME);
            onUpdateNodeData("voiceProvider", DEFAULT_VOICE_PROVIDER);
            onUpdateNodeData("voiceId", value);
          }}
        />

      </Section>

      <Section title="Conversation">
        {/* <Label>Language</Label>
        <SelectBox
          value={str("language", "en-US")}
          onChange={set("language")}
          options={[
            { value: "en-US", label: "English (US)" },
            { value: "en-GB", label: "English (UK)" },
            { value: "es", label: "Spanish" },
            { value: "hi", label: "Hindi" }
          ]}
        />

        <div className="mt-4">
          <Label>Speaking speed</Label>
          <SelectBox value={str("speakingSpeed", "1.0")} onChange={set("speakingSpeed")} options={["0.8", "0.9", "1.0", "1.1", "1.2"]} />
        </div> */}

        <div className="mt-4">
          <Label>First message</Label>
          <TextInput
            value={str("firstMessage")}
            onChange={set("firstMessage")}
            placeholder="e.g. Thanks for calling {{business.name}} — how can I help?"
          />
          <UnknownVariablesNote
            text={str("firstMessage")}
            nodePrefixes={variableNodePrefixes}
            testId="node-inspector-first-message-variable-warning"
          />
        </div>
      </Section>

      <Section title="Intelligence">
        <Label>AI model</Label>
        <SelectBox value={str("model", "gpt-4o")} onChange={set("model")} options={["gpt-4o", "gpt-4o-mini", "claude-sonnet", "gemini-3.1-flash-lite", "gemini-2.0-flash", "gemini-1.5-pro", "llama-3.1-70b"]} />

        <div className="mt-4">
          <Label>System prompt</Label>
          <TextArea value={str("systemPrompt")} onChange={set("systemPrompt")} height="h-44" mono />
          <UnknownVariablesNote
            text={str("systemPrompt")}
            nodePrefixes={variableNodePrefixes}
            testId="node-inspector-system-prompt-variable-warning"
          />
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Use generic placeholders like {"{{business.name}}"}, {"{{customer.name}}"}, and {"{{appointment.service}}"}.
        </p>
      </Section>

      <Section title="How she runs the call">
        <p className="mb-4 text-[11px] leading-5 text-slate-500" data-testid="sales-tuning-intro">
          These change the call itself — her timing, her patience, how hard she closes. Every default below comes from
          measured data on real sales calls, so move one only when you have heard the problem yourself.
        </p>

        {SALES_TUNING_CONTROLS.map((control) => (
          <TuningSlider
            key={control.key}
            control={control}
            value={tuning[control.key]}
            onChange={(value) => onUpdateNodeData(control.key as keyof BuilderNodeData, value)}
          />
        ))}

        <button
          type="button"
          data-testid="sales-tuning-reset"
          onClick={() => {
            for (const control of SALES_TUNING_CONTROLS) {
              onUpdateNodeData(control.key as keyof BuilderNodeData, control.default);
            }
          }}
          className="mt-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:border-violet-300 hover:text-violet-600"
        >
          Reset to the researched defaults
        </button>
      </Section>

      <Section title="Custom instructions" last>
        <Label>Template-level instructions</Label>
        <textarea
          data-testid="node-inspector-custom-instructions-textarea"
          value={str("customInstructions")}
          onChange={(event) => onUpdateNodeData("customInstructions", event.target.value)}
          placeholder="Enter reusable rules for this agent template…"
          className="h-48 w-full resize-y overflow-y-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-400/50"
        />
        <UnknownVariablesNote
          text={str("customInstructions")}
          nodePrefixes={variableNodePrefixes}
          testId="node-inspector-custom-instructions-variable-warning"
        />

        <p className="mt-2 text-[11px] text-slate-400" data-testid="ai-custom-instructions-note">
          Buyer-specific instructions are added during install and merged into the final prompt at deploy.
        </p>
      </Section>
    </>
  );
}

function CalendarAvailabilityProps({ selectedNode, onUpdateNodeData, calendar, ownership }: CalendarPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="Buyer requirement">
        <CalendarConnector calendar={calendar} ownership={ownership} node={selectedNode} />
      </Section>

      <Section title="Template defaults" last>
        <Label>Buffer between appointments (min)</Label>
        <SelectBox value={str("bufferMinutes", "10")} onChange={set("bufferMinutes")} options={["0", "5", "10", "15", "30"]} />

        <div className="mt-4">
          <Label>Slots to offer</Label>
          <SelectBox value={str("slotsToOffer", "3")} onChange={set("slotsToOffer")} options={["2", "3", "4"]} />
        </div>

        <div className="mt-4">
          <Label>Maximum advance booking (days)</Label>
          <SelectBox value={str("maxAdvanceDays", "30")} onChange={set("maxAdvanceDays")} options={["7", "14", "30", "90"]} />
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Buyer calendar ID and timezone are configured during install, not inside architect templates.
        </p>
      </Section>
    </>
  );
}

function BookCalendarAppointmentProps({ selectedNode, onUpdateNodeData, calendar, ownership }: CalendarPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="Buyer requirement">
        <CalendarConnector calendar={calendar} ownership={ownership} node={selectedNode} />
      </Section>

      <Section title="Event template">
        <Label>Event title format</Label>
        <TextInput
          mono
          value={str("eventTitleFormat")}
          onChange={set("eventTitleFormat")}
          placeholder="{{appointment.service}} - {{customer.name}}"
        />

        <div className="mt-4">
          <Label>Event description</Label>
          <TextArea
            mono
            height="h-20"
            value={str("eventDescription")}
            onChange={set("eventDescription")}
            placeholder="Phone: {{customer.phone}} | Service: {{appointment.service}}"
          />
        </div>
      </Section>

      <Section title="Reminder & confirmation" last>
        <BoolField label="Send calendar reminder" value={flag("reminderEnabled", true)} onChange={set("reminderEnabled")} />

        <div className="mt-4">
          <Label>Reminder timing (minutes before)</Label>
          <SelectBox value={str("reminderTiming", "120")} onChange={set("reminderTiming")} options={["60", "120", "1440"]} />
        </div>

        <div className="mt-4">
          <Label>Confirmation message</Label>
          <TextArea
            height="h-16"
            value={str("confirmationMessage")}
            onChange={set("confirmationMessage")}
            placeholder="Said after a successful booking"
          />
        </div>
      </Section>
    </>
  );
}

function SendEmailProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="Recipient">
        <RequirementNotice title="Buyer email setup" testId="send-email-buyer-requirement">
          To, CC, and BCC are configured by the buyer after installing this agent. During testing, use the Test Email
          field on the Test tab to receive this email yourself.
        </RequirementNotice>
      </Section>

      <Section title="Message">
        <Label>Purpose</Label>
        <SelectBox
          value={str("purpose", "auto")}
          onChange={set("purpose")}
          options={[
            { value: "auto", label: "Auto (confirmation when booked, follow-up otherwise)" },
            { value: "BOOKING_CONFIRMATION", label: "Appointment confirmation" },
            { value: "CUSTOMER_FOLLOW_UP", label: "Follow-up" },
            { value: "CALL_SUMMARY", label: "Call summary" },
            { value: "INTERNAL_NOTIFICATION", label: "Internal notification" }
          ]}
        />

        <div className="mt-4">
          <Label>Subject</Label>
          <TextInput
            value={str("subjectTemplate")}
            onChange={set("subjectTemplate")}
            placeholder="e.g. Your {{serviceName}} appointment with {{businessName}}"
          />
        </div>

        <div className="mt-4">
          <Label>Text body</Label>
          <TextArea height="h-32" value={str("bodyTemplate")} onChange={set("bodyTemplate")} />
        </div>

        <div className="mt-4">
          <Label>HTML body (optional)</Label>
          <TextArea mono height="h-32" value={str("htmlTemplate")} onChange={set("htmlTemplate")} />
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400" data-testid="send-email-variables">
          Allowed variables: {EMAIL_TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")}. Unknown variables are
          removed at send time and HTML is sanitized.
        </p>
      </Section>

      <Section title="Failure handling" last>
        <Label>If sending fails</Label>
        <SelectBox
          value={str("continueOnFailure", "true")}
          onChange={set("continueOnFailure")}
          options={[
            { value: "true", label: "Continue the workflow" },
            { value: "false", label: "Stop this branch" }
          ]}
        />

        <div className="mt-4">
          <Label>Fallback</Label>
          <SelectBox
            value={str("fallbackBehavior", "skip")}
            onChange={set("fallbackBehavior")}
            options={[
              { value: "skip", label: "Skip silently" },
              { value: "notify_team", label: "Notify the team by email" }
            ]}
          />
        </div>
      </Section>
    </>
  );
}

function useWhatsAppConnections() {
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listWhatsAppConnections()
      .then((res) => {
        if (cancelled) return;
        setConnections(res.data?.connections ?? []);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load WhatsApp connections");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return {
    connections,
    loading,
    error,
    reload: () => setReloadToken((value) => value + 1)
  };
}

function WhatsAppConnectionPicker({
  value,
  onChange,
  testId
}: {
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  const { connections, loading, error, reload } = useWhatsAppConnections();
  const [connectOpen, setConnectOpen] = useState(false);
  const options: SelectBoxOption[] = [
    { value: "", label: loading ? "Loading connections…" : "Select a WhatsApp connection" },
    ...connections.map((c) => ({
      value: c.id,
      label: `${c.displayName || c.businessName || c.phoneNumber} (${c.status})`
    }))
  ];

  return (
    <div data-testid={testId}>
      <SelectBox value={value} onChange={onChange} options={options} testId={`${testId}-select`} />
      {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}
      {!loading && connections.length === 0 ? (
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          No WhatsApp connections yet.{" "}
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline"
            data-testid={`${testId}-connect-link`}
          >
            
            Connect WhatsApp
          </button>
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline"
          data-testid={`${testId}-connect-another`}
        >
          <WhatsAppIcon className="h-3 w-3" />
          Connect another WhatsApp
        </button>
      )}
      <WhatsAppConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={(connection) => {
          void reload();
          onChange(connection.id);
        }}
      />
    </div>
  );
}

/**
 * The outbound call node.
 *
 * The consent rule is not a setting here on purpose: it is enforced in the
 * engine on every single call, and no field in this panel can turn it off. An
 * architect who tries to dial someone who never asked gets a refusal in the
 * run log, not a call.
 */
function OutboundCallProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>

      <Section title="Who to call" last>
        <p className="mb-3 text-xs leading-5 text-slate-500" data-testid="outbound-call-consent-note">
          Your agent only ever phones people who asked to be phoned. If someone
          has not asked, the call is refused and the reason is written in the
          run log. That rule is part of the engine and cannot be switched off.
        </p>

        <Label>Number to call</Label>
        <TextInput
          value={str("callTo")}
          onChange={set("callTo")}
          placeholder="{{lead.phone}} or +15551234567"
        />
        <p className="mt-2 text-xs leading-5 text-slate-500" data-testid="outbound-call-target-hint">
          Leave this empty to call back whoever just contacted you. Use a
          variable like{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
            {"{{webhook.body.phone}}"}
          </code>{" "}
          when the person comes from your own website or form.
        </p>

        <div className="mt-4">
          <Label>What the agent says first</Label>
          <TextArea
            value={str("firstMessage")}
            onChange={set("firstMessage")}
            height="h-20"
            placeholder="Hi, this is Maya from Triven — you asked us to give you a call about the AI receptionist."
          />
        </div>
      </Section>
    </>
  );
}

/**
 * The timer's settings. Deliberately four plain choices — an architect should
 * never meet a cron expression, and the hour floor is enforced by the engine,
 * so nothing here can create a clock that burns money every minute.
 */
function ScheduleTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const cadence = str("cadence", "daily");

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>

      <Section title="How often" last>
        <p className="mb-3 text-xs leading-5 text-slate-500" data-testid="schedule-trigger-intro">
          This agent runs by itself, with nobody watching. Times follow the
          business&apos;s own clock once they install it.
        </p>

        <Label>Runs</Label>
        <SelectBox
          value={cadence}
          onChange={set("cadence")}
          options={[
            { value: "hourly", label: "Every hour" },
            { value: "daily", label: "Every day" },
            { value: "weekly", label: "Every week" }
          ]}
          testId="schedule-trigger-cadence"
        />

        {cadence === "weekly" ? (
          <div className="mt-4">
            <Label>On</Label>
            <SelectBox
              value={str("weekday", "1")}
              onChange={set("weekday")}
              options={[
                { value: "1", label: "Monday" },
                { value: "2", label: "Tuesday" },
                { value: "3", label: "Wednesday" },
                { value: "4", label: "Thursday" },
                { value: "5", label: "Friday" },
                { value: "6", label: "Saturday" },
                { value: "0", label: "Sunday" }
              ]}
              testId="schedule-trigger-weekday"
            />
          </div>
        ) : null}

        {cadence === "hourly" ? (
          <p className="mt-4 text-xs leading-5 text-slate-500" data-testid="schedule-trigger-hourly-note">
            Runs once an hour. That is the fastest schedule we allow — anything
            quicker multiplies cost with nobody checking the result.
          </p>
        ) : (
          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <Label>Hour</Label>
              <SelectBox
                value={str("hour", "9")}
                onChange={set("hour")}
                options={Array.from({ length: 24 }, (_, h) => ({
                  value: String(h),
                  label: `${String(h).padStart(2, "0")}:00`
                }))}
                testId="schedule-trigger-hour"
              />
            </div>
            <div className="flex-1">
              <Label>Minute</Label>
              <SelectBox
                value={str("minute", "0")}
                onChange={set("minute")}
                options={["0", "15", "30", "45"].map((m) => ({
                  value: m,
                  label: `:${m.padStart(2, "0")}`
                }))}
                testId="schedule-trigger-minute"
              />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

/**
 * The webhook's settings. The private link itself is NOT shown here on purpose:
 * one workflow is installed by many businesses, so there is no single URL at
 * design time. Each buyer gets their own link when they go live.
 */
function WebhookTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>

      <Section title="How it works" last>
        <p className="mb-3 text-xs leading-5 text-slate-500" data-testid="webhook-trigger-intro">
          Every business that installs this agent gets its own private link. They
          paste it into their own software — their shop, their forms, their
          booking tool — and that software starts this agent.
        </p>

        <Label>Example of what they will send</Label>
        <TextArea
          value={str("sampleBody", '{\n  "message": "New order from Priya",\n  "amount": 4200\n}')}
          onChange={set("sampleBody")}
          height="h-28"
        />
        <p className="mt-2 text-xs leading-5 text-slate-500" data-testid="webhook-trigger-variables">
          Use any field in later steps as{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
            {"{{webhook.body.message}}"}
          </code>
          . Field names may use letters, numbers and underscores.
        </p>
      </Section>
    </>
  );
}

function WhatsAppTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>

      <Section title="WhatsApp connection">
        <WhatsAppRequirementNotice testId="whatsapp-trigger-requirement">
          Inbound WhatsApp messages run this workflow when they arrive on the selected Meta Cloud API number.
        </WhatsAppRequirementNotice>

        <div className="mt-4">
          <Label>Connection</Label>
          <WhatsAppConnectionPicker
            value={str("connectionId")}
            onChange={set("connectionId")}
            testId="whatsapp-trigger-connection"
          />
        </div>
      </Section>

      <Section title="Filters" last>
        <Label>Listen for</Label>
        <SelectBox
          value={str("listenFor", "all")}
          onChange={set("listenFor")}
          options={[
            { value: "all", label: "All messages" },
            { value: "text", label: "Text only" },
            { value: "image", label: "Images" },
            { value: "document", label: "Documents" },
            { value: "audio", label: "Audio" },
            { value: "video", label: "Video" }
          ]}
          testId="whatsapp-trigger-listen-for"
        />

        <div className="mt-4">
          <BoolField label="Ignore group messages" value={flag("ignoreGroups", true)} onChange={set("ignoreGroups")} />
        </div>
        <div className="mt-3">
          <BoolField
            label="Ignore status / reaction messages"
            value={flag("ignoreStatusMessages", true)}
            onChange={set("ignoreStatusMessages")}
          />
        </div>

        <p className="mt-3 text-[11px] leading-5 text-slate-400">
          Variables available: {"{{contact.name}}"}, {"{{contact.phone}}"}, {"{{message.text}}"}, {"{{customer.phone}}"}
        </p>
      </Section>
    </>
  );
}

function WhatsAppSendProps({ selectedNode, onUpdateNodeData, variableNodePrefixes }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const messageType = str("whatsappMessageType", "text");

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>

      <Section title="WhatsApp connection">
        <WhatsAppRequirementNotice testId="whatsapp-send-requirement">
          Messages are sent with your connected Meta Cloud API credentials (not buyer Twilio).
        </WhatsAppRequirementNotice>

        <div className="mt-4">
          <Label>Connection</Label>
          <WhatsAppConnectionPicker
            value={str("connectionId")}
            onChange={set("connectionId")}
            testId="whatsapp-send-connection"
          />
        </div>
      </Section>

      <Section title="Message" last>
        <Label>Message type</Label>
        <SelectBox
          value={messageType}
          onChange={set("whatsappMessageType")}
          options={[
            { value: "text", label: "Text" },
            { value: "image", label: "Image" },
            { value: "document", label: "Document / PDF" },
            { value: "audio", label: "Audio / Voice" },
            { value: "video", label: "Video" },
            { value: "template", label: "Template" }
          ]}
          testId="whatsapp-send-message-type"
        />

        <div className="mt-4">
          <Label>Recipient</Label>
          <TextInput
            mono
            value={str("recipient", "{{contact.phone}}")}
            onChange={set("recipient")}
            placeholder="{{contact.phone}}"
          />
        </div>

        {messageType === "text" ? (
          <div className="mt-4">
            <Label>Message body</Label>
            <TextArea
              height="h-24"
              value={str("message", "Hello {{contact.name}}")}
              onChange={set("message")}
              placeholder="Hello {{contact.name}}, thanks for reaching out."
            />
            <UnknownVariablesNote text={str("message")} nodePrefixes={variableNodePrefixes} testId="whatsapp-send-unknown-vars" />
          </div>
        ) : null}

        {messageType === "template" ? (
          <>
            <div className="mt-4">
              <Label>Template name</Label>
              <TextInput
                mono
                value={str("templateName")}
                onChange={set("templateName")}
                placeholder="hello_world"
                data-testid="whatsapp-send-template-name"
              />
            </div>
            <div className="mt-4">
              <Label>Language code</Label>
              <TextInput
                mono
                value={str("languageCode", "en_US")}
                onChange={set("languageCode")}
                data-testid="whatsapp-send-template-language"
              />
            </div>
          </>
        ) : null}

        {messageType === "image" || messageType === "document" || messageType === "audio" || messageType === "video" ? (
          <>
            <div className="mt-4">
              <Label>Media link (URL)</Label>
              <TextInput
                mono
                value={str("mediaLink")}
                onChange={set("mediaLink")}
                placeholder="https://..."
                data-testid="whatsapp-send-media-link"
              />
            </div>
            <div className="mt-4">
              <Label>Media ID (optional)</Label>
              <TextInput
                mono
                value={str("mediaId")}
                onChange={set("mediaId")}
                placeholder="Meta media id"
                data-testid="whatsapp-send-media-id"
              />
            </div>
            {messageType !== "audio" ? (
              <div className="mt-4">
                <Label>Caption (optional)</Label>
                <TextArea
                  height="h-20"
                  value={str("caption", str("message"))}
                  onChange={set("caption")}
                />
              </div>
            ) : null}
            {messageType === "document" ? (
              <div className="mt-4">
                <Label>Filename (optional)</Label>
                <TextInput
                  mono
                  value={str("filename")}
                  onChange={set("filename")}
                  placeholder="file.pdf"
                  data-testid="whatsapp-send-media-filename"
                />
              </div>
            ) : null}
          </>
        ) : null}

        <p className="mt-3 text-[11px] leading-5 text-slate-400">
          Tip: use {"{{contact.phone}}"} or {"{{customer.phone}}"} for the recipient.
        </p>
      </Section>
    </>
  );
}

function SendSmsProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="Buyer requirement">
        <RequirementNotice title="Buyer SMS setup" testId="sms-buyer-requirement">
          SMS is sent using the buyer’s configured phone provider and assigned phone number during deployment.
        </RequirementNotice>
      </Section>

      <Section title="Customer message">
        <BoolField label="Send to customer" value={flag("sendToCustomer", flag("sendToPatient", true))} onChange={set("sendToCustomer")} />

        <div className="mt-4">
          <Label>Customer message template</Label>
          <TextArea
            height="h-20"
            value={str("customerTemplate", str("patientTemplate"))}
            onChange={set("customerTemplate")}
            placeholder="Confirmed: {{appointment.service}} on {{appointment.date}} at {{appointment.time}}."
          />
        </div>
      </Section>

      <Section title="Team message" last>
        <BoolField label="Send to team" value={flag("sendToTeam", flag("sendToDentist", false))} onChange={set("sendToTeam")} />

        <div className="mt-4">
          <Label>Team message template</Label>
          <TextArea
            height="h-20"
            value={str("teamTemplate", str("dentistTemplate"))}
            onChange={set("teamTemplate")}
            placeholder="New booking: {{customer.name}}, {{appointment.date}} {{appointment.time}}, {{appointment.service}}."
          />
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Buyer team phone number is configured during install.
        </p>
      </Section>
    </>
  );
}

/**
 * Fetch the architect's saved key NAMES for the "My key" picker. Best-effort:
 * an empty list (locker route missing, offline, no keys) is fine — the
 * inspector falls back to a plain name field so the node stays usable.
 */
function useArchitectSecretNames(): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listArchitectSecrets()
      .then((res) => {
        if (cancelled) return;
        const secrets = res.success && res.data ? res.data.secrets : [];
        setNames(secrets.map((secret) => secret.name).filter(Boolean));
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}

/**
 * API Call node — the universal "connect to a service" action. Plain fields the
 * architect can always open and read: method, URL, optional headers/body, which
 * stored key to use and how it rides on the request, and where the reply lands.
 */
function ApiCallProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const secretNames = useArchitectSecretNames();

  const method = str("apiMethod", "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const keySource = str("apiKeySource", "none");
  const keyInjection = str("apiKeyInjection", "query") === "header" ? "header" : "query";
  const outputKey = str("apiOutputKey", API_CALL_DEFAULT_OUTPUT_KEY);

  const applyYouTubePreset = () => {
    for (const [key, value] of Object.entries(API_CALL_YOUTUBE_PRESET)) {
      onUpdateNodeData(key as keyof BuilderNodeData, value);
    }
  };

  return (
    <>
      <Section title="Quick start">
        <p className="mb-3 text-[11px] leading-5 text-slate-500">
          One step that fetches live data from any service on the internet — a channel’s
          stats, today’s weather, a stock price. Fill the fields below, or start from a
          working example.
        </p>
        <button
          type="button"
          onClick={applyYouTubePreset}
          data-testid="node-inspector-api-youtube-preset"
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
        >
          Use “YouTube channel stats” example
        </button>
      </Section>

      <Section title="The request">
        <Label>Method</Label>
        <SelectBox
          value={method}
          onChange={set("apiMethod")}
          options={[
            { value: "GET", label: "GET — read data" },
            { value: "POST", label: "POST — send data" }
          ]}
          testId="node-inspector-api-method"
        />

        <div className="mt-4">
          <Label>Web address (URL)</Label>
          <TextInput
            value={str("apiUrl")}
            onChange={set("apiUrl")}
            mono
            placeholder="https://api.example.com/data"
            testId="node-inspector-api-url"
          />
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            Insert values from earlier steps with double braces, e.g.{" "}
            <span className="font-mono text-slate-500">{"{{latestMessage}}"}</span> or{" "}
            <span className="font-mono text-slate-500">{"{{business.name}}"}</span>.
          </p>
        </div>

        <div className="mt-4">
          <Label>Headers (optional)</Label>
          <TextArea
            height="h-16"
            mono
            value={str("apiHeaders")}
            onChange={set("apiHeaders")}
            placeholder={"One per line, e.g.\nAccept: application/json"}
            testId="node-inspector-api-headers"
          />
        </div>

        {method === "POST" ? (
          <div className="mt-4">
            <Label>Body (JSON, optional)</Label>
            <TextArea
              height="h-20"
              mono
              value={str("apiBody")}
              onChange={set("apiBody")}
              placeholder={'{\n  "query": "{{latestMessage}}"\n}'}
              testId="node-inspector-api-body"
            />
          </div>
        ) : null}
      </Section>

      <Section title="Your key">
        <Label>Which key to use</Label>
        <SelectBox
          value={keySource}
          onChange={set("apiKeySource")}
          options={[
            { value: "none", label: "No key needed" },
            { value: "my_key", label: "One of my saved keys" },
            { value: "platform_youtube", label: "Platform YouTube key (no setup)" }
          ]}
          testId="node-inspector-api-key-source"
        />

        {keySource === "my_key" ? (
          <div className="mt-4">
            <Label>Key name</Label>
            {secretNames.length > 0 ? (
              <SelectBox
                value={str("apiKeyName")}
                onChange={set("apiKeyName")}
                options={[
                  { value: "", label: "Choose a saved key…" },
                  ...secretNames.map((name) => ({ value: name, label: name }))
                ]}
                testId="node-inspector-api-key-name"
              />
            ) : (
              <TextInput
                value={str("apiKeyName")}
                onChange={set("apiKeyName")}
                placeholder="The name you gave it in My Keys"
                testId="node-inspector-api-key-name"
              />
            )}
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              Add and manage keys in My Keys. Your key is used only for this request and
              is never shown to your customer.
            </p>
          </div>
        ) : null}

        {keySource === "platform_youtube" ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
            Uses Triven’s shared YouTube key so the example works right away — no key
            setup needed.
          </p>
        ) : null}

        {keySource !== "none" ? (
          <>
            <div className="mt-4">
              <Label>Where the key goes</Label>
              <SelectBox
                value={keyInjection}
                onChange={set("apiKeyInjection")}
                options={[
                  { value: "query", label: "In the web address (query parameter)" },
                  { value: "header", label: "In a header" }
                ]}
                testId="node-inspector-api-key-injection"
              />
            </div>

            <div className="mt-4">
              <Label>{keyInjection === "header" ? "Header name" : "Parameter name"}</Label>
              <TextInput
                value={str("apiKeyParam")}
                onChange={set("apiKeyParam")}
                mono
                placeholder={keyInjection === "header" ? "Authorization" : "key"}
                testId="node-inspector-api-key-param"
              />
            </div>

            {keyInjection === "header" ? (
              <div className="mt-4">
                <Label>Value prefix (optional)</Label>
                <TextInput
                  value={str("apiKeyPrefix")}
                  onChange={set("apiKeyPrefix")}
                  mono
                  placeholder="Bearer "
                  testId="node-inspector-api-key-prefix"
                />
              </div>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="The reply" last>
        <Label>Save the reply as</Label>
        <TextInput
          value={outputKey}
          onChange={set("apiOutputKey")}
          mono
          placeholder={API_CALL_DEFAULT_OUTPUT_KEY}
          testId="node-inspector-api-output-key"
        />
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          A later AI Brain step can read it with{" "}
          <span className="font-mono text-slate-500">{`{{${outputKey || API_CALL_DEFAULT_OUTPUT_KEY}}}`}</span>.
          Up to 5 service calls run per session.
        </p>
      </Section>
    </>
  );
}

function EndFlowProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="End flow">
        <Label>Closing message</Label>
        <TextInput value={str("closingMessage")} onChange={set("closingMessage")} placeholder="e.g. You're all set. Have a great day." />
      </Section>

      <Section title="After flow" last>
        <Label>After-flow action</Label>
        <SelectBox value={str("afterCallAction", "hangup")} onChange={set("afterCallAction")} options={["hangup", "voicemail", "transfer"]} />

        <div className="mt-4">
          <BoolField label="Call recording" value={flag("callRecording", true)} onChange={set("callRecording")} />
        </div>
      </Section>
    </>
  );
}

/* ------------- "Your Product" block panels (customer page sections) ------------- */

/** Stable id for a new gallery card / model choice row. */
function newBlockRowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_GALLERY_PRESETS = 8;
const MAX_MODEL_OPTIONS = 6;
const BLOCK_TEXT_MAX = 120;

/**
 * THE PROMPT BOX PANEL.
 *
 * It used to open under the heading "Product section", then repeat "General ›
 * Section name" above a second heading that also said "Prompt Box" — three
 * pieces of furniture before a single useful control, and the one control that
 * matters, the hint text, was the smallest box on the screen.
 *
 * Now: the panel is already named after the node, so the name field is one line
 * with its explanation on hover, and the hint text gets the room it deserves
 * with its limit shown while it is being typed.
 */
function PromptBoxBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const hint = str("placeholder", "Describe what you want…");

  return (
    <>
      <Section title="Name" >
        <TextInput
          value={selectedNode.data.title}
          onChange={set("title")}
          placeholder="Prompt Box"
          testId="block-prompt-name-input"
        />
      </Section>

      <Section title="Hint text" last>
        <textarea
          value={hint}
          onChange={(event) => set("placeholder")(event.target.value.slice(0, BLOCK_TEXT_MAX))}
          placeholder="Describe what you want…"
          rows={4}
          maxLength={BLOCK_TEXT_MAX}
          data-testid="block-prompt-placeholder-input"
          className="w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            Shown faintly inside the box until your customer starts typing.
          </p>
          <span
            className={`shrink-0 font-mono text-[11px] ${
              hint.length >= BLOCK_TEXT_MAX ? "font-semibold text-amber-600" : "text-slate-400"
            }`}
            data-testid="block-prompt-placeholder-count"
          >
            {hint.length}/{BLOCK_TEXT_MAX}
          </span>
        </div>
      </Section>
    </>
  );
}

function StylesGalleryBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { set } = fields(selectedNode, onUpdateNodeData);
  const presets: BlockPreset[] = Array.isArray(selectedNode.data.presets)
    ? (selectedNode.data.presets as BlockPreset[])
    : [];

  const updatePresets = (next: BlockPreset[]) => onUpdateNodeData("presets", next);

  return (
    <>
      <Section title="General">
        <Label>Section name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="Style cards" last>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs leading-5 text-slate-500">
            Each card is one tap for your customer — an emoji, a name, and your hidden style instructions.
          </p>
          <button
            type="button"
            onClick={() =>
              updatePresets([
                ...presets,
                { id: newBlockRowId("style"), title: "", emoji: "", promptFragment: "" }
              ])
            }
            disabled={presets.length >= MAX_GALLERY_PRESETS}
            data-testid="block-preset-add"
            className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
          >
            Add style
          </button>
        </div>

        {presets.length ? (
          <div className="mt-3 space-y-3">
            {presets.map((preset, index) => {
              const updatePreset = (patch: Partial<BlockPreset>) => {
                updatePresets(
                  presets.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
                );
              };

              return (
                <div
                  key={preset.id}
                  className="rounded-xl border border-rose-100 bg-white p-3"
                  data-testid="block-preset-row"
                >
                  <div className="flex gap-2">
                    <div className="w-16 shrink-0">
                      <Label>Emoji</Label>
                      <TextInput
                        value={preset.emoji}
                        onChange={(value) => updatePreset({ emoji: value.slice(0, 4) })}
                        placeholder="🎨"
                        maxLength={4}
                        testId="block-preset-emoji-input"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Label>Style name</Label>
                      <TextInput
                        value={preset.title}
                        onChange={(value) => updatePreset({ title: value })}
                        placeholder="e.g. Watercolor"
                        maxLength={BLOCK_TEXT_MAX}
                        testId="block-preset-title-input"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <Label>Hidden style instructions (your customer never sees this)</Label>
                    <TextArea
                      value={preset.promptFragment}
                      onChange={(value) => updatePreset({ promptFragment: value })}
                      height="h-16"
                      placeholder="e.g. soft watercolor wash, pastel palette, textured paper"
                      maxLength={BLOCK_TEXT_MAX}
                      testId="block-preset-instructions-textarea"
                    />
                  </div>

                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => updatePresets(presets.filter((_, itemIndex) => itemIndex !== index))}
                      data-testid="block-preset-remove"
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500" data-testid="block-preset-empty">
            No styles yet. Add up to {MAX_GALLERY_PRESETS}.
          </p>
        )}

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Cards need a name to appear on your customer&apos;s page.
        </p>
      </Section>
    </>
  );
}

function ModelPickerBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { set } = fields(selectedNode, onUpdateNodeData);
  const options: BlockModelOption[] = Array.isArray(selectedNode.data.options)
    ? (selectedNode.data.options as BlockModelOption[])
    : [];

  const updateOptions = (next: BlockModelOption[]) => onUpdateNodeData("options", next);

  return (
    <>
      <Section title="General">
        <Label>Section name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="Choices" last>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs leading-5 text-slate-500">
            Your customer picks one of these before they generate.
          </p>
          <button
            type="button"
            onClick={() => updateOptions([...options, { id: newBlockRowId("model"), label: "" }])}
            disabled={options.length >= MAX_MODEL_OPTIONS}
            data-testid="block-model-option-add"
            className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
          >
            Add choice
          </button>
        </div>

        {options.length ? (
          <div className="mt-3 space-y-2">
            {options.map((option, index) => (
              <div
                key={option.id}
                className="flex items-end gap-2 rounded-xl border border-rose-100 bg-white p-3"
                data-testid="block-model-option-row"
              >
                <div className="min-w-0 flex-1">
                  <Label>Shown as</Label>
                  <TextInput
                    value={option.label}
                    onChange={(value) =>
                      updateOptions(
                        options.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, label: value } : item
                        )
                      )
                    }
                    placeholder="e.g. Fast & playful"
                    maxLength={BLOCK_TEXT_MAX}
                    testId="block-model-option-label-input"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => updateOptions(options.filter((_, itemIndex) => itemIndex !== index))}
                  data-testid="block-model-option-remove"
                  className="rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500" data-testid="block-model-option-empty">
            No choices yet. Add up to {MAX_MODEL_OPTIONS}.
          </p>
        )}
      </Section>
    </>
  );
}

const BUTTON_LABEL_MAX = 40;

function ActionButtonBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const label = str("label", "Go");

  return (
    <>
      <Section title="General">
        <Label>Section name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="Button" last>
        <Label>Button text</Label>
        <TextInput
          value={label}
          onChange={set("label")}
          placeholder="Go"
          maxLength={BUTTON_LABEL_MAX}
          testId="block-action-button-label-input"
        />
        <p
          className="mt-1 text-right text-[11px] text-slate-400"
          data-testid="block-action-button-label-count"
        >
          {label.length}/{BUTTON_LABEL_MAX}
        </p>
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Your customer presses this. Connect it to the steps it should run.
        </p>
      </Section>
    </>
  );
}

/**
 * THE RESULT VIEWER PANEL — node two, the lamp.
 *
 * Same furniture problem the Prompt Box had: it opened under a heading naming
 * the node, then repeated "General › Section name", then a second heading also
 * naming the node, before one useful control. The panel is already named after
 * the node, so the name is one line and the setting gets the room.
 */
function ResultViewerBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="Name">
        <TextInput
          value={selectedNode.data.title}
          onChange={set("title")}
          placeholder="Result Viewer"
          testId="block-result-name-input"
        />
      </Section>

      <Section title="What it shows" last>
        <SelectBox
          value={str("kind", "auto")}
          onChange={set("kind")}
          options={[
            { value: "auto", label: "Auto — match what comes back" },
            { value: "text", label: "Words" },
            { value: "image", label: "Image" },
            { value: "video", label: "Video" }
          ]}
          testId="block-result-kind-select"
        />
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Auto is right for most products — it shows whatever the result is.
          Choose one only when you want to force it.
        </p>
      </Section>
    </>
  );
}

function ContinueButtonBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Section name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="Continue Button" last>
        <Label>Button words</Label>
        <TextInput
          value={str("label", "Continue")}
          onChange={set("label")}
          placeholder="Continue"
          maxLength={BLOCK_TEXT_MAX}
          testId="block-continue-label-input"
        />
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Appears after a result, so your customer can keep going with one tap.
        </p>
      </Section>
    </>
  );
}

function HistoryShelfBlockProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Section name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="History Shelf" last>
        <p className="text-xs leading-5 text-slate-500" data-testid="block-history-note">
          Nothing to set up. The shelf automatically collects everything your customer makes during
          their visit, so they can bring any of it back with a tap.
        </p>
      </Section>
    </>
  );
}

/* ----------------- Generic panels for the remaining nodes ----------------- */

function isManualTriggerNode(node: { data?: Record<string, unknown>; type?: unknown }): boolean {
  const dataType = String(node.data?.type ?? node.type ?? "").toLowerCase();
  return dataType === "trigger.manual" || dataType === "manual_trigger" || dataType === "manual";
}

function TelegramTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="Bot profile">
        <Label>Bot name template</Label>
        <TextInput
          value={str("telegramBotNameTemplate", "{{business.name}} Assistant")}
          onChange={set("telegramBotNameTemplate")}
          maxLength={64}
          testId="telegram-bot-name-template"
        />

        <div className="mt-4">
          <Label>Description</Label>
          <TextArea
            value={str("telegramBotDescription")}
            onChange={set("telegramBotDescription")}
            height="h-24"
            maxLength={512}
            testId="telegram-bot-description"
          />
        </div>

        <div className="mt-4">
          <Label>Short description</Label>
          <TextArea
            value={str("telegramBotShortDescription")}
            onChange={set("telegramBotShortDescription")}
            height="h-16"
            maxLength={120}
            testId="telegram-bot-short-description"
          />
        </div>

        <div className="mt-4">
          <Label>Bot username</Label>
          <ReadOnly value="Taken from the BotFather token connected in Test or Business Setup" testId="telegram-bot-username-policy" />
        </div>
      </Section>

      <Section title="Trigger event">
        <Label>Event type</Label>
        <SelectBox
          value={str("telegramEventType", "message")}
          onChange={set("telegramEventType")}
          testId="telegram-event-type"
          options={[
            { value: "message", label: "Any new private message" },
            { value: "command", label: "Bot command" },
            { value: "keyword", label: "Keyword or text match" },
            { value: "callback_query", label: "Callback query" },
            { value: "contact", label: "Contact received" },
            { value: "photo", label: "Photo received" },
            { value: "document", label: "Document received" },
            { value: "voice", label: "Voice received" },
            { value: "location", label: "Location received" }
          ]}
        />

        {str("telegramEventType", "message") === "command" ? (
          <div className="mt-4">
            <Label>Command</Label>
            <TextInput
              value={str("telegramCommand")}
              onChange={set("telegramCommand")}
              placeholder="book"
              testId="telegram-command"
            />
          </div>
        ) : null}

        {str("telegramEventType", "message") === "keyword" ? (
          <div className="mt-4 space-y-4">
            <div>
              <Label>Keywords</Label>
              <TextInput
                value={str("telegramKeywords")}
                onChange={set("telegramKeywords")}
                placeholder="book, appointment, services"
                testId="telegram-keywords"
              />
            </div>
            <div>
              <Label>Match type</Label>
              <SelectBox
                value={str("telegramMatchType", "contains")}
                onChange={set("telegramMatchType")}
                options={[
                  { value: "contains", label: "Contains" },
                  { value: "exact", label: "Exact" },
                  { value: "starts_with", label: "Starts with" },
                  { value: "regex", label: "Regular expression" }
                ]}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <BoolField
            label="Ignore bots"
            value={flag("telegramIgnoreBots", true)}
            onChange={set("telegramIgnoreBots")}
          />
        </div>
      </Section>

      <Section title="Conversation">
        <Label>Welcome message</Label>
        <TextArea
          value={str("telegramWelcomeMessage")}
          onChange={set("telegramWelcomeMessage")}
          height="h-24"
          maxLength={4096}
          testId="telegram-welcome-message"
        />

        <div className="mt-4">
          <Label>Fallback message</Label>
          <TextArea
            value={str("telegramFallbackMessage")}
            onChange={set("telegramFallbackMessage")}
            height="h-24"
            maxLength={4096}
            testId="telegram-fallback-message"
          />
        </div>

        <div className="mt-4">
          <Label>Chat access</Label>
          <SelectBox
            value={str("telegramChatAccess", "private")}
            onChange={set("telegramChatAccess")}
            testId="telegram-chat-access"
            options={[
              { value: "private", label: "Private chats only" },
              { value: "private_and_groups", label: "Private chats and approved groups" }
            ]}
          />
        </div>
      </Section>

      <Section title="Customer details">
        <div className="grid grid-cols-2 gap-3">
          <BoolField
            label="Request phone"
            value={flag("telegramRequestPhone", false)}
            onChange={set("telegramRequestPhone")}
          />
          <BoolField
            label="Request email"
            value={flag("telegramRequestEmail", false)}
            onChange={set("telegramRequestEmail")}
          />
          <BoolField
            label="Request notes"
            value={flag("telegramRequestNotes", false)}
            onChange={set("telegramRequestNotes")}
          />
        </div>
      </Section>

      <Section title="Business setup" last>
        <RequirementNotice title="Connected separately for every business" testId="telegram-business-setup-requirement">
          Set and sync the Architect test-bot commands in the Test tab. The buyer later connects a BotFather token and
          can override the command menu, customer details, welcome copy, and fallback copy. Each bot reads its own
          business service list from that buyer&apos;s Business Profile.
        </RequirementNotice>
      </Section>
    </>
  );
}

function TelegramActionProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);
  const type = String(selectedNode.data.type ?? "");
  const recipientSource = str("telegramRecipientSource", "trigger_chat");
  const isCallback = type === TELEGRAM_NODE_TYPES.answerCallback;
  const isDelete = type === TELEGRAM_NODE_TYPES.deleteMessage;
  const isEdit = type === TELEGRAM_NODE_TYPES.editMessage;
  const isButtons = type === TELEGRAM_NODE_TYPES.sendButtons;
  const isRequestContact = type === TELEGRAM_NODE_TYPES.requestContact;
  const mediaField =
    type === TELEGRAM_NODE_TYPES.sendPhoto
      ? "telegramPhotoSource"
      : type === TELEGRAM_NODE_TYPES.sendDocument
        ? "telegramDocumentSource"
        : type === TELEGRAM_NODE_TYPES.sendVoice
          ? "telegramVoiceSource"
          : null;
  const isLocation = type === TELEGRAM_NODE_TYPES.sendLocation;

  return (
    <>
      <Section title="Business bot">
        <RequirementNotice title="Buyer connects Telegram" testId="telegram-action-buyer-requirement">
          This action uses the dedicated bot connected to the installed agent. Credentials are never stored in the
          Architect workflow.
        </RequirementNotice>
      </Section>

      {!isCallback ? (
        <Section title="Recipient">
          <Label>Recipient source</Label>
          <SelectBox
            value={recipientSource}
            onChange={set("telegramRecipientSource")}
            testId="telegram-recipient-source"
            options={[
              { value: "trigger_chat", label: "Current customer (from trigger)" },
              { value: "business_owner", label: "Connected business owner" },
              { value: "stored_customer", label: "Stored customer (previous chat)" },
              { value: "manual", label: "Advanced: mapped chat ID" }
            ]}
          />
          {recipientSource === "business_owner" ? (
            <div className="mt-4">
              <RequirementNotice title="No chat ID required">
                The buyer securely connects their private owner chat in Business Setup. This recipient receives the
                detailed operational message configured below.
              </RequirementNotice>
            </div>
          ) : recipientSource === "stored_customer" ? (
            <div className="mt-4">
              <RequirementNotice title="Uses a captured customer chat">
                The customer must have messaged this business bot before. Their tenant-scoped Telegram chat is looked
                up automatically.
              </RequirementNotice>
            </div>
          ) : recipientSource === "trigger_chat" ? (
            <p className="mt-2 text-xs text-slate-500">Replies only to the customer who started this workflow run.</p>
          ) : null}
          {recipientSource === "manual" ? <div className="mt-4">
            <Label>Chat ID expression</Label>
            <TextInput
              mono
              value={str("telegramChatIdExpression")}
              onChange={set("telegramChatIdExpression")}
              testId="telegram-chat-id-expression"
            />
          </div> : null}
        </Section>
      ) : null}

      {isCallback ? (
        <Section title="Callback response">
          <Label>Callback query ID</Label>
          <TextInput
            mono
            value={str("telegramCallbackIdExpression", "{{trigger.telegram.callback.id}}")}
            onChange={set("telegramCallbackIdExpression")}
          />
          <div className="mt-4">
            <Label>Response text</Label>
            <TextInput
              value={str("telegramCallbackText")}
              onChange={set("telegramCallbackText")}
              maxLength={200}
            />
          </div>
          <div className="mt-4">
            <BoolField
              label="Show alert"
              value={flag("telegramShowAlert", false)}
              onChange={set("telegramShowAlert")}
            />
          </div>
          <div className="mt-4">
            <Label>Callback URL</Label>
            <TextInput value={str("telegramCallbackUrl")} onChange={set("telegramCallbackUrl")} />
          </div>
        </Section>
      ) : null}

      {!isDelete && !isLocation && !mediaField && !isCallback ? (
        <Section title={isRequestContact ? "Contact request" : isEdit ? "Message update" : "Message"}>
          <Label>Text</Label>
          <TextArea
            value={str("telegramMessageText")}
            onChange={set("telegramMessageText")}
            height="h-28"
            maxLength={4096}
            testId="telegram-message-text"
          />
          {isRequestContact ? (
            <div className="mt-4">
              <Label>Contact button text</Label>
              <TextInput
                value={str("telegramContactButtonText", "Share my phone number")}
                onChange={set("telegramContactButtonText")}
                maxLength={64}
              />
            </div>
          ) : null}
          {isButtons || isEdit ? (
            <div className="mt-4">
              <Label>Buttons JSON</Label>
              <TextArea
                mono
                value={str("telegramButtonsJson")}
                onChange={set("telegramButtonsJson")}
                height="h-28"
                testId="telegram-buttons-json"
              />
            </div>
          ) : null}
          {!isRequestContact ? (
            <div className="mt-4">
              <Label>Formatting</Label>
              <SelectBox
                value={str("telegramParseMode", "none")}
                onChange={set("telegramParseMode")}
                options={[
                  { value: "none", label: "Plain text" },
                  { value: "HTML", label: "HTML" },
                  { value: "MarkdownV2", label: "Markdown V2" }
                ]}
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      {mediaField ? (
        <Section title="Media">
          <Label>Telegram file ID or public HTTPS URL</Label>
          <TextInput
            mono
            value={str(mediaField)}
            onChange={set(mediaField)}
            testId="telegram-media-source"
          />
          <div className="mt-4">
            <Label>Caption</Label>
            <TextArea
              value={str("telegramCaption")}
              onChange={set("telegramCaption")}
              height="h-20"
              maxLength={1024}
            />
          </div>
        </Section>
      ) : null}

      {isLocation ? (
        <Section title="Location">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Latitude</Label>
              <TextInput mono value={str("telegramLatitude")} onChange={set("telegramLatitude")} />
            </div>
            <div>
              <Label>Longitude</Label>
              <TextInput mono value={str("telegramLongitude")} onChange={set("telegramLongitude")} />
            </div>
          </div>
          <div className="mt-4">
            <Label>Live period (seconds)</Label>
            <TextInput mono value={str("telegramLivePeriod")} onChange={set("telegramLivePeriod")} />
          </div>
        </Section>
      ) : null}

      {isEdit || isDelete ? (
        <Section title="Target message">
          <Label>Message ID expression</Label>
          <TextInput
            mono
            value={str("telegramMessageIdExpression", "{{telegram.action.messageId}}")}
            onChange={set("telegramMessageIdExpression")}
            testId="telegram-message-id-expression"
          />
        </Section>
      ) : null}

      {!isCallback && !isDelete ? (
        <Section title="Delivery" last>
          <div className="grid grid-cols-2 gap-3">
            <BoolField
              label="Silent notification"
              value={flag("telegramDisableNotification", false)}
              onChange={set("telegramDisableNotification")}
            />
            <BoolField
              label="Protect content"
              value={flag("telegramProtectContent", false)}
              onChange={set("telegramProtectContent")}
            />
          </div>
        </Section>
      ) : (
        <Section title="Output" last>
          <ReadOnly value="{{telegram.action.success}}" />
        </Section>
      )}
    </>
  );
}

function TriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const isManual = isManualTriggerNode(selectedNode);

  if (isManual) {
    return (
      <>
        <Section title="Input Config" last>
          <Label>Input</Label>
          <TextArea
            value={str("input")}
            onChange={set("input")}
            height="h-20"
            placeholder="Enter Input text input..."
          />
        </Section>
      </>
    );
  }

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />

        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>

      <Section title="Trigger" last>
        <Label>Trigger type</Label>
        <ReadOnly value={String(selectedNode.data.label ?? selectedNode.data.title ?? "Trigger")} />

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Live phone/calendar/account setup belongs to the buyer during install.
        </p>
      </Section>
    </>
  );
}

function CalendlyTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const calendlyEvent = str("calendlyEvent", "meeting_booked");
  const selectedMeta = CALENDLY_TRIGGER_EVENTS.find((event) => event.value === calendlyEvent);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-16" />
        </div>
      </Section>
      <Section title="Calendly event" last>
        <ConnectorRequirements node={selectedNode} />
        <div className="mt-4">
          <Label>Connection</Label>
          <CalendlyConnectBlock testId="calendly-trigger-connection" />
        </div>
        <div className="mt-4">
          <Label>Trigger when</Label>
          <SelectBox
            value={calendlyEvent}
            onChange={(value) => {
              set("calendlyEvent")(value);
              const meta = CALENDLY_TRIGGER_EVENTS.find((event) => event.value === value);
              if (meta) {
                onUpdateNodeData("subtitle", meta.description);
              }
            }}
            options={CALENDLY_TRIGGER_EVENTS.map((event) => ({
              value: event.value,
              label: event.label
            }))}
            testId="node-inspector-calendly-event"
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {selectedMeta?.description ?? "The selected webhook event starts this workflow."}
        </p>
      </Section>
    </>
  );
}

/**
 * MEMORY.
 *
 * The node that stops an agent starting blank every time. Without it a customer
 * says "actually, make it Tuesday" and the agent has no idea what "it" is.
 *
 * The panel that was here talked in our words rather than theirs: "Memory
 * configuration", "Custom context", "Output variable", "Memory Variable", and a
 * button to copy {{memory}} into a prompt — when memory reaches the next step on
 * its own and always has. Attachments have gone the same way as the AI Brain's:
 * to a File Upload node of their own, rather than living half-here.
 */
function MemoryNodeProps({ selectedNode, onUpdateNodeData, variableNodePrefixes }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  /* The choices come from the node's own declaration (question 5 of the SOP),
     not from a list typed again here. One fact, one home — the panel, the
     Composer and the admin Nodes page all read the same line. */
  const KEEP = nodeSettingChoices("ai.memory", "maxMemoryTokens");

  return (
    <>
      <Section title="Name">
        <TextInput value={selectedNode.data.title} onChange={set("title")} placeholder="Memory" testId="memory-name-input" />
      </Section>

      <Section title="Always remember">
        <p className="text-[12px] leading-5 text-slate-500">
          Things worth remembering every single time, whatever else happened. Leave it empty and it
          simply remembers the conversation.
        </p>
        <TextArea
          value={str("customMemoryNotes", str("notes"))}
          onChange={set("customMemoryNotes")}
          testId="memory-notes-textarea"
          height="h-32"
          placeholder="This customer is on the yearly plan. Their delivery address is on file."
        />
        <UnknownVariablesNote
          text={str("customMemoryNotes", str("notes"))}
          nodePrefixes={variableNodePrefixes}
          testId="memory-node-notes-variable-warning"
        />
      </Section>

      <Section title="How much to keep" last>
        <SelectBox
          value={str("maxMemoryTokens", "4000")}
          onChange={set("maxMemoryTokens")}
          options={KEEP}
          testId="memory-keep-select"
        />
        {/* Beyond the limit it summarises rather than cutting the end off. A
            conversation opens with the things that matter — a name, a date,
            what somebody wanted — and closes with pleasantries. */}
        <p className="mt-2 text-[12px] leading-5 text-slate-500">
          When there is more than this, it keeps the facts — names, dates, what somebody asked for —
          and drops the small talk. It never simply cuts off the end.
        </p>
      </Section>
    </>
  );
}

function AiProps(props: NodePropsPanel) {
  if (props.selectedNode.data.type === "ai.memory") {
    return <MemoryNodeProps {...props} />;
  }

  return <StandardAiProps {...props} />;
}

function StandardAiProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const lastOutput = str("lastTestOutput");

  const { availability: aiAvailability } = useLlmAvailability();
  const aiSelection = resolveLlmSelection(str("provider"), str("model"));
  const aiModelId = aiSelection.modelId ?? defaultLlmModelForProvider(aiSelection.providerId) ?? "";

  useEffect(() => {
    if (!aiAvailability) return;
    if (isProviderDisabled(aiAvailability, aiSelection.providerId)) {
      const firstUsable = LLM_PROVIDERS.find((p) => !isProviderDisabled(aiAvailability, p.id));
      if (firstUsable && firstUsable.id !== aiSelection.providerId) {
        onUpdateNodeData("provider", firstUsable.id);
        onUpdateNodeData("model", defaultLlmModelForProvider(firstUsable.id) ?? "");
      }
    }
  }, [aiAvailability, aiSelection.providerId, onUpdateNodeData]);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />

        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={str("subtitle")} onChange={set("subtitle")} height="h-[72px]" />
        </div>
      </Section>

      <Section title="AI configuration">
        <Label>LLM provider</Label>
        <SelectBox
          testId="node-inspector-provider-select"
          value={aiSelection.providerId}
          onChange={(providerId) => {
            onUpdateNodeData("provider", providerId);
            onUpdateNodeData("model", defaultLlmModelForProvider(providerId) ?? "");
          }}
          options={LLM_PROVIDERS.map((provider) => ({
            value: provider.id,
            label: provider.displayName,
            disabled: isProviderDisabled(aiAvailability, provider.id)
          }))}
        />

        <div className="mt-4">
          <Label>Model</Label>
          <SelectBox
            value={aiModelId}
            onChange={set("model")}
            options={getLlmModelsForProvider(aiSelection.providerId).map((model) => ({
              value: model.id,
              label: model.displayName
            }))}
          />
        </div>

        <div className="mt-4">
          <Label>Temperature</Label>
          <NumberInput testId="node-inspector-temperature-input" value={str("temperature", "0.7")} onChange={set("temperature")} min="0" max="1" step="0.1" />
        </div>

        <div className="mt-4">
          <Label>System prompt</Label>
          <TextArea value={str("prompt")} onChange={set("prompt")} height="h-[134px]" mono />
        </div>

        <div className="mt-4">
          <Label>Max tokens</Label>
          <NumberInput testId="node-inspector-delay-input" value={str("maxTokens", "2048")} onChange={set("maxTokens")} />
        </div>
      </Section>

      <Section title="Test output" last>
        {lastOutput ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm leading-relaxed text-slate-700" data-testid="node-inspector-last-test-output">
              {lastOutput}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400" data-testid="node-inspector-no-test-output">
            No test output yet. Run a dry test to preview this node.
          </p>
        )}
      </Section>
    </>
  );
}

/**
 * THE FORK IN THE ROAD.
 *
 * It sorts what arrives into one of the words an architect chose, and each word
 * is a road out of the node. Yes and No are only the two it starts with.
 *
 * Routing a support email three ways used to mean three conditions chained in a
 * ladder — an unreadable canvas and three decisions where one would do.
 *
 * Two kinds of rule, and the difference is what it costs:
 *   • a PLAIN rule — are we open, does this contain "cancel" — is arithmetic,
 *     answered instantly, and never reaches a model
 *   • a rule about MEANING — is this a complaint — is read by the entry door,
 *     which picks one of the words by name
 * Asking a model whether we are inside business hours would put a cost and a
 * delay on the commonest rule on the platform, so the two are kept apart.
 */
function ConditionProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const { conditionRoads: maxRoads } = useNodeLimits();

  const operator = str("conditionOperator", "business_hours");
  const byMeaning = operator === "meaning";

  const roads: string[] = Array.isArray(selectedNode.data.conditionChoices)
    ? (selectedNode.data.conditionChoices as unknown[]).map((value) => String(value))
    : ["Yes", "No"];

  const setRoads = (next: string[]) =>
    onUpdateNodeData("conditionChoices" as keyof BuilderNodeData, next as BuilderNodeData[keyof BuilderNodeData]);

  return (
    <>
      <Section title="Name">
        <TextInput value={selectedNode.data.title} onChange={set("title")} placeholder="Condition" />
      </Section>

      <Section title="How it decides">
        <SelectBox
          value={operator}
          onChange={set("conditionOperator")}
          testId="condition-operator"
          options={[
            { value: "business_hours", label: "Are we open right now?" },
            { value: "meaning", label: "Read what arrived and decide" },
            { value: "contains", label: "Something contains…" },
            { value: "not_contains", label: "Something does not contain…" },
            { value: "equals", label: "Something is exactly…" },
            { value: "not_equals", label: "Something is not…" },
            { value: "is_empty", label: "Something is empty" },
            { value: "is_not_empty", label: "Something has a value" },
            { value: "greater_than", label: "A number is more than…" },
            { value: "less_than", label: "A number is less than…" }
          ]}
        />

        {byMeaning ? (
          <div className="mt-4">
            <Label>What is it deciding?</Label>
            <textarea
              value={str("conditionQuestion")}
              onChange={(event) => set("conditionQuestion")(event.target.value)}
              placeholder="Is this customer complaining, asking a question, or is it spam?"
              rows={3}
              data-testid="condition-question"
              className="mt-1 w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
            <p className="mt-1.5 text-[11px] leading-5 text-slate-400">
              It reads whatever arrived and picks one of the roads below. Only this kind of rule
              uses AI — the others are instant and cost nothing.
            </p>
          </div>
        ) : operator !== "business_hours" ? (
          <>
            <div className="mt-4">
              <Label>Which value?</Label>
              <TextInput value={str("conditionField")} onChange={set("conditionField")} placeholder="text" />
              <p className="mt-1 text-[11px] text-slate-400">
                What arrived from the step before is <code>text</code>.
              </p>
            </div>

            {!["is_empty", "is_not_empty"].includes(operator) ? (
              <div className="mt-4">
                <Label>Compared to</Label>
                <TextInput value={str("conditionValue")} onChange={set("conditionValue")} placeholder="cancel" />
              </div>
            ) : null}
          </>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------- the roads */}
      <Section title="The roads out" last>
        <p className="text-[12px] leading-5 text-slate-500">
          Every word here is a road out of this step. Rename them, or add more.
        </p>

        <div className="mt-3 space-y-2" data-testid="condition-roads">
          {roads.map((road, index) => (
            <div key={index} className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${index === 0 ? "bg-green-500" : "bg-amber-500"}`}
              />
              <input
                value={road}
                onChange={(event) => {
                  const next = [...roads];
                  next[index] = event.target.value;
                  setRoads(next);
                }}
                placeholder={index === 0 ? "Yes" : "No"}
                data-testid={`condition-road-${index}`}
                className="h-10 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
              />
              {roads.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setRoads(roads.filter((_, i) => i !== index))}
                  data-testid={`condition-road-remove-${index}`}
                  className="shrink-0 px-1 text-[12px] font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {/* THE LINE, DRAWN WHERE THEY ARE WORKING.
            Nothing used to say no, so a step could grow twelve ways out: a
            flowchart nobody can read, twelve prompts the AI door has to choose
            between, and twelve chances to send a customer somewhere nobody
            meant. The number is the admin's (admin/node-limits.ts), not this
            file's — a judgement about what the platform allows should never
            need a release. */}
        <button
          type="button"
          onClick={() => setRoads([...roads, ""])}
          disabled={roads.length >= maxRoads}
          data-testid="condition-road-add"
          className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add a road
        </button>
        {roads.length >= maxRoads ? (
          <p className="mt-1.5 text-[11px] leading-5 text-slate-400" data-testid="condition-road-limit">
            {maxRoads} roads is the most one step may have. More than this and it is really two
            steps — and the more roads there are, the easier it is to send somebody down the wrong one.
          </p>
        ) : null}

        {/* Always there, never removable. A customer will eventually say
            something nobody listed, and a run that falls off the end in silence
            is the failure this platform keeps deleting. */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-slate-50/60 px-3 py-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
          <span className="text-[13px] font-medium text-slate-600">Anything else</span>
          <span className="text-[11px] text-slate-400">— always here, so nothing is ever lost</span>
        </div>
      </Section>
    </>
  );
}

function ConnectorProps({ selectedNode, onUpdateNodeData, calendar, ownership }: CalendarPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const connector = str("connector", "SMS");
  const isGmail = connector === "Gmail";
  const isVapi = connector === "Vapi";
  const isCalendar = connector === "Google Calendar";
  const isCalendly =
    connector === "Calendly" ||
    String(selectedNode.data.type ?? "").includes("calendly");
  const isCore = connector === "CoreAI" || connector === "Triven";
  const isWhatsApp = connector === "WhatsApp";
  const coreAction = str("connectorAction", "save_lead");
  const whatsappMessageType = str("whatsappMessageType", "text");
  const calendlyAction = str("connectorAction", "get_my_profile");
  const needsEventTypeUri =
    isCalendly &&
    (calendlyAction === "find_available_times" ||
      calendlyAction === "create_scheduling_link" ||
      calendlyAction === "book_meeting_for_invitee" ||
      calendlyAction === "find_invitee_by_email");
  const needsEventUuid =
    isCalendly &&
    (calendlyAction === "get_event" ||
      calendlyAction === "find_event" ||
      calendlyAction === "list_invitees" ||
      calendlyAction === "get_invitee" ||
      calendlyAction === "cancel_event" ||
      calendlyAction === "cancel_scheduled_event" ||
      calendlyAction === "mark_invitee_no_show");
  const needsInviteeUuid =
    isCalendly &&
    (calendlyAction === "get_invitee" || calendlyAction === "mark_invitee_no_show");
  const needsContactUuid =
    isCalendly &&
    (calendlyAction === "update_contact" ||
      calendlyAction === "delete_contact" ||
      calendlyAction === "find_contact");
  const needsMeetingRecapUuid =
    isCalendly &&
    (calendlyAction === "find_meeting_recap" ||
      calendlyAction === "find_meeting_recap_transcript");
  const eventTypePicker = useCalendlyEventTypeOptions(needsEventTypeUri);
  const eventPicker = useCalendlyEventOptions(needsEventUuid, {
    startedOnly: calendlyAction === "mark_invitee_no_show"
  });
  const inviteePicker = useCalendlyInviteeOptions(needsInviteeUuid, str("calendlyEventUuid"));
  const contactPicker = useCalendlyContactOptions(needsContactUuid);
  const meetingRecapPicker = useCalendlyMeetingRecapOptions(needsMeetingRecapUuid);
  const availableTimePicker = useCalendlyAvailableTimeOptions(
    isCalendly && calendlyAction === "book_meeting_for_invitee",
    str("calendlyEventTypeUri")
  );

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />

        <div className="mt-4">
          <Label>Summary</Label>
          <TextInput value={str("subtitle")} onChange={set("subtitle")} />
        </div>
      </Section>

      <Section
        title={
          isGmail
            ? "Gmail"
            : isVapi
              ? "Vapi voice"
              : isCalendar
                ? "Google Calendar"
                : isCalendly
                  ? "Calendly"
                  : isCore
                    ? "Triven action"
                    : isWhatsApp
                      ? "WhatsApp"
                      : "SMS"
        }
        last
      >
        {isCalendly ? (
          <>
            <ConnectorRequirements node={selectedNode} />
            <div className="mt-4">
              <Label>Connection</Label>
              <CalendlyConnectBlock testId="calendly-action-connection" />
            </div>
            <div className="mt-4">
              <Label>Action</Label>
              <SelectBox
                value={calendlyAction}
                onChange={set("connectorAction")}
                options={CALENDLY_ACTION_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.requiresPaidPlan ? `${option.label} (Paid plan)` : option.label
                }))}
                testId="node-inspector-calendly-action"
              />
              {calendlyActionPaidPlanNote(calendlyAction) ? (
                <p
                  className="mt-2 text-[11px] text-amber-700"
                  data-testid="node-inspector-calendly-paid-plan-note"
                >
                  {calendlyActionPaidPlanNote(calendlyAction)}
                </p>
              ) : null}
            </div>
            {(calendlyAction === "find_available_times" ||
              calendlyAction === "create_scheduling_link" ||
              calendlyAction === "book_meeting_for_invitee" ||
              calendlyAction === "find_invitee_by_email") && (
              <div className="mt-4">
                <Label>
                  {calendlyAction === "find_invitee_by_email"
                    ? "Event type (optional)"
                    : "Event type"}
                </Label>
                <SelectBox
                  value={str("calendlyEventTypeUri")}
                  onChange={(value) => {
                    set("calendlyEventTypeUri")(value);
                    if (calendlyAction === "book_meeting_for_invitee") {
                      set("calendlyStartTime")("");
                    }
                  }}
                  options={calendlySelectBoxOptions(
                    str("calendlyEventTypeUri"),
                    eventTypePicker.options,
                    eventTypePicker.loading
                      ? "Loading event types…"
                      : eventTypePicker.options.length === 0
                        ? "No event types found"
                        : calendlyAction === "find_invitee_by_email"
                          ? "Any event type"
                          : "Select an event type"
                  )}
                  testId="node-inspector-calendly-event-type"
                />
                {eventTypePicker.error ? (
                  <p className="mt-1.5 text-[11px] text-rose-600">{eventTypePicker.error}</p>
                ) : null}
              </div>
            )}
            {calendlyAction === "find_available_times" && (
              <>
                <div className="mt-4">
                  <Label>Timezone</Label>
                  <CalendlyTimezoneSelect
                    variant="inspector"
                    value={str("calendlyTimezone", "America/New_York")}
                    onChange={set("calendlyTimezone")}
                    testId="node-inspector-calendly-timezone"
                  />
                </div>
                <div className="mt-4">
                  <Label>Search window</Label>
                  <CalendlyTeamsRangePicker
                    variant="inspector"
                    valueMode="iso"
                    startValue={str("calendlyStartTime")}
                    endValue={str("calendlyEndTime")}
                    timeZone={str("calendlyTimezone", "America/New_York")}
                    startLabel="Window start"
                    durationLabel="Window length"
                    testIdPrefix="node-inspector-calendly-window"
                    onChange={({ start, end }) => {
                      set("calendlyStartTime")(start);
                      set("calendlyEndTime")(end);
                    }}
                  />
                </div>
              </>
            )}
            {calendlyAction === "book_meeting_for_invitee" && (
              <>
                <div className="mt-4">
                  <Label>Timezone</Label>
                  <CalendlyTimezoneSelect
                    variant="inspector"
                    value={str("calendlyTimezone", "America/New_York")}
                    onChange={set("calendlyTimezone")}
                    testId="node-inspector-calendly-book-timezone"
                  />
                </div>
                <div className="mt-4">
                  <Label>Start time</Label>
                  <CalendlyAvailableSlotButtons
                    options={
                      str("calendlyStartTime").trim() &&
                      !availableTimePicker.options.some((option) => option.value === str("calendlyStartTime"))
                        ? [
                            { value: str("calendlyStartTime"), label: str("calendlyStartTime") },
                            ...availableTimePicker.options
                          ]
                        : availableTimePicker.options
                    }
                    value={str("calendlyStartTime")}
                    onChange={set("calendlyStartTime")}
                    timeZone={str("calendlyTimezone", "America/New_York")}
                    loading={availableTimePicker.loading}
                    disabled={!str("calendlyEventTypeUri").trim()}
                    emptyHint={
                      !str("calendlyEventTypeUri").trim()
                        ? "Select an event type first"
                        : "No available times in the next 7 days"
                    }
                    error={availableTimePicker.error}
                    testIdPrefix="node-inspector-calendly-start-time"
                  />
                </div>
                <div className="mt-4">
                  <Label>Invitee name</Label>
                  <TextInput
                    value={str("calendlyInviteeName")}
                    onChange={set("calendlyInviteeName")}
                    placeholder="Jordan Lee"
                  />
                </div>
                <div className="mt-4">
                  <Label>Invitee email</Label>
                  <TextInput
                    value={str("calendlyInviteeEmail")}
                    onChange={set("calendlyInviteeEmail")}
                    placeholder="jordan@example.com"
                  />
                </div>
              </>
            )}
            {(calendlyAction === "get_event" ||
              calendlyAction === "find_event" ||
              calendlyAction === "list_invitees" ||
              calendlyAction === "get_invitee" ||
              calendlyAction === "cancel_event" ||
              calendlyAction === "cancel_scheduled_event" ||
              calendlyAction === "mark_invitee_no_show") && (
              <div className="mt-4">
                <Label>Event</Label>
                <SelectBox
                  value={str("calendlyEventUuid")}
                  onChange={(value) => {
                    set("calendlyEventUuid")(value);
                    set("calendlyInviteeUuid")("");
                  }}
                  options={calendlySelectBoxOptions(
                    str("calendlyEventUuid"),
                    eventPicker.options,
                    eventPicker.loading
                      ? "Loading events…"
                      : eventPicker.options.length === 0
                        ? calendlyAction === "mark_invitee_no_show"
                          ? "No started meetings found"
                          : "No recent events found"
                        : "Select an event"
                  )}
                  testId="node-inspector-calendly-scheduled-event"
                />
                {eventPicker.error ? (
                  <p className="mt-1.5 text-[11px] text-rose-600">{eventPicker.error}</p>
                ) : null}
                {calendlyAction === "mark_invitee_no_show" ? (
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
                    Only meetings that have already started are listed — Calendly blocks no-show before the start time.
                  </p>
                ) : null}
              </div>
            )}
            {(calendlyAction === "cancel_event" || calendlyAction === "cancel_scheduled_event") && (
              <div className="mt-4">
                <Label>Cancellation reason (optional)</Label>
                <TextInput
                  value={str("calendlyCancelReason")}
                  onChange={set("calendlyCancelReason")}
                  placeholder="Customer requested cancellation"
                />
              </div>
            )}
            {(calendlyAction === "get_invitee" || calendlyAction === "mark_invitee_no_show") && (
              <div className="mt-4">
                <Label>Invitee</Label>
                <SelectBox
                  value={str("calendlyInviteeUuid")}
                  onChange={set("calendlyInviteeUuid")}
                  options={calendlySelectBoxOptions(
                    str("calendlyInviteeUuid"),
                    inviteePicker.options,
                    !str("calendlyEventUuid").trim()
                      ? "Select an event first"
                      : inviteePicker.loading
                        ? "Loading invitees…"
                        : inviteePicker.options.length === 0
                          ? "No invitees found"
                          : "Select an invitee"
                  )}
                  testId="node-inspector-calendly-invitee"
                />
                {inviteePicker.error ? (
                  <p className="mt-1.5 text-[11px] text-rose-600">{inviteePicker.error}</p>
                ) : null}
              </div>
            )}
            {calendlyAction === "find_invitee_by_email" && (
              <div className="mt-4">
                <Label>Invitee email</Label>
                <TextInput
                  value={str("calendlyInviteeEmail")}
                  onChange={set("calendlyInviteeEmail")}
                  placeholder="jordan@example.com"
                />
              </div>
            )}
            {(calendlyAction === "create_contact" || calendlyAction === "update_contact") && (
              <>
                {calendlyAction === "update_contact" ? (
                  <div className="mt-4">
                    <Label>Contact</Label>
                    <SelectBox
                      value={str("calendlyContactUuid")}
                      onChange={set("calendlyContactUuid")}
                      options={calendlySelectBoxOptions(
                        str("calendlyContactUuid"),
                        contactPicker.options,
                        contactPicker.loading
                          ? "Loading contacts…"
                          : contactPicker.options.length === 0
                            ? "No contacts found"
                            : "Select a contact"
                      )}
                      testId="node-inspector-calendly-contact"
                    />
                    {contactPicker.error ? (
                      <p className="mt-1.5 text-[11px] text-rose-600">{contactPicker.error}</p>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-4">
                  <Label>Email{calendlyAction === "create_contact" ? "" : " (optional)"}</Label>
                  <TextInput
                    value={str("calendlyContactEmail")}
                    onChange={set("calendlyContactEmail")}
                    placeholder="jordan@example.com"
                  />
                </div>
                <div className="mt-4">
                  <Label>First name (optional)</Label>
                  <TextInput
                    value={str("calendlyContactFirstName")}
                    onChange={set("calendlyContactFirstName")}
                  />
                </div>
                <div className="mt-4">
                  <Label>Last name (optional)</Label>
                  <TextInput
                    value={str("calendlyContactLastName")}
                    onChange={set("calendlyContactLastName")}
                  />
                </div>
                <div className="mt-4">
                  <Label>Full name (optional)</Label>
                  <TextInput value={str("calendlyContactName")} onChange={set("calendlyContactName")} />
                </div>
              </>
            )}
            {(calendlyAction === "delete_contact" || calendlyAction === "find_contact") && (
              <div className="mt-4">
                <Label>Contact</Label>
                <SelectBox
                  value={str("calendlyContactUuid")}
                  onChange={set("calendlyContactUuid")}
                  options={calendlySelectBoxOptions(
                    str("calendlyContactUuid"),
                    contactPicker.options,
                    contactPicker.loading
                      ? "Loading contacts…"
                      : contactPicker.options.length === 0
                        ? "No contacts found"
                        : "Select a contact"
                  )}
                  testId="node-inspector-calendly-contact"
                />
                {contactPicker.error ? (
                  <p className="mt-1.5 text-[11px] text-rose-600">{contactPicker.error}</p>
                ) : null}
              </div>
            )}
            {calendlyAction === "create_one_off_meeting_link" && (
              <>
                <div className="mt-4">
                  <Label>Meeting name</Label>
                  <TextInput
                    value={str("calendlyMeetingName", "One-off meeting")}
                    onChange={set("calendlyMeetingName")}
                  />
                </div>
                <div className="mt-4">
                  <Label>Meeting length</Label>
                  <SelectBox
                    value={str("calendlyDurationMinutes", "30")}
                    onChange={set("calendlyDurationMinutes")}
                    options={[
                      { value: "15", label: "15 minutes" },
                      { value: "30", label: "30 minutes" },
                      { value: "45", label: "45 minutes" },
                      { value: "60", label: "60 minutes" },
                      { value: "90", label: "90 minutes" },
                      { value: "120", label: "120 minutes" }
                    ]}
                    testId="node-inspector-calendly-duration"
                  />
                </div>
                <div className="mt-4">
                  <Label>Availability window</Label>
                  <CalendlyTeamsRangePicker
                    variant="inspector"
                    valueMode="local"
                    startValue={str("calendlyOneOffStartDate")}
                    endValue={str("calendlyOneOffEndDate")}
                    timeZone={str("calendlyTimezone", "America/New_York")}
                    startLabel="Window start"
                    durationLabel="Window length"
                    testIdPrefix="node-inspector-calendly-one-off-window"
                    onChange={({ start, end }) => {
                      set("calendlyOneOffStartDate")(start);
                      set("calendlyOneOffEndDate")(end);
                    }}
                  />
                </div>
                <div className="mt-4">
                  <Label>Location</Label>
                  <SelectBox
                    value={str("calendlyLocationKind", "ask_invitee")}
                    onChange={set("calendlyLocationKind")}
                    options={[
                      { value: "ask_invitee", label: "Ask invitee" },
                      { value: "google_conference", label: "Google Meet" },
                      { value: "zoom_conference", label: "Zoom" },
                      { value: "microsoft_teams_conference", label: "Microsoft Teams" },
                      { value: "outbound_call", label: "Phone call (outbound)" },
                      { value: "inbound_call", label: "Phone call (inbound)" },
                      { value: "physical", label: "In person" },
                      { value: "custom", label: "Custom" }
                    ]}
                    testId="node-inspector-calendly-location-kind"
                  />
                </div>
                {(str("calendlyLocationKind", "ask_invitee") === "physical" ||
                  str("calendlyLocationKind", "ask_invitee") === "custom" ||
                  str("calendlyLocationKind", "ask_invitee") === "outbound_call") && (
                  <div className="mt-4">
                    <Label>Location details</Label>
                    <TextInput
                      value={str("calendlyLocation")}
                      onChange={set("calendlyLocation")}
                      placeholder="Address, phone, or custom link"
                    />
                  </div>
                )}
                <div className="mt-4">
                  <Label>Timezone</Label>
                  <CalendlyTimezoneSelect
                    variant="inspector"
                    value={str("calendlyTimezone", "America/New_York")}
                    onChange={set("calendlyTimezone")}
                    testId="node-inspector-calendly-one-off-timezone"
                  />
                </div>
              </>
            )}
            {(calendlyAction === "find_meeting_recap" ||
              calendlyAction === "find_meeting_recap_transcript") && (
              <div className="mt-4">
                <Label>Meeting recap</Label>
                <SelectBox
                  value={str("calendlyMeetingRecapUuid")}
                  onChange={set("calendlyMeetingRecapUuid")}
                  options={calendlySelectBoxOptions(
                    str("calendlyMeetingRecapUuid"),
                    meetingRecapPicker.options,
                    meetingRecapPicker.loading
                      ? "Loading meeting recaps…"
                      : meetingRecapPicker.options.length === 0
                        ? "No meeting recaps found"
                        : "Select a meeting recap"
                  )}
                  testId="node-inspector-calendly-meeting-recap"
                />
                {meetingRecapPicker.error ? (
                  <p className="mt-1.5 text-[11px] text-rose-600">{meetingRecapPicker.error}</p>
                ) : null}
              </div>
            )}
            {calendlyAction === "find_user" && (
              <>
                <div className="mt-4">
                  <Label>Name or email</Label>
                  <TextInput
                    value={str("calendlyUserSearch")}
                    onChange={set("calendlyUserSearch")}
                    placeholder="jordan@example.com"
                  />
                </div>
                <div className="mt-4">
                  <Label>User UUID (optional)</Label>
                  <TextInput mono value={str("calendlyUserUuid")} onChange={set("calendlyUserUuid")} />
                </div>
              </>
            )}
            {calendlyAction === "list_events" && (
              <>
                <div className="mt-4">
                  <Label>Min start time (ISO)</Label>
                  <TextInput mono value={str("calendlyStartTime")} onChange={set("calendlyStartTime")} />
                </div>
                <div className="mt-4">
                  <Label>Max start time (ISO)</Label>
                  <TextInput mono value={str("calendlyEndTime")} onChange={set("calendlyEndTime")} />
                </div>
                <div className="mt-4">
                  <Label>Status</Label>
                  <SelectBox
                    value={str("calendlyStatus", "active")}
                    onChange={set("calendlyStatus")}
                    options={["active", "canceled"]}
                  />
                </div>
              </>
            )}
          </>
        ) : isGmail ? (
          <>
            <ConnectorRequirements node={selectedNode} />

            <div className="mt-4">
              <Label>Action</Label>
              <SelectBox
                value={str("connectorAction", "read_emails")}
                onChange={set("connectorAction")}
                options={["read_emails", "draft_reply", "create_draft", "send_email"]}
              />
            </div>

            {str("connectorAction", "read_emails") === "read_emails" ? (
              <div className="mt-4">
                <Label>Search query template</Label>
                <TextInput mono value={str("gmailQuery", "newer_than:7d")} onChange={set("gmailQuery")} />
              </div>
            ) : (
              <>
                <div className="mt-4">
                  <Label>To</Label>
                  <TextInput mono value={str("gmailTo", "{{gmail.senderEmail}}")} onChange={set("gmailTo")} />
                </div>

                <div className="mt-4">
                  <Label>Subject</Label>
                  <TextInput mono value={str("gmailSubject", "Re: {{gmail.subject}}")} onChange={set("gmailSubject")} />
                </div>

                <div className="mt-4">
                  <Label>Body</Label>
                  <TextArea mono height="h-24" value={str("gmailBody", "{{ai.output}}")} onChange={set("gmailBody")} />
                </div>
              </>
            )}
          </>
        ) : isVapi ? (
          <>
            <ConnectorRequirements node={selectedNode} />

            <div className="mt-4">
              <Label>Action</Label>
              <SelectBox value={str("connectorAction", "start_voice_call")} onChange={set("connectorAction")} options={["start_voice_call"]} />
            </div>

            <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
              Vapi assistant ID and phone number ID are created/mapped when the buyer deploys the live agent.
            </p>
          </>
        ) : isCalendar ? (
          <>
            <CalendarConnector calendar={calendar} ownership={ownership} node={selectedNode} />

            <div className="mt-4">
              <Label>Action</Label>
              <SelectBox
                value={str("connectorAction", "book_appointment")}
                onChange={set("connectorAction")}
                options={["check_availability", "book_appointment"]}
              />
            </div>

            <div className="mt-4">
              <Label>Service template</Label>
              <TextInput value={str("appointmentService")} onChange={set("appointmentService")} placeholder="{{appointment.service}}" />
            </div>

            <div className="mt-4">
              <Label>Event summary</Label>
              <TextInput mono value={str("calendarSummary")} onChange={set("calendarSummary")} />
            </div>

            <div className="mt-4">
              <Label>Event description</Label>
              <TextArea mono height="h-20" value={str("calendarDescription")} onChange={set("calendarDescription")} />
            </div>
          </>
        ) : isCore ? (
          <div data-testid="node-inspector-coreai">
            <Label>Action</Label>
            <SelectBox
              value={coreAction}
              onChange={set("connectorAction")}
              options={["save_lead", "save_conversation_message", "human_handoff", "trigger_next_workflow"]}
            />

            {coreAction === "trigger_next_workflow" ? (
              <div className="mt-4">
                <Label>Next workflow ID</Label>
                <TextInput mono value={str("nextWorkflowId")} onChange={set("nextWorkflowId")} placeholder="Not configured" />
              </div>
            ) : null}

            {coreAction === "save_conversation_message" ? (
              <>
                <div className="mt-4">
                  <Label>Direction</Label>
                  <SelectBox value={str("conversationDirection", "OUTBOUND")} onChange={set("conversationDirection")} options={["OUTBOUND", "INBOUND", "SYSTEM"]} />
                </div>

                <div className="mt-4">
                  <Label>Message body</Label>
                  <TextArea mono height="h-20" value={str("conversationBody", "{{ai.output}}")} onChange={set("conversationBody")} />
                </div>
              </>
            ) : null}

            {coreAction === "human_handoff" ? (
              <div className="mt-4">
                <Label>Handoff reason</Label>
                <TextArea height="h-16" value={str("handoffReason", "{{business.escalationRules}}")} onChange={set("handoffReason")} />
              </div>
            ) : null}

            {coreAction === "save_lead" ? (
              <p
                className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700"
                data-testid="architect-ui-workflow-builder-node-inspector-saves-the-contact-as-a-lead-for-text"
              >
                Saves the contact as a lead for this business. No extra configuration needed.
              </p>
            ) : null}
          </div>
        ) : isWhatsApp ? (
          <>
            <ConnectorRequirements node={selectedNode} />
            <div className="mt-4">
              <Label>Connection</Label>
              <WhatsAppConnectionPicker
                value={str("connectionId")}
                onChange={set("connectionId")}
                testId="whatsapp-connector-connection"
              />
            </div>
            {coreAction === "send_template" ? (
              <>
                <div className="mt-4">
                  <Label>Recipient</Label>
                  <TextInput mono value={str("recipient", "{{contact.phone}}")} onChange={set("recipient")} />
                </div>
                <div className="mt-4">
                  <Label>Template name</Label>
                  <TextInput mono value={str("templateName")} onChange={set("templateName")} />
                </div>
                <div className="mt-4">
                  <Label>Language code</Label>
                  <TextInput mono value={str("languageCode", "en_US")} onChange={set("languageCode")} />
                </div>
              </>
            ) : coreAction === "send_media" ? (
              <>
                <div className="mt-4">
                  <Label>Recipient</Label>
                  <TextInput mono value={str("recipient", "{{contact.phone}}")} onChange={set("recipient")} />
                </div>
                <div className="mt-4">
                  <Label>Media type</Label>
                  <SelectBox
                    value={str("mediaType", "image")}
                    onChange={set("mediaType")}
                    options={["image", "document", "audio", "video"]}
                  />
                </div>
                <div className="mt-4">
                  <Label>Media link (URL)</Label>
                  <TextInput mono value={str("mediaLink")} onChange={set("mediaLink")} placeholder="https://..." />
                </div>
                <div className="mt-4">
                  <Label>Media ID (optional)</Label>
                  <TextInput mono value={str("mediaId")} onChange={set("mediaId")} placeholder="Meta media id" />
                </div>
                <div className="mt-4">
                  <Label>Caption (optional)</Label>
                  <TextArea height="h-[88px]" value={str("caption", str("message"))} onChange={set("caption")} />
                </div>
                <div className="mt-4">
                  <Label>Filename (optional, documents)</Label>
                  <TextInput mono value={str("filename")} onChange={set("filename")} placeholder="file.pdf" />
                </div>
              </>
            ) : (
              <>
                <div className="mt-4">
                  <Label>Recipient</Label>
                  <TextInput mono value={str("recipient", "{{contact.phone}}")} onChange={set("recipient")} />
                </div>
                <div className="mt-4">
                  <Label>WhatsApp content type</Label>
                  <SelectBox
                    value={whatsappMessageType}
                    onChange={set("whatsappMessageType")}
                    options={["text", "image", "document", "audio", "video", "template"]}
                    data-testid="whatsapp-content-type"
                  />
                </div>
                {whatsappMessageType === "text" ? (
                  <div className="mt-4">
                    <Label>Message</Label>
                    <TextArea height="h-[88px]" value={str("message")} onChange={set("message")} data-testid="whatsapp-message-text" />
                  </div>
                ) : whatsappMessageType === "template" ? (
                  <>
                    <div className="mt-4">
                      <Label>Template name</Label>
                      <TextInput mono value={str("templateName")} onChange={set("templateName")} data-testid="whatsapp-template-name" />
                    </div>
                    <div className="mt-4">
                      <Label>Language code</Label>
                      <TextInput mono value={str("languageCode", "en_US")} onChange={set("languageCode")} data-testid="whatsapp-template-language-code" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-4">
                      <Label>Media link (URL)</Label>
                      <TextInput mono value={str("mediaLink")} onChange={set("mediaLink")} placeholder="https://..." data-testid="whatsapp-media-link" />
                    </div>
                    <div className="mt-4">
                      <Label>Media ID (optional)</Label>
                      <TextInput mono value={str("mediaId")} onChange={set("mediaId")} placeholder="Meta media id" data-testid="whatsapp-media-id" />
                    </div>
                    <div className="mt-4">
                      <Label>Caption (optional)</Label>
                      <TextArea height="h-[88px]" value={str("caption", str("message"))} onChange={set("caption")} data-testid="whatsapp-media-caption" />
                    </div>
                    <div className="mt-4">
                      <Label>Filename (optional, documents)</Label>
                      <TextInput mono value={str("filename")} onChange={set("filename")} placeholder="file.pdf" data-testid="whatsapp-media-filename" />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <ConnectorRequirements node={selectedNode} />

            <div className="mt-4">
              <Label>Send to</Label>
              <TextInput mono value={str("smsTo")} onChange={set("smsTo")} />
            </div>

            <div className="mt-4">
              <Label>Message body</Label>
              <TextArea value={str("smsBody")} onChange={set("smsBody")} height="h-[88px]" />
            </div>
          </>
        )}
      </Section>
    </>
  );
}

function GenericProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />

        <div className="mt-4">
          <Label>Summary</Label>
          <TextInput value={str("subtitle")} onChange={set("subtitle")} />
        </div>
      </Section>

      <Section title="Settings" last>
        <p
          className="text-sm leading-relaxed text-slate-500"
          data-testid="architect-ui-workflow-builder-node-inspector-configure-how-this-selected-node-kind-to-text"
        >
          Configure how this {String(selectedNode.data.kind ?? "").toLowerCase() || "step"} behaves. Drag from its ports to connect it to the rest of your workflow.
        </p>
      </Section>
    </>
  );
}

import { getModelStatusesFromBackend } from "@/components/architect/features/api";

type BackendModelStatus = { available: boolean; disabledReason?: string; hasKey: boolean; isQuotaExceeded: boolean };

export function getImageGenerationModelOptions(backendStatuses?: Record<string, BackendModelStatus>): SelectBoxOption[] {
  const defaultModels = [
    { value: "gemini-3.1-flash-image", label: "Nano Banana 2", provider: "gemini" },
    { value: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", provider: "gemini" },
    { value: "gemini-3-pro-image", label: "Nano Banana Pro", provider: "gemini" },
    { value: "gemini-2.5-flash-image", label: "Nano Banana", provider: "gemini" },
    { value: "sd3.5-large", label: "Stable Diffusion 3.5 Large", provider: "stability" },
    { value: "sd3.5-large-turbo", label: "Stable Diffusion 3.5 Large Turbo", provider: "stability" },
    { value: "sd3.5-medium", label: "Stable Diffusion 3.5 Medium", provider: "stability" },
    { value: "sd3.5-flash", label: "Stable Diffusion 3.5 Flash", provider: "stability" },
    { value: "dall-e-3", label: "OpenAI DALL-E 3", provider: "dalle" },
    { value: "dall-e-2", label: "OpenAI DALL-E 2", provider: "dalle" }
  ];

  return defaultModels.map((item) => {
    const status = backendStatuses?.[item.value];
    let label = item.label;
    let disabled = false;

    if (status) {
      if (!status.hasKey) {
        label = `${item.label} (API Key Missing)`;
        disabled = true;
      } else if (status.isQuotaExceeded) {
        label = `${item.label} (Quota Exceeded - 3h Cooldown)`;
        disabled = true;
      } else if (!status.available) {
        label = `${item.label} (${status.disabledReason || "Unavailable"})`;
        disabled = true;
      }
    }

    return {
      value: item.value,
      label,
      disabled
    };
  });
}

export const IMAGE_GENERATION_MODELS: SelectBoxOption[] = getImageGenerationModelOptions();

function ImageGenNodeProps({ selectedNode, onUpdateNodeData, variableNodePrefixes }: NodePropsPanel) {
  const data = selectedNode.data ?? {};
  const str = (field: string, fallback = "") =>
    typeof data[field] === "string" ? (data[field] as string) : fallback;

  const currentModel = str("model") || "gemini-3.1-flash-image";
  const prompt = str("prompt");

  const [backendStatuses, setBackendStatuses] = useState<Record<string, BackendModelStatus>>({});

  useEffect(() => {
    let isMounted = true;
    getModelStatusesFromBackend()
      .then((res) => {
        if (isMounted && res && res.data) {
          setBackendStatuses(res.data);
        }
      })
      .catch(() => {
        // Ignore API fetch errors
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const dynamicModelOptions = getImageGenerationModelOptions(backendStatuses);

  return (
    <div>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title ?? "Image Generation"} onChange={(val) => onUpdateNodeData("title", val)} />
      </Section>

      <Section title="Model Selection">
        <div className="space-y-1.5">
          <Label>Image Model</Label>
          <SelectBox
            testId="image-gen-model-select"
            value={currentModel}
            onChange={(val) => onUpdateNodeData("model", val)}
            options={dynamicModelOptions}
          />
        </div>
      </Section>

      <Section title="Image Prompt" last>
        <div className="space-y-3">
          <div>
            <Label>Prompt</Label>
            <TextArea
              testId="image-gen-prompt-textarea"
              height="h-32"
              value={prompt}
              onChange={(val) => onUpdateNodeData("prompt", val)}
              placeholder="Describe the image to generate, e.g. A sleek logo for {{business.name}}"
            />
          </div>

          <UnknownVariablesNote
            text={prompt}
            nodePrefixes={variableNodePrefixes}
            testId="image-gen-prompt-unknown-vars"
          />
        </div>
      </Section>
    </div>
  );
}
