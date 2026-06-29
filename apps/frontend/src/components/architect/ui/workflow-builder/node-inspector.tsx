import { VOICE_NODE_TYPES } from "@coreai/shared";
import type { ReactNode } from "react";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData } from "./types";

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

type CalendarPanel = NodePropsPanel & { calendar: CalendarConnection };

/**
 * Node inspector — fully data-driven from node.data, with no hardcoded business
 * values, fake phone numbers, or use-case (dental/missed-call) wording. Panels are
 * keyed by generic node capability (node.data.type) or connector, never by a
 * template. Use-case values appear only because a template put them in node.data.
 */
export function NodeInspector({
  selectedNode,
  onClearSelection,
  onUpdateNodeData,
  onDeleteNode,
  calendarConnected = false,
  calendarEmail = null,
  connectingCalendar = false,
  onConnectCalendar
}: {
  selectedNode: BuilderNode | null;
  onClearSelection: () => void;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
  onDeleteNode: () => void;
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
  const type = String(selectedNode.data.type ?? "");
  const base: NodePropsPanel = { selectedNode, onUpdateNodeData };

  let panel: ReactNode;
  if (type === VOICE_NODE_TYPES.phoneCallTrigger) panel = <PhoneCallTriggerProps {...base} />;
  else if (type === VOICE_NODE_TYPES.voiceConversation) panel = <AiVoiceConversationProps {...base} />;
  else if (type === VOICE_NODE_TYPES.calendarAvailability) panel = <CalendarAvailabilityProps {...base} calendar={calendar} />;
  else if (type === VOICE_NODE_TYPES.bookAppointment) panel = <BookCalendarAppointmentProps {...base} calendar={calendar} />;
  else if (type === VOICE_NODE_TYPES.sendSms) panel = <SendSmsProps {...base} />;
  else if (type === VOICE_NODE_TYPES.endFlow) panel = <EndFlowProps {...base} />;
  else if (selectedNode.data.nodeKind === "trigger") panel = <TriggerProps {...base} />;
  else if (selectedNode.data.nodeKind === "ai") panel = <AiProps {...base} />;
  else if (selectedNode.data.nodeKind === "condition") panel = <ConditionProps {...base} />;
  else if (selectedNode.data.nodeKind === "connector") panel = <ConnectorProps {...base} calendar={calendar} />;
  else panel = <GenericProps {...base} />;

  return (
    <div className="h-full overflow-y-auto bg-white scroll-thin">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <BuilderIcon name={selectedNode.data.icon} className="h-4 w-4 text-amber-600" />
          <span className="font-bold text-slate-900" data-testid="architect-ui-workflow-builder-node-inspector-node-properties-text">Node properties</span>
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
        <h3 className="font-bold text-slate-900" data-testid="architect-ui-workflow-builder-node-inspector-select-a-node-heading">Select a node</h3>
        <p className="mx-auto mt-1 max-w-[200px] text-xs text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-select-a-node-on-the-canvas-to-text">
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
      {title ? <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-title-heading">{title}</h3> : null}
      {children}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span data-testid="node-inspector-field-label" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</span>;
}

function TextInput({ value, onChange, placeholder, mono = false }: { value: string; onChange: (value: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input data-testid="node-inspector-label-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${mono ? "font-mono" : ""} w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function TextArea({ value, onChange, height = "h-20", mono = false, placeholder }: { value: string; onChange: (value: string) => void; height?: string; mono?: boolean; placeholder?: string }) {
  return (
    <textarea data-testid="node-inspector-prompt-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${height} ${mono ? "font-mono text-xs leading-relaxed" : ""} w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function SelectBox({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  const allOptions = options.includes(value) || !value ? options : [value, ...options];
  return (
    <div className="relative">
      <select data-testid="node-inspector-model-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
      >
        {allOptions.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        <BuilderIcon name="chevron" className="h-4 w-4" />
      </span>
    </div>
  );
}

function NumberInput({ value, onChange, testId, min, max, step }: { value: string; onChange: (value: string) => void; testId: string; min?: string; max?: string; step?: string }) {
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
        If Calendar is not connected, dry-run uses safe preview slots. Live booking requires a Google Calendar connection.
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

function PhoneCallTriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const assignedNumber = str("phoneNumber") || str("assignedNumber") || str("businessPhoneNumber");
  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>
      <Section title="Phone line">
        <Label>Assigned number</Label>
        <ReadOnly value={assignedNumber || "Assigned on deploy"} testId="phone-trigger-number" />
        <p className="mt-2 text-[11px] text-slate-400" data-testid="phone-trigger-note">
          The Twilio number is assigned automatically on Deploy.
        </p>
      </Section>
      <Section title="Answering" last>
        <Label>Answer mode</Label>
        <SelectBox value={str("callHandlingMode", "AI_ANSWERS")} onChange={set("callHandlingMode")} options={["AI_ANSWERS", "FORWARD_THEN_AI"]} />
        <div className="mt-4">
          <Label>Answer after (rings)</Label>
          <SelectBox value={str("answerAfterRings", "1")} onChange={set("answerAfterRings")} options={["1", "2", "3"]} />
        </div>
        <div className="mt-4">
          <Label>Forwarding schedule</Label>
          <SelectBox value={str("forwardingSchedule", "always")} onChange={set("forwardingSchedule")} options={["always", "after-hours"]} />
        </div>
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
      </Section>
      <Section title="Voice">
        <Label>Voice</Label>
        <SelectBox value={str("voice", "sarah")} onChange={set("voice")} options={["sarah", "james", "priya"]} />
        <div className="mt-4">
          <Label>Language</Label>
          <SelectBox value={str("language", "en-US")} onChange={set("language")} options={["en-US", "en-GB", "es", "hi"]} />
        </div>
        <div className="mt-4">
          <Label>Speaking speed</Label>
          <SelectBox value={str("speakingSpeed", "1.0")} onChange={set("speakingSpeed")} options={["0.8", "0.9", "1.0", "1.1", "1.2"]} />
        </div>
      </Section>
      <Section title="Intelligence">
        <Label>AI model</Label>
        <SelectBox value={str("model", "gpt-4o")} onChange={set("model")} options={["gpt-4o", "gpt-4o-mini", "claude-sonnet"]} />
        <div className="mt-4">
          <Label>First message</Label>
          <TextInput value={str("firstMessage")} onChange={set("firstMessage")} placeholder="e.g. Thanks for calling {{business.name}} — how can I help?" />
        </div>
        <div className="mt-4">
          <Label>System prompt</Label>
          <TextArea value={str("systemPrompt")} onChange={set("systemPrompt")} height="h-44" mono />
        </div>
      </Section>
      <Section title="Business details">
        <Label>Business name</Label>
        <TextInput value={str("practiceName")} onChange={set("practiceName")} placeholder="Not configured" />
        <div className="mt-4">
          <Label>Contact / owner name</Label>
          <TextInput value={str("doctorName")} onChange={set("doctorName")} placeholder="Not configured" />
        </div>
        <div className="mt-4">
          <Label>Hours</Label>
          <TextInput value={str("practiceHours")} onChange={set("practiceHours")} placeholder="Not configured" />
        </div>
        <div className="mt-4">
          <Label>Services</Label>
          <TextArea value={str("services")} onChange={set("services")} height="h-20" placeholder="Comma-separated services" />
        </div>
        <div className="mt-4">
          <Label>Fallback response</Label>
          <TextInput value={str("fallbackResponse")} onChange={set("fallbackResponse")} placeholder="Said when the assistant can't help" />
        </div>
      </Section>
      <Section title="Custom instructions" last>
        <Label>Added to the AI system prompt</Label>
        <textarea
          data-testid="node-inspector-custom-instructions-textarea"
          value={str("customInstructions")}
          onChange={(event) => onUpdateNodeData("customInstructions", event.target.value)}
          placeholder="Enter custom rules for this agent…"
          className="h-48 w-full resize-y overflow-y-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-400/50"
        />
        <p className="mt-2 text-[11px] text-slate-400" data-testid="ai-custom-instructions-note">
          This is added to the AI system prompt at Deploy.
        </p>
      </Section>
    </>
  );
}

function CalendarAvailabilityProps({ selectedNode, onUpdateNodeData, calendar }: CalendarPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  return (
    <>
      <Section title="Google Calendar">
        <CalendarConnect calendar={calendar} />
        <div className="mt-4">
          <Label>Calendar ID</Label>
          <TextInput mono value={str("calendarId", "primary")} onChange={set("calendarId")} />
        </div>
        <div className="mt-4">
          <Label>Timezone</Label>
          <TextInput value={str("timeZone")} onChange={set("timeZone")} placeholder="e.g. Asia/Kolkata" />
        </div>
      </Section>
      <Section title="Availability rules" last>
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
      </Section>
    </>
  );
}

function BookCalendarAppointmentProps({ selectedNode, onUpdateNodeData, calendar }: CalendarPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);
  return (
    <>
      <Section title="Google Calendar">
        <CalendarConnect calendar={calendar} />
        <div className="mt-4">
          <Label>Calendar ID</Label>
          <TextInput mono value={str("calendarId", "primary")} onChange={set("calendarId")} />
        </div>
        <div className="mt-4">
          <Label>Timezone</Label>
          <TextInput value={str("timeZone")} onChange={set("timeZone")} placeholder="e.g. Asia/Kolkata" />
        </div>
      </Section>
      <Section title="Event">
        <Label>Event title format</Label>
        <TextInput mono value={str("eventTitleFormat")} onChange={set("eventTitleFormat")} placeholder="[Service] - [Customer Name]" />
        <div className="mt-4">
          <Label>Event description</Label>
          <TextArea mono height="h-20" value={str("eventDescription")} onChange={set("eventDescription")} placeholder="Phone: [Customer Phone] | Service: [Service]" />
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
          <TextArea height="h-16" value={str("confirmationMessage")} onChange={set("confirmationMessage")} placeholder="Said after a successful booking" />
        </div>
      </Section>
    </>
  );
}

function SendSmsProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const { str, flag, set } = fields(selectedNode, onUpdateNodeData);
  return (
    <>
      <Section title="Send SMS">
        <p className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs leading-5 text-green-700" data-testid="sms-provider-note">
          Sent via your connected Twilio number.
        </p>
      </Section>
      <Section title="Customer">
        <BoolField label="Send to customer" value={flag("sendToPatient", true)} onChange={set("sendToPatient")} />
        <div className="mt-4">
          <Label>Customer message template</Label>
          <TextArea height="h-20" value={str("patientTemplate")} onChange={set("patientTemplate")} placeholder="Confirmed: [Service] on [Date] at [Time]." />
        </div>
      </Section>
      <Section title="Team" last>
        <BoolField label="Send to team" value={flag("sendToDentist", false)} onChange={set("sendToDentist")} />
        <div className="mt-4">
          <Label>Team phone number</Label>
          <TextInput mono value={str("dentistPhone")} onChange={set("dentistPhone")} placeholder="Not configured" />
        </div>
        <div className="mt-4">
          <Label>Team message template</Label>
          <TextArea height="h-20" value={str("dentistTemplate")} onChange={set("dentistTemplate")} placeholder="New booking: [Customer Name], [Date] [Time], [Service]." />
        </div>
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
  const assignedNumber = str("phoneNumber") || str("assignedNumber") || str("businessPhoneNumber");
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
        <div className="mt-4">
          <Label>Assigned number</Label>
          <ReadOnly value={assignedNumber || "Assigned on deploy"} />
        </div>
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
        <SelectBox value={str("model", "gpt-4o")} onChange={set("model")} options={["gpt-4o", "gpt-4o-mini", "claude-sonnet", "gemini-1.5-pro", "llama-3.1-70b"]} />
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
            <p className="text-sm leading-relaxed text-slate-700" data-testid="node-inspector-last-test-output">{lastOutput}</p>
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
        <TextInput value={str("condition")} onChange={set("condition")} placeholder="e.g. 9:00 AM - 5:00 PM, Mon-Fri" />
        <p className="mt-2 text-[11px] text-slate-400">Routes to the connected nodes based on this rule.</p>
      </Section>
    </>
  );
}

function ConnectorProps({ selectedNode, onUpdateNodeData, calendar }: CalendarPanel) {
  const { str, set } = fields(selectedNode, onUpdateNodeData);
  const connector = str("connector", "SMS");
  const isGmail = connector === "Gmail";
  const isVapi = connector === "Vapi";
  const isCalendar = connector === "Google Calendar";
  const isCore = connector === "CoreAI";
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
      <Section title={isGmail ? "Gmail" : isVapi ? "Vapi voice" : isCalendar ? "Google Calendar" : isCore ? "CoreAI action" : "SMS"} last>
        {isGmail ? (
          <>
            <Label>Action</Label>
            <SelectBox value={str("connectorAction", "read_emails")} onChange={set("connectorAction")} options={["read_emails", "draft_reply", "create_draft", "send_email"]} />
            {str("connectorAction", "read_emails") === "read_emails" ? (
              <div className="mt-4"><Label>Search query</Label><TextInput mono value={str("gmailQuery", "newer_than:7d")} onChange={set("gmailQuery")} /></div>
            ) : (
              <>
                <div className="mt-4"><Label>To</Label><TextInput mono value={str("gmailTo", "{{gmail.senderEmail}}")} onChange={set("gmailTo")} /></div>
                <div className="mt-4"><Label>Subject</Label><TextInput mono value={str("gmailSubject", "Re: {{gmail.subject}}")} onChange={set("gmailSubject")} /></div>
                <div className="mt-4"><Label>Body</Label><TextArea mono height="h-24" value={str("gmailBody", "{{ai.output}}")} onChange={set("gmailBody")} /></div>
              </>
            )}
          </>
        ) : isVapi ? (
          <>
            <Label>Action</Label>
            <SelectBox value={str("connectorAction", "start_voice_call")} onChange={set("connectorAction")} options={["start_voice_call"]} />
            <div className="mt-4"><Label>Assistant ID</Label><TextInput mono value={str("vapiAssistantId", "{{business.vapiAssistantId}}")} onChange={set("vapiAssistantId")} /></div>
            <div className="mt-4"><Label>Phone Number ID</Label><TextInput mono value={str("vapiPhoneNumberId", "{{business.vapiPhoneNumberId}}")} onChange={set("vapiPhoneNumberId")} /></div>
          </>
        ) : isCalendar ? (
          <>
            {calendar ? <CalendarConnect calendar={calendar} /> : null}
            <div className="mt-4"><Label>Action</Label><SelectBox value={str("connectorAction", "book_appointment")} onChange={set("connectorAction")} options={["check_availability", "book_appointment"]} /></div>
            <div className="mt-4"><Label>Calendar ID</Label><TextInput mono value={str("calendarId", "{{business.calendarId}}")} onChange={set("calendarId")} /></div>
            <div className="mt-4"><Label>Service</Label><TextInput value={str("appointmentService")} onChange={set("appointmentService")} placeholder="Not configured" /></div>
            <div className="mt-4"><Label>Event summary</Label><TextInput mono value={str("calendarSummary")} onChange={set("calendarSummary")} placeholder="{{appointmentService}} - {{customer.phone}}" /></div>
            <div className="mt-4"><Label>Event description</Label><TextArea mono height="h-20" value={str("calendarDescription")} onChange={set("calendarDescription")} /></div>
          </>
        ) : isCore ? (
          <div data-testid="node-inspector-coreai">
            <Label>Action</Label>
            <SelectBox value={coreAction} onChange={set("connectorAction")} options={["save_lead", "save_conversation_message", "human_handoff", "trigger_next_workflow"]} />
            {coreAction === "trigger_next_workflow" ? (
              <div className="mt-4"><Label>Next workflow ID</Label><TextInput mono value={str("nextWorkflowId")} onChange={set("nextWorkflowId")} placeholder="Not configured" /></div>
            ) : null}
            {coreAction === "save_conversation_message" ? (
              <>
                <div className="mt-4"><Label>Direction</Label><SelectBox value={str("conversationDirection", "OUTBOUND")} onChange={set("conversationDirection")} options={["OUTBOUND", "INBOUND", "SYSTEM"]} /></div>
                <div className="mt-4"><Label>Message body</Label><TextArea mono height="h-20" value={str("conversationBody", "{{ai.output}}")} onChange={set("conversationBody")} /></div>
              </>
            ) : null}
            {coreAction === "human_handoff" ? (
              <div className="mt-4"><Label>Handoff reason</Label><TextArea height="h-16" value={str("handoffReason", "{{business.escalationRules}}")} onChange={set("handoffReason")} /></div>
            ) : null}
            {coreAction === "save_lead" ? (
              <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700" data-testid="architect-ui-workflow-builder-node-inspector-saves-the-contact-as-a-lead-for-text">Saves the contact as a lead for this business. No extra configuration needed.</p>
            ) : null}
          </div>
        ) : (
          <>
            <Label>Send to</Label>
            <TextInput mono value={str("smsTo", "{{customer.phone}}")} onChange={set("smsTo")} />
            <div className="mt-4">
              <Label>Message body</Label>
              <TextArea value={str("smsBody", "{{ai.output}}")} onChange={set("smsBody")} height="h-[88px]" />
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
        <div className="mt-4"><Label>Summary</Label><TextInput value={str("subtitle")} onChange={set("subtitle")} /></div>
      </Section>
      <Section title="Settings" last>
        <p className="text-sm leading-relaxed text-slate-500" data-testid="architect-ui-workflow-builder-node-inspector-configure-how-this-selected-node-kind-to-text">
          Configure how this {String(selectedNode.data.kind ?? "").toLowerCase() || "step"} behaves. Drag from its ports to connect it to the rest of your workflow.
        </p>
      </Section>
    </>
  );
}
