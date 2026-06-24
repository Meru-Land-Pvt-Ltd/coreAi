import type { WorkflowRunLog } from "@/components/architect/features/types";
import { logColor } from "./run-context";
import { getCapturedLead, getDraftEmail, getGmailRead, getSentEmail, getSentSms } from "./run-context";

export function TestPanel({
  hasGmailFlow,
  gmailConnected,
  gmailEmail,
  connectingGmail,
  running,
  callerNumber,
  callerName,
  businessName,
  runLogs,
  runContext,
  onConnectGmail,
  onRunTest,
  onRunLive,
  onCallerNumberChange,
  onCallerNameChange,
  onBusinessNameChange
}: {
  hasGmailFlow: boolean;
  gmailConnected: boolean;
  gmailEmail: string | null;
  connectingGmail: boolean;
  running: boolean;
  callerNumber: string;
  callerName: string;
  businessName: string;
  runLogs: WorkflowRunLog[];
  runContext: Record<string, unknown>;
  onConnectGmail: () => void;
  onRunTest: () => void;
  onRunLive: () => void;
  onCallerNumberChange: (value: string) => void;
  onCallerNameChange: (value: string) => void;
  onBusinessNameChange: (value: string) => void;
}) {
  const sentSms = getSentSms(runContext);
  const capturedLead = getCapturedLead(runContext);
  const draftEmail = getDraftEmail(runContext);
  const sentEmail = getSentEmail(runContext);
  const gmailRead = getGmailRead(runContext);

  return (
    <section className="absolute inset-0 overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              {hasGmailFlow ? "Gmail test console" : "Twilio test console"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {hasGmailFlow
                ? "Connect Gmail, then run the agent. The default Gmail flow creates a draft safely."
                : "Use a verified recipient number when you test with a Twilio trial account."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {hasGmailFlow && !gmailConnected ? (
              <button
                type="button"
                onClick={onConnectGmail}
                disabled={connectingGmail}
                className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 shadow-sm transition hover:bg-amber-50 disabled:opacity-60"
              >
                {connectingGmail ? "Connecting..." : "Connect Gmail"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRunTest}
              disabled={running}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-60"
            >
              {running ? "Running..." : hasGmailFlow ? "Run Gmail Test" : "Dry Run"}
            </button>
            {!hasGmailFlow ? (
              <button
                type="button"
                onClick={onRunLive}
                disabled={running}
                className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
              >
                {running ? "Sending..." : "Send with Twilio"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            {hasGmailFlow ? (
              <GmailTestStatus
                gmailConnected={gmailConnected}
                gmailEmail={gmailEmail}
                connectingGmail={connectingGmail}
                onConnectGmail={onConnectGmail}
              />
            ) : (
              <TwilioInput
                callerNumber={callerNumber}
                callerName={callerName}
                businessName={businessName}
                onCallerNumberChange={onCallerNumberChange}
                onCallerNameChange={onCallerNameChange}
                onBusinessNameChange={onBusinessNameChange}
              />
            )}
          </div>

          <ResultPhone
            hasGmailFlow={hasGmailFlow}
            sentSms={sentSms}
            draftEmail={draftEmail}
            sentEmail={sentEmail}
            gmailRead={gmailRead}
          />
        </div>

        <RunLogTerminal
          hasGmailFlow={hasGmailFlow}
          runLogs={runLogs}
          capturedLead={capturedLead}
        />
      </div>
    </section>
  );
}

function GmailTestStatus({
  gmailConnected,
  gmailEmail,
  connectingGmail,
  onConnectGmail
}: {
  gmailConnected: boolean;
  gmailEmail: string | null;
  connectingGmail: boolean;
  onConnectGmail: () => void;
}) {
  return (
    <>
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Gmail connection</h3>
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
        <p className="font-black">Status</p>
        <p className="mt-1">
          {gmailConnected
            ? `Connected: ${gmailEmail ?? "Gmail"}`
            : "Gmail is not connected yet. Connect Gmail before running this flow."}
        </p>
        {!gmailConnected ? (
          <button
            type="button"
            onClick={onConnectGmail}
            disabled={connectingGmail}
            className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
          >
            {connectingGmail ? "Connecting..." : "Connect Gmail"}
          </button>
        ) : null}
      </div>
      <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-800">
        <p className="font-black">Safe Gmail test</p>
        <p className="mt-1">
          The starter Gmail flow reads one email and creates a Gmail draft. It only sends a real email if you change the final node action to Send Email.
        </p>
      </div>
    </>
  );
}

function TwilioInput({
  callerNumber,
  callerName,
  businessName,
  onCallerNumberChange,
  onCallerNameChange,
  onBusinessNameChange
}: {
  callerNumber: string;
  callerName: string;
  businessName: string;
  onCallerNumberChange: (value: string) => void;
  onCallerNameChange: (value: string) => void;
  onBusinessNameChange: (value: string) => void;
}) {
  return (
    <>
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Missed call input</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Verified recipient / caller number</span>
          <input
            value={callerNumber}
            onChange={(event) => onCallerNumberChange(event.target.value)}
            placeholder="+1XXXXXXXXXX"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Caller name optional</span>
          <input
            value={callerName}
            onChange={(event) => onCallerNameChange(event.target.value)}
            placeholder="Customer name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Business name</span>
          <input
            value={businessName}
            onChange={(event) => onBusinessNameChange(event.target.value)}
            placeholder="Your business name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
        </label>
      </div>

      <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
        <p className="font-black">Twilio trial account rule</p>
        <p className="mt-1">
          Use your Twilio trial/live credentials with your Twilio phone number. The recipient must be verified in Twilio. For Twilio test credentials, set TWILIO_TEST_MODE=true; Twilio accepts the API request but no real SMS is delivered.
        </p>
      </div>
    </>
  );
}

function ResultPhone({
  hasGmailFlow,
  sentSms,
  draftEmail,
  sentEmail,
  gmailRead
}: {
  hasGmailFlow: boolean;
  sentSms: ReturnType<typeof getSentSms>;
  draftEmail: ReturnType<typeof getDraftEmail>;
  sentEmail: ReturnType<typeof getSentEmail>;
  gmailRead: ReturnType<typeof getGmailRead>;
}) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-3 shadow-xl">
      <div className="rounded-[1.5rem] bg-white p-3">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-slate-200" />
        <p className="text-center text-xs font-bold text-slate-400">{hasGmailFlow ? "Gmail result" : "Twilio result"}</p>
        {hasGmailFlow ? (
          draftEmail || sentEmail || gmailRead ? (
            <div className="mt-5 space-y-3">
              {gmailRead ? (
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-400">Email read</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{gmailRead.subject}</p>
                  <p className="mt-1 text-xs text-slate-500">From: {gmailRead.senderEmail}</p>
                </div>
              ) : null}
              {(draftEmail ?? sentEmail) ? (
                <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-3 text-sm leading-6 text-slate-800">
                  {(draftEmail ?? sentEmail)?.body}
                </div>
              ) : null}
              {(draftEmail ?? sentEmail) ? (
                <div className="space-y-1 font-mono text-[11px] text-slate-400">
                  <p>To: {(draftEmail ?? sentEmail)?.to}</p>
                  <p>Subject: {(draftEmail ?? sentEmail)?.subject}</p>
                  <p>{draftEmail ? "Gmail draft created" : "Gmail email sent"}</p>
                  {(draftEmail ?? sentEmail)?.id ? <p>ID: {(draftEmail ?? sentEmail)?.id}</p> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
              Run the agent to see Gmail read/draft/send output returned by the backend.
            </div>
          )
        ) : sentSms ? (
          <div className="mt-5">
            <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-3 text-sm leading-6 text-slate-800">{sentSms.body}</div>
            <div className="mt-3 space-y-1 font-mono text-[11px] text-slate-400">
              <p>To: {sentSms.to}</p>
              <p>{sentSms.providerCalled ? sentSms.twilioTestMode ? "Twilio test credentials accepted request" : "Sent by Twilio" : "Dry run only"}</p>
              {sentSms.id ? <p>SID: {sentSms.id}</p> : null}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
            Run the agent to see the SMS body returned by the backend.
          </div>
        )}
      </div>
    </div>
  );
}

function RunLogTerminal({
  hasGmailFlow,
  runLogs,
  capturedLead
}: {
  hasGmailFlow: boolean;
  runLogs: WorkflowRunLog[];
  capturedLead: ReturnType<typeof getCapturedLead>;
}) {
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-2 font-mono text-xs text-slate-400">coreai {hasGmailFlow ? "gmail-reply" : "missed-call text-back"}</span>
      </div>
      <div className="min-h-[230px] space-y-2 p-4 font-mono text-xs">
        {runLogs.length > 0 ? (
          runLogs.map((log, index) => (
            <p key={`${log.nodeId}-${index}`} className={logColor(log.status)}>▶ {log.label} · {log.message}</p>
          ))
        ) : (
          <p className="text-slate-500">
            {hasGmailFlow ? "No run yet. Connect Gmail and run the Gmail test." : "No run yet. Enter test input and choose Dry Run or Send with Twilio."}
          </p>
        )}
        {capturedLead ? (
          <p className="text-blue-300">✓ Lead captured · {capturedLead.callerNumber} · {capturedLead.status}</p>
        ) : null}
      </div>
    </div>
  );
}
