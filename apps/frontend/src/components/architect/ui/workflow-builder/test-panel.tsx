import { COMMON_TIMEZONES, calendlyActionPaidPlanNote, describeZonedTime, isValidTimeZone, resolveDeepgramMode } from "@coreai/shared";
import { DeepgramSttTestCard } from "@/components/common/deepgram-stt-test-card";
import { DeepgramTtsTestCard } from "@/components/common/deepgram-tts-test-card";
import { speakArchitectDeepgram } from "@/components/architect/features/api";
import type {
  ArchitectConversationMessage,
  ArchitectConversationToolCall,
  ArchitectTestCalendarEvent,
  ArchitectTestDeploymentStatus,
  ArchitectVapiBrowserTestSession,
  WorkflowRunLog
} from "@/components/architect/features/types";
import type { AIAttachment, BuilderNode } from "./types";
import { BuilderIcon } from "./icons";
import { logColor, formatRunLogOutputFields } from "./run-context";
import { detectUiPreview, isMarkupField } from "./ui-preview-source";
import { UiPreview } from "./ui-preview";
import { getCalendarAppointment, getCalendlyResult, getCapturedLead, getDeepgramSttResults, getDeepgramTtsResults, getDraftEmail, getGmailRead, getSentEmail, getSentSms, getVapiCall } from "./run-context";
import { BrowserVoiceCallTest } from "./browser-voice-call-test";
import { InfoTooltip } from "@/components/business/setup/InfoTooltip";
import { WhatsAppIcon } from "@/components/architect/features/whatsapp/WhatsAppIcon";
import {
  useCalendlyAvailableTimeOptions,
  useCalendlyContactOptions,
  useCalendlyEventOptions,
  useCalendlyEventTypeOptions,
  useCalendlyInviteeOptions,
  useCalendlyMeetingRecapOptions
} from "./use-calendly-pickers";
import {
  CalendlyAvailableSlotButtons,
  CalendlyTeamsRangePicker,
  CalendlyTimezoneSelect
} from "./calendly-time-controls";
import { marked } from "marked";
import type { CalendlyPickerOption } from "@/components/architect/features/types";
import type { ArchitectTelegramTestConnection } from "@/components/architect/features/api";
import { useMemo, useState } from "react";

type TestPanelSectionKey = "trigger" | "stt" | "tts" | "calendly" | "llm" | "image" | "voice" | "email" | "sms" | "vapi";

function nodeTypeOf(node: BuilderNode): string {
  return String(node.data?.type ?? node.type ?? "").toLowerCase();
}

function isTriggerLikeNode(node: BuilderNode): boolean {
  const type = nodeTypeOf(node);
  const kind = String(node.data?.nodeKind ?? "").toLowerCase();
  return kind === "trigger" || type.startsWith("trigger.") || type === "manual_trigger" || type === "manual";
}

/** Canvas order: top-to-bottom, then left-to-right. */
function sortNodesByCanvas(nodes: BuilderNode[]): BuilderNode[] {
  return [...nodes].sort((a, b) => {
    const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
    if (Math.abs(dy) > 8) return dy;
    return (a.position?.x ?? 0) - (b.position?.x ?? 0);
  });
}

function buildTestSectionOrder(nodes: BuilderNode[]): TestPanelSectionKey[] {
  const ordered = sortNodesByCanvas(nodes);
  const sections: TestPanelSectionKey[] = [];
  const pushUnique = (key: TestPanelSectionKey) => {
    if (!sections.includes(key)) sections.push(key);
  };

  // Always start with trigger when any trigger-like node exists (or always for dry-test inputs).
  if (ordered.some(isTriggerLikeNode) || ordered.length > 0) {
    pushUnique("trigger");
  }

  for (const node of ordered) {
    if (isTriggerLikeNode(node)) continue;
    const type = nodeTypeOf(node);
    const mode = typeof node.data?.mode === "string" ? node.data.mode : undefined;
    const deepgramMode = resolveDeepgramMode(type, mode);
    if (deepgramMode === "stt") pushUnique("stt");
    else if (deepgramMode === "tts") pushUnique("tts");
    else if (type.includes("calendly")) pushUnique("calendly");
    else if (type === "ai.llm_call" || type.includes("llm")) pushUnique("llm");
    else if (type.includes("image")) pushUnique("image");
    else if (type.includes("email") || type.includes("gmail")) pushUnique("email");
    else if (type.includes("sms") || type.includes("twilio")) pushUnique("sms");
    else if (type.includes("voice") || type.includes("vapi") || type.includes("phone")) pushUnique("voice");
  }

  return sections.length > 0 ? sections : ["trigger"];
}

export type TelegramCommandField =
  | "telegramBookingMode"
  | "telegramServicesCommand"
  | "telegramBookCommand"
  | "telegramMyBookingsCommand"
  | "telegramRescheduleCommand"
  | "telegramCancelCommand"
  | "telegramHelpCommand";

export type TelegramTestCommandSettings = Record<TelegramCommandField, boolean>;

export type TelegramCustomCommand = {
  id: string;
  command: string;
  description: string;
  action: "reply" | "services" | "book" | "help";
  response: string;
};

const DEFAULT_TELEGRAM_COMMAND_SETTINGS: TelegramTestCommandSettings = {
  telegramBookingMode: false,
  telegramServicesCommand: false,
  telegramBookCommand: false,
  telegramMyBookingsCommand: false,
  telegramRescheduleCommand: false,
  telegramCancelCommand: false,
  telegramHelpCommand: true
};

function TelegramCommandToggle({
  label,
  checked,
  disabled = false,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-sky-200 text-[#229ED9] focus:ring-sky-400"
      />
    </label>
  );
}

function newTelegramCustomCommand(): TelegramCustomCommand {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `telegram-command-${Date.now()}`,
    command: "",
    description: "",
    action: "reply",
    response: ""
  };
}

function calendlyPickerSelectOptions(
  selected: string,
  options: CalendlyPickerOption[]
): CalendlyPickerOption[] {
  if (!selected || options.some((option) => option.value === selected)) return options;
  return [{ value: selected, label: selected, uri: selected }, ...options];
}

function CalendlyRequiredMark() {
  return <span className="font-bold text-amber-600"> *</span>;
}

const CALENDLY_DURATION_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "60 minutes" },
  { value: "90", label: "90 minutes" },
  { value: "120", label: "120 minutes" }
] as const;

const CALENDLY_LOCATION_OPTIONS = [
  { value: "ask_invitee", label: "Ask invitee" },
  { value: "google_conference", label: "Google Meet" },
  { value: "zoom_conference", label: "Zoom" },
  { value: "microsoft_teams_conference", label: "Microsoft Teams" },
  { value: "outbound_call", label: "Phone call (outbound)" },
  { value: "inbound_call", label: "Phone call (inbound)" },
  { value: "physical", label: "In person" },
  { value: "custom", label: "Custom" }
] as const;

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
  hasWhatsAppTrigger = false,
  needsCalendlyConnection = false,
  calendlyActions = [],
  hasCalendlyTrigger = false,
  gmailConnected,
  gmailEmail,
  calendarConnected,
  connectingGmail,
  calendlyConnected = false,
  calendlyEmail = null,
  calendlyName = null,
  connectingCalendly = false,
  calendlyEventTypeUri = "",
  calendlyEventUuid = "",
  calendlyInviteeUuid = "",
  calendlyStartTime = "",
  calendlyEndTime = "",
  calendlyInviteeName = "",
  calendlyInviteeEmail = "",
  calendlyMeetingName = "",
  calendlyTriggerEvent = "meeting_booked",
  calendlyDurationMinutes = "30",
  calendlyOneOffStartDate = "",
  calendlyOneOffEndDate = "",
  calendlyTimezone = "America/New_York",
  calendlyLocationKind = "ask_invitee",
  calendlyLocation = "",
  calendlyContactEmail = "",
  calendlyContactUuid = "",
  calendlyContactName = "",
  calendlyCancelReason = "",
  calendlyMeetingRecapUuid = "",
  calendlyUserSearch = "",
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
  isManualTriggerWorkflow = false,
  isMissedCallWorkflow = false,
  isSmsWorkflow = false,
  isTelegramWorkflow = false,
  hasDeepgram = false,
  hasDeepgramStt = false,
  hasDeepgramTts = false,
  workflowNodes = [],
  dryRunConfigureHints = [],
  telegramTestConnection = null,
  connectingTelegramTest = false,
  syncingTelegramTest = false,
  telegramCommandSettings = DEFAULT_TELEGRAM_COMMAND_SETTINGS,
  telegramCustomCommands = [],
  onConnectGmail,
  onDisconnectGoogle,
  onConnectCalendly,
  onDisconnectCalendly,
  onCalendlyEventTypeUriChange,
  onCalendlyEventUuidChange,
  onCalendlyInviteeUuidChange,
  onCalendlyStartTimeChange,
  onCalendlyEndTimeChange,
  onCalendlyInviteeNameChange,
  onCalendlyInviteeEmailChange,
  onCalendlyMeetingNameChange,
  onCalendlyTriggerEventChange,
  onCalendlyDurationMinutesChange,
  onCalendlyOneOffStartDateChange,
  onCalendlyOneOffEndDateChange,
  onCalendlyTimezoneChange,
  onCalendlyLocationKindChange,
  onCalendlyLocationChange,
  onCalendlyContactEmailChange,
  onCalendlyContactUuidChange,
  onCalendlyContactNameChange,
  onCalendlyCancelReasonChange,
  onCalendlyMeetingRecapUuidChange,
  onCalendlyUserSearchChange,
  onRefreshConnections,
  onRunTest,
  onStartLiveTest,
  onStopLiveTest,
  onStartVapiCall,
  onSendConversationMessage,
  onResetConversationTest,
  onBrowserCallEnded,
  onConnectWhatsApp,
  onConnectTelegramTest,
  onSyncTelegramTest,
  onDisconnectTelegramTest,
  onTelegramCommandChange,
  onTelegramCustomCommandsChange,
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
  hasWhatsAppTrigger?: boolean;
  needsCalendlyConnection?: boolean;
  calendlyActions?: string[];
  hasCalendlyTrigger?: boolean;
  gmailConnected: boolean;
  gmailEmail: string | null;
  calendarConnected: boolean;
  connectingGmail: boolean;
  calendlyConnected?: boolean;
  calendlyEmail?: string | null;
  calendlyName?: string | null;
  connectingCalendly?: boolean;
  calendlyEventTypeUri?: string;
  calendlyEventUuid?: string;
  calendlyInviteeUuid?: string;
  calendlyStartTime?: string;
  calendlyEndTime?: string;
  calendlyInviteeName?: string;
  calendlyInviteeEmail?: string;
  calendlyMeetingName?: string;
  calendlyTriggerEvent?: string;
  calendlyDurationMinutes?: string;
  calendlyOneOffStartDate?: string;
  calendlyOneOffEndDate?: string;
  calendlyTimezone?: string;
  calendlyLocationKind?: string;
  calendlyLocation?: string;
  calendlyContactEmail?: string;
  calendlyContactUuid?: string;
  calendlyContactName?: string;
  calendlyCancelReason?: string;
  calendlyMeetingRecapUuid?: string;
  calendlyUserSearch?: string;
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
  hasDeepgram?: boolean;
  hasDeepgramStt?: boolean;
  hasDeepgramTts?: boolean;
  workflowNodes?: BuilderNode[];
  dryRunConfigureHints?: string[];
  telegramTestConnection?: ArchitectTelegramTestConnection | null;
  connectingTelegramTest?: boolean;
  syncingTelegramTest?: boolean;
  telegramCommandSettings?: TelegramTestCommandSettings;
  telegramCustomCommands?: TelegramCustomCommand[];
  onConnectGmail: () => void;
  onDisconnectGoogle: () => void;
  onConnectCalendly?: () => void;
  onDisconnectCalendly?: () => void;
  onCalendlyEventTypeUriChange?: (value: string) => void;
  onCalendlyEventUuidChange?: (value: string) => void;
  onCalendlyInviteeUuidChange?: (value: string) => void;
  onCalendlyStartTimeChange?: (value: string) => void;
  onCalendlyEndTimeChange?: (value: string) => void;
  onCalendlyInviteeNameChange?: (value: string) => void;
  onCalendlyInviteeEmailChange?: (value: string) => void;
  onCalendlyMeetingNameChange?: (value: string) => void;
  onCalendlyTriggerEventChange?: (value: string) => void;
  onCalendlyDurationMinutesChange?: (value: string) => void;
  onCalendlyOneOffStartDateChange?: (value: string) => void;
  onCalendlyOneOffEndDateChange?: (value: string) => void;
  onCalendlyTimezoneChange?: (value: string) => void;
  onCalendlyLocationKindChange?: (value: string) => void;
  onCalendlyLocationChange?: (value: string) => void;
  onCalendlyContactEmailChange?: (value: string) => void;
  onCalendlyContactUuidChange?: (value: string) => void;
  onCalendlyContactNameChange?: (value: string) => void;
  onCalendlyCancelReasonChange?: (value: string) => void;
  onCalendlyMeetingRecapUuidChange?: (value: string) => void;
  onCalendlyUserSearchChange?: (value: string) => void;
  onRefreshConnections: () => void;
  onConnectWhatsApp?: () => void;
  onConnectTelegramTest?: (botToken: string) => void;
  onSyncTelegramTest?: () => void;
  onDisconnectTelegramTest?: () => void;
  onTelegramCommandChange?: (field: TelegramCommandField, value: boolean) => void;
  onTelegramCustomCommandsChange?: (commands: TelegramCustomCommand[]) => void;
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
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const telegramCustomCommandError = (() => {
    const builtIns = new Set(["start", "services", "book", "mybookings", "reschedule", "cancel", "help"]);
    const seen = new Set<string>();
    for (const item of telegramCustomCommands) {
      const command = item.command.trim().toLowerCase().replace(/^\/+/, "");
      if (!command) return "Enter a command name for every custom command.";
      if (builtIns.has(command)) return `/${command} is already a built-in command.`;
      if (seen.has(command)) return `/${command} is duplicated.`;
      if (!item.description.trim()) return `Add a Telegram menu description for /${command}.`;
      if (item.action === "reply" && !item.response.trim()) return `Add the bot reply for /${command}.`;
      seen.add(command);
    }
    return "";
  })();

  const sentSms = getSentSms(runContext);
  const capturedLead = getCapturedLead(runContext);
  const draftEmail = getDraftEmail(runContext);
  const sentEmail = getSentEmail(runContext);
  const gmailRead = getGmailRead(runContext);
  const vapiCall = getVapiCall(runContext);
  const calendarAppointment = getCalendarAppointment(runContext);
  const calendlyResult = getCalendlyResult(runContext);
  const deepgramSttResults = getDeepgramSttResults(runContext);
  const deepgramTtsResults = getDeepgramTtsResults(runContext);

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

  const hasImagePipeline = Boolean(
    (runContext.imagePipeline &&
      typeof runContext.imagePipeline === "object" &&
      Object.keys(runContext.imagePipeline).length > 0) ||
      (runContext.image && (typeof runContext.image === "string" || (typeof runContext.image === "object" && (runContext.image as any)?.type === "Buffer"))) ||
      (runContext.image_url && typeof runContext.image_url === "string")
  );

  const hasLlmPipeline = Boolean(
    runContext.llmPipeline &&
      typeof runContext.llmPipeline === "object" &&
      Object.keys(runContext.llmPipeline).length > 0
  );

  const hasResult = Boolean(
    sentSms ||
      draftEmail ||
      sentEmail ||
      gmailRead ||
      vapiCall ||
      calendarAppointment ||
      (needsCalendlyConnection && calendlyResult) ||
      (hasDeepgramStt && deepgramSttResults.length > 0) ||
      (hasDeepgramTts && deepgramTtsResults.length > 0) ||
      hasVoiceResult ||
      hasImagePipeline ||
      hasLlmPipeline
  );

  const sandboxReady = testDeployment?.status === "READY";
  const testSectionOrder = useMemo(
    () => buildTestSectionOrder(workflowNodes),
    [workflowNodes]
  );

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
  const subtitle = isVoiceWorkflow || needsCalendlyConnection
    ? null
    : isTelegramWorkflow
      ? "Connect a dedicated test bot, then send it a real Telegram message. The draft workflow runs without publishing."
    : needsWhatsAppConnection
      ? "Connect WhatsApp, fill the sample message fields, then run a dry test."
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
            : needsWhatsAppConnection
              ? "Test WhatsApp Agent"
              : needsCalendlyConnection || hasDeepgramStt || hasDeepgramTts
                ? "Test agent"
                : "Test console";

  // Field visibility driven by live canvas node capabilities (no theme changes).
  const showCallerFields =
    !isManualTriggerWorkflow &&
    (isVoiceWorkflow || isMissedCallWorkflow || isSmsWorkflow || hasWhatsAppTrigger);
  const showTriggerMessage =
    isManualTriggerWorkflow || isSmsWorkflow || hasWhatsAppTrigger;
  const showBusinessContextFields =
    !isManualTriggerWorkflow &&
    (isVoiceWorkflow ||
      isMissedCallWorkflow ||
      isSmsWorkflow ||
      isTelegramWorkflow ||
      hasWhatsAppTrigger ||
      needsCalendarConnection ||
      hasGmailFlow);

  const calendlyActionSet = new Set(calendlyActions.map((action) => action.toLowerCase()));
  // Mandatory (and useful optional) fields for each Calendly action in the dry-test panel.
  const showCalendlyEventTypeUri =
    needsCalendlyConnection &&
    (calendlyActionSet.has("find_available_times") ||
      calendlyActionSet.has("create_scheduling_link") ||
      calendlyActionSet.has("book_meeting_for_invitee") ||
      calendlyActionSet.has("find_invitee_by_email"));
  const showCalendlyEventUuid =
    needsCalendlyConnection &&
    (calendlyActionSet.has("get_event") ||
      calendlyActionSet.has("find_event") ||
      calendlyActionSet.has("list_invitees") ||
      calendlyActionSet.has("get_invitee") ||
      calendlyActionSet.has("cancel_event") ||
      calendlyActionSet.has("cancel_scheduled_event") ||
      calendlyActionSet.has("mark_invitee_no_show"));
  const showCalendlyInviteeUuid =
    needsCalendlyConnection &&
    (calendlyActionSet.has("get_invitee") || calendlyActionSet.has("mark_invitee_no_show"));
  const showCalendlyTimeRange =
    needsCalendlyConnection && calendlyActionSet.has("find_available_times");
  const showCalendlyBookStartTime =
    needsCalendlyConnection && calendlyActionSet.has("book_meeting_for_invitee");
  const showCalendlyBookInviteeFields =
    needsCalendlyConnection &&
    (calendlyActionSet.has("book_meeting_for_invitee") ||
      calendlyActionSet.has("find_invitee_by_email"));
  const showCalendlyContactEmail =
    needsCalendlyConnection && calendlyActionSet.has("create_contact");
  const showCalendlyContactUuid =
    needsCalendlyConnection &&
    (calendlyActionSet.has("update_contact") ||
      calendlyActionSet.has("delete_contact") ||
      calendlyActionSet.has("find_contact"));
  const showCalendlyContactName =
    needsCalendlyConnection &&
    (calendlyActionSet.has("create_contact") || calendlyActionSet.has("update_contact"));
  const showCalendlyCancelReason =
    needsCalendlyConnection &&
    (calendlyActionSet.has("cancel_event") || calendlyActionSet.has("cancel_scheduled_event"));
  const showCalendlyMeetingRecapUuid =
    needsCalendlyConnection &&
    (calendlyActionSet.has("find_meeting_recap") ||
      calendlyActionSet.has("find_meeting_recap_transcript"));
  const showCalendlyUserSearch = needsCalendlyConnection && calendlyActionSet.has("find_user");
  const showCalendlyOneOffFields =
    needsCalendlyConnection && calendlyActionSet.has("create_one_off_meeting_link");
  const showCalendlyTriggerFields = needsCalendlyConnection && hasCalendlyTrigger;
  const showCalendlyTestFields =
    showCalendlyTriggerFields ||
    showCalendlyEventTypeUri ||
    showCalendlyEventUuid ||
    showCalendlyInviteeUuid ||
    showCalendlyTimeRange ||
    showCalendlyBookStartTime ||
    showCalendlyBookInviteeFields ||
    showCalendlyContactEmail ||
    showCalendlyContactUuid ||
    showCalendlyContactName ||
    showCalendlyCancelReason ||
    showCalendlyMeetingRecapUuid ||
    showCalendlyUserSearch ||
    showCalendlyOneOffFields;

  const eventTypePicker = useCalendlyEventTypeOptions(Boolean(calendlyConnected && showCalendlyEventTypeUri));
  const eventPicker = useCalendlyEventOptions(Boolean(calendlyConnected && showCalendlyEventUuid), {
    startedOnly: calendlyActionSet.has("mark_invitee_no_show")
  });
  const inviteePicker = useCalendlyInviteeOptions(
    Boolean(calendlyConnected && showCalendlyInviteeUuid),
    calendlyEventUuid
  );
  const contactPicker = useCalendlyContactOptions(Boolean(calendlyConnected && showCalendlyContactUuid));
  const meetingRecapPicker = useCalendlyMeetingRecapOptions(
    Boolean(calendlyConnected && showCalendlyMeetingRecapUuid)
  );
  const availableTimePicker = useCalendlyAvailableTimeOptions(
    Boolean(calendlyConnected && showCalendlyBookStartTime),
    calendlyEventTypeUri
  );
  const calendlyPaidPlanNotes = Array.from(
    new Set(
      calendlyActions
        .map((action) => calendlyActionPaidPlanNote(action))
        .filter((note): note is string => Boolean(note))
    )
  );

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
            {needsWhatsAppConnection ? (
              <p className="mt-2 text-[12.5px] font-medium text-slate-500" data-testid="builder-test-whatsapp-console-status">
                {whatsappConnected
                  ? "WhatsApp connected — ready for a dry test."
                  : "Connect WhatsApp below before running a dry test."}
              </p>
            ) : null}
            {needsCalendlyConnection && calendlyPaidPlanNotes.length > 0 ? (
              <div className="mt-2 space-y-1" data-testid="builder-test-calendly-paid-plan-notes">
                {calendlyPaidPlanNotes.map((note) => (
                  <p key={note} className="text-[12.5px] font-medium text-amber-700">
                    {note}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2.5">
            {!isTelegramWorkflow ? (
              <button
                type="button"
                onClick={onRunTest}
                disabled={running || (needsWhatsAppConnection && !whatsappConnected)}
                data-testid="test-run"
                className="btn-primary shadow-amber inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-[14px] font-bold text-white transition disabled:opacity-60"
              >
                <BuilderIcon name="play" className="h-4 w-4" />
                {running ? "Running..." : "Run dry test"}
              </button>
            ) : telegramTestConnection?.connected && telegramTestConnection.botUrl ? (
              <a
                href={telegramTestConnection.botUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="builder-test-open-telegram"
                className="inline-flex items-center gap-2 rounded-xl bg-[#229ED9] px-5 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:bg-[#168ac2]"
              >
                <BuilderIcon name="telegram" className="h-4 w-4" />
                Open in Telegram
              </a>
            ) : null}
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

        {dryRunConfigureHints.length > 0 ? (
          <div
            className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"
            data-testid="builder-test-configure-hints"
          >
            <p className="text-sm font-bold text-amber-900">Complete this before running the dry test</p>
            <ul className="mt-2 space-y-1.5">
              {dryRunConfigureHints.map((hint) => (
                <li key={hint} className="flex items-start gap-2 text-sm text-amber-900/90">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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

        <div className="shadow-soft mt-5 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6" data-testid="builder-test-trigger-section">
          <h3 className="mb-5 text-[13px] font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-test-panel-simulate-a-missed-call-heading">
            {isVoiceWorkflow
              ? "Trigger — inbound call"
              : isMissedCallWorkflow
                ? "Trigger — missed call"
                : isSmsWorkflow
                  ? "Trigger — inbound SMS"
                  : isTelegramWorkflow
                    ? "Trigger — Telegram"
                    : hasWhatsAppTrigger
                      ? "Trigger — WhatsApp"
                      : needsCalendlyConnection
                        ? "Trigger — Calendly"
                        : "Trigger"}
          </h3>
          {isTelegramWorkflow ? (
            <div className="mb-5 rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm leading-6 text-sky-900" data-testid="builder-test-telegram-live-instructions">
              These values provide sample business context to the draft. Connect the test bot below, open it in Telegram,
              and send a real message. Incoming updates and outgoing replies use Telegram&apos;s live API.
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {showCallerFields && (
              <>
                <label data-testid="architect-ui-workflow-builder-test-panel-caller-number-on-caller-number-change-event-label">
                  <span className="mb-1.5 block text-[13px] font-semibold text-slate-700" data-testid="architect-ui-workflow-builder-test-panel-caller-number-text">
                    {isSmsWorkflow || hasWhatsAppTrigger
                      ? "Sender phone"
                      : isVoiceWorkflow
                        ? "Caller phone"
                        : "Caller number"}
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
                    {isSmsWorkflow || hasWhatsAppTrigger ? "Sender name" : "Caller name"}
                  </span>
                  <input data-testid="builder-test-caller-name-input"
                    type="text"
                    value={callerName}
                    onChange={(event) => onCallerNameChange(event.target.value)}
                    placeholder={isVoiceWorkflow ? "Customer name" : "Name"}
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
                      : hasWhatsAppTrigger
                        ? "WhatsApp message"
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
                        : hasWhatsAppTrigger
                          ? "Type a WhatsApp message to trigger the workflow..."
                          : "Type or paste text content (e.g. resume content or SMS text) to trigger the workflow..."
                  }
                  data-testid="builder-test-trigger-message-input"
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
                  {isTelegramWorkflow ? (
                    <textarea
                      rows={4}
                      value={appointmentService}
                      onChange={(event) => onAppointmentServiceChange(event.target.value)}
                      placeholder={"General Consultation\nDental Cleaning\nEmergency Visit"}
                      data-testid="builder-test-appointment-service-input"
                      className="fld w-full resize-y rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-400/30"
                    />
                  ) : (
                    <input
                      type="text"
                      value={appointmentService}
                      onChange={(event) => onAppointmentServiceChange(event.target.value)}
                      placeholder="General Consultation"
                      data-testid="builder-test-appointment-service-input"
                      className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                    />
                  )}
                  {isTelegramWorkflow ? (
                    <span className="mt-1 block text-[11px] text-slate-500">Enter one test service per line. Every buyer can use a different list from Business Profile.</span>
                  ) : null}
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

            {showCalendlyTestFields ? (
              <>

                {showCalendlyTriggerFields ? (
                  <>
                    <label data-testid="builder-test-calendly-trigger-event-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Trigger event
                      </span>
                      <select
                        data-testid="builder-test-calendly-trigger-event-select"
                        value={calendlyTriggerEvent}
                        onChange={(event) => onCalendlyTriggerEventChange?.(event.target.value)}
                        className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                      >
                        <option value="meeting_booked">Meeting booked</option>
                        <option value="meeting_cancelled">Meeting cancelled</option>
                        <option value="meeting_rescheduled">Meeting rescheduled</option>
                        <option value="routing_form_submitted">Routing form submitted</option>
                      </select>
                    </label>
                    <label data-testid="builder-test-calendly-meeting-name-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Meeting name
                      </span>
                      <input
                        data-testid="builder-test-calendly-meeting-name-input"
                        type="text"
                        value={calendlyMeetingName}
                        onChange={(event) => onCalendlyMeetingNameChange?.(event.target.value)}
                        placeholder="30 Minute Meeting"
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                      />
                    </label>
                    <label data-testid="builder-test-calendly-invitee-name-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Invitee name
                      </span>
                      <input
                        data-testid="builder-test-calendly-invitee-name-input"
                        type="text"
                        value={calendlyInviteeName}
                        onChange={(event) => onCalendlyInviteeNameChange?.(event.target.value)}
                        placeholder="Invitee name"
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                      />
                    </label>
                    <label data-testid="builder-test-calendly-invitee-email-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Invitee email
                      </span>
                      <input
                        data-testid="builder-test-calendly-invitee-email-input"
                        type="text"
                        value={calendlyInviteeEmail}
                        onChange={(event) => onCalendlyInviteeEmailChange?.(event.target.value)}
                        placeholder="invitee@email.com"
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                      />
                    </label>
                  </>
                ) : null}
                {showCalendlyEventTypeUri ? (
                  <label className="col-span-1 sm:col-span-2" data-testid="builder-test-calendly-event-type-uri-label">
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Event type
                      <CalendlyRequiredMark />
                    </span>
                    <select
                      data-testid="builder-test-calendly-event-type-uri-input"
                      value={calendlyEventTypeUri}
                      onChange={(event) => {
                        onCalendlyEventTypeUriChange?.(event.target.value);
                        onCalendlyStartTimeChange?.("");
                      }}
                      disabled={!calendlyConnected || eventTypePicker.loading}
                      className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                    >
                      <option value="">
                        {eventTypePicker.loading
                          ? "Loading event types…"
                          : eventTypePicker.options.length === 0
                            ? "No event types found"
                            : "Select an event type"}
                      </option>
                      {calendlyPickerSelectOptions(calendlyEventTypeUri, eventTypePicker.options).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {eventTypePicker.error ? (
                      <p className="mt-1.5 text-[12px] text-rose-600" data-testid="builder-test-calendly-event-type-error">
                        {eventTypePicker.error}
                      </p>
                    ) : null}
                  </label>
                ) : null}
                {showCalendlyEventUuid ? (
                  <label data-testid="builder-test-calendly-event-uuid-label">
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Event
                      <CalendlyRequiredMark />
                    </span>
                    <select
                      data-testid="builder-test-calendly-event-uuid-input"
                      value={calendlyEventUuid}
                      onChange={(event) => {
                        onCalendlyEventUuidChange?.(event.target.value);
                        onCalendlyInviteeUuidChange?.("");
                      }}
                      disabled={!calendlyConnected || eventPicker.loading}
                      className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                    >
                      <option value="">
                        {eventPicker.loading
                          ? "Loading events…"
                          : eventPicker.options.length === 0
                            ? calendlyActionSet.has("mark_invitee_no_show")
                              ? "No started meetings found"
                              : "No recent events found"
                            : "Select an event"}
                      </option>
                      {calendlyPickerSelectOptions(calendlyEventUuid, eventPicker.options).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {eventPicker.error ? (
                      <p className="mt-1.5 text-[12px] text-rose-600" data-testid="builder-test-calendly-event-error">
                        {eventPicker.error}
                      </p>
                    ) : null}
                    {calendlyActionSet.has("mark_invitee_no_show") ? (
                      <p className="mt-1.5 text-[12px] leading-4 text-slate-400">
                        Only meetings that have already started are listed — Calendly blocks no-show before the start time.
                      </p>
                    ) : null}
                  </label>
                ) : null}
                {showCalendlyInviteeUuid ? (
                  <label data-testid="builder-test-calendly-invitee-uuid-label">
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Invitee
                      <CalendlyRequiredMark />
                    </span>
                    <select
                      data-testid="builder-test-calendly-invitee-uuid-input"
                      value={calendlyInviteeUuid}
                      onChange={(event) => onCalendlyInviteeUuidChange?.(event.target.value)}
                      disabled={!calendlyConnected || !calendlyEventUuid.trim() || inviteePicker.loading}
                      className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                    >
                      <option value="">
                        {!calendlyEventUuid.trim()
                          ? "Select an event first"
                          : inviteePicker.loading
                            ? "Loading invitees…"
                            : inviteePicker.options.length === 0
                              ? "No invitees found"
                              : "Select an invitee"}
                      </option>
                      {calendlyPickerSelectOptions(calendlyInviteeUuid, inviteePicker.options).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {inviteePicker.error ? (
                      <p className="mt-1.5 text-[12px] text-rose-600" data-testid="builder-test-calendly-invitee-error">
                        {inviteePicker.error}
                      </p>
                    ) : null}
                  </label>
                ) : null}
                {showCalendlyTimeRange ? (
                  <>
                    <label
                      className="col-span-1 sm:col-span-2"
                      data-testid="builder-test-calendly-timezone-label"
                    >
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Timezone
                        <CalendlyRequiredMark />
                      </span>
                      <CalendlyTimezoneSelect
                        value={calendlyTimezone}
                        onChange={(value) => onCalendlyTimezoneChange?.(value)}
                        disabled={!calendlyConnected}
                        testId="builder-test-calendly-timezone-input"
                      />
                    </label>
                    <CalendlyTeamsRangePicker
                      startValue={calendlyStartTime}
                      endValue={calendlyEndTime}
                      timeZone={calendlyTimezone}
                      disabled={!calendlyConnected}
                      requiredMark
                      valueMode="iso"
                      startLabel="Window start"
                      durationLabel="Window length"
                      testIdPrefix="builder-test-calendly-window"
                      onChange={({ start, end }) => {
                        onCalendlyStartTimeChange?.(start);
                        onCalendlyEndTimeChange?.(end);
                      }}
                    />
                  </>
                ) : null}
                {showCalendlyBookStartTime ? (
                  <div
                    className="col-span-1 sm:col-span-2"
                    data-testid="builder-test-calendly-book-start-time-label"
                  >
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Start time
                      <CalendlyRequiredMark />
                    </span>
                    <div className="mb-3">
                      <span className="mb-1.5 block text-[12px] font-medium text-slate-500">Timezone</span>
                      <CalendlyTimezoneSelect
                        value={calendlyTimezone}
                        onChange={(value) => onCalendlyTimezoneChange?.(value)}
                        disabled={!calendlyConnected}
                        testId="builder-test-calendly-book-timezone-input"
                      />
                    </div>
                    <CalendlyAvailableSlotButtons
                      options={
                        calendlyStartTime.trim() &&
                        !availableTimePicker.options.some((option) => option.value === calendlyStartTime)
                          ? [{ value: calendlyStartTime, label: calendlyStartTime }, ...availableTimePicker.options]
                          : availableTimePicker.options
                      }
                      value={calendlyStartTime}
                      onChange={(value) => onCalendlyStartTimeChange?.(value)}
                      timeZone={calendlyTimezone}
                      loading={availableTimePicker.loading}
                      disabled={
                        !calendlyConnected || !calendlyEventTypeUri.trim() || availableTimePicker.loading
                      }
                      emptyHint={
                        !calendlyEventTypeUri.trim()
                          ? "Select an event type first"
                          : "No available times in the next 7 days"
                      }
                      error={availableTimePicker.error}
                      testIdPrefix="builder-test-calendly-start-time"
                    />
                  </div>
                ) : null}
                {showCalendlyBookInviteeFields && !showCalendlyTriggerFields ? (
                  <>
                    {calendlyActionSet.has("book_meeting_for_invitee") ? (
                      <label data-testid="builder-test-calendly-book-invitee-name-label">
                        <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                          Invitee name
                          <CalendlyRequiredMark />
                        </span>
                        <input
                          data-testid="builder-test-calendly-book-invitee-name-input"
                          type="text"
                          value={calendlyInviteeName}
                          onChange={(event) => onCalendlyInviteeNameChange?.(event.target.value)}
                          placeholder="Invitee name"
                          className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                        />
                      </label>
                    ) : null}
                    <label data-testid="builder-test-calendly-book-invitee-email-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Invitee email
                        <CalendlyRequiredMark />
                      </span>
                      <input
                        data-testid="builder-test-calendly-book-invitee-email-input"
                        type="text"
                        value={calendlyInviteeEmail}
                        onChange={(event) => onCalendlyInviteeEmailChange?.(event.target.value)}
                        placeholder="invitee@email.com"
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                      />
                    </label>
                  </>
                ) : null}
                {showCalendlyContactEmail ? (
                  <label data-testid="builder-test-calendly-contact-email-label">
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Contact email
                      <CalendlyRequiredMark />
                    </span>
                    <input
                      data-testid="builder-test-calendly-contact-email-input"
                      type="email"
                      value={calendlyContactEmail}
                      onChange={(event) => onCalendlyContactEmailChange?.(event.target.value)}
                      placeholder="contact@email.com"
                      className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                    />
                  </label>
                ) : null}
                {showCalendlyContactName ? (
                  <label data-testid="builder-test-calendly-contact-name-label">
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Contact name
                    </span>
                    <input
                      data-testid="builder-test-calendly-contact-name-input"
                      type="text"
                      value={calendlyContactName}
                      onChange={(event) => onCalendlyContactNameChange?.(event.target.value)}
                      placeholder="Optional name"
                      className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                    />
                  </label>
                ) : null}
                {showCalendlyContactUuid ? (
                  <label
                    className="col-span-1 sm:col-span-2"
                    data-testid="builder-test-calendly-contact-uuid-label"
                  >
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Contact
                      <CalendlyRequiredMark />
                    </span>
                    <select
                      data-testid="builder-test-calendly-contact-uuid-input"
                      value={calendlyContactUuid}
                      onChange={(event) => onCalendlyContactUuidChange?.(event.target.value)}
                      disabled={!calendlyConnected || contactPicker.loading}
                      className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                    >
                      <option value="">
                        {contactPicker.loading
                          ? "Loading contacts…"
                          : contactPicker.options.length === 0
                            ? "No contacts found"
                            : "Select a contact"}
                      </option>
                      {calendlyPickerSelectOptions(calendlyContactUuid, contactPicker.options).map(
                        (option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        )
                      )}
                    </select>
                    {contactPicker.error ? (
                      <p className="mt-1.5 text-[12px] text-rose-600" data-testid="builder-test-calendly-contact-error">
                        {contactPicker.error}
                      </p>
                    ) : null}
                  </label>
                ) : null}
                {showCalendlyCancelReason ? (
                  <label
                    className="col-span-1 sm:col-span-2"
                    data-testid="builder-test-calendly-cancel-reason-label"
                  >
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Cancellation reason
                    </span>
                    <input
                      data-testid="builder-test-calendly-cancel-reason-input"
                      type="text"
                      value={calendlyCancelReason}
                      onChange={(event) => onCalendlyCancelReasonChange?.(event.target.value)}
                      placeholder="Optional reason"
                      className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                    />
                  </label>
                ) : null}
                {showCalendlyMeetingRecapUuid ? (
                  <label
                    className="col-span-1 sm:col-span-2"
                    data-testid="builder-test-calendly-meeting-recap-uuid-label"
                  >
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      Meeting recap
                      <CalendlyRequiredMark />
                    </span>
                    <select
                      data-testid="builder-test-calendly-meeting-recap-uuid-input"
                      value={calendlyMeetingRecapUuid}
                      onChange={(event) => onCalendlyMeetingRecapUuidChange?.(event.target.value)}
                      disabled={!calendlyConnected || meetingRecapPicker.loading}
                      className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                    >
                      <option value="">
                        {meetingRecapPicker.loading
                          ? "Loading meeting recaps…"
                          : meetingRecapPicker.options.length === 0
                            ? "No meeting recaps found"
                            : "Select a meeting recap"}
                      </option>
                      {calendlyPickerSelectOptions(
                        calendlyMeetingRecapUuid,
                        meetingRecapPicker.options
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {meetingRecapPicker.error ? (
                      <p
                        className="mt-1.5 text-[12px] text-rose-600"
                        data-testid="builder-test-calendly-meeting-recap-error"
                      >
                        {meetingRecapPicker.error}
                      </p>
                    ) : null}
                  </label>
                ) : null}
                {showCalendlyUserSearch ? (
                  <label
                    className="col-span-1 sm:col-span-2"
                    data-testid="builder-test-calendly-user-search-label"
                  >
                    <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                      User email or name
                      <CalendlyRequiredMark />
                    </span>
                    <input
                      data-testid="builder-test-calendly-user-search-input"
                      type="text"
                      value={calendlyUserSearch}
                      onChange={(event) => onCalendlyUserSearchChange?.(event.target.value)}
                      placeholder="name@email.com or full name"
                      className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                    />
                  </label>
                ) : null}
                {showCalendlyOneOffFields ? (
                  <>
                    <div
                      className="col-span-1 rounded-xl border border-amber-100 bg-amber-50/50 px-3.5 py-3 sm:col-span-2"
                      data-testid="builder-test-calendly-one-off-host"
                    >
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-800/80">
                        Host (from connected Calendly)
                      </p>
                      <p className="mt-1 text-[14px] font-medium text-slate-800">
                        {calendlyConnected
                          ? [calendlyName, calendlyEmail].filter(Boolean).join(" · ") ||
                            "Connected Calendly account"
                          : "Connect Calendly to use your account as host"}
                      </p>
                    </div>
                    <label
                      className="col-span-1 sm:col-span-2"
                      data-testid="builder-test-calendly-one-off-meeting-name-label"
                    >
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Meeting name
                        <CalendlyRequiredMark />
                      </span>
                      <input
                        data-testid="builder-test-calendly-one-off-meeting-name-input"
                        type="text"
                        value={calendlyMeetingName}
                        onChange={(event) => onCalendlyMeetingNameChange?.(event.target.value)}
                        placeholder="One-off meeting"
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                      />
                    </label>
                    <label data-testid="builder-test-calendly-one-off-duration-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Meeting length
                        <CalendlyRequiredMark />
                      </span>
                      <select
                        data-testid="builder-test-calendly-one-off-duration-input"
                        value={calendlyDurationMinutes}
                        onChange={(event) => onCalendlyDurationMinutesChange?.(event.target.value)}
                        disabled={!calendlyConnected}
                        className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                      >
                        {CALENDLY_DURATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                        {!CALENDLY_DURATION_OPTIONS.some((option) => option.value === calendlyDurationMinutes) &&
                        calendlyDurationMinutes ? (
                          <option value={calendlyDurationMinutes}>{calendlyDurationMinutes} minutes</option>
                        ) : null}
                      </select>
                    </label>
                    <label data-testid="builder-test-calendly-one-off-timezone-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Timezone
                      </span>
                      <CalendlyTimezoneSelect
                        value={calendlyTimezone}
                        onChange={(value) => onCalendlyTimezoneChange?.(value)}
                        disabled={!calendlyConnected}
                        testId="builder-test-calendly-one-off-timezone-input"
                      />

                    </label>
                    <div
                      className="col-span-1 sm:col-span-2"
                      data-testid="builder-test-calendly-one-off-start-date-label"
                    >
                      <p className="mb-1.5 text-[13px] font-semibold text-slate-700">
                        Availability window
                        <CalendlyRequiredMark />
                      </p>
                      <CalendlyTeamsRangePicker
                        startValue={calendlyOneOffStartDate}
                        endValue={calendlyOneOffEndDate}
                        timeZone={calendlyTimezone}
                        disabled={!calendlyConnected}
                        requiredMark
                        valueMode="local"
                        startLabel="Window start"
                        durationLabel="Window length"
                        testIdPrefix="builder-test-calendly-one-off-window"
                        onChange={({ start, end }) => {
                          onCalendlyOneOffStartDateChange?.(start);
                          onCalendlyOneOffEndDateChange?.(end);
                        }}
                      />
                    </div>
                    <label data-testid="builder-test-calendly-one-off-location-kind-label">
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                        Location
                      </span>
                      <select
                        data-testid="builder-test-calendly-one-off-location-kind-input"
                        value={calendlyLocationKind || "ask_invitee"}
                        onChange={(event) => onCalendlyLocationKindChange?.(event.target.value)}
                        disabled={!calendlyConnected}
                        className="fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                      >
                        {CALENDLY_LOCATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {calendlyLocationKind === "physical" ||
                    calendlyLocationKind === "custom" ||
                    calendlyLocationKind === "outbound_call" ? (
                      <label data-testid="builder-test-calendly-one-off-location-label">
                        <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                          Location details
                        </span>
                        <input
                          data-testid="builder-test-calendly-one-off-location-input"
                          type="text"
                          value={calendlyLocation}
                          onChange={(event) => onCalendlyLocationChange?.(event.target.value)}
                          placeholder={
                            calendlyLocationKind === "outbound_call"
                              ? "+15551234567"
                              : "Office address or custom link"
                          }
                          className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {testSectionOrder
          .filter((section) => section === "stt" || section === "tts")
          .map((section) => {
            if (section === "stt" && hasDeepgramStt) {
              return (
                <div key="test-section-stt" className="mt-5" data-testid="builder-test-deepgram-stt-section">
                  <DeepgramSttTestCard
                    testIdPrefix="architect-deepgram"
                    title="Try transcription"
                    description="Tap the microphone and speak. Your words appear live as you talk."
                    livePath="/architect/ai/deepgram/live"
                    onAudioCaptured={(audio) => {
                      onTriggerAttachmentsChange([
                        {
                          name: audio.name,
                          mimeType: audio.mimeType,
                          data: audio.data
                        }
                      ]);
                    }}
                  />
                </div>
              );
            }
            if (section === "tts" && hasDeepgramTts) {
              return (
                <div key="test-section-tts" className="mt-5" data-testid="builder-test-deepgram-tts-section">
                  <DeepgramTtsTestCard
                    testIdPrefix="architect-deepgram"
                    title="Try voice"
                    description="Enter a short message and play how it sounds."
                    onSpeak={async (input) => {
                      const response = await speakArchitectDeepgram(input);
                      return {
                        success: response.success,
                        data: response.data ?? null,
                        error: response.error
                      };
                    }}
                  />
                </div>
              );
            }
            return null;
          })}

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

            {needsCalendlyConnection ? (
              <div
                className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3.5"
                data-testid="builder-test-calendly-card"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#006BFF]/10">
                    <BuilderIcon name="calendly" className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800" data-testid="builder-test-calendly-status">
                      {calendlyConnected ? "Calendly connected" : "Calendly"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {calendlyConnected
                        ? `Connected as ${calendlyEmail || "your account"}`
                        : "Connect so meeting webhooks and Calendly actions can run."}
                    </p>
                  </div>
                </div>
                {calendlyConnected ? (
                  <button
                    type="button"
                    onClick={onDisconnectCalendly}
                    data-testid="builder-test-disconnect-calendly"
                    className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-gray-300"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onConnectCalendly}
                    disabled={connectingCalendly}
                    data-testid="builder-test-connect-calendly"
                    className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                  >
                    {connectingCalendly ? "Connecting…" : "Connect"}
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

            {isTelegramWorkflow ? (
              <div
                className="mt-3 rounded-xl border border-sky-100 bg-sky-50/30 px-4 py-4"
                data-testid="builder-test-telegram-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#229ED9] text-white">
                      <BuilderIcon name="telegram" className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800" data-testid="builder-test-telegram-status">
                        {telegramTestConnection?.connected
                          ? `@${telegramTestConnection.botUsername || "telegram_test_bot"}`
                          : "Telegram test bot"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {telegramTestConnection?.connected
                          ? "Webhook is connected to this draft workflow."
                          : "Use a separate BotFather token reserved for Architect testing."}
                      </p>
                    </div>
                  </div>

                  {telegramTestConnection?.connected ? (
                    <div className="flex gap-2">
                      {telegramTestConnection.botUrl ? (
                        <a href={telegramTestConnection.botUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-[#229ED9] px-4 py-2 text-xs font-semibold text-white">
                          Open on phone
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={onDisconnectTelegramTest}
                        disabled={connectingTelegramTest}
                        data-testid="builder-test-disconnect-telegram"
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4" data-testid="builder-test-telegram-commands">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-sky-800">Test bot command menu</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        These are the Architect defaults. Save &amp; sync updates the Test business name, services, and real command menu visible on your phone.
                      </p>
                    </div>
                    {telegramTestConnection?.connected ? (
                      <button
                        type="button"
                        onClick={onSyncTelegramTest}
                        disabled={connectingTelegramTest || syncingTelegramTest || Boolean(telegramCustomCommandError)}
                        data-testid="builder-test-sync-telegram"
                        className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 disabled:opacity-60"
                      >
                        {syncingTelegramTest ? "Syncing…" : "Save & sync test setup"}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="flex items-center justify-between rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      <span>/start</span><span className="text-sky-700">Always on</span>
                    </div>
                    <TelegramCommandToggle
                      label="/services"
                      checked={telegramCommandSettings.telegramServicesCommand}
                      onChange={(value) => onTelegramCommandChange?.("telegramServicesCommand", value)}
                    />
                    <TelegramCommandToggle
                      label="Booking features"
                      checked={telegramCommandSettings.telegramBookingMode}
                      onChange={(value) => onTelegramCommandChange?.("telegramBookingMode", value)}
                    />
                    <TelegramCommandToggle
                      label="/book"
                      checked={telegramCommandSettings.telegramBookCommand}
                      disabled={!telegramCommandSettings.telegramBookingMode}
                      onChange={(value) => onTelegramCommandChange?.("telegramBookCommand", value)}
                    />
                    <TelegramCommandToggle
                      label="/mybookings"
                      checked={telegramCommandSettings.telegramMyBookingsCommand}
                      disabled={!telegramCommandSettings.telegramBookingMode}
                      onChange={(value) => onTelegramCommandChange?.("telegramMyBookingsCommand", value)}
                    />
                    <TelegramCommandToggle
                      label="/reschedule"
                      checked={telegramCommandSettings.telegramRescheduleCommand}
                      disabled={!telegramCommandSettings.telegramBookingMode}
                      onChange={(value) => onTelegramCommandChange?.("telegramRescheduleCommand", value)}
                    />
                    <TelegramCommandToggle
                      label="/cancel"
                      checked={telegramCommandSettings.telegramCancelCommand}
                      disabled={!telegramCommandSettings.telegramBookingMode}
                      onChange={(value) => onTelegramCommandChange?.("telegramCancelCommand", value)}
                    />
                    <TelegramCommandToggle
                      label="/help"
                      checked={telegramCommandSettings.telegramHelpCommand}
                      onChange={(value) => onTelegramCommandChange?.("telegramHelpCommand", value)}
                    />
                  </div>
                  <div className="mt-4 border-t border-sky-100 pt-4" data-testid="builder-test-telegram-custom-commands">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-800">Custom commands</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Add the command shown in Telegram, describe its feature, then choose what the bot should do.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onTelegramCustomCommandsChange?.([
                          ...telegramCustomCommands,
                          newTelegramCustomCommand()
                        ])}
                        disabled={telegramCustomCommands.length >= 20}
                        data-testid="builder-test-add-telegram-command"
                        className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 disabled:opacity-50"
                      >
                        Add command
                      </button>
                    </div>
                    {telegramCustomCommands.length ? (
                      <div className="mt-3 space-y-3">
                        {telegramCustomCommands.map((custom, index) => {
                          const updateCustom = (patch: Partial<TelegramCustomCommand>) => {
                            onTelegramCustomCommandsChange?.(
                              telegramCustomCommands.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, ...patch } : item
                              )
                            );
                          };
                          return (
                            <div key={custom.id} className="rounded-xl border border-sky-100 bg-white p-3" data-testid="builder-test-telegram-custom-command">
                              <div className="grid gap-3 md:grid-cols-3">
                                <label>
                                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Command</span>
                                  <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-sky-300">
                                    <span className="px-3 py-2 text-sm text-slate-400">/</span>
                                    <input
                                      value={custom.command}
                                      onChange={(event) => updateCustom({
                                        command: event.target.value.toLowerCase().replace(/^\/+/, "").replace(/[^a-z0-9_]/g, "").slice(0, 32)
                                      })}
                                      placeholder="contact"
                                      className="min-w-0 flex-1 rounded-r-lg px-1 py-2 text-sm text-slate-800 outline-none"
                                      data-testid="builder-test-telegram-custom-command-name"
                                    />
                                  </div>
                                </label>
                                <label>
                                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Menu description</span>
                                  <input
                                    value={custom.description}
                                    onChange={(event) => updateCustom({ description: event.target.value.slice(0, 256) })}
                                    placeholder="Show contact information"
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-300"
                                    data-testid="builder-test-telegram-custom-command-description"
                                  />
                                </label>
                                <label>
                                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">What should it do?</span>
                                  <select
                                    value={custom.action}
                                    onChange={(event) => updateCustom({ action: event.target.value as TelegramCustomCommand["action"] })}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-300"
                                    data-testid="builder-test-telegram-custom-command-action"
                                  >
                                    <option value="reply">Send a custom reply</option>
                                    <option value="services">Show services</option>
                                    <option value="book">Start booking</option>
                                    <option value="help">Show command help</option>
                                  </select>
                                </label>
                              </div>
                              {custom.action === "reply" ? (
                                <label className="mt-3 block">
                                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Bot reply</span>
                                  <textarea
                                    rows={2}
                                    value={custom.response}
                                    onChange={(event) => updateCustom({ response: event.target.value.slice(0, 4096) })}
                                    placeholder="You can contact {{business.name}} at..."
                                    className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-300"
                                    data-testid="builder-test-telegram-custom-command-response"
                                  />
                                </label>
                              ) : null}
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => onTelegramCustomCommandsChange?.(
                                    telegramCustomCommands.filter((_, itemIndex) => itemIndex !== index)
                                  )}
                                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                                  data-testid="builder-test-remove-telegram-command"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">No custom commands yet.</p>
                    )}
                    {telegramCustomCommandError ? (
                      <p className="mt-2 text-xs font-semibold text-rose-600" data-testid="builder-test-telegram-custom-command-error">
                        {telegramCustomCommandError}
                      </p>
                    ) : null}
                  </div>
                </div>

                {!telegramTestConnection?.connected ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={telegramBotToken}
                      onChange={(event) => setTelegramBotToken(event.target.value)}
                      autoComplete="off"
                      placeholder="BotFather token · 123456789:AA..."
                      data-testid="builder-test-telegram-token"
                      className="fld min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 font-mono text-[13px] text-slate-800 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-400/30"
                    />
                    <button
                      type="button"
                      onClick={() => onConnectTelegramTest?.(telegramBotToken.trim())}
                      disabled={connectingTelegramTest || telegramBotToken.trim().length < 20 || Boolean(telegramCustomCommandError)}
                      data-testid="builder-test-connect-telegram"
                      className="rounded-xl bg-[#229ED9] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#168ac2] disabled:opacity-60"
                    >
                      {connectingTelegramTest ? "Connecting…" : "Connect test bot"}
                    </button>
                  </div>
                ) : null}

                {telegramTestConnection?.lastChatId ? (
                  <p className="mt-3 text-xs font-medium text-emerald-700" data-testid="builder-test-telegram-chat-captured">
                    Latest Telegram chat captured for replies and confirmation messages.
                  </p>
                ) : null}

                {telegramTestConnection?.lastRunAt ? (
                  <div className="mt-4 border-t border-sky-100 pt-3" data-testid="builder-test-telegram-last-run">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-1 font-bold ${
                        telegramTestConnection.lastRunStatus === "SUCCESS"
                          ? "bg-emerald-100 text-emerald-700"
                          : telegramTestConnection.lastRunStatus === "FAILED"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                      }`}>
                        {telegramTestConnection.lastRunStatus}
                      </span>
                      <span className="text-slate-500">
                        {telegramTestConnection.lastSender || "Telegram user"} · {telegramTestConnection.lastMessage || "Update received"}
                      </span>
                    </div>
                    {telegramTestConnection.lastError ? (
                      <p className="mt-2 text-xs font-semibold text-rose-600">{telegramTestConnection.lastError}</p>
                    ) : null}
                    {telegramTestConnection.lastRunLogs.length ? (
                      <div className="mt-3 space-y-1.5">
                        {telegramTestConnection.lastRunLogs.slice(-5).map((log, index) => (
                          <p key={`${log.nodeId}-${index}`} className="text-xs text-slate-600">
                            <span className="font-semibold text-slate-800">{log.label}:</span> {log.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

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

        {runLogs.length > 0 ? (
          <NodeResultsPanel
            runLogs={runLogs}
            llmPipeline={
              hasLlmPipeline && runContext.llmPipeline && typeof runContext.llmPipeline === "object"
                ? (runContext.llmPipeline as Record<string, LlmPipelineStep>)
                : undefined
            }
          />
        ) : null}

        {hasResult ? (
          <div className="mt-5 space-y-5 pb-2" data-testid="test-panel-results-by-node">
            <h3
              className="text-[13px] font-bold uppercase tracking-wider text-slate-400"
              data-testid="architect-ui-workflow-builder-test-panel-has-gmail-flow-email-result-message-the-heading"
            >
              Results
            </h3>

            {needsCalendlyConnection && calendlyResult ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-calendly-result"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-[#006BFF]">
                    <BuilderIcon name="calendly" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Calendly</p>
                    <p className="text-xs text-slate-500">
                      {calendlyResult.actionLabel || "Scheduling"}
                    </p>
                  </div>
                </div>
                <div className="space-y-3 min-w-0 max-w-full">
                  {(calendlyResult.calendlyEvent || calendlyResult.inviteeName || calendlyResult.meetingName) ? (
                    <div className="rounded-xl border border-sky-100 bg-sky-50/30 p-4" data-testid="test-panel-calendly-trigger-preview">
                      <p className="text-sm font-semibold text-slate-800">
                        {calendlyResult.meetingName || "Calendly meeting"}
                        {calendlyResult.calendlyEvent ? (
                          <span className="ml-2 text-xs font-medium text-slate-500">
                            ({calendlyResult.calendlyEvent.replace(/_/g, " ")})
                          </span>
                        ) : null}
                      </p>
                      {calendlyResult.inviteeName || calendlyResult.inviteeEmail ? (
                        <p className="mt-1 text-[13px] text-slate-600">
                          Invitee: {[calendlyResult.inviteeName, calendlyResult.inviteeEmail].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {calendlyResult.startTime ? (
                        <p className="mt-1 text-[13px] text-slate-500">
                          {formatCalendlyPreviewTime(calendlyResult.startTime)}
                          {calendlyResult.endTime
                            ? ` → ${formatCalendlyPreviewTime(calendlyResult.endTime)}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {calendlyResult.action ||
                  calendlyResult.fields.length > 0 ||
                  calendlyResult.items.length > 0 ||
                  calendlyResult.summary ? (
                    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4" data-testid="test-panel-calendly-action-preview">
                      <p className="text-sm font-semibold text-slate-800" data-testid="test-panel-calendly-action-summary">
                        {calendlyResult.summary || "Calendly action completed."}
                      </p>
                      {calendlyResult.fields.length > 0 ? (
                        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                          {calendlyResult.fields.map((field) => (
                            <div key={`${field.label}-${field.value}`} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100">
                              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{field.label}</dt>
                              <dd className="mt-0.5 break-words text-[13px] text-slate-700">{field.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {calendlyResult.items.length > 0 ? (
                        <ul className="mt-3 space-y-2" data-testid="test-panel-calendly-action-items">
                          {calendlyResult.items.map((item, index) => (
                            <li
                              key={`${item.title}-${index}`}
                              className="rounded-lg border border-gray-100 bg-white px-3 py-2"
                            >
                              <p className="text-[13px] font-medium text-slate-800">{item.title}</p>
                              {item.detail ? (
                                <p className="mt-0.5 text-[12px] text-slate-500">{item.detail}</p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasDeepgramStt && deepgramSttResults.length > 0 ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-deepgram-stt-results"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <BuilderIcon name="mic" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Transcription</p>
                    <p className="text-xs text-slate-500">From speech-to-text</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {deepgramSttResults.map((result) => (
                    <div
                      key={`stt-${result.nodeId}`}
                      className="rounded-xl border border-slate-100 bg-slate-50/80 p-4"
                      data-testid={`test-panel-deepgram-stt-result-${result.nodeId}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{result.label}</p>
                        {result.model ? (
                          <span className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                            {result.model}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                        {result.transcript}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {hasDeepgramTts && deepgramTtsResults.length > 0 ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-deepgram-tts-results"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <BuilderIcon name="sparkles" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Voice</p>
                    <p className="text-xs text-slate-500">From text-to-speech</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {deepgramTtsResults.map((result) => (
                    <div
                      key={`tts-${result.nodeId}`}
                      className="rounded-xl border border-slate-100 bg-slate-50/80 p-4"
                      data-testid={`test-panel-deepgram-tts-result-${result.nodeId}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{result.label}</p>
                        {result.model ? (
                          <span className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                            {result.model}
                          </span>
                        ) : null}
                      </div>
                      {result.text ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                          {result.text}
                        </p>
                      ) : null}
                      {result.audioUrl ? (
                        <audio
                          className="mt-3 w-full"
                          controls
                          src={result.audioUrl}
                          data-testid={`test-panel-deepgram-tts-audio-${result.nodeId}`}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}


            {hasLlmPipeline ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-llm-pipeline-results"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <BuilderIcon name="sparkles" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">AI reply</p>
                    <p className="text-xs text-slate-500">From AI nodes</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {Object.values(runContext.llmPipeline as Record<string, LlmPipelineStep>).map((step, idx) => {
                    const stepText = typeof step.output === "string" ? step.output : String(step.output ?? "");
                    const stepPreview = detectUiPreview(stepText);
                    return (
                    <div
                      key={idx}
                      className="overflow-hidden rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/60 to-white p-4"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="truncate text-sm font-bold text-violet-950">
                          {step.label || "LLM Step"}
                        </span>
                        {step.providerId || step.modelName ? (
                          <span className="shrink-0 rounded-full bg-violet-100/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-violet-700">
                            {[step.providerId, step.modelName].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-violet-100/80 break-words [overflow-wrap:anywhere]">
                        <Markdown content={stepText} />
                      </div>
                      {stepPreview ? (
                        <UiPreview source={stepPreview} nodeId={`llm-step-${idx}`} />
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {hasImagePipeline ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-image-pipeline-results"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <BuilderIcon name="image" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Generated images</p>
                    <p className="text-xs text-slate-500">From image nodes</p>
                  </div>
                </div>
                <div className="space-y-4">
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
                              : "",
                          prompt: typeof runContext.prompt === "string" ? runContext.prompt : "",
                          model: typeof runContext.model === "string" ? runContext.model : ""
                        }];
                    return steps.map((step, idx) => {
                      const imgSrc = step.imageUrl || (typeof step.image === "string" ? step.image : "");
                      return (
                        <div key={idx} className="rounded-xl border border-violet-100 bg-violet-50/10 p-4">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-bold text-violet-950">{step.label || "Generated Image"}</span>
                            {step.model ? (
                              <span className="font-mono text-[10px] font-semibold text-violet-700 bg-violet-100/80 px-2.5 py-1 rounded-full">
                                {step.model}
                              </span>
                            ) : null}
                          </div>
                          {imgSrc ? (
                            <div className="mt-3 space-y-3">
                              <img
                                src={imgSrc}
                                alt={step.prompt || "Generated image preview"}
                                className="max-h-80 w-auto rounded-lg object-contain"
                              />
                              <a
                                href={imgSrc}
                                download={`generated-image-${idx + 1}.png`}
                                target="_blank"
                                rel="noreferrer"
                                data-testid="test-panel-download-image-btn"
                                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-violet-700"
                              >
                                Download Image
                              </a>
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-slate-500">Image generated successfully.</p>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : null}

            {hasVoiceResult ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-voice-result"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <BuilderIcon name="phone-call" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Voice booking</p>
                    <p className="text-xs text-slate-500">From voice workflow</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {voiceConversation ? (
                    <div data-testid="test-panel-voice-conversation-preview">
                      <p className="text-sm leading-relaxed text-slate-700">&ldquo;{voiceConversation.firstMessage}&rdquo;</p>
                    </div>
                  ) : null}
                  {calendarAvailability ? (
                    <p className="text-xs text-slate-500" data-testid="test-panel-calendar-result">
                      Calendar: {calendarAvailability.source === "calendar" ? "checked Google Calendar" : "demo slots"}
                      {calendarAvailability.slots?.length ? ` — ${calendarAvailability.slots.join(", ")}` : ""}
                    </p>
                  ) : null}
                  {calendarAppointment ? (
                    <div data-testid="test-panel-appointment-result">
                      <p className={`text-sm ${calendarAppointment.status === "FAILED" ? "text-rose-600" : "text-slate-700"}`}>
                        Appointment: {calendarAppointment.summary}
                      </p>
                    </div>
                  ) : null}
                  {smsNotification ? (
                    <p className="text-xs text-slate-500" data-testid="test-panel-sms-notification-result">
                      SMS notification prepared
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(draftEmail || sentEmail || gmailRead) ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-email-result"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-600">
                    <BuilderIcon name="mail" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Email</p>
                    <p className="text-xs text-slate-500">From email nodes</p>
                  </div>
                </div>
                <EmailResult draftEmail={draftEmail} sentEmail={sentEmail} gmailRead={gmailRead} />
              </div>
            ) : null}

            {sentSms && !hasVoiceResult ? (
              <div
                className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6"
                data-testid="test-panel-sms-result"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-600">
                    <BuilderIcon name="message" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Message</p>
                    <p className="text-xs text-slate-500">From SMS nodes</p>
                  </div>
                </div>
                <div className="inline-block max-w-md rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
                  {sentSms.body ? <Markdown content={sentSms.body} /> : "No message body."}
                </div>
              </div>
            ) : null}

            {vapiCall && !hasVoiceResult ? (
              <div className="shadow-soft rounded-2xl border border-gray-100 bg-white p-5 sm:p-6">
                <p className="text-sm text-slate-700">
                  Voice call: {vapiCall.providerCalled ? "Started" : "Dry run"}
                  {vapiCall.status ? ` — ${vapiCall.status}` : ""}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

type LlmPipelineStep = {
  label?: string;
  output?: string;
  providerId?: string;
  modelName?: string;
  outputKey?: string;
};

function getLlmMessageFromLog(
  log: WorkflowRunLog,
  llmPipeline?: Record<string, LlmPipelineStep>
): { text: string; providerId?: string; modelName?: string } | null {
  const fromPipeline = llmPipeline?.[log.nodeId];
  if (fromPipeline && typeof fromPipeline.output === "string" && fromPipeline.output.trim()) {
    return {
      text: fromPipeline.output,
      providerId: fromPipeline.providerId,
      modelName: fromPipeline.modelName
    };
  }
  const output = log.output;
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim()) {
      return {
        text: record.text,
        providerId: typeof record.providerId === "string" ? record.providerId : undefined,
        modelName: typeof record.modelName === "string" ? record.modelName : undefined
      };
    }
  }
  return null;
}

function NodeResultsPanel({
  runLogs,
  llmPipeline
}: {
  runLogs: WorkflowRunLog[];
  llmPipeline?: Record<string, LlmPipelineStep>;
}) {
  const successCount = runLogs.filter((log) => log.status === "success").length;
  const errorCount = runLogs.filter((log) => log.status === "error").length;
  const waitingCount = runLogs.filter((log) => log.status === "waiting").length;

  return (
    <div className="mt-5 pb-2" data-testid="test-panel-node-results">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3
            className="text-[13px] font-bold uppercase tracking-wider text-slate-400"
            data-testid="test-panel-node-results-heading"
          >
            Node results
          </h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Output from each step in this dry test
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-100">
            {successCount} passed
          </span>
          {waitingCount > 0 ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800 ring-1 ring-amber-100">
              {waitingCount} need input
            </span>
          ) : null}
          {errorCount > 0 ? (
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700 ring-1 ring-red-100">
              {errorCount} failed
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative space-y-0">
        {runLogs.map((log, index) => {
          const llmMessage = getLlmMessageFromLog(log, llmPipeline);
          /* A step that generated markup gets a rendered preview. Checked on the
             LLM text too, since a page usually arrives inside a ```html fence.
             When the AI reply card is on screen it owns the preview for LLM
             steps, so the same page is not rendered twice on one run. */
          const uiPreview =
            llmMessage && llmPipeline
              ? null
              : (detectUiPreview(llmMessage?.text ?? null) ?? detectUiPreview(log.output));
          const allFields = llmMessage
            ? formatRunLogOutputFields(log.output).filter(
                (field) =>
                  field.label.toLowerCase() !== "text" &&
                  field.label.toLowerCase() !== "result" &&
                  field.label.toLowerCase() !== "provider id" &&
                  field.label.toLowerCase() !== "model name" &&
                  field.label.toLowerCase() !== "output key"
              )
            : formatRunLogOutputFields(log.output);
          // The markup is on screen in the preview; repeating it as a one-line
          // summary row would bury every other field under it.
          const fields = uiPreview ? allFields.filter((field) => !isMarkupField(field.value)) : allFields;
          const isLast = index === runLogs.length - 1;
          const isError = log.status === "error";
          const isWaiting = log.status === "waiting";
          const isLlm = Boolean(llmMessage);
          const stepTone = isError
            ? {
                line: "bg-red-200",
                ring: "bg-red-500 ring-red-100",
                card: "border-red-100 bg-gradient-to-br from-red-50/80 to-white",
                badge: "bg-red-100 text-red-700",
                iconBg: "bg-red-50 text-red-600"
              }
            : isWaiting
              ? {
                  line: "bg-amber-200",
                  ring: "bg-amber-500 ring-amber-100",
                  card: "border-amber-100 bg-gradient-to-br from-amber-50/80 to-white",
                  badge: "bg-amber-100 text-amber-800",
                  iconBg: "bg-amber-50 text-amber-600"
                }
              : isLlm
                ? {
                    line: "bg-violet-200",
                    ring: "bg-violet-500 ring-violet-100",
                    card: "border-violet-100 bg-gradient-to-br from-violet-50/70 to-white",
                    badge: "bg-violet-100 text-violet-700",
                    iconBg: "bg-violet-50 text-violet-600"
                  }
                : {
                    line: "bg-emerald-200",
                    ring: "bg-emerald-500 ring-emerald-100",
                    card: "border-gray-100 bg-white",
                    badge: "bg-emerald-50 text-emerald-700",
                    iconBg: "bg-emerald-50 text-emerald-600"
                  };

          return (
            <div
              key={`node-result-${log.nodeId}-${index}`}
              className="relative flex gap-3 sm:gap-4"
              data-testid={`test-panel-node-result-${log.nodeId}`}
            >
              <div className="flex w-8 shrink-0 flex-col items-center sm:w-9">
                <span
                  className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold text-white shadow-sm ring-4 ${stepTone.ring}`}
                  aria-hidden="true"
                >
                  {isError ? "!" : isWaiting ? "…" : index + 1}
                </span>
                {!isLast ? (
                  <span className={`mt-1 w-0.5 flex-1 min-h-[1.25rem] rounded-full ${stepTone.line}`} aria-hidden="true" />
                ) : null}
              </div>

              <div
                className={`shadow-soft mb-3 min-w-0 flex-1 overflow-hidden rounded-2xl border p-4 sm:mb-4 sm:p-5 ${stepTone.card}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${stepTone.iconBg}`}
                    aria-hidden="true"
                  >
                    {isError ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                      </svg>
                    ) : isWaiting ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" strokeLinecap="round" />
                      </svg>
                    ) : isLlm ? (
                      <BuilderIcon name="sparkles" className="h-4 w-4" />
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-900">{log.label}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stepTone.badge}`}
                      >
                        {isWaiting ? "needs input" : log.status}
                      </span>
                      {llmMessage?.providerId || llmMessage?.modelName ? (
                        <span className="rounded-full bg-violet-100/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-700">
                          {[llmMessage.providerId, llmMessage.modelName].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{log.message}</p>
                  </div>
                </div>

                {llmMessage && !llmPipeline ? (
                  <div
                    className="mt-4 rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-violet-100/80 min-w-0 max-w-full overflow-x-auto break-words [overflow-wrap:anywhere]"
                    data-testid={`test-panel-node-result-llm-${log.nodeId}`}
                  >
                    <Markdown content={llmMessage.text} />
                  </div>
                ) : null}

                {uiPreview ? <UiPreview source={uiPreview} nodeId={log.nodeId} /> : null}

                {fields.length > 0 ? (
                  <div
                    className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    data-testid={`test-panel-node-result-fields-${log.nodeId}`}
                  >
                    {fields.map((field) => (
                      <div
                        key={`${log.nodeId}-${field.label}-${field.value}`}
                        className="rounded-xl border border-gray-100 bg-slate-50/80 px-3 py-2.5"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {field.label}
                        </p>
                        <p className="mt-1 text-[13px] font-medium leading-snug text-slate-800 break-words [overflow-wrap:anywhere]">
                          {looksLikeUrl(field.value) ? (
                            <a
                              href={field.value}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#006BFF] underline-offset-2 hover:underline"
                            >
                              {field.value}
                            </a>
                          ) : (
                            field.value
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : !llmMessage && !uiPreview ? (
                  <p className="mt-3 text-[12px] italic text-slate-400">
                    {isWaiting
                      ? "Fill the fields above, then run the dry test again."
                      : "No extra output fields for this step."}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

function formatCalendlyPreviewTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return value;
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
