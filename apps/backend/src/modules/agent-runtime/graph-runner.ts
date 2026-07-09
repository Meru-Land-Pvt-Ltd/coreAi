import {
  asRecord,
  asString,
  humanSlotLabel,
  humanSlotList,
  inferConversationState,
  isPureGreeting,
  stringVariable,
  type AgentBusinessContext,
  type AgentCallerContext,
  type AgentChannel,
  type AgentMessage,
  type AgentRuntimeContext,
  type AgentRuntimeLog,
  type AgentRuntimeMode,
  type AgentToolCall
} from "./runtime-context";
import {
  collectDownstreamTools,
  hasCapability,
  nodeCapability,
  nodeLabel,
  type AgentTool,
  type GraphEdge,
  type GraphNode
} from "./tool-registry";
import { executeNode, seedConversationVariables } from "./node-handlers";
import type { AgentProviders } from "./provider-adapters";
import {
  buildAgentFirstMessage,
  buildAgentSystemPrompt,
  resolveAssistantName,
  resolveBusinessName
} from "./prompt-builder";

/* ------------------------------ graph parsing ----------------------------- */

export type ParsedGraph = {
  nodes: GraphNode[];
  nodeById: Map<string, GraphNode>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  startNode: GraphNode | null;
  /** Nodes reachable from the trigger, in connected (BFS, edge-order) order. */
  executionOrder: GraphNode[];
};

function nodesOf(workflowJson: unknown): GraphNode[] {
  const nodes = asRecord(workflowJson).nodes;

  if (!Array.isArray(nodes)) return [];

  return nodes
    .map((node, index) => {
      const record = asRecord(node);
      return {
        id: asString(record.id) || `node-${index}`,
        data: asRecord(record.data)
      };
    })
    .filter((node) => Boolean(node.id));
}

function edgesOf(workflowJson: unknown): GraphEdge[] {
  const edges = asRecord(workflowJson).edges;

  if (!Array.isArray(edges)) return [];

  return edges
    .map((edge) => {
      const record = asRecord(edge);
      return { source: asString(record.source), target: asString(record.target) };
    })
    .filter((edge) => edge.source.length > 0 && edge.target.length > 0);
}

export function parseGraph(workflowJson: unknown, channel: AgentChannel): ParsedGraph {
  const nodes = nodesOf(workflowJson);
  const edges = edgesOf(workflowJson);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;

    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const triggers = nodes.filter((node) => nodeCapability(node).startsWith("trigger."));
  const preferredCapability = channel === "sms" ? "trigger.sms" : "trigger.phone_call";

  const startNode =
    triggers.find((node) => nodeCapability(node) === preferredCapability) ??
    triggers[0] ??
    nodes.find((node) => !incoming.has(node.id)) ??
    nodes[0] ??
    null;

  // Legacy workflows saved before edges mattered: with zero edges, fall back to
  // node array order. With ANY edges present, only the connected graph runs.
  if (edges.length === 0 && nodes.length > 1) {
    return { nodes, nodeById, outgoing, incoming, startNode, executionOrder: [...nodes] };
  }

  const executionOrder: GraphNode[] = [];

  if (startNode) {
    const visited = new Set<string>([startNode.id]);
    const queue: string[] = [startNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift();

      if (!currentId) break;

      const current = nodeById.get(currentId);

      if (current) executionOrder.push(current);

      for (const targetId of outgoing.get(currentId) ?? []) {
        if (visited.has(targetId)) continue;
        visited.add(targetId);
        queue.push(targetId);
      }
    }
  }

  return { nodes, nodeById, outgoing, incoming, startNode, executionOrder };
}

/* ----------------------------- runtime helpers ---------------------------- */

function findAiNode(graph: ParsedGraph): GraphNode | null {
  return graph.executionOrder.find((node) => nodeCapability(node) === "ai.conversation") ?? null;
}

function aiTools(graph: ParsedGraph): AgentTool[] {
  const aiNode = findAiNode(graph);

  if (!aiNode) return [];

  return collectDownstreamTools({ fromNodeId: aiNode.id, outgoing: graph.outgoing, nodeById: graph.nodeById });
}

function aiNodeInstructions(aiNode: GraphNode | null): string {
  if (!aiNode?.data) return "";

  const promptFields = [
    "systemPrompt",
    "prompt",
    "instructions",
    "customInstructions",
    "conversationPrompt",
    "agentPrompt",
    "persona",
    "goal",
    "knowledge",
    "description"
  ];

  return promptFields
    .map((field) => asString(aiNode.data?.[field]))
    .filter(Boolean)
    .join("\n\n");
}

function firstMessageOf(aiNode: GraphNode | null, business: AgentBusinessContext): string {
  const raw = asString(aiNode?.data?.firstMessage)
    .replaceAll("{{assistant_name}}", business.assistantName)
    .replaceAll("{{assistantName}}", business.assistantName)
    .replaceAll("{{business_name}}", business.name)
    .replaceAll("{{businessName}}", business.name)
    .replaceAll("{{business_type}}", business.type)
    .replaceAll("{{businessType}}", business.type);

  // buildAgentFirstMessage sanitizes stale demo identities out of saved text
  // and falls back to the standard greeting when nothing custom is set.
  return buildAgentFirstMessage({
    assistantName: business.assistantName,
    businessName: business.name,
    customFirstMessage: raw
  });
}

function dateInZone(date: Date, timeZone: string): string {
  try {
    return date.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/* ------------------------------- LLM prompt ------------------------------- */

function describeMissingVariables(missing: string[]): string {
  const friendly: Record<string, string> = {
    "customer.name": "the caller's full name",
    "customer.phone": "the caller's phone number",
    "selected.slot": "a chosen day and time",
    service: "the service they need"
  };

  return missing.map((key) => friendly[key] ?? key).join(" and ");
}

function buildRuntimeSystemPrompt(params: {
  context: AgentRuntimeContext;
  tools: AgentTool[];
  nodeInstructions: string;
  firstMessage: string;
  graph: ParsedGraph;
}): string {
  const { context, tools, nodeInstructions, firstMessage, graph } = params;
  const { business, conversation, turn } = context;
  const slots = context.variables["calendar.available_slots"];
  const slotStrings = Array.isArray(slots) ? slots.filter((s): s is string => typeof s === "string") : [];
  const slotList = humanSlotList(slotStrings);

  const workflowMap = graph.executionOrder
    .map((node) => `- ${nodeLabel(node, node.id)} (${nodeCapability(node)})`)
    .join("\n");

  const now = new Date();

  const turnState = `
Current state this turn (internal — never read this aloud):
- Caller name collected: ${conversation.collectedName || "NOT YET — ask before confirming any booking"}
- Caller phone collected: ${conversation.collectedPhone || "NOT YET — ask before confirming any booking"}
- Time chosen: ${stringVariable(context, "selected.slot") ? humanSlotLabel(stringVariable(context, "selected.slot")) : "not chosen yet"}
- Requested service: ${stringVariable(context, "service") || business.appointmentService}
- Booking completed THIS turn: ${turn.bookedThisTurn ? `YES — confirmed for ${humanSlotLabel(stringVariable(context, "selected.slot"))}. Confirm it naturally.${turn.smsThisTurn ? " Mention the details will be texted." : " Do not mention any text or SMS."}` : "NO — never say an appointment is booked or confirmed this turn."}
${slotStrings.length > 0 ? `- Available times returned by the calendar (offer only these; if there are many, mention about five and ask morning or afternoon): ${slotList}` : ""}
${turn.missingVariables.length > 0 ? `- Before the next step can happen you still need: ${describeMissingVariables(turn.missingVariables)}. Ask for exactly that now.` : ""}
${conversation.detailsComplaint ? "- The caller pointed out you did not collect their details. Apologize briefly and ask for their full name and phone number now." : ""}

Opening line you already said when the conversation started:
${firstMessage}

Internal workflow map (never mention to the caller):
${workflowMap}
`.trim();

  return buildAgentSystemPrompt({
    assistantName: business.assistantName,
    businessName: business.name,
    businessType: business.type,
    services: business.services,
    faqs: business.faqs,
    timezoneText: business.timezone,
    currentDateTimeText: now.toLocaleString("en-US", { timeZone: business.timezone }),
    currentDateText: dateInZone(now, business.timezone),
    tomorrowDateText: dateInZone(addDaysUtc(now, 1), business.timezone),
    capabilities: {
      canCheckAvailability: hasCapability(tools, "calendar.check_availability"),
      canBook: hasCapability(tools, "calendar.book_appointment"),
      canText: hasCapability(tools, "sms.send")
    },
    nodeInstructions,
    extraSections: [turnState]
  });
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/* --------------------------- deterministic reply --------------------------- */

function askForMissing(missing: string[], slotLabel: string): string {
  // A time comes first: without it, name/phone questions are premature.
  if (missing.includes("selected.slot")) {
    return "Of course, I can help you with that. What day and time work best for you?";
  }

  const intro = slotLabel ? `Great, ${slotLabel} works.` : "Perfect.";
  const wantsName = missing.includes("customer.name");
  const wantsPhone = missing.includes("customer.phone");

  if (wantsName && wantsPhone) return `${intro} Can I have your full name and the best phone number to confirm?`;
  if (wantsName) return `${intro} Can I have your full name to confirm?`;
  if (wantsPhone) return `${intro} And what's the best phone number to reach you?`;

  return `${intro} Could you share ${describeMissingVariables(missing)}?`;
}

/** Generic knowledge lookup: match question words against FAQs/instructions. */
function answerFromKnowledge(params: {
  message: string;
  business: AgentBusinessContext;
  nodeInstructions: string;
}): string {
  const { message, business, nodeInstructions } = params;
  const questionWords = new Set(
    message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );

  const knowledgeLines = [
    ...business.faqs,
    ...nodeInstructions.split("\n").map((line) => line.trim()).filter((line) => line.length > 10)
  ];

  let best: { line: string; score: number } | null = null;

  for (const line of knowledgeLines) {
    const lineWords = line.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    const score = lineWords.filter((word) => questionWords.has(word)).length;

    if (score >= 2 && (!best || score > best.score)) best = { line, score };
  }

  if (best) return best.line;

  return `I'm sorry, I don't have that detail on hand right now — the ${business.name} team can confirm it for you. Is there anything else I can help you with?`;
}

/**
 * Fallback reply used when no LLM key is configured. Small and generic: it is
 * driven entirely by the connected tools, the node prompt/knowledge, and the
 * current turn state — no business-specific script.
 */
function fallbackReply(params: {
  context: AgentRuntimeContext;
  tools: AgentTool[];
  nodeInstructions: string;
  firstMessage: string;
}): string {
  const { context, tools, nodeInstructions, firstMessage } = params;
  const { business, conversation, turn } = context;
  const message = context.userMessage;
  const canOfferSlots = hasCapability(tools, "calendar.check_availability");
  const canBook = hasCapability(tools, "calendar.book_appointment");
  const canText = hasCapability(tools, "sms.send");
  const selectedSlot = stringVariable(context, "selected.slot");

  if (conversation.ending) {
    const configured = stringVariable(context, "flow.closing_message");

    return configured || `You're all set. Thanks for calling ${business.name}, and have a great day.`;
  }

  if (isPureGreeting(message)) return firstMessage;

  // Identity questions always answer with the configured assistant name.
  if (/\b(what('?s| is) your name|who are you|who am i (speaking|talking) (to|with))\b/i.test(message)) {
    return `My name is ${business.assistantName}. I help ${business.name} with calls, questions, and appointments.`;
  }

  if (conversation.detailsComplaint) {
    return "You're right, I'm sorry about that. Can I have your full name and the best phone number to reach you?";
  }

  // Message-taking: the caller's turn after "what would you like me to pass
  // along?" is the message itself — acknowledge it, then collect contact info.
  if (conversation.messageFollowUp) {
    if (!conversation.collectedName || !conversation.collectedPhone) {
      return "Got it — I'll pass that along to the team. Can I have your name and the best number to reach you?";
    }

    return `Thanks, ${conversation.collectedName.split(" ")[0] ?? ""} — I'll pass that along and the team will get back to you soon. Is there anything else I can help you with?`;
  }

  if (conversation.wantsMessage) {
    return "Sure, I can take a message for the team. What would you like me to pass along?";
  }

  // Vague opener: ask what they want instead of reading a menu.
  if (conversation.vagueQuestion) {
    return "Of course — what would you like to know?";
  }

  if (turn.bookedThisTurn) {
    const name = conversation.collectedName.split(" ")[0] ?? "";
    const smsNote = turn.smsThisTurn ? " We'll text the details to you shortly." : "";

    return `Perfect${name ? `, ${name}` : ""}, you're booked for ${humanSlotLabel(selectedSlot)}.${smsNote} Is there anything else I can help you with?`;
  }

  if (turn.smsThisTurn) {
    return "Got it — I'll send that to your phone shortly. Is there anything else I can help you with?";
  }

  // Active scheduling thread this turn.
  if (conversation.schedulingIntent && conversation.currentContributes) {
    const slots = context.variables["calendar.available_slots"];
    const slotStrings = Array.isArray(slots) ? slots.filter((s): s is string => typeof s === "string") : [];

    // Offer times before asking for anything else. Keep the spoken list
    // voice-friendly: with many openings, mention a subset and narrow down.
    if (turn.slotsOffered && slotStrings.length > 0 && !selectedSlot) {
      if (slotStrings.length > 6) {
        return `I have several openings, including ${humanSlotList(slotStrings.slice(0, 5))}. Would you prefer morning or afternoon?`;
      }

      return `Of course, I can help you with that. I have ${humanSlotList(slotStrings)} available. Which time works best for you?`;
    }

    if (turn.missingVariables.length > 0) {
      return askForMissing(turn.missingVariables, selectedSlot ? humanSlotLabel(selectedSlot) : "");
    }

    if (canBook && !selectedSlot) {
      return "Of course, I can help you with that. What day and time work best for you?";
    }

    if (!canOfferSlots && !canBook) {
      return canText
        ? `I can take your details and have the ${business.name} team follow up with you by text. Could I have your name and phone number?`
        : `I can take a message and have the ${business.name} team get back to you. Could I have your name and phone number?`;
    }
  }

  if (conversation.smsRequested) {
    if (!canText) return `I can pass that along to the ${business.name} team for you. Is there anything else I can help you with?`;

    return conversation.collectedPhone
      ? "Sure, I'll send that to your phone shortly. Is there anything else I can help you with?"
      : "Sure, I can text that to you. What's the best phone number to send it to?";
  }

  if (conversation.isQuestion) {
    return answerFromKnowledge({ message, business, nodeInstructions });
  }

  if (canOfferSlots || canBook) {
    return `I can help you book an appointment, check available times, or take a message for ${business.name}. What would you like to do?`;
  }

  return `I can answer questions or take a message for ${business.name}. What would you like to do?`;
}

/* --------------------------- graph capabilities --------------------------- */

export type WorkflowCapabilities = {
  canCheckAvailability: boolean;
  canBook: boolean;
  canText: boolean;
  canEmail: boolean;
  hasEnd: boolean;
  hasAi: boolean;
};

/** Capabilities of the connected graph — for deploy-time prompts and logging. */
export function workflowCapabilities(workflowJson: unknown, channel: AgentChannel = "phone_call"): WorkflowCapabilities {
  const graph = parseGraph(workflowJson, channel);
  const tools = aiTools(graph);

  return {
    canCheckAvailability: hasCapability(tools, "calendar.check_availability"),
    canBook: hasCapability(tools, "calendar.book_appointment"),
    canText: hasCapability(tools, "sms.send"),
    canEmail: hasCapability(tools, "email.send"),
    hasEnd: hasCapability(tools, "flow.end"),
    hasAi: Boolean(findAiNode(graph))
  };
}

/* ------------------------------- entry point ------------------------------ */

export type AgentWorkflowInput = {
  channel: AgentChannel;
  /** "call_start" plays the greeting; "user_message" runs a normal turn. */
  event?: "call_start" | "user_message";
  message: string;
  history: AgentMessage[];
  business: AgentBusinessContext;
  caller: AgentCallerContext;
};

export type AgentWorkflowResult = {
  reply: string;
  executedNodes: AgentRuntimeLog[];
  toolCalls: AgentToolCall[];
  variables: Record<string, unknown>;
  capabilities: { canOfferSlots: boolean; canBook: boolean; canText: boolean; hasEnd: boolean; hasAi: boolean };
  turn: AgentRuntimeContext["turn"];
};

export async function runAgentWorkflow(params: {
  workflowId: string;
  workflowJson: unknown;
  mode: AgentRuntimeMode;
  input: AgentWorkflowInput;
  providers: AgentProviders;
}): Promise<AgentWorkflowResult> {
  const { workflowId, workflowJson, mode, input, providers } = params;
  const graph = parseGraph(workflowJson, input.channel);
  const aiNode = findAiNode(graph);
  const tools = aiTools(graph);

  // Assistant identity source of truth: configured context (buyer/test) first,
  // then the AI node's configured name (template preview), then the generic
  // fallback. Never a hidden persona name.
  const business: AgentBusinessContext = {
    ...input.business,
    assistantName: resolveAssistantName(input.business.assistantName, asString(aiNode?.data?.assistantName)),
    name: resolveBusinessName(input.business.name)
  };

  const firstMessage = firstMessageOf(aiNode, business);
  const nodeInstructions = aiNodeInstructions(aiNode);

  const capabilities = {
    canOfferSlots: hasCapability(tools, "calendar.check_availability"),
    canBook: hasCapability(tools, "calendar.book_appointment"),
    canText: hasCapability(tools, "sms.send"),
    hasEnd: hasCapability(tools, "flow.end"),
    hasAi: Boolean(aiNode)
  };

  // Call start: connect the trigger and speak the AI node's opening line.
  if (input.event === "call_start") {
    const executedNodes: AgentRuntimeLog[] = [];

    if (graph.startNode) {
      executedNodes.push({
        nodeId: graph.startNode.id,
        label: nodeLabel(graph.startNode, "Trigger"),
        status: "success",
        message: "Conversation connected (no telephony provider used in this mode)."
      });
    }

    executedNodes.push(
      aiNode
        ? { nodeId: aiNode.id, label: nodeLabel(aiNode, "AI Conversation"), status: "success", message: "Spoke opening greeting." }
        : { nodeId: "ai-missing", label: "AI Conversation", status: "waiting", message: "No AI conversation node is connected; replies use a generic receptionist." }
    );

    return {
      reply: firstMessage,
      executedNodes,
      toolCalls: [],
      variables: {},
      capabilities,
      turn: { bookedThisTurn: false, smsThisTurn: false, slotsOffered: false, missingVariables: [], endReached: false }
    };
  }

  const conversation = inferConversationState({
    history: input.history,
    message: input.message,
    caller: input.caller,
    business
  });

  const context: AgentRuntimeContext = {
    mode,
    channel: input.channel,
    workflowId,
    currentNodeId: "",
    userMessage: input.message,
    history: input.history,
    variables: {},
    business,
    caller: input.caller,
    conversation,
    turn: { bookedThisTurn: false, smsThisTurn: false, slotsOffered: false, missingVariables: [], endReached: false },
    executedNodes: [],
    toolCalls: []
  };

  seedConversationVariables(context);

  for (const node of graph.executionOrder) {
    const result = await executeNode(node, context, providers);

    // A waiting node (missing required inputs) blocks everything downstream.
    if (result.status === "waiting") break;
  }

  let reply: string;

  try {
    const llmReply = await providers.llm.complete({
      systemPrompt: buildRuntimeSystemPrompt({ context, tools, nodeInstructions, firstMessage, graph }),
      history: input.history,
      message: input.message
    });

    reply = llmReply || fallbackReply({ context, tools, nodeInstructions, firstMessage });
  } catch (error) {
    context.executedNodes.push({
      nodeId: "agent-runtime-llm",
      label: "LLM",
      status: "error",
      message: error instanceof Error ? error.message : "LLM failed; fallback reply used."
    });

    reply = fallbackReply({ context, tools, nodeInstructions, firstMessage });
  }

  // Anti-loop guard: never say the exact same thing twice in a row. If the
  // computed reply matches the previous assistant turn, clarify instead.
  const lastAssistantReply = [...input.history].reverse().find((item) => item.role === "assistant")?.content ?? "";

  if (reply.trim() === lastAssistantReply.trim()) {
    reply = "Sorry — could you tell me a bit more about what you need? I want to make sure I help with the right thing.";
  }

  setReplyVariable(context, reply);

  return {
    reply,
    executedNodes: context.executedNodes,
    toolCalls: context.toolCalls,
    variables: context.variables,
    capabilities,
    turn: context.turn
  };
}

function setReplyVariable(context: AgentRuntimeContext, reply: string): void {
  context.variables["ai.reply"] = reply;
}
