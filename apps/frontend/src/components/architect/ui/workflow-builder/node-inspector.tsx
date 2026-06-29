import { DENTAL_NODE_TYPES, isDentalNodeType } from "@coreai/shared";
import type { CSSProperties, ReactNode } from "react";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData } from "./types";

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

  const calendar = { connected: calendarConnected, email: calendarEmail, connecting: connectingCalendar, onConnect: onConnectCalendar };

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

      {isDentalNodeType(String(selectedNode.data.type ?? "")) ? (
        <DentalProps selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} calendar={calendar} />
      ) : selectedNode.data.nodeKind === "trigger" ? (
        <TriggerProps selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
      ) : selectedNode.data.nodeKind === "ai" ? (
        <AiProps selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
      ) : selectedNode.data.nodeKind === "condition" ? (
        <ConditionProps selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
      ) : selectedNode.data.nodeKind === "connector" ? (
        <ConnectorProps selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
      ) : (
        <GenericProps selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
      )}

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

function Section({
  title,
  children,
  last = false
}: {
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
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
    <input data-testid="node-inspector-label-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${mono ? "font-mono" : ""} w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function TextArea({
  value,
  onChange,
  height = "h-20",
  mono = false
}: {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  mono?: boolean;
}) {
  return (
    <textarea data-testid="node-inspector-prompt-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${height} ${mono ? "font-mono text-xs leading-relaxed" : ""} w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function SelectBox({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <div className="relative">
      <select data-testid="node-inspector-model-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
        <BuilderIcon name="chevron" className="h-4 w-4" />
      </span>
    </div>
  );
}

function Pills({ items }: { items: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} data-testid={`node-inspector-pill-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-[11px] text-slate-600">
          {item}
        </span>
      ))}
    </div>
  );
}

function Toggle({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600" data-testid="architect-ui-workflow-builder-node-inspector-label-text">{label}</span>
      <div className="toggle on" role="switch" aria-checked="true"><div className="knob" /></div>
    </div>
  );
}

function TriggerProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={(value) => onUpdateNodeData("title", value)} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={selectedNode.data.subtitle ?? "Fires when a call to the practice goes unanswered during the configured hours."} onChange={(value) => onUpdateNodeData("subtitle", value)} height="h-16" />
        </div>
      </Section>
      <Section title="Trigger settings">
        <Label>Event type</Label>
        <SelectBox value="Missed call" onChange={() => undefined} options={["Missed call", "Voicemail left", "Call abandoned"]} />
        <div className="mt-4"><Toggle label="Only during business hours" /></div>
        <div className="mt-4">
          <Label>Phone line</Label>
          <SelectBox value="Main line - (415) 555-0100" onChange={() => undefined} options={["Main line - (415) 555-0100", "Booking line - (415) 555-0177"]} />
        </div>
      </Section>
      <Section title="Output" last>
        <Label>Variables produced</Label>
        <Pills items={["{caller_number}", "{timestamp}"]} />
      </Section>
    </>
  );
}

function AiProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const prompt = selectedNode.data.prompt ?? "You are a friendly dental office assistant. A patient just called but we missed their call. Write a brief, warm text message acknowledging their call and offering to help schedule an appointment. Keep it under 160 characters.";
  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={(value) => onUpdateNodeData("title", value)} />
        <div className="mt-4">
          <Label>Description</Label>
          <TextArea value={selectedNode.data.subtitle ?? "Creates a friendly, personalized text message acknowledging the missed call and inviting the patient to book."} onChange={(value) => onUpdateNodeData("subtitle", value)} height="h-[72px]" />
        </div>
      </Section>
      <Section title="AI configuration">
        <Label>Model</Label>
        <SelectBox value="GPT-4o" onChange={() => undefined} options={["GPT-4o", "GPT-4o mini", "Claude 3.5 Sonnet", "Gemini 1.5 Pro", "Llama 3.1 70B"]} />
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between"><label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-node-inspector-temperature-label">Temperature</label></div>
          <div className="relative pt-6">
            <div className="absolute top-0 -translate-x-1/2 rounded-md bg-amber-500 px-1.5 py-0.5 font-mono text-[10px] text-white shadow" style={{ left: "70%" }}>0.7</div>
            <input data-testid="node-inspector-temperature-input" type="range" min="0" max="1" step="0.1" defaultValue="0.7" className="slider w-full" style={{ "--p": "70%" } as CSSProperties} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-400"><span data-testid="architect-ui-workflow-builder-node-inspector-0-precise-text">0.0 - precise</span><span data-testid="architect-ui-workflow-builder-node-inspector-1-0-creative-text">1.0 - creative</span></div>
        </div>
        <div className="mt-4">
          <Label>System prompt</Label>
          <TextArea value={prompt} onChange={(value) => onUpdateNodeData("prompt", value)} height="h-[134px]" mono />
        </div>
        <div className="mt-4">
          <Label>Max tokens</Label>
          <input data-testid="node-inspector-delay-input" defaultValue="200" className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50" />
        </div>
      </Section>
      <Section title="Input mapping">
        <Label>Variables available</Label>
        <Pills items={["{caller_number}", "{caller_name}", "{timestamp}", "{business_name}"]} />
      </Section>
      <Section title="Test output" last>
        <p className="text-xs text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-last-result-text">Last test result</p>
        <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm leading-relaxed text-slate-700" data-testid="architect-ui-workflow-builder-node-inspector-hi-we-noticed-we-missed-your-call-text">Hi! We noticed we missed your call at Mitchell Dental. Sorry about that! Would you like to schedule an appointment? Reply YES and we will get you booked.</p>
        </div>
        <p className="mt-2 font-mono text-xs text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-generated-in-1-2s-text">Generated in 1.2s</p>
      </Section>
    </>
  );
}

function ConditionProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const day = (label: string, on = true) => (
    <span className={on ? "rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700" : "rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-slate-400"} data-testid="architect-ui-workflow-builder-node-inspector-label-text-2">{label}</span>
  );
  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={(value) => onUpdateNodeData("title", value)} />
      </Section>
      <Section title="Condition">
        <Label>Variable</Label>
        <SelectBox value="{timestamp}" onChange={() => undefined} options={["{timestamp}", "{caller_number}", "{message_text}"]} />
        <div className="mt-4">
          <Label>Check</Label>
          <SelectBox value="is within hours" onChange={() => undefined} options={["is within hours", "is outside hours", "equals", "contains"]} />
        </div>
        <div className="mt-4">
          <Label>Time window</Label>
          <TextInput value={selectedNode.data.condition ?? "8:00 AM - 6:00 PM"} onChange={(value) => onUpdateNodeData("condition", value)} />
        </div>
        <div className="mt-4">
          <Label>Active days</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">{day("Mon")}{day("Tue")}{day("Wed")}{day("Thu")}{day("Fri")}{day("Sat", false)}{day("Sun", false)}</div>
        </div>
      </Section>
      <Section title="Branches" last>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-green-500" /><span className="font-medium text-slate-700" data-testid="architect-ui-workflow-builder-node-inspector-yes-text-2">Yes</span><span className="text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-send-sms-now-text">Send SMS Now</span></div>
          <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-red-500" /><span className="font-medium text-slate-700" data-testid="architect-ui-workflow-builder-node-inspector-no-text-2">No</span><span className="text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-queue-for-morning-text">Queue for Morning</span></div>
        </div>
      </Section>
    </>
  );
}

function ConnectorProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const connector = selectedNode.data.connector ?? "SMS";
  const isGmail = connector === "Gmail";
  const isVapi = connector === "Vapi";
  const isCalendar = connector === "Google Calendar";
  const isCore = connector === "CoreAI";
  const coreAction = selectedNode.data.connectorAction ?? "save_lead";

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={(value) => onUpdateNodeData("title", value)} />
        <div className="mt-4">
          <Label>Summary</Label>
          <TextInput value={selectedNode.data.subtitle ?? ""} onChange={(value) => onUpdateNodeData("subtitle", value)} />
        </div>
      </Section>
      <Section title={isGmail ? "Gmail action" : isVapi ? "Vapi voice" : isCalendar ? "Google Calendar" : isCore ? "CoreAI action" : "Message"}>
        {isGmail ? (
          <>
            <Label>Action</Label>
            <SelectBox value={selectedNode.data.connectorAction ?? "read_emails"} onChange={(value) => onUpdateNodeData("connectorAction", value)} options={["read_emails", "draft_reply", "send_email"]} />
            {selectedNode.data.connectorAction === "read_emails" ? (
              <div className="mt-4"><Label>Search query</Label><TextInput mono value={selectedNode.data.gmailQuery ?? "newer_than:7d"} onChange={(value) => onUpdateNodeData("gmailQuery", value)} /></div>
            ) : (
              <>
                <div className="mt-4"><Label>To</Label><TextInput mono value={selectedNode.data.gmailTo ?? "{{gmail.senderEmail}}"} onChange={(value) => onUpdateNodeData("gmailTo", value)} /></div>
                <div className="mt-4"><Label>Subject</Label><TextInput mono value={selectedNode.data.gmailSubject ?? "Re: {{gmail.subject}}"} onChange={(value) => onUpdateNodeData("gmailSubject", value)} /></div>
                <div className="mt-4"><Label>Body</Label><TextArea mono height="h-24" value={selectedNode.data.gmailBody ?? "{{ai.output}}"} onChange={(value) => onUpdateNodeData("gmailBody", value)} /></div>
              </>
            )}
          </>
        ) : isVapi ? (
          <>
            <Label>Action</Label>
            <SelectBox value={selectedNode.data.connectorAction ?? "start_voice_call"} onChange={(value) => onUpdateNodeData("connectorAction", value)} options={["start_voice_call"]} />
            <div className="mt-4"><Label>Assistant ID</Label><TextInput mono value={selectedNode.data.vapiAssistantId ?? "{{business.vapiAssistantId}}"} onChange={(value) => onUpdateNodeData("vapiAssistantId", value)} /></div>
            <div className="mt-4"><Label>Phone Number ID</Label><TextInput mono value={selectedNode.data.vapiPhoneNumberId ?? "{{business.vapiPhoneNumberId}}"} onChange={(value) => onUpdateNodeData("vapiPhoneNumberId", value)} /></div>
            <p className="mt-3 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-700" data-testid="architect-ui-workflow-builder-node-inspector-vapi-receives-business-context-variables-talks-to-t">Vapi receives business context variables, talks to the patient, and can call the Vapi webhook tool to book appointments.</p>
          </>
        ) : isCalendar ? (
          <>
            <Label>Action</Label>
            <SelectBox value={selectedNode.data.connectorAction ?? "book_appointment"} onChange={(value) => onUpdateNodeData("connectorAction", value)} options={["book_appointment"]} />
            <div className="mt-4"><Label>Calendar ID</Label><TextInput mono value={selectedNode.data.calendarId ?? "{{business.calendarId}}"} onChange={(value) => onUpdateNodeData("calendarId", value)} /></div>
            <div className="mt-4"><Label>Service</Label><TextInput value={selectedNode.data.appointmentService ?? "Consultation"} onChange={(value) => onUpdateNodeData("appointmentService", value)} /></div>
            <div className="mt-4"><Label>Summary</Label><TextInput mono value={selectedNode.data.calendarSummary ?? "{{appointmentService}} - {{caller_number}}"} onChange={(value) => onUpdateNodeData("calendarSummary", value)} /></div>
            <div className="mt-4"><Label>Description</Label><TextArea mono height="h-20" value={selectedNode.data.calendarDescription ?? "Booked by CORE AI Receptionist after missed-call follow-up."} onChange={(value) => onUpdateNodeData("calendarDescription", value)} /></div>
          </>
        ) : isCore ? (
          <div data-testid="node-inspector-coreai">
            <Label>Action</Label>
            <SelectBox value={coreAction} onChange={(value) => onUpdateNodeData("connectorAction", value)} options={["save_lead", "save_conversation_message", "human_handoff", "trigger_next_workflow"]} />
            {coreAction === "trigger_next_workflow" ? (
              <div className="mt-4"><Label>Next workflow ID</Label><TextInput mono value={selectedNode.data.nextWorkflowId ?? ""} onChange={(value) => onUpdateNodeData("nextWorkflowId", value)} /></div>
            ) : null}
            {coreAction === "save_conversation_message" ? (
              <>
                <div className="mt-4"><Label>Direction</Label><SelectBox value={selectedNode.data.conversationDirection ?? "OUTBOUND"} onChange={(value) => onUpdateNodeData("conversationDirection", value)} options={["OUTBOUND", "INBOUND", "SYSTEM"]} /></div>
                <div className="mt-4"><Label>Message body</Label><TextArea mono height="h-20" value={selectedNode.data.conversationBody ?? "{{sentSms.body}}"} onChange={(value) => onUpdateNodeData("conversationBody", value)} /></div>
              </>
            ) : null}
            {coreAction === "human_handoff" ? (
              <div className="mt-4"><Label>Handoff reason</Label><TextArea height="h-16" value={selectedNode.data.handoffReason ?? "{{business.escalationRules}}"} onChange={(value) => onUpdateNodeData("handoffReason", value)} /></div>
            ) : null}
            {coreAction === "save_lead" ? (
              <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700" data-testid="architect-ui-workflow-builder-node-inspector-saves-the-caller-as-a-lead-for-text">Saves the caller as a lead for this business. No extra configuration needed.</p>
            ) : null}
          </div>
        ) : (
          <>
            <Label>Send to</Label>
            <TextInput mono value={selectedNode.data.smsTo ?? "{caller_number}"} onChange={(value) => onUpdateNodeData("smsTo", value)} />
            <div className="mt-4">
              <Label>Message body</Label>
              <TextArea value={selectedNode.data.smsBody ?? "{{ai.output}}"} onChange={(value) => onUpdateNodeData("smsBody", value)} height="h-[88px]" />
              <p className="mt-1 text-[11px] text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-uses-the-ai-generated-from-the-previous-text">Uses the AI-generated text from the previous step.</p>
            </div>
          </>
        )}
      </Section>
      <Section title="Delivery" last>
        <Label>Provider</Label>
        <SelectBox value={isGmail ? "Gmail" : isVapi ? "Vapi" : isCalendar ? "Google Calendar" : isCore ? "CoreAI" : "Twilio"} onChange={() => undefined} options={isGmail ? ["Gmail"] : isVapi ? ["Vapi"] : isCalendar ? ["Google Calendar"] : isCore ? ["CoreAI"] : ["Twilio", "MessageBird", "Vonage", "Telnyx"]} />
        <div className="mt-4"><Toggle label={isGmail ? "Create safe draft first" : isVapi ? "Call patient after missed call" : isCalendar ? "Create appointment event" : isCore ? "Run inside workflow" : "Send immediately"} /></div>
      </Section>
    </>
  );
}

function GenericProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={(value) => onUpdateNodeData("title", value)} />
        <div className="mt-4"><Label>Summary</Label><TextInput value={selectedNode.data.subtitle ?? ""} onChange={(value) => onUpdateNodeData("subtitle", value)} /></div>
      </Section>
      <Section title="Settings" last>
        <p className="text-sm leading-relaxed text-slate-500" data-testid="architect-ui-workflow-builder-node-inspector-configure-how-this-selected-node-kind-to-text">Configure how this {selectedNode.data.kind.toLowerCase()} step behaves. Drag from its ports to connect it to the rest of your workflow.</p>
      </Section>
    </>
  );
}

function BoolField({
  label,
  value,
  onChange
}: {
  label: string;
  value: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <SelectBox value={value ? "On" : "Off"} onChange={(v) => onChange(v === "On" ? "true" : "false")} options={["On", "Off"]} />
    </div>
  );
}

/**
 * Config panels for the 6 Dental AI Receptionist nodes. Field values are written
 * back to node.data by their registry keys; the Deploy endpoint reads the same
 * keys to build the Vapi assistant + tools.
 */
type CalendarConnection = {
  connected: boolean;
  email: string | null;
  connecting: boolean;
  onConnect?: () => void;
};

function DentalProps({
  selectedNode,
  onUpdateNodeData,
  calendar
}: NodePropsPanel & { calendar: CalendarConnection }) {
  const type = String(selectedNode.data.type ?? "");
  const str = (key: string, fallback = ""): string =>
    typeof selectedNode.data[key] === "string" ? (selectedNode.data[key] as string) : fallback;
  const flag = (key: string, fallback: boolean): boolean => {
    const value = selectedNode.data[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "true";
    return fallback;
  };
  const set = (key: string) => (value: string) => onUpdateNodeData(key as keyof BuilderNodeData, value);

  if (type === DENTAL_NODE_TYPES.incomingPhoneCall) {
    return (
      <>
        <Section title="Trigger">
          <Label>Node name</Label>
          <TextInput value={selectedNode.data.title} onChange={set("title")} />
          <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700" data-testid="architect-ui-workflow-builder-node-inspector-dental-phone-note">
            The Twilio number is assigned automatically on Deploy.
          </p>
        </Section>
        <Section title="Answering" last>
          <Label>Answer after</Label>
          <SelectBox value={str("answerAfterRings", "1")} onChange={set("answerAfterRings")} options={["1", "2", "3"]} />
          <div className="mt-4">
            <Label>Forwarding schedule</Label>
            <SelectBox value={str("forwardingSchedule", "always")} onChange={set("forwardingSchedule")} options={["always", "after-hours"]} />
          </div>
        </Section>
      </>
    );
  }

  if (type === DENTAL_NODE_TYPES.aiConversation) {
    return (
      <>
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
            <TextInput value={str("firstMessage")} onChange={set("firstMessage")} />
          </div>
          <div className="mt-4">
            <Label>System prompt</Label>
            <TextArea value={str("systemPrompt")} onChange={set("systemPrompt")} height="h-44" mono />
          </div>
        </Section>
        <Section title="Practice details">
          <Label>Practice name</Label>
          <TextInput value={str("practiceName")} onChange={set("practiceName")} />
          <div className="mt-4">
            <Label>Doctor name</Label>
            <TextInput value={str("doctorName")} onChange={set("doctorName")} />
          </div>
          <div className="mt-4">
            <Label>Practice hours</Label>
            <TextInput value={str("practiceHours")} onChange={set("practiceHours")} />
          </div>
          <div className="mt-4">
            <Label>Services offered</Label>
            <TextArea value={str("services")} onChange={set("services")} height="h-20" />
          </div>
          <div className="mt-4">
            <Label>Fallback response</Label>
            <TextInput value={str("fallbackResponse")} onChange={set("fallbackResponse")} />
          </div>
        </Section>
        <Section title="Custom instructions" last>
          <Label>Injected into the AI system prompt</Label>
          <textarea
            data-testid="node-inspector-custom-instructions-textarea"
            value={str("customInstructions")}
            onChange={(event) => onUpdateNodeData("customInstructions", event.target.value)}
            placeholder="Enter custom rules… e.g. 'New patients get a 60-minute first visit. Always mention free parking behind the building.'"
            className="h-48 w-full resize-y overflow-y-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-400/50"
          />
          <p className="mt-2 text-[11px] text-slate-400" data-testid="architect-ui-workflow-builder-node-inspector-dental-custom-note">
            This is spliced into the Vapi system prompt at Deploy.
          </p>
        </Section>
      </>
    );
  }

  if (type === DENTAL_NODE_TYPES.checkCalendar) {
    return (
      <>
        <Section title="Google Calendar">
          {calendar.connected ? (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5" data-testid="dental-calendar-connected">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
                <span className="h-2 w-2 rounded-full bg-green-500" /> Google Calendar connected
              </p>
              {calendar.email ? <p className="mt-1 text-[11px] text-green-700/80">{calendar.email}</p> : null}
              <p className="mt-1 text-[11px] text-slate-500">check_availability and book_appointment will use this calendar.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5" data-testid="dental-calendar-disconnected">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Calendar not connected
              </p>
              <p className="mt-1 text-[11px] text-amber-700/90">
                The agent will offer safe demo slots (10:00 AM, 2:00 PM, 4:30 PM) until you connect.
              </p>
              <button
                type="button"
                onClick={calendar.onConnect}
                disabled={calendar.connecting || !calendar.onConnect}
                data-testid="dental-connect-calendar"
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {calendar.connecting ? "Connecting…" : "Connect Google Calendar"}
              </button>
            </div>
          )}
        </Section>
        <Section title="Availability rules" last>
          <Label>Buffer between appointments (min)</Label>
          <SelectBox value={str("bufferMinutes", "10")} onChange={set("bufferMinutes")} options={["0", "5", "10", "15", "30"]} />
          <div className="mt-4">
            <Label>Maximum advance booking (days)</Label>
            <SelectBox value={str("maxAdvanceDays", "30")} onChange={set("maxAdvanceDays")} options={["7", "14", "30", "90"]} />
          </div>
          <div className="mt-4">
            <Label>Slots to offer</Label>
            <SelectBox value={str("slotsToOffer", "3")} onChange={set("slotsToOffer")} options={["2", "3", "4"]} />
          </div>
        </Section>
      </>
    );
  }

  if (type === DENTAL_NODE_TYPES.bookAppointment) {
    return (
      <>
        <Section title="Book appointment">
          <Label>Event title format</Label>
          <TextInput mono value={str("eventTitleFormat", "[Service] - [Patient Name]")} onChange={set("eventTitleFormat")} />
          <div className="mt-4">
            <Label>Event description</Label>
            <TextArea mono height="h-20" value={str("eventDescription")} onChange={set("eventDescription")} />
          </div>
        </Section>
        <Section title="Confirmation" last>
          <BoolField label="Send calendar reminder" value={flag("reminderEnabled", true)} onChange={set("reminderEnabled")} />
          <div className="mt-4">
            <Label>Reminder timing (minutes before)</Label>
            <SelectBox value={str("reminderTiming", "120")} onChange={set("reminderTiming")} options={["60", "120", "1440"]} />
          </div>
          <div className="mt-4">
            <Label>Confirmation message</Label>
            <TextArea height="h-16" value={str("confirmationMessage")} onChange={set("confirmationMessage")} />
          </div>
        </Section>
      </>
    );
  }

  if (type === DENTAL_NODE_TYPES.sendSmsNotification) {
    return (
      <>
        <Section title="Send SMS notification">
          <p className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs leading-5 text-green-700" data-testid="architect-ui-workflow-builder-node-inspector-dental-sms-note">
            Connected via the Triven Twilio pool.
          </p>
        </Section>
        <Section title="Patient">
          <BoolField label="Send to patient" value={flag("sendToPatient", true)} onChange={set("sendToPatient")} />
          <div className="mt-4">
            <Label>Patient message template</Label>
            <TextArea height="h-20" value={str("patientTemplate")} onChange={set("patientTemplate")} />
          </div>
        </Section>
        <Section title="Dentist" last>
          <BoolField label="Send to dentist" value={flag("sendToDentist", true)} onChange={set("sendToDentist")} />
          <div className="mt-4">
            <Label>Dentist phone number</Label>
            <TextInput mono value={str("dentistPhone")} onChange={set("dentistPhone")} placeholder="+1 (512) 555-0000" />
          </div>
          <div className="mt-4">
            <Label>Dentist message template</Label>
            <TextArea height="h-20" value={str("dentistTemplate")} onChange={set("dentistTemplate")} />
          </div>
        </Section>
      </>
    );
  }

  // End Call
  return (
    <>
      <Section title="End call">
        <Label>Closing message</Label>
        <TextInput value={str("closingMessage", "You're all set! Have a wonderful day.")} onChange={set("closingMessage")} />
      </Section>
      <Section title="After call" last>
        <Label>After-call action</Label>
        <SelectBox value={str("afterCallAction", "hangup")} onChange={set("afterCallAction")} options={["hangup", "voicemail", "transfer"]} />
        <div className="mt-4">
          <BoolField label="Call recording" value={flag("callRecording", true)} onChange={set("callRecording")} />
        </div>
      </Section>
    </>
  );
}

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};
