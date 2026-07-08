import { VOICE_NODE_TYPES, getNodeDefinition } from "@coreai/shared";
import { useState, type ReactNode } from "react";
import { VoicePicker } from "@/components/common/voice-picker";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData } from "./types";

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
};

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
  onConnectCalendar
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
  const base: NodePropsPanel = { selectedNode, onUpdateNodeData };

  let panel: ReactNode;

  if (type === VOICE_NODE_TYPES.phoneCallTrigger) panel = <PhoneCallTriggerProps {...base} />;
  else if (type === VOICE_NODE_TYPES.voiceConversation) panel = <AiVoiceConversationProps {...base} />;
  else if (type === VOICE_NODE_TYPES.calendarAvailability) {
    panel = <CalendarAvailabilityProps {...base} calendar={calendar} ownership={ownership} />;
  } else if (type === VOICE_NODE_TYPES.bookAppointment) {
    panel = <BookCalendarAppointmentProps {...base} calendar={calendar} ownership={ownership} />;
  } else if (type === VOICE_NODE_TYPES.sendSms) panel = <SendSmsProps {...base} />;
  else if (type === VOICE_NODE_TYPES.endFlow) panel = <EndFlowProps {...base} />;
  else if (selectedNode.data.nodeKind === "trigger") panel = <TriggerProps {...base} />;
  else if (selectedNode.data.nodeKind === "ai") panel = <AiProps {...base} />;
  else if (selectedNode.data.nodeKind === "condition") panel = <ConditionProps {...base} />;
  else if (selectedNode.data.nodeKind === "connector") {
    panel = <ConnectorProps {...base} calendar={calendar} ownership={ownership} />;
  } else {
    panel = <GenericProps {...base} />;
  }

  return (
    <div className="h-full overflow-y-auto bg-white scroll-thin">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <BuilderIcon name={selectedNode.data.icon} className="h-4 w-4 text-amber-600" />
          <span
            className="font-bold text-slate-900"
            data-testid="architect-ui-workflow-builder-node-inspector-node-properties-text"
          >
            Node properties
          </span>
        </div>

        <button
          type="button"
          onClick={onClearSelection}
          data-testid="node-inspector-clear"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          aria-label="Deselect node"
        >
          <BuilderIcon name="x" className="h-4 w-4" />
        </button>
      </div>

      {panel}

      <NodeOverviewPanel node={selectedNode} />

      <NodeAdvancedSettingsPanel node={selectedNode} />

      <div className="border-t border-gray-100 p-5">
        <button
          type="button"
          onClick={onDeleteNode}
          data-testid="node-inspector-delete"
          className="w-full rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-100"
        >
          Delete Node
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

function Section({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
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

function Label({ children }: { children: ReactNode }) {
  return (
    <span
      data-testid="node-inspector-field-label"
      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500"
    >
      {children}
    </span>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono = false
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      data-testid="node-inspector-label-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${mono ? "font-mono" : ""
        } w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function TextArea({
  value,
  onChange,
  height = "h-20",
  mono = false,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <textarea
      data-testid="node-inspector-prompt-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${height} ${mono ? "font-mono text-xs leading-relaxed" : ""
        } w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function SelectBox({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  const allOptions = options.includes(value) || !value ? options : [value, ...options];

  return (
    <div className="relative">
      <select
        data-testid="node-inspector-model-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
      >
        {allOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        <BuilderIcon name="chevron" className="h-4 w-4" />
      </span>
    </div>
  );
}

function NumberInput({
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
      className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
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

/**
 * Architect-mode connector display: requirement badges only.
 * No OAuth and no "Connect" button in architect template builder.
 */
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
  tone: "amber" | "violet" | "blue" | "green" | "orange" | "slate";
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

function NodeOverviewPanel({ node }: { node: BuilderNode }) {
  const overview = nodeOverview(node);
  const styles = TONE_CLASSNAMES[overview.tone];

  return (
    <Section title="Step overview">
      <div className={`rounded-2xl border px-3.5 py-3.5 ${styles.card}`} data-testid="node-step-overview">
        <div className="flex gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${styles.icon}`}>
            <BuilderIcon name={String(node.data.icon ?? "message")} className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold leading-5 ${styles.title}`}>
              {String(node.data.title ?? node.data.label ?? "Workflow step")}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{overview.summary}</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Needs</p>
            <PillList items={overview.needs} emptyText="No input required" className={styles.chip} />
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Creates</p>
            <PillList items={overview.creates} emptyText="No new output" className={styles.chip} />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/70 bg-white/70 px-3 py-2">
          <p className="flex items-start gap-2 text-[11px] leading-5 text-slate-600">
            <BuilderIcon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>{overview.setup.join(". ")}</span>
          </p>
        </div>
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

/**
 * Collapsed-by-default technical panel: variable mappings and developer
 * details. The default inspector stays plain-language; power users expand
 * this to wire {{variables}} between steps.
 */
function NodeAdvancedSettingsPanel({ node }: { node: BuilderNode }) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const type = String(node.data.type ?? "");
  const definition = getNodeDefinition(type);
  const inputKeys = definition?.requiredVariables ?? [];
  const outputKeys = definition?.producedVariables ?? [];
  const usedKeys = collectTemplateVariables(node);
  const connector = String(node.data.connector ?? "");
  const connectorAction = String(node.data.connectorAction ?? "");

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

          <AdvancedVariableGroup
            title="Variables"
            testId="node-advanced-variables"
            emptyText="No variables are used in this step yet."
            helper="Variables referenced by this step's fields. Click one to copy it, then paste it into any text field."
            keys={usedKeys}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />

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
        className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
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

function AiVoiceConversationProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

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
          <p className="mt-2 text-[11px] text-slate-400" data-testid="ai-assistant-name-note">
            The name the agent introduces itself with. Buyers can override it during install.
          </p>
        </div>
      </Section>

      <Section title="Voice">
        <VoicePicker
          accent="violet"
          selectedVoice={str("voice", PLATFORM_DEFAULT_VOICE_ID)}
          customVoiceId={str("voiceId")}
          testIdPrefix="architect-voice-picker"
          subtitle="Choose the suggested voice for this template. The buyer can accept it or choose another voice before deployment."
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

        <p className="mt-2 text-[11px] text-slate-400" data-testid="voice-suggested-note">
          This is only the template’s suggested voice. Buyer deployment resolves the final ElevenLabs voice.
        </p>
      </Section>

      <Section title="Conversation">
        <Label>Language</Label>
        <SelectBox value={str("language", "en-US")} onChange={set("language")} options={["en-US", "en-GB", "es", "hi"]} />

        <div className="mt-4">
          <Label>Speaking speed</Label>
          <SelectBox value={str("speakingSpeed", "1.0")} onChange={set("speakingSpeed")} options={["0.8", "0.9", "1.0", "1.1", "1.2"]} />
        </div>

        <div className="mt-4">
          <Label>First message</Label>
          <TextInput
            value={str("firstMessage")}
            onChange={set("firstMessage")}
            placeholder="e.g. Thanks for calling {{business.name}} — how can I help?"
          />
        </div>
      </Section>

      <Section title="Intelligence">
        <Label>AI model</Label>
        <SelectBox value={str("model", "gpt-4o")} onChange={set("model")} options={["gpt-4o", "gpt-4o-mini", "claude-sonnet"]} />

        <div className="mt-4">
          <Label>System prompt</Label>
          <TextArea value={str("systemPrompt")} onChange={set("systemPrompt")} height="h-44" mono />
        </div>

        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          Use generic placeholders like {"{{business.name}}"}, {"{{customer.name}}"}, and {"{{appointment.service}}"}.
        </p>
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

/* ----------------- Generic panels for the remaining nodes ----------------- */

function TriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
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

function AiProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const lastOutput = str("lastTestOutput");

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
        <Label>Model</Label>
        <SelectBox
          value={str("model", "gpt-4o")}
          onChange={set("model")}
          options={["gpt-4o", "gpt-4o-mini", "claude-sonnet", "gemini-1.5-pro", "llama-3.1-70b"]}
        />

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
          <NumberInput testId="node-inspector-delay-input" value={str("maxTokens", "200")} onChange={set("maxTokens")} />
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

function ConditionProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="Condition" last>
        <Label>Rule</Label>
        <TextInput value={str("condition")} onChange={set("condition")} placeholder="e.g. after hours, urgent request, booking intent" />
        <p className="mt-2 text-[11px] text-slate-400">Routes to connected nodes based on this rule.</p>
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
  const isCore = connector === "CoreAI" || connector === "Triven";
  const coreAction = str("connectorAction", "save_lead");

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

      <Section title={isGmail ? "Gmail" : isVapi ? "Vapi voice" : isCalendar ? "Google Calendar" : isCore ? "Triven action" : "SMS"} last>
        {isGmail ? (
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