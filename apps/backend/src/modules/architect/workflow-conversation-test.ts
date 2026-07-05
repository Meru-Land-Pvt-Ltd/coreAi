import { BROWSER_CALL_START_MESSAGE } from "@coreai/shared";
import { runAgentWorkflow } from "../agent-runtime/graph-runner";
import { createArchitectTestProviders } from "../agent-runtime/provider-adapters";
import type { AgentMessage } from "../agent-runtime/runtime-context";

/**
 * Architect Browser Call Test — a thin wrapper over the shared agent runtime.
 * The same runtime (graph runner + node handlers) will power the Business
 * browser test and the live call flow; only the provider adapters differ.
 */

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
  services?: string[];
  faqs?: string[];
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
  status: "success" | "waiting" | "error";
  message: string;
  output?: unknown;
};

export type ArchitectConversationTestResult = {
  reply: string;
  transcript: ArchitectConversationMessage[];
  executedNodes: ArchitectConversationNodeLog[];
  toolCalls: ArchitectConversationToolCall[];
  finalOutput: Record<string, unknown>;
  simulated: true;
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

export async function runArchitectConversationTest({
  userId,
  workflowId,
  workflowJson,
  message,
  history,
  testContext
}: {
  userId: string;
  workflowId: string;
  workflowJson: unknown;
  message: string;
  history?: ArchitectConversationMessage[];
  testContext?: ArchitectConversationTestContext;
}): Promise<ArchitectConversationTestResult> {
  const transcriptHistory = cleanHistory(history);
  const cleanMessage = message.trim();
  const isCallStart = cleanMessage === BROWSER_CALL_START_MESSAGE;

  const business = {
    name: testContext?.businessName?.trim() || "Sample Business",
    type: testContext?.businessType?.trim() || "service business",
    assistantName: testContext?.assistantName?.trim() || "",
    timezone: testContext?.timeZone?.trim() || "America/Los_Angeles",
    calendarId: testContext?.calendarId?.trim() || "primary",
    appointmentService: testContext?.appointmentService?.trim() || "Consultation",
    services:
      Array.isArray(testContext?.services) && testContext.services.length > 0
        ? testContext.services
        : ["Consultation", "Appointment booking", "General inquiry"],
    faqs:
      Array.isArray(testContext?.faqs) && testContext.faqs.length > 0
        ? testContext.faqs
        : ["Pricing depends on the selected service.", "Urgent requests should be escalated to the team."]
  };

  const caller = {
    name: testContext?.callerName?.trim() || "Test caller",
    phone: testContext?.callerPhone?.trim() || "+15555550100"
  };

  const hasNodes = Array.isArray((workflowJson as { nodes?: unknown[] } | null)?.nodes)
    ? ((workflowJson as { nodes: unknown[] }).nodes.length > 0)
    : false;

  if (!hasNodes) {
    const reply = "Add at least one node before testing this agent.";

    return {
      reply,
      transcript: [
        ...transcriptHistory,
        { role: "user", content: cleanMessage, createdAt: new Date().toISOString() },
        { role: "assistant", content: reply, createdAt: new Date().toISOString() }
      ],
      executedNodes: [{ nodeId: "empty", label: "Empty workflow", status: "error", message: "No nodes found." }],
      toolCalls: [],
      finalOutput: { workflowId, reply },
      simulated: true
    };
  }

  const result = await runAgentWorkflow({
    workflowId,
    workflowJson,
    mode: "architect_test",
    input: {
      channel: "browser_voice",
      event: isCallStart ? "call_start" : "user_message",
      message: cleanMessage,
      history: transcriptHistory,
      business,
      caller
    },
    providers: createArchitectTestProviders({ userId })
  });

  const availableSlots = result.variables["calendar.available_slots"];

  console.log("[browser-call-test] turn", {
    workflowId,
    assistantName: business.assistantName || "(resolved from node config)",
    businessName: business.name,
    capabilities: result.capabilities,
    slotsReturned: Array.isArray(availableSlots) ? availableSlots.length : 0,
    executedNodes: result.executedNodes.map((log) => log.label)
  });

  const now = new Date().toISOString();
  const transcript: ArchitectConversationMessage[] = isCallStart
    ? [...transcriptHistory, { role: "assistant", content: result.reply, createdAt: now }]
    : [
        ...transcriptHistory,
        { role: "user", content: cleanMessage, createdAt: now },
        { role: "assistant", content: result.reply, createdAt: new Date().toISOString() }
      ];

  return {
    reply: result.reply,
    transcript,
    executedNodes: result.executedNodes,
    toolCalls: result.toolCalls,
    finalOutput: {
      workflowId,
      reply: result.reply,
      businessName: business.name,
      assistantName: business.assistantName,
      capabilities: result.capabilities,
      executedNodeIds: result.executedNodes.map((log) => log.nodeId),
      variables: result.variables,
      simulated: true
    },
    simulated: true
  };
}
