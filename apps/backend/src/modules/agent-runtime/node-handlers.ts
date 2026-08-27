import { SCRIPT_NODE_TYPE } from "@coreai/shared";
import { type MemoryAttachment } from "../memory/memory-compression";
import { executeScript } from "./script-executor";
import { buildSmartMemory } from "../memory/smart-memory";
import { executeImageGeneration } from "../ai-provider-engine/langchain/langchain-image-executor";
import {
  asString,
  extractTimeLabel,
  hasVariable,
  humanSlotLabel,
  mentionsSpecificTime,
  pickOfferedSlot,
  setVariables,
  stringVariable,
  type AgentRuntimeContext,
  type NodeExecutionResult
} from "./runtime-context";
import { nodeCapability, nodeLabel, nodeRequiredVariables, type GraphNode } from "./tool-registry";
import type { AgentProviders } from "./provider-adapters";

function log(
  context: AgentRuntimeContext,
  node: GraphNode,
  status: "success" | "waiting" | "error" | "skipped",
  message: string,
  output?: unknown
): void {
  context.executedNodes.push({
    nodeId: node.id,
    label: nodeLabel(node, node.id),
    status,
    message,
    output
  });
}

/** Resolve both runtime {{variable}} and builder [Label] references. */
export function resolveTemplate(template: string, context: AgentRuntimeContext): string {
  const values: Record<string, string> = {
    "customer.name": stringVariable(context, "customer.name") || context.caller.name,
    "customer.phone": stringVariable(context, "customer.phone") || context.caller.phone,
    "caller.name": context.caller.name,
    "caller.phone": context.caller.phone,
    service: stringVariable(context, "service"),
    "appointment.service": stringVariable(context, "service"),
    "appointment.date": stringVariable(context, "appointment.date"),
    "appointment.time": stringVariable(context, "appointment.time"),
    "appointment.confirmation_id": stringVariable(context, "appointment.confirmation_id"),
    "selected.slot": stringVariable(context, "selected.slot"),
    "business.name": context.business.name,
    "business_name": context.business.name,
    "businessName": context.business.name,
    "business.type": context.business.type,
    "business_type": context.business.type,
    "assistant_name": context.business.assistantName,
    "assistantName": context.business.assistantName,
    memory: stringVariable(context, "memory"),
    "memory.context": stringVariable(context, "memory")
  };

  let resolved = template;

  for (const [key, value] of Object.entries(values)) {
    resolved = resolved.replaceAll(`{{${key}}}`, value);
  }

  const bracketValues: Record<string, string> = {
    "customer name": values["customer.name"],
    "patient name": values["customer.name"],
    "customer phone": values["customer.phone"],
    "patient phone": values["customer.phone"],
    service: values.service,
    date: values["appointment.date"],
    time: values["appointment.time"],
    "business name": values["business.name"],
    "assistant name": values.assistantName,
    "confirmation id": values["appointment.confirmation_id"]
  };

  // An unset variable resolves to "", which would silently delete the
  // placeholder and ship "Confirmed:  on  at  with Acme." to the customer.
  // Leave the bracket intact instead so callers can detect and fall back.
  resolved = resolved.replace(/\[([^\]]+)\]/g, (match, rawKey: string) => {
    const value = bracketValues[rawKey.trim().toLowerCase()];
    return value && value.trim() ? value : match;
  });

  return resolved;
}

/** True when a resolved template still carries unfilled [Placeholder] slots. */
export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\[[^\]]+\]/.test(text);
}

export function afterHoursBlocksActions(context: AgentRuntimeContext): boolean {
  const state = context.afterHoursState;
  if (!state) return false;

  return (
    state.route === "RED_FLAG_DETECTED" ||
    state.route === "HUMAN_REVIEW" ||
    state.needsClarification ||
    (state.route === "POSSIBLE_EMERGENCY" && !state.redFlagQuestionAsked)
  );
}

export function seedConversationVariables(context: AgentRuntimeContext): void {
  const { conversation } = context;

  setVariables(context, {
    "conversation.latest_user_message": context.userMessage,
    ...(conversation.collectedName ? { "customer.name": conversation.collectedName } : {}),
    ...(conversation.collectedPhone ? { "customer.phone": conversation.collectedPhone } : {}),
    ...(conversation.requestedService ? { service: conversation.requestedService } : {})
  });
}

type NodeHandler = (
  node: GraphNode,
  context: AgentRuntimeContext,
  providers: AgentProviders
) => Promise<NodeExecutionResult>;

const handlePhoneTrigger: NodeHandler = async (node, context) => {
  log(context, node, "success", "Call message received by the workflow trigger (no telephony provider used in this mode).", {
    callerName: context.caller.name,
    callerPhone: context.caller.phone,
    channel: context.channel,
    message: context.userMessage
  });

  setVariables(context, {
    "caller.phone": context.caller.phone,
    "caller.name": context.caller.name,
    "call.time": new Date().toISOString(),
    "business.name": context.business.name,
    "business.type": context.business.type
  });

  return { status: "executed" };
};

const handleSmsTrigger: NodeHandler = async (node, context) => {
  log(context, node, "success", "Message treated as an incoming SMS (no telephony provider used in this mode).", {
    from: context.caller.phone,
    body: context.userMessage
  });

  setVariables(context, {
    "customer.phone": context.caller.phone,
    "sms.incoming_message": context.userMessage,
    "sms.received_time": new Date().toISOString(),
    "trigger.source": "sms"
  });

  return { status: "executed" };
};

const handleAiConversation: NodeHandler = async (node, context) => {
  log(context, node, "success", "Conversation handled by this node's prompt and the connected downstream tools.", {
    assistantName: context.business.assistantName,
    schedulingIntent: context.conversation.schedulingIntent,
    latestUserMessage: context.userMessage
  });

  return { status: "executed" };
};

const handleCalendarAvailability: NodeHandler = async (node, context, providers) => {
  const { conversation, turn } = context;

  if (afterHoursBlocksActions(context)) {
    log(context, node, "skipped", "Skipped — after-hours emergency screening takes priority this turn.");
    return { status: "skipped" };
  }

  if (!conversation.schedulingIntent || !conversation.currentContributes || conversation.ending) {
    return { status: "skipped" };
  }

  // Scheduling settings come from node config / buyer setup — never fixed.
  const maxSlots =
    Number(node.data?.maximumSlotsToShow) ||
    Number(node.data?.maxSlotsToShow) ||
    Number(node.data?.slotsToOffer) ||
    6;

  const configuredDurationMinutes =
    Number(node.data?.serviceDurationMinutes) || Number(node.data?.defaultDurationMinutes) || undefined;

  const result = await providers.calendar.checkAvailability({
    calendarId: asString(node.data?.calendarId) || context.business.calendarId,
    timeZone: context.business.timezone,
    date: conversation.requestedDate,
    maxSlots,
    bufferMinutes: Number(node.data?.bufferMinutes) || 10,
    openHour: Number(node.data?.openHour) || undefined,
    closeHour: Number(node.data?.closeHour) || undefined,
    durationMinutes: configuredDurationMinutes,
    serviceName: stringVariable(context, "service") || conversation.requestedService || undefined
  });

  if (result.source === "unavailable") {
    setVariables(context, {
      "calendar.available_slots": [],
      "calendar.status": "unavailable",
      "calendar.requested_date": conversation.requestedDate,
      "calendar.timezone": context.business.timezone
    });
    context.toolCalls.push({
      name: "calendar.check_availability",
      status: "error",
      message: result.note,
      input: { date: conversation.requestedDate },
      output: { source: result.source }
    });
    log(context, node, "error", "Live calendar availability could not be confirmed — no slots offered.", {
      note: result.note
    });
    return { status: "executed" };
  }

  setVariables(context, {
    "calendar.available_slots": result.slots,
    "calendar.spoken_slots": result.spoken ?? result.slots,
    "calendar.total_free": result.totalFree ?? result.slots.length,
    "calendar.open_until": result.openUntil ?? "",
    "calendar.status": "ok",
    "calendar.requested_date": conversation.requestedDate,
    "calendar.timezone": context.business.timezone,
    // The Book node is a different node and cannot see this node's config,
    // so the length travels with the slots that were offered.
    "calendar.duration_minutes": configuredDurationMinutes ?? ""
  });

  if (conversation.lastTimeMessage) {
    const offered = pickOfferedSlot(conversation.lastTimeMessage, result.slots);
    const stated = extractTimeLabel(conversation.lastTimeMessage);
    const selected = offered || (stated ? `${conversation.requestedDate} ${stated}` : "");

    if (selected) setVariables(context, { "selected.slot": selected });
  }

  turn.slotsOffered = true;

  context.toolCalls.push({
    name: "calendar.check_availability",
    status: "simulated",
    message: result.note,
    input: { calendarId: context.business.calendarId, date: conversation.requestedDate, timeZone: context.business.timezone },
    output: { slots: result.slots, source: result.source }
  });

  log(context, node, "success", `Found ${result.slots.length} open slots (${result.source === "calendar" ? "connected calendar" : "test data"}).`, {
    slots: result.slots,
    source: result.source
  });

  return { status: "executed" };
};

const handleBookAppointment: NodeHandler = async (node, context, providers) => {
  const { conversation, turn } = context;

  if (afterHoursBlocksActions(context)) {
    log(context, node, "skipped", "Skipped — after-hours emergency screening takes priority this turn.");
    return { status: "skipped" };
  }

  if (!conversation.schedulingIntent || !conversation.currentContributes || conversation.ending) {
    return { status: "skipped" };
  }

  // Workflows without a Calendar Availability node still honor a stated time.
  if (!hasVariable(context, "selected.slot") && conversation.lastTimeMessage) {
    const stated = extractTimeLabel(conversation.lastTimeMessage);

    if (stated) setVariables(context, { "selected.slot": `${conversation.requestedDate} ${stated}` });
  }

  const required = nodeRequiredVariables(node);
  const missing = required.filter((key) => !hasVariable(context, key));

  if (missing.length > 0) {
    turn.missingVariables = missing;
    // Booking is the gate: downstream nodes wait until required inputs exist.
    return { status: "waiting" };
  }

  const slot = stringVariable(context, "selected.slot");
  // Prefer the Book node's own length, then the one availability offered.
  const bookingDurationMinutes =
    Number(node.data?.serviceDurationMinutes) ||
    Number(node.data?.defaultDurationMinutes) ||
    Number(stringVariable(context, "calendar.duration_minutes")) ||
    undefined;

  const result = await providers.calendar.bookAppointment({
    calendarId: context.business.calendarId,
    timeZone: context.business.timezone,
    slot,
    service: stringVariable(context, "service"),
    customerName: stringVariable(context, "customer.name"),
    customerPhone: stringVariable(context, "customer.phone"),
    durationMinutes: Number.isFinite(bookingDurationMinutes) ? bookingDurationMinutes : undefined
  });

  const slotParts = slot.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);

  setVariables(context, {
    "appointment.status": result.status,
    "appointment.confirmation_id": result.confirmationId,
    "appointment.date": slotParts?.[1] ?? conversation.requestedDate,
    "appointment.time": slotParts?.[2] ?? slot,
    "appointment.calendar_event_id": result.calendarEventId,
    ...(result.event
      ? {
          "appointment.event_title": result.event.title,
          "appointment.event_link": result.event.htmlLink ?? "",
          "appointment.event_status": result.event.status,
          "appointment.test_event_id": result.event.testEventId ?? "",
          "appointment.event_start": result.event.startAt,
          "appointment.event_end": result.event.endAt,
          "appointment.event_timezone": result.event.timeZone
        }
      : {})
  });

  /* A SIMULATED EVENT IS NOT A BOOKING.
     On a public agent page every turn runs in test mode, so the calendar step
     writes a SIMULATED row and still answered "confirmed" — which set this
     flag, which made the agent tell the visitor their appointment was booked.
     Nothing was booked, nobody was expecting them, and the agent is forbidden
     from using the words "test" or "simulated" to a customer, so they had no
     way to know. Only a real write counts. */
  turn.bookedThisTurn =
    result.status === "confirmed" && (result.event?.status ?? "") === "CREATED";

  context.toolCalls.push({
    name: "calendar.book_appointment",
    status: result.status === "failed" ? "error" : "simulated",
    message: result.note,
    input: {
      customerName: stringVariable(context, "customer.name"),
      customerPhone: stringVariable(context, "customer.phone"),
      service: stringVariable(context, "service"),
      slot
    },
    output: {
      status: result.status,
      confirmationId: result.confirmationId,
      date: stringVariable(context, "appointment.date"),
      time: stringVariable(context, "appointment.time"),
      ...(result.event ? { event: result.event } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode, remediation: result.remediation } : {})
    }
  });

  if (result.status === "failed") {
    // Never claim the appointment was created when the calendar write failed.
    log(context, node, "error", result.note, { slot, status: result.status, errorCode: result.errorCode });
    return { status: "failed" };
  }

  log(
    context,
    node,
    "success",
    result.event?.status === "CREATED"
      ? "Booked a marked test appointment on the connected calendar."
      : "Booked appointment through the calendar provider (simulated).",
    { slot, status: result.status }
  );

  return { status: "executed" };
};

const handleSendSms: NodeHandler = async (node, context, providers) => {
  const { conversation, turn } = context;

  if (afterHoursBlocksActions(context)) {
    log(context, node, "skipped", "Skipped — after-hours emergency screening takes priority this turn.");
    return { status: "skipped" };
  }

  const required = nodeRequiredVariables(node);
  const missing = required.filter((key) => !hasVariable(context, key));

  const consented = conversation.smsRequested && !conversation.smsDeclined;
  const shouldRun = consented && (turn.bookedThisTurn || !conversation.ending);

  if (!shouldRun) return { status: "skipped" };

  if (missing.length > 0) {
    turn.missingVariables = missing;
    return { status: "waiting" };
  }

  const template =
    asString(node.data?.customerTemplate) ||
    asString(node.data?.patientTemplate) ||
    asString(node.data?.smsBody);

  const resolvedTemplate = template ? resolveTemplate(template, context) : "";

  // A configured template is only usable when every placeholder it references
  // actually resolved. A non-booking follow-up SMS has no service/date/time,
  // so a booking-shaped template must yield to the generic message rather than
  // text the customer a confirmation with holes in it.
  const body =
    resolvedTemplate && !hasUnresolvedPlaceholders(resolvedTemplate)
      ? resolvedTemplate
      : turn.bookedThisTurn
        ? `Your ${stringVariable(context, "service")} is confirmed for ${humanSlotLabel(stringVariable(context, "selected.slot"), context.business.timezone)}. — ${context.business.name}`
        : `Thanks for contacting ${context.business.name}. We will follow up shortly.`;

  const to = stringVariable(context, "customer.phone") || context.caller.phone;
  const result = await providers.sms.send({ to, body });

  setVariables(context, { "sms.status": result.status, "sms.body": body });
  turn.smsThisTurn = true;

  context.toolCalls.push({
    name: "sms.send",
    status: "simulated",
    message: result.note,
    input: { to },
    output: { body, status: result.status }
  });

  log(context, node, "success", "Prepared SMS through the SMS provider (dry run in test mode).", { to, body });

  return { status: "executed" };
};

const handleEndFlow: NodeHandler = async (node, context) => {
  const { conversation, turn } = context;

  if (!conversation.ending) return { status: "skipped" };

  const closingMessage = asString(node.data?.closingMessage);

  setVariables(context, { "flow.status": "completed", "flow.closing_message": closingMessage });
  turn.endReached = true;

  log(context, node, "success", "Caller ended the conversation. Flow reached the end node.");

  return { status: "ended" };
};

const handleCondition: NodeHandler = async (node, context) => {
  log(context, node, "success", "Passed through condition node.");
  return { status: "executed" };
};

const handleMemoryNode: NodeHandler = async (node, context) => {
  const attachments = (Array.isArray(node.data?.attachments) ? node.data?.attachments : []) as MemoryAttachment[];
  const customNotes =
    asString(node.data?.customMemoryNotes) || asString(node.data?.notes) || asString(node.data?.customNotes);

  const smartMemory = await buildSmartMemory({
    executedNodes: context.executedNodes,
    variables: context.variables,
    attachments,
    customNotes,
    scope: {
      businessId: context.memoryIdentity?.businessId,
      installedAgentId: context.memoryIdentity?.installedAgentId,
      architectUserId: context.memoryIdentity?.architectUserId,
      testSessionId: context.memoryIdentity?.testSessionId,
      workflowId: context.workflowId,
      nodeId: node.id,
      callerKey: context.caller.phone || undefined
    }
  });

  context.memoryScopeKey = smartMemory.scopeKey;
  setVariables(context, { memory: smartMemory.memory });

  log(context, node, "success", "Aggregated previous node executions and manual attachments into compact memory string.", {
    memory: smartMemory.memory
  });

  return { status: "executed" };
};

const handleImageGeneration: NodeHandler = async (node, context) => {
  const promptRaw = asString(node.data?.prompt);
  let prompt = resolveTemplate(promptRaw, context);

  const model = asString(node.data?.model) || "imagen-3.0-generate-002";

  // Resolve reference image for image-to-image workflows
  let referenceImage: Buffer | string | undefined = undefined;
  const refConfig = asString(node.data?.reference_image);

  if (refConfig) {
    const resolvedRefKey = resolveTemplate(refConfig, context);
    const varValue = context.variables[resolvedRefKey] ?? context.variables[refConfig];
    if (Buffer.isBuffer(varValue) || typeof varValue === "string") {
      referenceImage = varValue;
    }
  }

  if (!referenceImage) {
    // Check default binary image in variables if available
    const defaultImg = context.variables["image"];
    if (Buffer.isBuffer(defaultImg) || typeof defaultImg === "string") {
      referenceImage = defaultImg;
    }
  }

  if (!prompt || !prompt.trim()) {
    const prevOutput =
      asString(context.variables.lastOutput) ||
      asString(context.variables.latestMessage) ||
      asString(context.variables.output) ||
      asString(context.variables.text) ||
      asString(context.variables.query) ||
      asString(context.variables["ai.output"]) ||
      asString(context.variables.llmOutput) ||
      asString(context.variables.result) ||
      asString(context.variables.message);

    if (prevOutput && prevOutput.trim() && prevOutput !== "No custom message") {
      prompt = prevOutput.trim();
    } else {
      prompt = referenceImage ? "Generate variation of reference image" : "Generate image";
    }
  }

  const result = await executeImageGeneration({
    prompt,
    model,
    referenceImage,
    imageSize: asString(node.data?.imageSize) || undefined
  });

  if (result.status !== "success") {
    log(context, node, "error", result.error || "Image generation failed.", { model, prompt });
    return { status: "failed" };
  }

  const binaryOutput = result.imageBuffer ?? result.imageUrl ?? "";
  const outputJson = {
    prompt,
    model: result.modelName || model,
    revised_prompt: result.revisedPrompt || prompt
  };

  // Store binary and metadata JSON in context variables
  setVariables(context, {
    image: binaryOutput,
    image_url: result.imageUrl ?? "",
    prompt: outputJson.prompt,
    model: outputJson.model,
    revised_prompt: outputJson.revised_prompt,
    [`node.${node.id}.image`]: binaryOutput
  });

  const nodeLabelSlug = (asString(node.data?.title ?? node.data?.label) || node.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (nodeLabelSlug) {
    setVariables(context, { [`${nodeLabelSlug}.image`]: binaryOutput });
  }

  log(context, node, "success", `Generated image using ${result.modelName || model}.`, {
    ...outputJson,
    image: binaryOutput ? "[Binary Image Data]" : ""
  });

  return { status: "executed" };
};

const handleScriptNode: NodeHandler = async (node, context) => {
  const outputKey = asString(node.data?.scriptOutputKey) || "script.output";

  const result = await executeScript({
    language: node.data?.scriptLanguage,
    code: node.data?.scriptCode,
    timeoutMs: node.data?.scriptTimeoutMs,
    input: { ...context.variables, "conversation.latest_user_message": context.userMessage }
  });

  if (result.status === "error") {
    log(context, node, "error", result.error ?? "Code node failed.", { logs: result.logs });
    return { status: "failed" };
  }

  const output = result.output ?? null;
  setVariables(context, { [outputKey]: output, [`node.${node.id}.output`]: output });

  log(context, node, "success", `Ran ${result.language === "python" ? "Python" : "JavaScript"} in ${result.durationMs}ms.`, {
    outputKey,
    output,
    logs: result.logs
  });

  return { status: "executed" };
};

const handleUnknown: NodeHandler = async (node, context) => {
  log(context, node, "waiting", "Not part of this conversation channel; skipped by the runtime.");
  return { status: "skipped" };
};

const HANDLERS: Record<string, NodeHandler> = {
  "trigger.phone_call": handlePhoneTrigger,
  "trigger.sms": handleSmsTrigger,
  "ai.conversation": handleAiConversation,
  "ai.memory": handleMemoryNode,
  "ai.image_generation": handleImageGeneration,
  "calendar.check_availability": handleCalendarAvailability,
  "calendar.book_appointment": handleBookAppointment,
  "sms.send": handleSendSms,
  "flow.end": handleEndFlow,
  "logic.condition": handleCondition,
  [SCRIPT_NODE_TYPE]: handleScriptNode
};

export async function executeNode(
  node: GraphNode,
  context: AgentRuntimeContext,
  providers: AgentProviders
): Promise<NodeExecutionResult> {
  context.currentNodeId = node.id;

  const handler = HANDLERS[nodeCapability(node)] ?? handleUnknown;

  const logsBefore = context.executedNodes.length;
  try {
    const result = await handler(node, context, providers);
    if (result.status === "skipped" && context.executedNodes.length === logsBefore) {
      log(context, node, "skipped", "Skipped this turn — the conversation did not reach this step.");
    }
    return result;
  } catch (error) {
    log(context, node, "error", error instanceof Error ? error.message : "Node execution failed.");
    return { status: "failed" };
  }
}
