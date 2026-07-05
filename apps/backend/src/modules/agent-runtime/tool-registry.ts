import { VOICE_NODE_TYPES, getNodeDefinition } from "@coreai/shared";
import { asString } from "./runtime-context";

export type GraphNode = {
  id: string;
  data?: Record<string, unknown>;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export function nodeLabel(node: GraphNode | null | undefined, fallback: string): string {
  if (!node) return fallback;

  return asString(node.data?.label) || asString(node.data?.title) || fallback;
}

export function nodeType(node: GraphNode | null | undefined): string {
  return asString(node?.data?.type);
}

export function nodeKind(node: GraphNode | null | undefined): string {
  return asString(node?.data?.nodeKind);
}

function connectorOf(node: GraphNode | null | undefined): string {
  return asString(node?.data?.connector).toLowerCase();
}

function connectorAction(node: GraphNode | null | undefined): string {
  return asString(node?.data?.connectorAction).toLowerCase();
}

/**
 * Capability slug for a node. Prefers the shared node-registry metadata; falls
 * back to structural classification for nodes the registry doesn't know.
 */
export function nodeCapability(node: GraphNode): string {
  const type = nodeType(node);
  const fromRegistry = type ? getNodeDefinition(type)?.capability : undefined;

  if (fromRegistry) return fromRegistry;

  if (type === VOICE_NODE_TYPES.phoneCallTrigger) return "trigger.phone_call";
  if (type === VOICE_NODE_TYPES.voiceConversation) return "ai.conversation";
  if (type === VOICE_NODE_TYPES.calendarAvailability) return "calendar.check_availability";
  if (type === VOICE_NODE_TYPES.bookAppointment) return "calendar.book_appointment";
  if (type === VOICE_NODE_TYPES.sendSms) return "sms.send";
  if (type === VOICE_NODE_TYPES.endFlow) return "flow.end";

  const kind = nodeKind(node);
  const action = connectorAction(node);
  const connector = connectorOf(node);
  const title = `${asString(node.data?.title)} ${asString(node.data?.label)}`.toLowerCase();

  if (kind === "trigger") {
    return connector === "sms" || title.includes("sms") ? "trigger.sms" : "trigger.phone_call";
  }

  if (kind === "ai") return "ai.conversation";
  if (action.startsWith("check") || action.includes("availab")) return "calendar.check_availability";
  if (action.includes("book")) return "calendar.book_appointment";
  if (action.includes("send_sms") || action.includes("send_notification") || ((connector === "sms" || connector === "twilio") && kind === "connector")) {
    return "sms.send";
  }
  if (title.includes("end flow") || title.includes("end call") || kind === "output") return "flow.end";
  if (kind === "condition") return "logic.condition";

  return "node.generic";
}

/** Variables a node needs before it can execute (registry metadata first). */
export function nodeRequiredVariables(node: GraphNode): string[] {
  const type = nodeType(node);
  const fromRegistry = type ? getNodeDefinition(type)?.requiredVariables : undefined;

  if (fromRegistry) return fromRegistry;

  const capability = nodeCapability(node);

  if (capability === "calendar.book_appointment") {
    return ["customer.name", "customer.phone", "selected.slot", "service"];
  }

  if (capability === "sms.send") return ["customer.phone"];

  return [];
}

export type AgentTool = {
  capability: string;
  nodeId: string;
  label: string;
  requiredVariables: string[];
};

/**
 * Tools the AI conversation can use this turn: the capability of every node
 * reachable downstream of the AI node in the connected graph. A node sitting
 * on the canvas without a path from the AI node is never offered as a tool.
 */
export function collectDownstreamTools(params: {
  fromNodeId: string;
  outgoing: Map<string, string[]>;
  nodeById: Map<string, GraphNode>;
}): AgentTool[] {
  const { fromNodeId, outgoing, nodeById } = params;
  const visited = new Set<string>();
  const queue = [...(outgoing.get(fromNodeId) ?? [])];
  const tools: AgentTool[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();

    if (!currentId || visited.has(currentId)) continue;

    visited.add(currentId);

    const node = nodeById.get(currentId);

    if (node) {
      tools.push({
        capability: nodeCapability(node),
        nodeId: node.id,
        label: nodeLabel(node, node.id),
        requiredVariables: nodeRequiredVariables(node)
      });
    }

    queue.push(...(outgoing.get(currentId) ?? []));
  }

  return tools;
}

export function hasCapability(tools: AgentTool[], capability: string): boolean {
  return tools.some((tool) => tool.capability === capability);
}
