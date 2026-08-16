import {
  BROWSER_CALL_START_MESSAGE,
  buildAfterHoursSnapshot,
  resolveExecutionTimezone,
  resolveSimulatedHoursState,
  type AfterHoursPolicy,
  type AfterHoursSnapshot,
  type ExecutionMode
} from "@coreai/shared";
import { resolveAfterHoursPolicy } from "../business/after-hours-state";
import { runAgentWorkflow } from "../agent-runtime/graph-runner";
import { retrieveRelevantKnowledge } from "../business/agent-knowledge";
import { lookupStructuredFacts } from "../business/business-facts";
import {
  createArchitectTestProviders,
  createBusinessTestProviders,
  type AgentProviders,
  type CalendarBookingEventDetails
} from "../agent-runtime/provider-adapters";
import type { AgentMessage } from "../agent-runtime/runtime-context";
import { sanitizeCustomerText } from "../agent-pages/output-hygiene";
import { calendarError, publicCalendarError } from "./calendar-errors";


export type ArchitectConversationRole = "user" | "assistant";

export type ArchitectConversationMessage = {
  role: ArchitectConversationRole;
  content: string;
  createdAt?: string;
};

export type ArchitectConversationTestContext = {
  businessName?: string;
  businessType?: string;
  assistantName?: string;
  callerName?: string;
  callerPhone?: string;
  calendarId?: string;
  timeZone?: string;
  appointmentService?: string;
  /** Test-form pre-selected date ("YYYY-MM-DD") — seeds the conversation. */
  requestedDate?: string;
  /** Test-form pre-selected time ("HH:mm", 24h). */
  requestedTime?: string;
  services?: string[];
  faqs?: string[];
  /** Business knowledge entries (manual + document-derived, shared format). */
  knowledge?: string[];
  address?: string;
  factsLines?: string[];
  /** Structured Business Hours prompt block (same text the live agent gets). */
  businessHours?: string;
  /** Server-resolved after-hours policy + hours snapshot (BUSINESS_TEST). */
  afterHours?: { policy: AfterHoursPolicy; snapshot: AfterHoursSnapshot };
};

export type ArchitectConversationToolCall = {
  name: string;
  status: "simulated" | "skipped" | "error";
  message: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
};

export type ArchitectConversationNodeLog = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error" | "skipped";
  message: string;
  output?: unknown;
};

export type ConversationTestConfigError = {
  code: string;
  message: string;
  remediation: string;
};

export type ArchitectConversationTestResult = {
  reply: string;
  transcript: ArchitectConversationMessage[];
  executedNodes: ArchitectConversationNodeLog[];
  toolCalls: ArchitectConversationToolCall[];
  finalOutput: Record<string, unknown>;
  simulated: true;
  executionMode: ExecutionMode;
  timeZone: string | null;
  testSessionId: string | null;
  /** Calendar event created/simulated by this turn's booking, if any. */
  calendarEvent: CalendarBookingEventDetails | null;
  /** Set when this turn's booking failed (e.g. CALENDAR_NOT_CONNECTED) —
   * shown as an actionable error panel; never a silent fallback. */
  calendarError: ConversationTestConfigError | null;
  /** Set when the test could not run safely (e.g. missing/invalid timezone). */
  configError: ConversationTestConfigError | null;
};

/** Identity of the business under test — required for BUSINESS_TEST mode. */
export type ConversationTestBusinessIdentity = {
  businessId: string;
  installedAgentId?: string;
};

function cleanHistory(history: ArchitectConversationMessage[] | undefined): AgentMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 4000),
      createdAt: item.createdAt
    }))
    .filter((item) => item.content.length > 0)
    .slice(-30);
}

function emptyResult(params: {
  executionMode: ExecutionMode;
  workflowId: string;
  transcript: ArchitectConversationMessage[];
  message: string;
  reply: string;
  testSessionId: string | null;
  nodeLog: ArchitectConversationNodeLog;
  configError: ConversationTestConfigError | null;
}): ArchitectConversationTestResult {
  const now = new Date().toISOString();

  return {
    reply: params.reply,
    transcript: [
      ...params.transcript,
      { role: "user", content: params.message, createdAt: now },
      { role: "assistant", content: params.reply, createdAt: now }
    ],
    executedNodes: [params.nodeLog],
    toolCalls: [],
    finalOutput: { workflowId: params.workflowId, reply: params.reply },
    simulated: true,
    executionMode: params.executionMode,
    timeZone: null,
    testSessionId: params.testSessionId,
    calendarEvent: null,
    calendarError: null,
    configError: params.configError
  };
}

export async function runArchitectConversationTest({
  userId,
  workflowId,
  workflowJson,
  message,
  history,
  testContext,
  executionMode = "ARCHITECT_DRY_RUN",
  simulateBusinessHoursState,
  testSessionId,
  useTestCalendar,
  forceTestAvailability,
  businessIdentity
}: {
  userId: string;
  workflowId: string;
  workflowJson: unknown;
  message: string;
  history?: ArchitectConversationMessage[];
  testContext?: ArchitectConversationTestContext;
  /** ARCHITECT_DRY_RUN (default) or BUSINESS_TEST. Never LIVE. */
  executionMode?: Extract<ExecutionMode, "ARCHITECT_DRY_RUN" | "BUSINESS_TEST">;
  /** Test-only after-hours override ("open"/"closed"); structurally cannot
   * reach LIVE — this runner never executes in LIVE mode. */
  simulateBusinessHoursState?: "open" | "closed";
  /** Groups this test's records; generated by the caller/route. */
  testSessionId?: string;
  /** Architect only: create real events in the architect's own test calendar. */
  useTestCalendar?: boolean;
  /** Public agent-page traffic: never read the architect's real calendar —
   * availability is always business-hours test slots. */
  forceTestAvailability?: boolean;
  /** Required when executionMode is BUSINESS_TEST. */
  businessIdentity?: ConversationTestBusinessIdentity;
}): Promise<ArchitectConversationTestResult> {
  const transcriptHistory = cleanHistory(history);
  const cleanMessage = message.trim();
  const isCallStart = cleanMessage === BROWSER_CALL_START_MESSAGE;
  const session = testSessionId?.trim() || null;

  // Central timezone decision — never a silent server-zone fallback. A missing
  // or invalid timezone blocks the test with a remediation message instead of
  // booking at an assumed time.
  const timezoneResult = resolveExecutionTimezone({
    executionMode,
    selectedTestTimezone: executionMode === "ARCHITECT_DRY_RUN" ? testContext?.timeZone : null,
    businessTimezone: executionMode === "BUSINESS_TEST" ? testContext?.timeZone : null
  });

  if (!timezoneResult.ok) {
    const error = publicCalendarError(calendarError(timezoneResult.errorCode));
    const reply =
      executionMode === "ARCHITECT_DRY_RUN"
        ? "Select a valid test timezone before running this test."
        : "Set your business timezone in the Configure step before testing.";

    return emptyResult({
      executionMode,
      workflowId,
      transcript: transcriptHistory,
      message: cleanMessage,
      reply,
      testSessionId: session,
      nodeLog: {
        nodeId: "timezone",
        label: "Timezone configuration",
        status: "error",
        message: error.message
      },
      configError: { code: error.code, message: error.message, remediation: error.remediation }
    });
  }

  const timeZone = timezoneResult.timeZone;

  // The exact supplied service name is retained (trimmed + bounded). The
  // generic fallback applies only when nothing was supplied.
  const suppliedService = testContext?.appointmentService?.trim().slice(0, 160) ?? "";
  const appointmentService = suppliedService || "Appointment";

  // After-hours context: BUSINESS_TEST supplies the server-resolved policy +
  // hours snapshot via testContext; ARCHITECT_DRY_RUN derives the policy from
  // the workflow's voice node and activates only when the architect simulates
  // open/closed (the test sandbox has no configured business hours). The
  // override goes through resolveSimulatedHoursState, which refuses LIVE.
  const simulateHours = resolveSimulatedHoursState(executionMode, simulateBusinessHoursState);
  let afterHours = testContext?.afterHours;

  if (!afterHours) {
    const nodePolicy = resolveAfterHoursPolicy({
      configJson: null,
      workflowJson,
      businessType: testContext?.businessType ?? null
    });
    if (nodePolicy?.enabled && simulateHours) {
      afterHours = {
        policy: nodePolicy,
        snapshot: buildAfterHoursSnapshot({ weekly: null, timeZone, simulate: simulateHours })
      };
    }
  }

  const business = {
    name: testContext?.businessName?.trim() || "the business",
    type: testContext?.businessType?.trim() || "service business",
    assistantName: testContext?.assistantName?.trim() || "",
    timezone: timeZone,
    calendarId: testContext?.calendarId?.trim() || "primary",
    appointmentService,
    services: Array.isArray(testContext?.services) ? testContext.services : [],
    faqs: Array.isArray(testContext?.faqs) ? testContext.faqs : [],
    knowledge: Array.isArray(testContext?.knowledge) ? testContext.knowledge : [],
    address: testContext?.address?.trim() || undefined,
    factsLines: Array.isArray(testContext?.factsLines) ? testContext.factsLines : [],
    businessHours: testContext?.businessHours?.trim() || undefined,
    ...(afterHours ? { afterHours } : {})
  };

  const caller = {
    name: testContext?.callerName?.trim() || "Test caller",
    phone: testContext?.callerPhone?.trim() || "+15555550100"
  };

  const hasNodes = Array.isArray((workflowJson as { nodes?: unknown[] } | null)?.nodes)
    ? ((workflowJson as { nodes: unknown[] }).nodes.length > 0)
    : false;

  if (!hasNodes) {
    return emptyResult({
      executionMode,
      workflowId,
      transcript: transcriptHistory,
      message: cleanMessage,
      reply: "Add at least one node before testing this agent.",
      testSessionId: session,
      nodeLog: { nodeId: "empty", label: "Empty workflow", status: "error", message: "No nodes found." },
      configError: null
    });
  }

  let providers: AgentProviders;

  if (executionMode === "BUSINESS_TEST") {
    if (!businessIdentity?.businessId) {
      throw new Error("BUSINESS_TEST requires businessIdentity.businessId");
    }

    if (!isCallStart && cleanMessage) {
      try {
        const structuredFacts = await lookupStructuredFacts({
          businessId: businessIdentity.businessId,
          query: cleanMessage
        });
        const documents = await retrieveRelevantKnowledge({
          businessId: businessIdentity.businessId,
          installedAgentId: businessIdentity.installedAgentId,
          query: cleanMessage
        });
        const retrieved = [...structuredFacts, ...documents];
        if (retrieved.length > 0) {
          const retrievedEntries = retrieved.map((section) =>
            `${section.title}: ${section.content}`
          );
          const baseline = Array.isArray(business.knowledge) ? business.knowledge : [];
          business.knowledge = [
            ...retrievedEntries,
            ...baseline.filter((entry) => !retrievedEntries.includes(entry))
          ];
        }
      } catch (error) {
        console.error("[conversation-test] knowledge retrieval failed (non-fatal)", error);
      }
    }

    providers = createBusinessTestProviders({
      ownerUserId: userId,
      businessId: businessIdentity.businessId,
      installedAgentId: businessIdentity.installedAgentId,
      workflowId,
      testSessionId: session ?? undefined,
      businessName: business.name
    });
  } else {
    providers = createArchitectTestProviders({
      userId,
      workflowId,
      testSessionId: session ?? undefined,
      businessName: business.name,
      useTestCalendar: useTestCalendar === true,
      forceTestAvailability: forceTestAvailability === true
    });
  }

  const result = await runAgentWorkflow({
    workflowId,
    workflowJson,
    mode: executionMode === "BUSINESS_TEST" ? "business_test" : "architect_test",
    input: {
      channel: "browser_voice",
      event: isCallStart ? "call_start" : "user_message",
      message: cleanMessage,
      history: transcriptHistory,
      business,
      caller,
      requestedDate: testContext?.requestedDate?.trim() || undefined,
      requestedTime: testContext?.requestedTime?.trim() || undefined,
      memoryIdentity:
        executionMode === "BUSINESS_TEST" && businessIdentity?.businessId
          ? {
              businessId: businessIdentity.businessId,
              installedAgentId: businessIdentity.installedAgentId,
              testSessionId: session ?? undefined
            }
          : { architectUserId: userId, testSessionId: session ?? undefined }
    },
    providers
  });

  const availableSlots = result.variables["calendar.available_slots"];

  console.log("[conversation-test] turn", {
    workflowId,
    executionMode,
    timeZone,
    assistantName: business.assistantName || "(resolved from node config)",
    businessName: business.name,
    capabilities: result.capabilities,
    slotsReturned: Array.isArray(availableSlots) ? availableSlots.length : 0,
    executedNodes: result.executedNodes.map((log) => log.label)
  });

  const bookingCall = result.toolCalls.find((call) => call.name === "calendar.book_appointment");
  const bookingOutput =
    bookingCall?.output && typeof bookingCall.output === "object"
      ? (bookingCall.output as Record<string, unknown>)
      : null;
  const calendarEvent = bookingOutput && "event" in bookingOutput
    ? (bookingOutput.event as CalendarBookingEventDetails)
    : null;
  const bookingError: ConversationTestConfigError | null =
    bookingCall?.status === "error" && typeof bookingOutput?.errorCode === "string"
      ? {
          code: bookingOutput.errorCode,
          message: bookingCall.message,
          remediation: typeof bookingOutput.remediation === "string" ? bookingOutput.remediation : "Try again."
        }
      : null;

  // Final exit for every conversation channel (builder conversation-test AND
  // the public agent-page /chat both return this reply verbatim): strip leaked
  // template artifacts exactly once, here, so no route needs its own pass.
  const reply = sanitizeCustomerText(result.reply);

  const now = new Date().toISOString();
  const transcript: ArchitectConversationMessage[] = isCallStart
    ? [...transcriptHistory, { role: "assistant", content: reply, createdAt: now }]
    : [
        ...transcriptHistory,
        { role: "user", content: cleanMessage, createdAt: now },
        { role: "assistant", content: reply, createdAt: new Date().toISOString() }
      ];

  return {
    reply,
    transcript,
    executedNodes: result.executedNodes,
    toolCalls: result.toolCalls,
    finalOutput: {
      workflowId,
      reply,
      businessName: business.name,
      assistantName: business.assistantName,
      capabilities: result.capabilities,
      executedNodeIds: result.executedNodes.map((log) => log.nodeId),
      variables: result.variables,
      simulated: true,
      executionMode,
      timeZone,
      // Debug visibility: the simulated clock/timezone and routing decision.
      ...(afterHours
        ? {
            afterHours: {
              state: afterHours.snapshot.state,
              timeZone: afterHours.snapshot.timeZone,
              localDate: afterHours.snapshot.localDate,
              localTime: afterHours.snapshot.localTime,
              simulated: afterHours.snapshot.simulated ?? null,
              route: result.variables["afterHours.route"] ?? null,
              outcome: result.variables["afterHours.outcome"] ?? null
            }
          }
        : {})
    },
    simulated: true,
    executionMode,
    timeZone,
    testSessionId: session,
    calendarEvent,
    calendarError: bookingError,
    configError: null
  };
}
