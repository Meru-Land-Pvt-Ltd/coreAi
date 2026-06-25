import type { WorkflowRunLog } from "@/components/architect/features/types";
import { BuilderIcon } from "./icons";
import { logColor } from "./run-context";
import { getCalendarAppointment, getCapturedLead, getDraftEmail, getGmailRead, getSentEmail, getSentSms, getVapiCall } from "./run-context";

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
  const vapiCall = getVapiCall(runContext);
  const calendarAppointment = getCalendarAppointment(runContext);
  const hasResult = Boolean(sentSms || draftEmail || sentEmail || gmailRead || vapiCall || calendarAppointment || runLogs.length > 0);

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Test console</h2>
            <p className="mt-1 text-sm text-slate-500">
              Send a sample trigger through the workflow and watch each step run in real time.
            </p>
            {hasGmailFlow ? (
              <p className="mt-2 text-xs font-medium text-blue-600">
                {gmailConnected ? `Gmail connected: ${gmailEmail ?? "Gmail"}` : "Gmail flow selected. Connect Gmail before a live Gmail run."}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
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
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
            >
              <BuilderIcon name="play" className="h-4 w-4" />
              {running ? "Running..." : "Run test"}
            </button>
            {!hasGmailFlow ? (
              <button
                type="button"
                onClick={onRunLive}
                disabled={running}
                className="hidden rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 disabled:opacity-60 sm:block"
              >
                Send live
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Simulate a missed call</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Caller number</span>
              <input
                type="text"
                value={callerNumber}
                onChange={(event) => onCallerNumberChange(event.target.value)}
                placeholder="+1 (415) 555-0132"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Caller name</span>
              <input
                type="text"
                value={callerName}
                onChange={(event) => onCallerNameChange(event.target.value)}
                placeholder="Jordan Lee"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Time of call</span>
              <input
                type="text"
                value="Today - 2:14 PM"
                readOnly
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Business</span>
              <input
                type="text"
                value={businessName}
                onChange={(event) => onBusinessNameChange(event.target.value)}
                placeholder="Mitchell Dental"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl bg-slate-900 shadow-sm ring-1 ring-slate-900/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="ml-2 font-mono text-xs text-slate-400">execution.log</span>
          </div>
          <div className="min-h-[190px] space-y-1.5 p-4 font-mono text-xs leading-relaxed text-slate-300">
            {runLogs.length > 0 ? (
              runLogs.map((log, index) => (
                <p key={`${log.nodeId}-${index}`} className={logColor(log.status)}>
                  $ {log.label} - {log.message}
                </p>
              ))
            ) : (
              <p className="text-slate-500">$ Awaiting run - press "Run test" to execute the workflow...</p>
            )}
            {capturedLead ? <p className="text-blue-300">$ Lead captured - {capturedLead.callerNumber} - {capturedLead.status}</p> : null}
          </div>
        </div>

        {hasResult ? (
          <div className="mt-6">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
              {hasGmailFlow ? "Email result" : "Message the patient receives"}
            </h3>
            <div className="flex items-start gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600">
                <BuilderIcon name={hasGmailFlow ? "mail" : "message"} className="h-5 w-5" />
              </div>
              <div className="flex-1">
                {hasGmailFlow ? (
                  <EmailResult draftEmail={draftEmail} sentEmail={sentEmail} gmailRead={gmailRead} />
                ) : (
                  <>
                    <div className="inline-block max-w-md rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
                      {sentSms?.body ?? "Hi! We noticed we missed your call at Mitchell Dental. Sorry about that! Would you like to schedule an appointment? Reply YES and we will get you booked."}
                    </div>
                    <p className="mt-2 font-mono text-xs text-slate-400">
                      {sentSms?.providerCalled ? (sentSms.twilioTestMode ? "Twilio test accepted" : "Delivered") : "Dry run"} - {sentSms?.body?.length ?? 142} characters - est. cost $0.15
                    </p>
                    {vapiCall ? <p className="mt-2 font-mono text-xs text-violet-500">Vapi voice: {vapiCall.providerCalled ? "Started" : "Dry run"} {vapiCall.status ? `- ${vapiCall.status}` : ""}</p> : null}
                    {calendarAppointment ? <p className="mt-2 font-mono text-xs text-blue-500">Calendar: {calendarAppointment.id ? "Booked" : "Dry run"} - {calendarAppointment.summary}</p> : null}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EmailResult({
  draftEmail,
  sentEmail,
  gmailRead
}: {
  draftEmail: ReturnType<typeof getDraftEmail>;
  sentEmail: ReturnType<typeof getSentEmail>;
  gmailRead: ReturnType<typeof getGmailRead>;
}) {
  if (sentEmail) {
    return (
      <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
        <p className="font-bold">Sent: {sentEmail.subject}</p>
        <p className="mt-1 text-xs text-slate-500">To: {sentEmail.to}</p>
        <p className="mt-2">{sentEmail.body}</p>
      </div>
    );
  }
  if (draftEmail) {
    return (
      <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
        <p className="font-bold">Draft: {draftEmail.subject}</p>
        <p className="mt-1 text-xs text-slate-500">To: {draftEmail.to}</p>
        <p className="mt-2">{draftEmail.body}</p>
      </div>
    );
  }
  if (gmailRead) {
    return (
      <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
        <p className="font-bold">Read: {gmailRead.subject}</p>
        <p className="mt-1 text-xs text-slate-500">From: {gmailRead.senderEmail}</p>
        <p className="mt-2">{gmailRead.body}</p>
      </div>
    );
  }
  return <p className="text-sm text-slate-500">Run the agent to see the email result.</p>;
}
