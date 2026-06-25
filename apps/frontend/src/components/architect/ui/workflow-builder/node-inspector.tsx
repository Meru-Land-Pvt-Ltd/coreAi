import type { CSSProperties, ReactNode } from "react";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData } from "./types";

export function NodeInspector({
  selectedNode,
  onClearSelection,
  onUpdateNodeData,
  onDeleteNode
}: {
  selectedNode: BuilderNode | null;
  onClearSelection: () => void;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
  onDeleteNode: () => void;
}) {
  if (!selectedNode) return <EmptyProperties />;

  return (
    <div className="h-full overflow-y-auto bg-white scroll-thin">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <BuilderIcon name={selectedNode.data.icon} className="h-4 w-4 text-amber-600" />
          <span className="font-bold text-slate-900">Node properties</span>
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          aria-label="Deselect node"
        >
          <BuilderIcon name="x" className="h-4 w-4" />
        </button>
      </div>

      {selectedNode.data.nodeKind === "trigger" ? (
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
        <h3 className="font-bold text-slate-900">Select a node</h3>
        <p className="mx-auto mt-1 max-w-[200px] text-xs text-slate-400">
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
      {title ? <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h3> : null}
      {children}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</span>;
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
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${height} ${mono ? "font-mono text-xs leading-relaxed" : ""} w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50`}
    />
  );
}

function SelectBox({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <div className="relative">
      <select
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
        <span key={item} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-[11px] text-slate-600">
          {item}
        </span>
      ))}
    </div>
  );
}

function Toggle({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600">{label}</span>
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
          <div className="mb-1 flex items-center justify-between"><label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Temperature</label></div>
          <div className="relative pt-6">
            <div className="absolute top-0 -translate-x-1/2 rounded-md bg-amber-500 px-1.5 py-0.5 font-mono text-[10px] text-white shadow" style={{ left: "70%" }}>0.7</div>
            <input type="range" min="0" max="1" step="0.1" defaultValue="0.7" className="slider w-full" style={{ "--p": "70%" } as CSSProperties} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-400"><span>0.0 - precise</span><span>1.0 - creative</span></div>
        </div>
        <div className="mt-4">
          <Label>System prompt</Label>
          <TextArea value={prompt} onChange={(value) => onUpdateNodeData("prompt", value)} height="h-[134px]" mono />
        </div>
        <div className="mt-4">
          <Label>Max tokens</Label>
          <input defaultValue="200" className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50" />
        </div>
      </Section>
      <Section title="Input mapping">
        <Label>Variables available</Label>
        <Pills items={["{caller_number}", "{caller_name}", "{timestamp}", "{business_name}"]} />
      </Section>
      <Section title="Test output" last>
        <p className="text-xs text-slate-400">Last test result</p>
        <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm leading-relaxed text-slate-700">Hi! We noticed we missed your call at Mitchell Dental. Sorry about that! Would you like to schedule an appointment? Reply YES and we will get you booked.</p>
        </div>
        <p className="mt-2 font-mono text-xs text-slate-400">Generated in 1.2s</p>
      </Section>
    </>
  );
}

function ConditionProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const day = (label: string, on = true) => (
    <span className={on ? "rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700" : "rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-slate-400"}>{label}</span>
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
          <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-green-500" /><span className="font-medium text-slate-700">Yes</span><span className="text-slate-400">Send SMS Now</span></div>
          <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-red-500" /><span className="font-medium text-slate-700">No</span><span className="text-slate-400">Queue for Morning</span></div>
        </div>
      </Section>
    </>
  );
}

function ConnectorProps({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const isGmail = selectedNode.data.connector === "Gmail";
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
      <Section title={isGmail ? "Gmail action" : "Message"}>
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
        ) : (
          <>
            <Label>Send to</Label>
            <TextInput mono value={selectedNode.data.smsTo ?? "{caller_number}"} onChange={(value) => onUpdateNodeData("smsTo", value)} />
            <div className="mt-4">
              <Label>Message body</Label>
              <TextArea value={selectedNode.data.smsBody ?? "{message_text}"} onChange={(value) => onUpdateNodeData("smsBody", value)} height="h-[88px]" />
              <p className="mt-1 text-[11px] text-slate-400">Uses the AI-generated text from the previous step.</p>
            </div>
          </>
        )}
      </Section>
      <Section title="Delivery" last>
        <Label>Provider</Label>
        <SelectBox value={isGmail ? "Gmail" : "Twilio"} onChange={() => undefined} options={isGmail ? ["Gmail"] : ["Twilio", "MessageBird", "Vonage", "Telnyx"]} />
        <div className="mt-4"><Toggle label={isGmail ? "Create safe draft first" : "Send immediately"} /></div>
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
        <p className="text-sm leading-relaxed text-slate-500">Configure how this {selectedNode.data.kind.toLowerCase()} step behaves. Drag from its ports to connect it to the rest of your workflow.</p>
      </Section>
    </>
  );
}

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};
