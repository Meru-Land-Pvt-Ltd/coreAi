import { COMMON_TIMEZONES, describeZonedTime, isValidTimeZone } from "@coreai/shared";
import type {
  ArchitectConversationMessage,
  ArchitectConversationToolCall,
  ArchitectTestCalendarEvent,
  ArchitectTestDeploymentStatus,
  ArchitectVapiBrowserTestSession,
  WorkflowRunLog
} from "@/components/architect/features/types";
import type { AIAttachment } from "./types";
import { BuilderIcon } from "./icons";
import { logColor } from "./run-context";
import { getCalendarAppointment, getCapturedLead, getDraftEmail, getGmailRead, getSentEmail, getSentSms, getVapiCall } from "./run-context";
import { BrowserVoiceCallTest } from "./browser-voice-call-test";
import { InfoTooltip } from "@/components/business/setup/InfoTooltip";
// Temporarily hidden — WhatsApp feature paused
// import { WhatsAppIcon } from "@/components/architect/features/whatsapp/WhatsAppIcon";
import { marked } from "marked";

function Markdown({ content, className = "" }: { content: string; className?: string }) {
  const html = typeof content === "string" ? (marked.parse(content, { breaks: true, gfm: true }) as string) : "";
  return (
    <div
      className={`markdown-content min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function TestPanel({
  hasGmailFlow,
  hasEmailNode = false,
  isVoiceWorkflow,
  isDentalWorkflow,
  needsAnyTestConnection = false,
  needsGoogleConnection = false,
  needsCalendarConnection = false,
  needsTwilioConnection = false,
  needsVapiConnection = false,
  needsWhatsAppConnection = false,
  gmailConnected,
  gmailEmail,
  calendarConnected,
  connectingGmail,
  whatsappConnected = false,
  connectingWhatsApp = false,
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
  testDate = "",
  testTime = "",
  testAfterHoursState = "current",
  useTestCalendar = false,
  conversationCalendarEvent = null,
  conversationConfigError = null,
  deletingTestEvent = false,
  testEmail = "",
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
  isMissedCallWorkflow = false,
  isSmsWorkflow = false,
  isTelegramWorkflow = false,
  onConnectGmail,
  onDisconnectGoogle,
  onRefreshConnections,
  onRunTest,
  onStartLiveTest,
  onStopLiveTest,
  onStartVapiCall,
  onSendConversationMessage,
  onResetConversationTest,
  onBrowserCallEnded,
  onConnectWhatsApp,
  onCallerNumberChange,
  onCallerNameChange,
  onBusinessNameChange,
  onBusinessTypeChange,
  onCalendarIdChange,
  onTimeZoneChange,
  onAppointmentServiceChange,
  onTestDateChange,
  onTestTimeChange,
  onTestAfterHoursStateChange,
  onUseTestCalendarChange,
  onDeleteTestEvent,
  onTestEmailChange,
  onTriggerMessageChange,
  onTriggerAttachmentsChange
}: {
  hasGmailFlow: boolean;
  hasEmailNode?: boolean;
  isVoiceWorkflow: boolean;
  isDentalWorkflow: boolean;
  needsAnyTestConnection?: boolean;
  needsGoogleConnection?: boolean;
  needsCalendarConnection?: boolean;
  needsTwilioConnection?: boolean;
  needsVapiConnection?: boolean;
  needsWhatsAppConnection?: boolean;
  gmailConnected: boolean;
  gmailEmail: string | null;
  calendarConnected: boolean;
  connectingGmail: boolean;
  whatsappConnected?: boolean;
  connectingWhatsApp?: boolean;
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
  testDate?: string;
  testTime?: string;
  /** After-hours simulation for chat + voice tests ("current" = no override). */
  testAfterHoursState?: "current" | "open" | "closed";
  useTestCalendar?: boolean;
  conversationCalendarEvent?: ArchitectTestCalendarEvent | null;
  conversationConfigError?: { code: string; message: string; remediation: string } | null;
  deletingTestEvent?: boolean;
  testEmail?: string;
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
  isMissedCallWorkflow?: boolean;
  isSmsWorkflow?: boolean;
  isTelegramWorkflow?: boolean;
  onConnectGmail: () => void;
  onDisconnectGoogle: () => void;
  onRefreshConnections: () => void;
  // Temporarily optional — WhatsApp feature paused
  onConnectWhatsApp?: () => void;
  onRunTest: () => void;
  onStartLiveTest: () => void;
  onStopLiveTest: () => void;
  onStartVapiCall: () => Promise<ArchitectVapiBrowserTestSession | { error: string }>;
  onSendConversationMessage: (value: string) => Promise<string | null>;
  onResetConversationTest: () => void;
  onBrowserCallEnded?: () => void;
  onCallerNumberChange: (value: string) => void;
  onCallerNameChange: (value: string) => void;
  onBusinessNameChange: (value: string) => void;
  onBusinessTypeChange: (value: string) => void;
  onCalendarIdChange: (value: string) => void;
  onTimeZoneChange: (value: string) => void;
  onAppointmentServiceChange: (value: string) => void;
  onTestDateChange?: (value: string) => void;
  onTestTimeChange?: (value: string) => void;
  onTestAfterHoursStateChange?: (value: "current" | "open" | "closed") => void;
  onUseTestCalendarChange?: (value: boolean) => void;
  onDeleteTestEvent?: (testEventId: string) => void;
  onTestEmailChange?: (value: string) => void;
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
  const googleReady = needsCalendarConnection ? calendarConnected : gmailConnected;

  const hasLlmPipeline = Boolean(
    runContext.llmPipeline &&
    typeof runContext.llmPipeline === "object" &&
    Object.keys(runContext.llmPipeline).length > 0
  );

  const hasImagePipeline = Boolean(
    (runContext.imagePipeline &&
      typeof runContext.imagePipeline === "object" &&
      Object.keys(runContext.imagePipeline).length > 0) ||
      (runContext.image && (typeof runContext.image === "string" || (typeof runContext.image === "object" && (runContext.image as any)?.type === "Buffer"))) ||
      (runContext.image_url && typeof runContext.image_url === "string")
  );

  const hasResult = Boolean(
    sentSms || draftEmail || sentEmail || gmailRead || vapiCall || calendarAppointment || hasVoiceResult || hasLlmPipeline || hasImagePipeline || runLogs.length > 0
  );

  const sandboxReady = testDeployment?.status === "READY";

  // Exact interpreted date/time preview in the selected test timezone —
  // computed with the same shared conversion the backend uses.
  const interpretedTime = (() => {
    if (!testDate || !isValidTimeZone(timeZone)) return null;
    const [hourRaw, minuteRaw] = (testTime || "09:00").split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    try {
      return describeZonedTime({ date: testDate, hour, minute, timeZone });
    } catch {
      return null;
    }
  })();

  const timezoneOptions = (() => {
    const known = COMMON_TIMEZONES.some((option) => option.value === timeZone);
    return known || !timeZone
      ? COMMON_TIMEZONES
      : [{ value: timeZone, label: timeZone }, ...COMMON_TIMEZONES];
  })();
  const subtitle = isVoiceWorkflow
    ? null
    : "Send a sample trigger through the workflow and watch each step run in real time.";
  const heading = isDentalWorkflow
    ? "Dental AI Receptionist test"
    : isVoiceWorkflow
      ? "Test AI Voice Agent"
      : isMissedCallWorkflow
        ? "Test Missed Call Agent"
        : isSmsWorkflow
          ? "Test SMS Agent"
          : isTelegramWorkflow
            ? "Test Telegram Agent"
            : "Test console";

  // Field visibility driven by live canvas node capabilities (no theme changes).
  const showCallerFields =
    !isManualTriggerWorkflow && (isVoiceWorkflow || isMissedCallWorkflow || isSmsWorkflow);
  const showTriggerMessage = isManualTriggerWorkflow || isSmsWorkflow || isTelegramWorkflow;
  const showBusinessContextFields =
    !isManualTriggerWorkflow &&
    (isVoiceWorkflow || isMissedCallWorkflow || isSmsWorkflow || needsCalendarConnection || hasGmailFlow);

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900 sm:text-[24px]" data-testid="architect-ui-workflow-builder-test-panel-console-heading">{heading}</h2>
            {subtitle ? (
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-send-a-sample-trigger-through-the-workflow-text">
                {subtitle}
              </p>
            ) : null}
            {hasGmailFlow || needsCalendarConnection ? (
              <p className="mt-2 text-[12.5px] font-medium text-slate-500" data-testid="architect-ui-workflow-builder-test-panel-gmail-connected-gmail-connected-gmail-email-gmail-text">
                {googleReady
                  ? `Google Calendar connected${gmailEmail ? ` as ${gmailEmail}` : ""}`
                  : "Connect Google Calendar below before a live run."}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2.5">
            <button
              type="button"
              onClick={onRunTest}
              disabled={running}
              data-testid="test-run"
              className="btn-primary shadow-amber inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-[14px] font-bold text-white transition disabled:opacity-60"
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
          <div className="shadow-soft mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6" data-testid="builder-test-live-sandbox-ready">
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

        <div className="shadow-soft mt-5 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6">
          <h3 className="mb-5 text-[13px] font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-simulate-a-missed-call-heading">
            {isVoiceWorkflow
              ? "Simulate an inbound call"
              : isMissedCallWorkflow
                ? "Simulate a missed call"
                : isSmsWorkflow
                  ? "Simulate an inbound SMS"
                  : isTelegramWorkflow
                    ? "Simulate a Telegram message"
                    : "Simulate a customer event"}
          </h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {showCallerFields && (
              <>
                <label data-testid="architect-ui-workflow-builder-test-panel-caller-number-on-caller-number-change-event-label">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700" data-testid="architect-ui-workflow-builder-test-panel-caller-number-text">
                    {isSmsWorkflow ? "Sender phone" : isVoiceWorkflow ? "Caller phone" : "Caller number"}
                  </span>
                  <input data-testid="builder-test-caller-number-input"
                    type="text"
                    value={callerNumber}
                    onChange={(event) => onCallerNumberChange(event.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 font-mono text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                  />
                </label>
                <label data-testid="architect-ui-workflow-builder-test-panel-caller-on-caller-change-event-placeholder-jordan-label">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700" data-testid="architect-ui-workflow-builder-test-panel-caller-text">
                    {isSmsWorkflow ? "Sender name" : "Caller name"}
                  </span>
                  <input data-testid="builder-test-caller-name-input"
                    type="text"
                    value={callerName}
                    onChange={(event) => onCallerNameChange(event.target.value)}
                    placeholder={isSmsWorkflow ? "Jordan Lee" : isVoiceWorkflow ? "Test Customer" : "Jordan Lee"}
                    className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                  />
                </label>
              </>
            )}
            {showTriggerMessage && (
              <label className="col-span-1 sm:col-span-2">
                <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                  {isSmsWorkflow
                    ? "SMS Message / Text input"
                    : isTelegramWorkflow
                      ? "Telegram message / Text input"
                      : "Trigger message / Text input"}
                </span>
                <textarea
                  rows={2}
                  value={triggerMessage}
                  onChange={(event) => onTriggerMessageChange(event.target.value)}
                  placeholder={
                    isSmsWorkflow
                      ? "Type SMS message content to trigger the workflow..."
                      : isTelegramWorkflow
                        ? "Type a Telegram message to trigger the workflow..."
                        : "Type or paste text content (e.g. resume content or SMS text) to trigger the workflow..."
                  }
                  className="fld h-16 w-full resize-none rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                />
              </label>
            )}

            {showBusinessContextFields && (
              <>
                <label data-testid="architect-ui-workflow-builder-test-panel-business-on-business-change-event-placeholder-mitchell">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700" data-testid="architect-ui-workflow-builder-test-panel-business-text">
                    Business name
                  </span>
                  <input data-testid="builder-test-business-name-input"
                    type="text"
                    value={businessName}
                    onChange={(event) => onBusinessNameChange(event.target.value)}
                    placeholder="Your business name"
                    className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                  />
                </label>

                <label data-testid="builder-test-appointment-service-label">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Business services</span>
                  <input data-testid="builder-test-appointment-service-input"
                    type="text"
                    value={appointmentService}
                    onChange={(event) => onAppointmentServiceChange(event.target.value)}
                    placeholder="General Consultation"
                    className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                  />
                </label>

                <label data-testid="builder-test-timezone-label">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Timezone</span>
                  <select
                    data-testid="builder-test-timezone-select"
                    value={timeZone}
                    onChange={(event) => onTimeZoneChange(event.target.value)}
                    className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                  >
                    <option value="">Select timezone</option>
                    {timezoneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>

        {needsAnyTestConnection ? (
          <div className="shadow-soft mt-5 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6" data-testid="builder-test-connections">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3
                className="text-[15px] font-bold text-slate-900"
                data-testid="architect-ui-workflow-builder-test-panel-architect-test-connections-heading"
              >
                Connections
              </h3>
              <button
                type="button"
                onClick={onRefreshConnections}
                data-testid="builder-test-refresh-status"
                className="btn-ghost shrink-0 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-slate-600 transition hover:border-gray-300"
              >
                Refresh status
              </button>
            </div>

            {needsGoogleConnection || needsCalendarConnection ? (
              <div
                className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3.5"
                data-testid="builder-test-google-card"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm-5-8h-4v4h4v-4z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800" data-testid="builder-test-google-status">
                      {googleReady ? "Google Calendar connected" : "Google Calendar"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500" data-testid="builder-test-calendar-status-text">
                      {googleReady
                        ? `Connected as ${gmailEmail || "your account"}`
                        : "Connect so the agent can book test appointments."}
                    </p>
                    {/* Keep legacy calendar card testid for existing Playwright selectors */}
                    <span className="sr-only" data-testid="builder-test-calendar-card">
                      {googleReady ? "Connected" : "Missing permission"}
                    </span>
                    <span className="sr-only" data-testid="builder-test-calendar-permission">
                      Calendar permission: {calendarConnected ? "connected" : "missing"}
                    </span>
                    <span className="sr-only" data-testid="builder-test-calendar-id-text">
                      Calendar ID: {calendarId || "primary"}
                    </span>
                    <span className="sr-only" data-testid="builder-test-calendar-timezone-text">
                      Timezone: {timeZone || "America/Los_Angeles"}
                    </span>
                  </div>
                </div>

                {googleReady ? (
                  <button
                    type="button"
                    onClick={onDisconnectGoogle}
                    data-testid="builder-test-disconnect-google"
                    className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-gray-300"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onConnectGmail}
                    disabled={connectingGmail}
                    data-testid="builder-test-connect-google"
                    className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                  >
                    {connectingGmail ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            ) : null}

            {needsTwilioConnection ? (
              <div
                className="mt-3 flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3.5"
                data-testid="builder-test-twilio-card"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Twilio test number</p>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-slate-600" data-testid="builder-test-twilio-number">
                    {testDeployment?.assignedPhoneNumber ?? "Assigned when the live sandbox starts"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-twilio-note">
                    Browser call test does not use phone numbers.
                  </p>
                </div>
              </div>
            ) : null}

            {needsVapiConnection ? (
              <div
                className="mt-3 flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3.5"
                data-testid="builder-test-vapi-card"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Vapi assistant</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-600" data-testid="builder-test-vapi-status">
                    {testDeployment?.vapiAssistantId ? "Assistant ready" : "Ready for browser call test"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500" data-testid="builder-test-vapi-note">
                    Uses a sandbox assistant for this workflow.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Temporarily hidden — WhatsApp feature paused
            {needsWhatsAppConnection ? (
              <div
                className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3.5"
                data-testid="builder-test-whatsapp-card"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <WhatsAppIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800" data-testid="builder-test-whatsapp-status">
                      {whatsappConnected ? "WhatsApp Business connected" : "WhatsApp Business"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500" data-testid="builder-test-whatsapp-note">
                      {whatsappConnected
                        ? "Connected for WhatsApp triggers and sends."
                        : "Connect so the agent can send and receive WhatsApp messages."}
                    </p>
                  </div>
                </div>

                {whatsappConnected ? (
                  <button
                    type="button"
                    onClick={onConnectWhatsApp}
                    data-testid="builder-test-connect-whatsapp"
                    className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-gray-300"
                  >
                    Manage
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onConnectWhatsApp}
                    disabled={connectingWhatsApp}
                    data-testid="builder-test-connect-whatsapp"
                    className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                  >
                    {connectingWhatsApp ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            ) : null}
            */}
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
            onCallEnded={onBrowserCallEnded}
          />
        ) : null}

        {conversationConfigError ? (
          <div className="shadow-soft mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 sm:p-6" data-testid="builder-test-config-error">
            <p className="text-[14px] font-bold text-rose-800" data-testid="builder-test-config-error-code">{conversationConfigError.code}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-rose-700" data-testid="builder-test-config-error-message">{conversationConfigError.message}</p>
            <p className="mt-1.5 text-[12.5px] font-semibold text-rose-600" data-testid="builder-test-config-error-remediation">{conversationConfigError.remediation}</p>
          </div>
        ) : null}

        {conversationCalendarEvent ? (
          <div className="shadow-soft mt-5 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6" data-testid="builder-test-event-result">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-400">
                {conversationCalendarEvent.status === "CREATED" ? "Test calendar event created" : "Simulated calendar event preview"}
              </h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${conversationCalendarEvent.status === "CREATED" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                data-testid="builder-test-event-status"
              >
                {conversationCalendarEvent.status}
              </span>
            </div>
            <p className="text-[15px] font-semibold text-slate-800" data-testid="builder-test-event-title">{conversationCalendarEvent.title}</p>
            <p className="mt-1.5 text-[12.5px] text-slate-500" data-testid="builder-test-event-start">
              Starts: {new Date(conversationCalendarEvent.startAt).toLocaleString("en-US", { timeZone: conversationCalendarEvent.timeZone })} ({conversationCalendarEvent.timeZone})
            </p>
            <p className="mt-1 text-[12.5px] text-slate-500" data-testid="builder-test-event-end">
              Ends: {new Date(conversationCalendarEvent.endAt).toLocaleString("en-US", { timeZone: conversationCalendarEvent.timeZone })}
            </p>
            {conversationCalendarEvent.description ? (
              <p className="mt-2.5 whitespace-pre-line text-[12.5px] leading-relaxed text-slate-500" data-testid="builder-test-event-description">
                {conversationCalendarEvent.description}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {conversationCalendarEvent.htmlLink ? (
                <a
                  href={conversationCalendarEvent.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="builder-test-event-link"
                  className="btn-ghost rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-slate-600 transition"
                >
                  Open in Google Calendar
                </a>
              ) : null}
              {conversationCalendarEvent.testEventId ? (
                <button
                  type="button"
                  onClick={() => onDeleteTestEvent?.(conversationCalendarEvent.testEventId!)}
                  disabled={deletingTestEvent}
                  data-testid="builder-test-event-delete"
                  className="rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  {deletingTestEvent ? "Deleting..." : "Delete test event"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {hasEmailNode ? (
          <div className="shadow-soft mt-5 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6" data-testid="builder-test-email-card">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
                <BuilderIcon name="mail" className="h-4 w-4 text-amber-500" />
                Test Email Delivery
              </h3>
              <InfoTooltip content="During a test run, the Email node sends a live confirmation message to this address. Enter an inbox you can access to verify delivery." />
            </div>
            <p className="mb-4 text-[13px] text-slate-500">
              Enter your email to receive the test booking confirmation email.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <label data-testid="builder-test-email-label" className="flex-1">
                <span className="sr-only" data-testid="builder-test-email-title">Test Email</span>
                <input
                  data-testid="builder-test-email-input"
                  type="email"
                  value={testEmail}
                  onChange={(event) => onTestEmailChange?.(event.target.value)}
                  placeholder="e.g. yourname@example.com"
                  className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                />
              </label>
              <button
                type="button"
                onClick={onRunTest}
                disabled={running}
                data-testid="builder-test-send-email-btn"
                className="btn-primary shadow-amber shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-[14px] font-bold text-white transition hover:from-amber-500 hover:to-amber-600 disabled:opacity-60"
              >
                <BuilderIcon name="mail" className="h-4 w-4" />
                {running ? "Sending..." : "Send confirmation email"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="shadow-lift mt-5 overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-900/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="ml-2 font-mono text-[12px] text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-execution-log-text-4">execution.log</span>
          </div>
          <div className="min-h-[200px] space-y-1.5 p-4 font-mono text-[12.5px] leading-relaxed text-slate-300">
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
          <div className="mt-5 pb-2">
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-has-gmail-flow-email-result-message-the-heading">
              {hasImagePipeline ? "Generated Image Results" : hasLlmPipeline ? "LLM Pipeline Results" : hasVoiceResult ? "Voice booking result" : hasGmailFlow ? "Email result" : "Message preview"}
            </h3>
            <div className="shadow-soft flex items-start gap-4 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 min-w-0 max-w-full overflow-hidden">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${hasImagePipeline || hasLlmPipeline ? "bg-violet-50 text-violet-600" : "bg-green-50 text-green-600"}`}>
                <BuilderIcon name={hasImagePipeline ? "image" : hasLlmPipeline ? "sparkles" : hasVoiceResult ? "phone-call" : hasGmailFlow ? "mail" : "message"} className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0 max-w-full">
                {hasImagePipeline ? (
                  <div className="space-y-4 min-w-0 max-w-full" data-testid="test-panel-image-pipeline-results">
                    <div className="min-w-0 max-w-full">
                      {(() => {
                        const rawPipeline = runContext.imagePipeline && typeof runContext.imagePipeline === "object"
                          ? Object.values(runContext.imagePipeline as Record<string, any>)
                          : [];

                        const steps = rawPipeline.length > 0
                          ? rawPipeline
                          : [{
                              label: "Image Generation",
                              imageUrl: typeof runContext.image_url === "string"
                                ? runContext.image_url
                                : typeof runContext.image === "string"
                                  ? runContext.image
                                  : (runContext.image && (runContext.image as any)?.type === "Buffer" && Array.isArray((runContext.image as any)?.data))
                                    ? `data:image/png;base64,${Buffer.from((runContext.image as any).data).toString("base64")}`
                                    : "",
                              prompt: typeof runContext.prompt === "string" ? runContext.prompt : "",
                              model: typeof runContext.model === "string" ? runContext.model : ""
                            }];

                        return steps.map((step, idx) => {
                          const imgSrc = step.imageUrl || (typeof step.image === "string" ? step.image : "");
                          return (
                            <div key={idx} className="mb-4 last:mb-0 rounded-2xl border border-violet-100 bg-violet-50/10 p-5 min-w-0 max-w-full overflow-hidden shadow-xs">
                              <div className="flex items-center justify-between border-b border-violet-100 pb-3 gap-2 flex-wrap sm:flex-nowrap">
                                <span className="text-xs font-bold text-violet-950 truncate min-w-0">{step.label || "Generated Image"}</span>
                                {step.model ? (
                                  <span className="font-mono text-[10px] font-semibold text-violet-700 bg-violet-100/80 px-2.5 py-1 rounded-full shrink-0">
                                    {step.model}
                                  </span>
                                ) : null}
                              </div>

                              {imgSrc ? (
                                <div className="mt-4 space-y-3">
                                  <div className="relative group max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900/5 p-1 shadow-sm flex items-center justify-center">
                                    <img
                                      src={imgSrc}
                                      alt={step.prompt || "Generated image preview"}
                                      className="max-h-80 w-auto rounded-lg object-contain"
                                    />
                                  </div>

                                  <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap pt-1">
                                    {step.prompt ? (
                                      <p className="text-xs text-slate-600 italic flex-1 min-w-0 break-words">&ldquo;{step.prompt}&rdquo;</p>
                                    ) : <span className="flex-1" />}

                                    <a
                                      href={imgSrc}
                                      download={`generated-image-${idx + 1}.png`}
                                      target="_blank"
                                      rel="noreferrer"
                                      data-testid="test-panel-download-image-btn"
                                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-violet-700 shadow-sm shrink-0"
                                    >
                                      <BuilderIcon name="image" className="h-3.5 w-3.5" />
                                      Download Image
                                    </a>
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-3 text-xs text-slate-500">Image buffer generated successfully.</p>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ) : hasLlmPipeline ? (
                  <div className="space-y-4 min-w-0 max-w-full" data-testid="test-panel-llm-pipeline-results">
                    <div className="min-w-0 max-w-full">
                      {Object.values(runContext.llmPipeline as Record<string, any>).map((step, idx) => (
                        <div key={idx} className="mb-3 last:mb-0 rounded-xl border border-violet-100 bg-violet-50/10 p-4 min-w-0 max-w-full overflow-hidden">
                          <div className="flex items-center justify-between border-b border-violet-100 pb-2 gap-2 flex-wrap sm:flex-nowrap">
                            <span className="text-xs font-bold text-violet-950 truncate min-w-0">{step.label || "LLM Step"}</span>
                            <span className="font-mono text-[10px] text-violet-500 bg-violet-50 px-2 py-0.5 rounded shrink-0">
                              {step.providerId} ({step.modelName})
                            </span>
                          </div>
                          <div className="mt-2 text-sm leading-relaxed text-slate-700 min-w-0 max-w-full overflow-x-auto break-words [overflow-wrap:anywhere]">
                            <Markdown content={step.output} />
                          </div>
                          <p className="mt-2 font-mono text-[9px] text-slate-400 truncate">Variable: <code className="text-violet-600 font-bold">{step.outputKey}</code></p>
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
                      <div data-testid="test-panel-appointment-result">
                        <p className={`font-mono text-xs ${calendarAppointment.status === "FAILED" ? "text-rose-500" : "text-blue-500"}`}>
                          Appointment result:{" "}
                          {calendarAppointment.status === "CREATED"
                            ? "test event created on your calendar"
                            : calendarAppointment.status === "DELETED"
                              ? "test event deleted"
                              : calendarAppointment.status === "FAILED"
                                ? `failed (${calendarAppointment.errorCode || "calendar error"})`
                                : calendarAppointment.id
                                  ? "booked"
                                  : "simulated (no live calendar write)"}{" "}
                          — {calendarAppointment.summary}
                        </p>
                        {calendarAppointment.status === "FAILED" && calendarAppointment.remediation ? (
                          <p className="mt-1 font-mono text-xs text-rose-400" data-testid="test-panel-appointment-remediation">
                            {calendarAppointment.remediation}
                          </p>
                        ) : null}
                        {calendarAppointment.htmlLink || calendarAppointment.testEventId ? (
                          <span className="mt-1.5 flex items-center gap-2">
                            {calendarAppointment.htmlLink ? (
                              <a
                                href={calendarAppointment.htmlLink}
                                target="_blank"
                                rel="noreferrer"
                                data-testid="test-panel-appointment-link"
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-gray-50"
                              >
                                Open in Google Calendar
                              </a>
                            ) : null}
                            {calendarAppointment.testEventId && calendarAppointment.status === "CREATED" ? (
                              <button
                                type="button"
                                onClick={() => onDeleteTestEvent?.(calendarAppointment.testEventId!)}
                                disabled={deletingTestEvent}
                                data-testid="test-panel-appointment-delete"
                                className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                              >
                                {deletingTestEvent ? "Deleting..." : "Delete test event"}
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
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
