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
  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center sm:p-5">
        <div>
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
            <BuilderIcon name="message" className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-sm font-black text-slate-900">Select a node</h3>
          <p className="mt-1 text-sm text-slate-500">Click any canvas card to edit its settings.</p>
        </div>
      </div>
    );
  }

  function switchConnector(connector: string) {
    if (connector === "Gmail") {
      onUpdateNodeData("connector", "Gmail");
      onUpdateNodeData("connectorAction", "read_emails");
      onUpdateNodeData("kind", "GMAIL");
      onUpdateNodeData("icon", "mail");
      onUpdateNodeData("accent", "blue");
      return;
    }

    onUpdateNodeData("connector", "SMS");
    onUpdateNodeData("connectorAction", "send_sms");
    onUpdateNodeData("kind", "ACTION");
    onUpdateNodeData("icon", "message");
    onUpdateNodeData("accent", "green");
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Properties</p>
          <h3 className="mt-1 text-lg font-black text-slate-900">{selectedNode.data.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
        >
          ×
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Name</span>
          <input
            value={selectedNode.data.title}
            onChange={(event) => onUpdateNodeData("title", event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Description</span>
          <input
            value={selectedNode.data.subtitle ?? ""}
            onChange={(event) => onUpdateNodeData("subtitle", event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
        </label>

        {selectedNode.data.nodeKind === "ai" ? (
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt</span>
            <textarea
              value={selectedNode.data.prompt ?? ""}
              onChange={(event) => onUpdateNodeData("prompt", event.target.value)}
              className="min-h-36 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
        ) : null}

        {selectedNode.data.nodeKind === "condition" ? (
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Condition</span>
            <input
              value={selectedNode.data.condition ?? ""}
              onChange={(event) => onUpdateNodeData("condition", event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
        ) : null}

        {selectedNode.data.nodeKind === "connector" ? (
          <div className="space-y-4 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Connector</span>
              <select
                value={selectedNode.data.connector ?? "SMS"}
                onChange={(event) => switchConnector(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              >
                <option value="SMS">SMS / Twilio</option>
                <option value="Gmail">Gmail</option>
              </select>
            </label>

            {selectedNode.data.connector === "Gmail" ? (
              <GmailFields selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
            ) : (
              <SmsFields selectedNode={selectedNode} onUpdateNodeData={onUpdateNodeData} />
            )}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onDeleteNode}
          className="w-full rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-100"
        >
          Delete Node
        </button>
      </div>
    </div>
  );
}

function GmailFields({
  selectedNode,
  onUpdateNodeData
}: {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Gmail Action</span>
        <select
          value={selectedNode.data.connectorAction ?? "read_emails"}
          onChange={(event) => onUpdateNodeData("connectorAction", event.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
        >
          <option value="read_emails">Read Emails</option>
          <option value="draft_reply">Create Draft</option>
          <option value="send_email">Send Email</option>
        </select>
      </label>

      {selectedNode.data.connectorAction === "read_emails" ? (
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Search Query</span>
          <input
            value={selectedNode.data.gmailQuery ?? ""}
            onChange={(event) => onUpdateNodeData("gmailQuery", event.target.value)}
            placeholder="newer_than:7d"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
        </label>
      ) : (
        <>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">To</span>
            <input
              value={selectedNode.data.gmailTo ?? ""}
              onChange={(event) => onUpdateNodeData("gmailTo", event.target.value)}
              placeholder="{{gmail.senderEmail}}"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Subject</span>
            <input
              value={selectedNode.data.gmailSubject ?? ""}
              onChange={(event) => onUpdateNodeData("gmailSubject", event.target.value)}
              placeholder="Re: {{gmail.subject}}"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Body</span>
            <textarea
              value={selectedNode.data.gmailBody ?? ""}
              onChange={(event) => onUpdateNodeData("gmailBody", event.target.value)}
              placeholder="{{ai.output}}"
              className="min-h-32 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
        </>
      )}
    </>
  );
}

function SmsFields({
  selectedNode,
  onUpdateNodeData
}: {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Action</span>
        <select
          value={selectedNode.data.connectorAction ?? "send_sms"}
          onChange={(event) => onUpdateNodeData("connectorAction", event.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
        >
          <option value="send_sms">Send SMS Now</option>
          <option value="queue_sms">Queue SMS</option>
          <option value="capture_lead">Capture Lead</option>
        </select>
      </label>

      {selectedNode.data.connectorAction !== "capture_lead" ? (
        <>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">To</span>
            <input
              value={selectedNode.data.smsTo ?? ""}
              onChange={(event) => onUpdateNodeData("smsTo", event.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Message</span>
            <textarea
              value={selectedNode.data.smsBody ?? ""}
              onChange={(event) => onUpdateNodeData("smsBody", event.target.value)}
              className="min-h-32 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            />
          </label>
          {selectedNode.data.connectorAction === "queue_sms" ? (
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Send At</span>
              <input
                value={selectedNode.data.sendAt ?? ""}
                onChange={(event) => onUpdateNodeData("sendAt", event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
          ) : null}
        </>
      ) : (
        <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-700">
          This step records the caller as a captured lead after the text-back runs.
        </p>
      )}
    </>
  );
}
