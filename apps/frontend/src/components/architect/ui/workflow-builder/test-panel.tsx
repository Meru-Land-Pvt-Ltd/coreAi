import type {
  ArchitectConversationMessage,
  ArchitectConversationToolCall,
  ArchitectTestDeploymentStatus,
  ArchitectVapiBrowserTestSession,
  WorkflowRunLog
} from "@/components/architect/features/types";
import type { AIAttachment } from "./types";
import { BuilderIcon } from "./icons";
import { logColor } from "./run-context";
import { getCalendarAppointment, getCapturedLead, getDraftEmail, getGmailRead, getSentEmail, getSentSms, getVapiCall } from "./run-context";
import { BrowserVoiceCallTest } from "./browser-voice-call-test";
import { marked } from "marked";

function Markdown({ content, className = "" }: { content: string; className?: string }) {
  const html = typeof content === "string" ? (marked.parse(content, { breaks: true, gfm: true }) as string) : "";
  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function TestPanel({
  hasGmailFlow,
  isVoiceWorkflow,
  isDentalWorkflow,
  gmailConnected,
  gmailEmail,
  calendarConnected,
  connectingGmail,
  running,
  startingLive,
  stoppingLive,
  callerNumber,
  callerName,
  businessName,
  businessType,
  calendarId,
  timeZone,
  appointmentService,
  testDeployment,
  runLogs,
  runContext,
  conversationMessages,
  conversationLogs,
  conversationToolCalls,
  chatting,
  triggerMessage,
  triggerAttachments,
  isManualTriggerWorkflow = false,
  onConnectGmail,
  onDisconnectGoogle,
  onRefreshConnections,
  onRunTest,
  onStartLiveTest,
  onStopLiveTest,
  onStartVapiCall,
  onSendConversationMessage,
  onResetConversationTest,
  onCallerNumberChange,
  onCallerNameChange,
  onBusinessNameChange,
  onBusinessTypeChange,
  onCalendarIdChange,
  onTimeZoneChange,
  onAppointmentServiceChange,
  onTriggerMessageChange,
  onTriggerAttachmentsChange
}: {
  hasGmailFlow: boolean;
  isVoiceWorkflow: boolean;
  isDentalWorkflow: boolean;
  gmailConnected: boolean;
  gmailEmail: string | null;
  calendarConnected: boolean;
  connectingGmail: boolean;
  running: boolean;
  startingLive: boolean;
  stoppingLive: boolean;
  callerNumber: string;
  callerName: string;
  businessName: string;
  businessType: string;
  calendarId: string;
  timeZone: string;
  appointmentService: string;
  testDeployment: ArchitectTestDeploymentStatus | null;
  runLogs: WorkflowRunLog[];
  runContext: Record<string, unknown>;
  conversationMessages: ArchitectConversationMessage[];
  conversationLogs: WorkflowRunLog[];
  conversationToolCalls: ArchitectConversationToolCall[];
  chatting: boolean;
  triggerMessage: string;
  triggerAttachments: AIAttachment[];
  isManualTriggerWorkflow?: boolean;
  onConnectGmail: () => void;
  onDisconnectGoogle: () => void;
  onRefreshConnections: () => void;
  onRunTest: () => void;
  onStartLiveTest: () => void;
  onStopLiveTest: () => void;
  onStartVapiCall: () => Promise<ArchitectVapiBrowserTestSession | { error: string }>;
  onSendConversationMessage: (value: string) => Promise<string | null>;
  onResetConversationTest: () => void;
  onCallerNumberChange: (value: string) => void;
  onCallerNameChange: (value: string) => void;
  onBusinessNameChange: (value: string) => void;
  onBusinessTypeChange: (value: string) => void;
  onCalendarIdChange: (value: string) => void;
  onTimeZoneChange: (value: string) => void;
  onAppointmentServiceChange: (value: string) => void;
  onTriggerMessageChange: (value: string) => void;
  onTriggerAttachmentsChange: (value: AIAttachment[]) => void;
}) {

  const sentSms = getSentSms(runContext);
  const capturedLead = getCapturedLead(runContext);
  const draftEmail = getDraftEmail(runContext);
  const sentEmail = getSentEmail(runContext);
  const gmailRead = getGmailRead(runContext);
  const vapiCall = getVapiCall(runContext);
  const calendarAppointment = getCalendarAppointment(runContext);

  // Voice booking workflow results (set by the runner from node capabilities).
  const voiceConversation = runContext.voiceConversation as
    | { firstMessage?: string; practiceName?: string; doctorName?: string; voice?: string; model?: string }
    | undefined;
  const calendarAvailability = runContext.calendarAvailability as
    | { slots?: string[]; source?: string; calendar_status?: string; date?: string }
    | undefined;
  const smsNotification = runContext.smsNotification as
    | { sendToPatient?: boolean; sendToDentist?: boolean }
    | undefined;
  const hasVoiceResult = Boolean(voiceConversation || calendarAvailability || smsNotification);

  const hasLlmPipeline = Boolean(
    runContext.llmPipeline &&
    typeof runContext.llmPipeline === "object" &&
    Object.keys(runContext.llmPipeline).length > 0
  );

  const hasResult = Boolean(
    sentSms || draftEmail || sentEmail || gmailRead || vapiCall || calendarAppointment || hasVoiceResult || hasLlmPipeline || runLogs.length > 0
  );

  const sandboxReady = testDeployment?.status === "READY";
  const heading = isDentalWorkflow
    ? "Dental AI Receptionist test"
    : isVoiceWorkflow
      ? "Test AI Voice Agent"
      : "Test console";
  const subtitle = isVoiceWorkflow
    ? "Test the AI in browser first. No call, SMS, or real calendar event is created. Live sandbox can be used later."
    : "Send a sample trigger through the workflow and watch each step run in real time.";

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-test-panel-console-heading">{heading}</h2>
            <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-send-a-sample-trigger-through-the-workflow-text">
              {subtitle}
            </p>
            {hasGmailFlow ? (
              <p className="mt-2 text-xs font-medium text-blue-600" data-testid="architect-ui-workflow-builder-test-panel-gmail-connected-gmail-connected-gmail-email-gmail-text">
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
                data-testid="test-connect-gmail"
                className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 shadow-sm transition hover:bg-amber-50 disabled:opacity-60"
              >
                {connectingGmail ? "Connecting..." : "Connect Gmail"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRunTest}
              disabled={running}
              data-testid="test-run"
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
            >
              <BuilderIcon name="play" className="h-4 w-4" />
              {running ? "Running..." : "Run dry test"}
            </button>
            {false && isVoiceWorkflow ? (
              sandboxReady ? (
                <button
                  type="button"
                  onClick={onStopLiveTest}
                  disabled={stoppingLive}
                  data-testid="builder-test-stop-live"
                  className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:opacity-60"
                >
                  {stoppingLive ? "Stopping..." : "Stop sandbox"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartLiveTest}
                  disabled={startingLive}
                  data-testid="builder-test-start-live"
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <BuilderIcon name="phone-call" className="h-4 w-4" />
                  {startingLive ? "Starting..." : "Start live test"}
                </button>
              )
            ) : null}
          </div>
        </div>

        {sandboxReady ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm" data-testid="builder-test-live-sandbox-ready">
            <p className="text-sm font-bold text-emerald-800" data-testid="builder-test-live-sandbox-ready-title">Live sandbox ready</p>
            <p className="mt-1 text-sm text-emerald-700" data-testid="architect-ui-workflow-builder-test-panel-call-this-number-to-test-text">Call this number to test:</p>
            <p className="mt-1 font-mono text-2xl font-black text-emerald-900" data-testid="builder-test-live-sandbox-number">
              {testDeployment?.assignedPhoneNumber}
            </p>
            <ul className="mt-3 space-y-1 text-xs font-semibold text-emerald-700">
              <li data-testid="builder-test-live-vapi-status">✓ Vapi assistant created</li>
              <li data-testid="builder-test-live-webhook-status">✓ Twilio webhook active</li>
              <li data-testid="builder-test-live-calendar-status">
                {testDeployment?.calendarConnected ? "✓ Google Calendar connected" : "✗ Google Calendar not connected"}
              </li>
            </ul>
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-simulate-a-missed-call-heading">
            {isVoiceWorkflow ? "Simulate an inbound call" : "Simulate a customer event"}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isManualTriggerWorkflow && (
              <>
                <label data-testid="architect-ui-workflow-builder-test-panel-caller-number-on-caller-number-change-event-label">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-caller-number-text">
                    {isVoiceWorkflow ? "Caller phone" : "Caller number"}
                  </span>
                  <input data-testid="builder-test-caller-number-input"
                    type="text"
                    value={callerNumber}
                    onChange={(event) => onCallerNumberChange(event.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                  />
                </label>
                <label data-testid="architect-ui-workflow-builder-test-panel-caller-on-caller-change-event-placeholder-jordan-label">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-caller-text">Caller name</span>
                  <input data-testid="builder-test-caller-name-input"
                    type="text"
                    value={callerName}
                    onChange={(event) => onCallerNameChange(event.target.value)}
                    placeholder={isVoiceWorkflow ? "Test Customer" : "Jordan Lee"}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                  />
                </label>
                {isVoiceWorkflow ? (
                  <label data-testid="builder-test-business-type-label">
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Business type</span>
                    <input data-testid="builder-test-business-type-input"
                      type="text"
                      value={businessType}
                      onChange={(event) => onBusinessTypeChange(event.target.value)}
                      placeholder="Service Business"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                    />
                  </label>
                ) : (
                  <label data-testid="architect-ui-workflow-builder-test-panel-time-of-call-label">
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-time-of-call-text">Time of call</span>
                    <input data-testid="builder-test-message-input"
                      type="text"
                      value="Today - 2:14 PM"
                      readOnly
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                    />
                  </label>
                )}
              </>
            )}
            {isManualTriggerWorkflow && (
              <>
                <label className="col-span-1 sm:col-span-2">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Trigger message / Text input</span>
                  <textarea
                    value={triggerMessage}
                    onChange={(event) => onTriggerMessageChange(event.target.value)}
                    placeholder="Type or paste text content (e.g. resume content or SMS text) to trigger the workflow..."
                    className="w-full h-24 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                  />
                </label>
                <div className="col-span-1 sm:col-span-2">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Trigger attachments</span>
                  {triggerAttachments.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {triggerAttachments.map((att, idx) => {
                        const isImage = att.mimeType.startsWith("image/");
                        const isPdf = att.mimeType === "application/pdf";
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2.5"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="flex h-8 w-8 shrink-0 place-items-center justify-center rounded-lg bg-white border border-slate-100 text-sm shadow-sm">
                                {isImage ? "🖼️" : isPdf ? "📄" : "📁"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-700 leading-tight">
                                  {att.name || `attachment-${idx + 1}`}
                                </p>
                                <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate uppercase">
                                  {att.mimeType}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                onTriggerAttachmentsChange(triggerAttachments.filter((_, i) => i !== idx));
                              }}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-red-500 transition-colors"
                              aria-label="Remove attachment"
                            >
                              <BuilderIcon name="x" className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer bg-slate-50/40 hover:bg-amber-50/20 hover:border-amber-300 transition-all duration-200 group">
                    <div className="flex flex-col items-center justify-center pt-2 pb-3">
                      <p className="text-[11px] font-semibold text-slate-500 group-hover:text-amber-600 transition-colors">
                        Click to add trigger file attachment (e.g. resume PDF)
                      </p>
                      <p className="text-[9px] text-slate-400 mt-1">
                        Supports Images, PDFs, Docs (Max 5MB)
                      </p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          alert("File is too large. Maximum size is 5MB.");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const base64Data = event.target?.result as string;
                          onTriggerAttachmentsChange([
                            ...triggerAttachments,
                            {
                              name: file.name,
                              mimeType: file.type || "application/octet-stream",
                              data: base64Data,
                            }
                          ]);
                        };
                        reader.readAsDataURL(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </>
            )}
            {!isManualTriggerWorkflow && (
              <>
                <label data-testid="architect-ui-workflow-builder-test-panel-business-on-business-change-event-placeholder-mitchell">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-business-text">
                    {isVoiceWorkflow ? "Test business" : "Business"}
                  </span>
                  <input data-testid="builder-test-business-name-input"
                    type="text"
                    value={businessName}
                    onChange={(event) => onBusinessNameChange(event.target.value)}
                    placeholder={isVoiceWorkflow ? "Sample Business" : "Your business name"}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                  />
                </label>
                {isVoiceWorkflow ? (
                  <>
                    <label data-testid="builder-test-appointment-service-label">
                      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Appointment service</span>
                      <input data-testid="builder-test-appointment-service-input"
                        type="text"
                        value={appointmentService}
                        onChange={(event) => onAppointmentServiceChange(event.target.value)}
                        placeholder="General Consultation"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                      />
                    </label>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        {isVoiceWorkflow || hasGmailFlow ? (
          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" data-testid="builder-test-connections">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-architect-test-connections-heading">Architect test connections</h3>
              <button
                type="button"
                onClick={onRefreshConnections}
                data-testid="builder-test-refresh-status"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
              >
                Refresh status
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4" data-testid="builder-test-google-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Gmail / Google account</p>
                <p className="mt-1 text-sm font-semibold text-slate-800" data-testid="builder-test-google-status">
                  {gmailConnected ? `Google connected: ${gmailEmail ?? "connected"}` : "Not connected"}
                </p>
                <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-calendar-permission">
                  Calendar permission: {calendarConnected ? "connected" : "missing"}
                </p>
                {gmailConnected && !calendarConnected ? (
                  <p className="mt-1 text-xs font-semibold text-amber-700" data-testid="builder-test-calendar-reconnect-hint">
                    Reconnect Google to grant Calendar permission.
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={onConnectGmail}
                    disabled={connectingGmail}
                    data-testid="builder-test-connect-google"
                    className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"
                  >
                    {connectingGmail ? "Connecting..." : gmailConnected ? "Reconnect Google" : "Connect Google"}
                  </button>
                  {gmailConnected ? (
                    <button
                      type="button"
                      onClick={onDisconnectGoogle}
                      data-testid="builder-test-disconnect-google"
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
                    >
                      Disconnect Google
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4" data-testid="builder-test-calendar-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Google Calendar</p>
                <p className="mt-1 text-sm font-semibold text-slate-800" data-testid="builder-test-calendar-status-text">
                  {calendarConnected ? "Connected" : "Missing permission"}
                </p>
                <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-calendar-id-text">Calendar ID: {calendarId || "primary"}</p>
                <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-calendar-timezone-text">Timezone: {timeZone || "America/Los_Angeles"}</p>
              </div>
              {isVoiceWorkflow ? (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4" data-testid="builder-test-twilio-card">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Twilio test number</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-slate-800" data-testid="builder-test-twilio-number">
                    {testDeployment?.assignedPhoneNumber ?? "Assigned when the live sandbox starts"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-twilio-note">
                    Browser call test does not use phone numbers. Live sandbox can be enabled later.
                  </p>
                </div>
              ) : null}
              {isVoiceWorkflow ? (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4" data-testid="builder-test-vapi-card">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Vapi assistant</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800" data-testid="builder-test-vapi-status">
                    {testDeployment?.vapiAssistantId ? "Assistant ready" : "Not required for browser call test"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-vapi-note">
                    The sandbox uses its own assistant for this workflow — no shared production assistant.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isVoiceWorkflow ? (
          <BrowserVoiceCallTest
            conversationMessages={conversationMessages}
            chatting={chatting}
            businessName={businessName}
            businessType={businessType}
            callerName={callerName}
            appointmentService={appointmentService}
            onStartVapiCall={onStartVapiCall}
            onSendConversationMessage={onSendConversationMessage}
            onResetConversationTest={onResetConversationTest}
          />
        ) : null}

        <div className="mt-6 overflow-hidden rounded-2xl bg-slate-900 shadow-sm ring-1 ring-slate-900/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="ml-2 font-mono text-xs text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-execution-log-text-4">execution.log</span>
          </div>
          <div className="min-h-[190px] space-y-1.5 p-4 font-mono text-xs leading-relaxed text-slate-300">
            {runLogs.length > 0 ? (
              runLogs.map((log, index) => (
                <p key={`${log.nodeId}-${index}`} className={logColor(log.status)} data-testid="architect-ui-workflow-builder-test-panel-log-label-log-message-text">
                  $ {log.label} - {log.message}
                </p>
              ))
            ) : (
              <p className="text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-awaiting-run-press-run-to-execute-the-text">$ Awaiting run - press "Run dry test" to execute the workflow...</p>
            )}
            {capturedLead ? <p className="text-blue-300" data-testid="architect-ui-workflow-builder-test-panel-lead-captured-lead-caller-number-captured-lead-text">$ Lead captured - {capturedLead.callerNumber} - {capturedLead.status}</p> : null}
          </div>
        </div>

        {hasResult ? (
          <div className="mt-6">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-has-gmail-flow-email-result-message-the-heading">
              {hasLlmPipeline ? "LLM Pipeline Results" : hasVoiceResult ? "Voice booking result" : hasGmailFlow ? "Email result" : "Message preview"}
            </h3>
            <div className="flex items-start gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${hasLlmPipeline ? "bg-violet-50 text-violet-600" : "bg-green-50 text-green-600"}`}>
                <BuilderIcon name={hasLlmPipeline ? "sparkles" : hasVoiceResult ? "phone-call" : hasGmailFlow ? "mail" : "message"} className="h-5 w-5" />
              </div>
              <div className="flex-1">
                {hasLlmPipeline ? (
                  <div className="space-y-4" data-testid="test-panel-llm-pipeline-results">
                    <div>
                      {Object.values(runContext.llmPipeline as Record<string, any>).map((step, idx) => (
                        <div key={idx} className="mb-3 last:mb-0 rounded-xl border border-violet-100 bg-violet-50/10 p-4">
                          <div className="flex items-center justify-between border-b border-violet-100 pb-2">
                            <span className="text-xs font-bold text-violet-950">{step.label || "LLM Step"}</span>
                            <span className="font-mono text-[10px] text-violet-500 bg-violet-50 px-2 py-0.5 rounded">
                              {step.providerId} ({step.modelName})
                            </span>
                          </div>
                          <div className="mt-2 text-sm leading-relaxed text-slate-700">
                            <Markdown content={step.output} />
                          </div>
                          <p className="mt-2 font-mono text-[9px] text-slate-400">Variable: <code className="text-violet-600 font-bold">{step.outputKey}</code></p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : hasVoiceResult ? (
                  <div className="space-y-2" data-testid="test-panel-voice-result">
                    {voiceConversation ? (
                      <div data-testid="test-panel-voice-conversation-preview">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">Voice conversation preview</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-slate-700">&ldquo;{voiceConversation.firstMessage}&rdquo;</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">
                          {[voiceConversation.practiceName, voiceConversation.doctorName].filter(Boolean).join(" · ")}
                          {voiceConversation.voice ? ` · ${voiceConversation.voice}/${voiceConversation.model}` : ""}
                        </p>
                      </div>
                    ) : null}
                    {calendarAvailability ? (
                      <p className="font-mono text-xs text-blue-500" data-testid="test-panel-calendar-result">
                        Calendar result: {calendarAvailability.source === "calendar" ? "checked Google Calendar" : "demo slots"}
                        {calendarAvailability.slots?.length ? ` — ${calendarAvailability.slots.join(", ")}` : ""}
                        {calendarAvailability.calendar_status ? ` (${calendarAvailability.calendar_status})` : ""}
                      </p>
                    ) : null}
                    {calendarAppointment ? (
                      <p className="font-mono text-xs text-blue-500" data-testid="test-panel-appointment-result">
                        Appointment result: {calendarAppointment.id ? "booked" : "would be created (dry run)"} — {calendarAppointment.summary}
                      </p>
                    ) : null}
                    {smsNotification ? (
                      <p className="font-mono text-xs text-green-500" data-testid="test-panel-sms-notification-result">
                        SMS notification result: dry run — {[smsNotification.sendToPatient ? "customer" : null, smsNotification.sendToDentist ? "team" : null].filter(Boolean).join(" + ") || "no recipients"}
                      </p>
                    ) : null}
                  </div>
                ) : hasGmailFlow ? (
                  <EmailResult draftEmail={draftEmail} sentEmail={sentEmail} gmailRead={gmailRead} />
                ) : (
                  <>
                    <div className="inline-block max-w-md rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
                      {sentSms?.body ? (
                        <Markdown content={sentSms.body} />
                      ) : (
                        "Run a test to preview the outgoing message."
                      )}
                    </div>
                    <p className="mt-2 font-mono text-xs text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-sent-sms-provider-called-sent-sms-twilio-text">
                      {sentSms?.providerCalled ? (sentSms.twilioTestMode ? "Twilio test accepted" : "Delivered") : "Dry run"} - {sentSms?.body?.length ?? 142} characters - est. cost $0.15
                    </p>
                    {vapiCall ? <p className="mt-2 font-mono text-xs text-violet-500" data-testid="architect-ui-workflow-builder-test-panel-vapi-voice-vapi-call-provider-called-started-text">Vapi voice: {vapiCall.providerCalled ? "Started" : "Dry run"} {vapiCall.status ? `- ${vapiCall.status}` : ""}</p> : null}
                    {calendarAppointment ? <p className="mt-2 font-mono text-xs text-blue-500" data-testid="architect-ui-workflow-builder-test-panel-calendar-appointment-booked-dry-run-calendar-appointmen">Calendar: {calendarAppointment.id ? "Booked" : "Dry run"} - {calendarAppointment.summary}</p> : null}
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
        <p className="font-bold" data-testid="architect-ui-workflow-builder-test-panel-sent-email-subject-text">Sent: {sentEmail.subject}</p>
        <p className="mt-1 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-to-sent-email-to-text">To: {sentEmail.to}</p>
        <div className="mt-2" data-testid="architect-ui-workflow-builder-test-panel-sent-email-body-text">
          <Markdown content={sentEmail.body} />
        </div>
      </div>
    );
  }
  if (draftEmail) {
    return (
      <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
        <p className="font-bold" data-testid="architect-ui-workflow-builder-test-panel-draft-email-subject-text">Draft: {draftEmail.subject}</p>
        <p className="mt-1 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-to-draft-email-to-text">To: {draftEmail.to}</p>
        <div className="mt-2" data-testid="architect-ui-workflow-builder-test-panel-draft-email-body-text">
          <Markdown content={draftEmail.body} />
        </div>
      </div>
    );
  }
  if (gmailRead) {
    return (
      <div className="rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
        <p className="font-bold" data-testid="architect-ui-workflow-builder-test-panel-read-gmail-read-subject-text">Read: {gmailRead.subject}</p>
        <p className="mt-1 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-from-gmail-read-sender-email-text">From: {gmailRead.senderEmail}</p>
        <div className="mt-2" data-testid="architect-ui-workflow-builder-test-panel-gmail-read-body-text">
          <Markdown content={gmailRead.body} />
        </div>
      </div>
    );
  }
  return <p className="text-sm text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-run-the-agent-to-see-the-email-text">Run the agent to see the email result.</p>;
}
